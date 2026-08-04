/**
 * Batched registry HTTP, via `cdxrs fetch` when it is available.
 *
 * The registry metadata functions in `lib/ecosystems/ecosystems.js` know every
 * URL they are going to need before they need any of them, but fetch them one
 * at a time with an `await` in a `for` body. That is the cost this module
 * removes: the URLs are handed to `cdxrs fetch` in a single batch, fetched
 * concurrently with an on-disk conditional cache, and returned as a map that
 * the existing loops read instead of the network.
 *
 * Two properties are deliberate and load-bearing:
 *
 * 1. **No field derivation happens here or in Rust.** The Rust subcommand
 *    returns registry documents verbatim; every `p.description`, `p.license`,
 *    provenance property and SPDX lookup is still computed by the same
 *    JavaScript that computes it when the binary is missing. The Rust path
 *    therefore cannot produce a different SBOM — it can only produce the same
 *    one sooner. An earlier design derived fields in Rust and diverged from the
 *    JS on all three registries it covered.
 *
 * 2. **Fallback is per URL, not per run.** A URL that the batch could not
 *    resolve for a transport reason is simply absent from the map, and the
 *    caller's own `cdxgenAgent.get` runs for it exactly as before. A URL that
 *    resolved to a definite HTTP error is recorded as such, so the caller does
 *    not re-request it only to get the same 404.
 */

import process from "node:process";

import { DEBUG_MODE } from "../core/activity.js";
import { resolveCacheDir } from "./cacheDir.js";
import { cdxrsAvailable, runCdxrs } from "./cdxrs.js";

/** Envelope version understood by this bridge; must match Rust's. */
const BATCH_SCHEMA_VERSION = 1;

/**
 * Timeout for one batch. Registry I/O for a large project legitimately takes
 * minutes on a cold cache, so this is far longer than the bridge default; the
 * Rust side bounds each individual request on its own.
 */
const DEFAULT_BATCH_TIMEOUT_MS = 600_000;

let _availabilityChecked = false;
let _available = false;

/**
 * Statistics from the most recent batch, or null when no batch has run.
 *
 * Exposed so a test can assert that the Rust path was *used*, not merely
 * available: a silent fallback to the JS agent would otherwise make a parity
 * comparison compare the JS path with itself and pass.
 */
let _lastStats = null;

/**
 * @returns {Object|null} Stats from the last batch (requests, unique, ok,
 *   failures, cacheHits, elapsedMs, peakConcurrency), or null.
 */
export function lastBatchStats() {
  return _lastStats;
}

/**
 * Whether batched fetching through cdxrs is available.
 *
 * Memoized because the probe spawns the binary, and this is consulted once per
 * metadata function rather than once per run.
 *
 * @returns {boolean} True when `cdxrs fetch` can be used.
 */
export function batchFetchAvailable() {
  if (_availabilityChecked) {
    return _available;
  }
  _availabilityChecked = true;
  _available = cdxrsAvailable("fetch").available === true;
  return _available;
}

/**
 * Reset the memoized availability probe. Tests only.
 */
export function resetBatchFetchAvailability() {
  _availabilityChecked = false;
  _available = false;
  _lastStats = null;
}

/**
 * The outcome recorded for a single URL in a batch.
 *
 * @typedef {Object} BatchEntry
 * @property {boolean} ok Whether a body was obtained.
 * @property {*} [body] Parsed response body when `ok`.
 * @property {number} [status] HTTP status, when the server produced one.
 * @property {boolean} [definite] True when the status is a final answer (a 4xx
 *   other than 429) and re-requesting it in JS would be pointless.
 */

/**
 * Build the cdxrs fetch arguments for cache control.
 *
 * JS is the authority for the cache directory, so `--cache-dir` is always
 * passed when a directory resolves. `--no-cache` and `--cache-ttl` are passed
 * only when the user opts in.
 *
 * @returns {string[]} Extra args for `cdxrs fetch`.
 */
function buildCacheArgs() {
  const args = [];
  if (
    process.env.CDXGEN_NO_CACHE === "true" ||
    process.env.CDXGEN_NO_CACHE === "1"
  ) {
    args.push("--no-cache");
    return args;
  }
  const dir = resolveCacheDir();
  if (dir) {
    args.push("--cache-dir", dir);
  }
  if (process.env.CDXGEN_CACHE_TTL != null) {
    const ttl = Number.parseInt(process.env.CDXGEN_CACHE_TTL, 10);
    if (Number.isFinite(ttl) && ttl >= 0) {
      args.push("--cache-ttl", String(ttl));
    }
  }
  return args;
}

/**
 * Fetch a batch of registry URLs concurrently.
 *
 * @param {Array<{url: string, accept?: string, authRealm?: string}>} requests
 *   URLs to fetch. Duplicates are fine; they are coalesced.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] Override the batch timeout.
 * @returns {Promise<Map<string, BatchEntry>>} Map keyed by URL. Empty when the
 *   Rust path is unavailable or the batch could not run at all, which makes
 *   every caller fall back to its own serial requests.
 */
export async function prefetchJson(requests, options = {}) {
  const empty = new Map();
  if (!Array.isArray(requests) || !requests.length) {
    return empty;
  }
  if (!batchFetchAvailable()) {
    return empty;
  }

  // The URL is the correlation id: callers look results up by the URL they
  // were going to request anyway, so there is no separate id to keep in sync.
  const seen = new Set();
  const payload = { requests: [] };
  for (const request of requests) {
    if (!request?.url || seen.has(request.url)) {
      continue;
    }
    seen.add(request.url);
    payload.requests.push({
      id: request.url,
      url: request.url,
      ...(request.accept ? { accept: request.accept } : {}),
      ...(request.authRealm ? { authRealm: request.authRealm } : {}),
    });
  }
  if (!payload.requests.length) {
    return empty;
  }

  const { ok, stdout, reason } = await runCdxrs("fetch", {
    content: JSON.stringify(payload),
    timeoutMs: options.timeoutMs || DEFAULT_BATCH_TIMEOUT_MS,
    args: buildCacheArgs(),
  });
  if (!ok) {
    if (DEBUG_MODE && reason !== "disabled" && reason !== "binary-not-found") {
      console.log(
        `cdxrs fetch unavailable (${reason}); using serial JS requests.`,
      );
    }
    return empty;
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (_err) {
    return empty;
  }
  if (envelope?.schemaVersion !== BATCH_SCHEMA_VERSION) {
    // A binary from a different generation of this protocol is not something
    // to guess at. Fall back rather than misread its output.
    if (DEBUG_MODE) {
      console.log(
        `cdxrs fetch envelope version ${envelope?.schemaVersion} != ${BATCH_SCHEMA_VERSION}; using serial JS requests.`,
      );
    }
    return empty;
  }

  _lastStats = envelope.stats || null;
  const results = new Map();
  for (const result of envelope.results || []) {
    if (!result?.id) {
      continue;
    }
    if (result.ok) {
      results.set(result.id, { ok: true, body: result.body });
      continue;
    }
    // 4xx other than 429 is the registry's final answer. Anything else — a
    // timeout, a connection reset, an offline cache miss — is worth one more
    // try through the JS agent, which has its own proxy and auth handling.
    const status =
      typeof result.status === "number" ? result.status : undefined;
    const definite = status >= 400 && status < 500 && status !== 429;
    results.set(result.id, { ok: false, status, definite });
  }

  if (DEBUG_MODE && envelope.stats) {
    const s = envelope.stats;
    console.log(
      `cdxrs fetch: ${s.requests} url(s), ${s.unique} unique, ${s.ok} ok, ${s.failures} failed, ${s.cacheHits} cached, peak concurrency ${s.peakConcurrency}, ${s.elapsedMs} ms`,
    );
  }
  return results;
}

/**
 * Read a prefetched response, or signal that the caller should fetch it itself.
 *
 * @param {Map<string, BatchEntry>} prefetched Result of {@link prefetchJson}.
 * @param {string} url The URL the caller is about to request.
 * @returns {{body: *}|undefined} A response-shaped object when the body is
 *   available, or `undefined` when the caller should issue its own request.
 * @throws {Error} When the batch established a definite HTTP error for this
 *   URL, so that the caller's existing `catch` treats it exactly as it treats a
 *   failed `cdxgenAgent.get`.
 */
export function prefetchedResponse(prefetched, url) {
  const entry = prefetched?.get(url);
  if (!entry) {
    return undefined;
  }
  if (entry.ok) {
    return { body: entry.body };
  }
  if (entry.definite) {
    const err = new Error(`Request failed with status code ${entry.status}`);
    err.statusCode = entry.status;
    throw err;
  }
  return undefined;
}

/**
 * Whether batched prefetching should be attempted at all.
 *
 * Cassette replay intercepts undici inside this process, which a subprocess
 * cannot participate in; running the Rust path under replay would silently
 * reach the real network and leave the cassette unused. The replay harness sets
 * `CDXGEN_RS_DISABLE`, and this is the belt to that braces.
 *
 * @returns {boolean} True when prefetching is allowed.
 */
export function prefetchEnabled() {
  if (process.env.CDXGEN_CASSETTE_REPLAY === "true") {
    return false;
  }
  return batchFetchAvailable();
}
