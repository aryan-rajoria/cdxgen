/**
 * Batched registry HTTP, via `cdxrs fetch` when it is available and a JS pool
 * otherwise.
 *
 * The registry metadata functions in `lib/ecosystems/ecosystems.js` know every
 * URL they are going to need before they need any of them, but fetch them one
 * at a time with an `await` in a `for` body. That is the cost this module
 * removes: the URLs are handed off in a single batch, fetched concurrently with
 * a shared per-host rate policy, and returned as a map that the existing loops
 * read instead of the network.
 *
 * There is one policy layer (`fetchRate.js`, mirrored by the Rust `rate.rs`)
 * and two transports. When the `cdxrs` binary is available it is preferred,
 * because it brings an on-disk conditional cache (D26) the JS pool does not
 * have. When it is absent, disabled, or unusable, the JS pool runs every
 * request through `cdxgenAgent` so the secure-mode host allowlist, the
 * activity recorder and the test cassette interceptor all still apply.
 *
 * Two properties are deliberate and load-bearing:
 *
 * 1. **No field derivation happens here or in Rust.** Both transports return
 *    registry documents verbatim; every `p.description`, `p.license`,
 *    provenance property and SPDX lookup is still computed by the same
 *    JavaScript that computes it on the serial path. Neither transport can
 *    therefore produce a different SBOM — both can only produce the same one
 *    sooner. An earlier design derived fields in Rust and diverged from the
 *    JS on all three registries it covered.
 *
 * 2. **Fallback is per URL, not per run.** A URL that the batch could not
 *    resolve for a transport reason is simply absent from the map, and the
 *    caller's own `cdxgenAgent.get` runs for it exactly as before. A URL that
 *    resolved to a definite HTTP error is recorded as such, so the caller does
 *    not re-request it only to get the same 404.
 */

import process from "node:process";

import { cdxgenAgent, DEBUG_MODE } from "../core/activity.js";
import { resolveCacheDir } from "./cacheDir.js";
import { cdxrsAvailable, runCdxrs } from "./cdxrs.js";
import {
  credentialsFor,
  DEFAULT_GLOBAL_CONCURRENCY,
  makeSemaphore,
  policyFor,
  RateLimiter,
} from "./fetchRate.js";

/** Envelope version understood by this bridge; must match Rust's. */
const BATCH_SCHEMA_VERSION = 1;

/**
 * Timeout for one batch. Registry I/O for a large project legitimately takes
 * minutes on a cold cache, so this is far longer than the bridge default; both
 * the Rust subprocess and each JS request bound themselves on their own.
 */
const DEFAULT_BATCH_TIMEOUT_MS = 600_000;

/**
 * Maximum retry attempts for a transient failure (5xx, 429, transport errors).
 * Matches the Rust client's `MAX_RETRIES` so the two transports have the same
 * retry budget.
 */
const MAX_RETRIES = 3;

/**
 * Cap for exponential backoff, including jitter. Matches `rate.rs`/`client.rs`.
 */
const BACKOFF_CAP_MS = 30_000;

let _availabilityChecked = false;
let _available = false;

// ---------------------------------------------------------------------------
// JS batcher state.
//
// The in-flight map deduplicates concurrent requests for the same URL *across*
// batches: two `prefetchJson` calls that overlap in time and share a URL share
// a single HTTP request. The per-batch deduplication (identical URLs in the
// same request list) is handled by the `seen` Set before dispatch. Together
// these guarantee one request per unique URL under concurrency, which the
// serial path got for free from `await`-in-a-loop and which the in-memory
// `responseCache` cannot provide because it is populated only after a response
// arrives (and is disabled entirely under `CDXGEN_NO_CACHE`).
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<BatchEntry>>} Keyed by `${url}|${accept}|${authRealm}`. */
const _inFlight = new Map();

/** @type {Map<string, {sem: ReturnType<typeof makeSemaphore>, limiter: RateLimiter}>} */
const _hostSemaphores = new Map();

/** @type {Map<string, RateLimiter>} Kept for the external-delay count; cleared on reset. */
const _hostLimiters = new Map();

const _globalSemaphore = makeSemaphore(DEFAULT_GLOBAL_CONCURRENCY);

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
 * Reset the memoized availability probe and the JS batcher's in-flight map.
 * Tests only.
 */
export function resetBatchFetchAvailability() {
  _availabilityChecked = false;
  _available = false;
  _lastStats = null;
  _inFlight.clear();
  _hostSemaphores.clear();
  _hostLimiters.clear();
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
 * Dispatches to the Rust subprocess when it is available (it brings the D26
 * on-disk cache), and to the JS pool otherwise. Both transports return a map
 * keyed by URL with the same entry shape, so callers do not know — and do not
 * need to know — which one ran.
 *
 * @param {Array<{url: string, accept?: string, authRealm?: string, responseType?: ("json"|"text"|"buffer"), headers?: Object}>} requests
 *   URLs to fetch. Duplicates are fine; they are coalesced.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] Override the Rust batch timeout.
 * @returns {Promise<Map<string, BatchEntry>>} Map keyed by URL. Empty when
 *   prefetching is disabled (cassette replay) or the request list is empty;
 *   never empty for "no binary", which is the whole point of the JS pool.
 */
export async function prefetchJson(requests, options = {}) {
  const empty = new Map();
  if (!Array.isArray(requests) || !requests.length) {
    return empty;
  }
  if (!prefetchEnabled()) {
    return empty;
  }

  // The URL is the correlation id: callers look results up by the URL they
  // were going to request anyway, so there is no separate id to keep in sync.
  const seen = new Set();
  const unique = [];
  for (const request of requests) {
    if (!request?.url || seen.has(request.url)) {
      continue;
    }
    seen.add(request.url);
    unique.push(request);
  }
  if (!unique.length) {
    return empty;
  }

  if (batchFetchAvailable()) {
    return await rustBatchFetch(unique, options);
  }
  return await jsBatchFetch(unique);
}

/**
 * Run the batch through the `cdxrs fetch` subprocess and translate its
 * envelope into the shared result shape.
 *
 * @param {Array<{url: string, accept?: string, authRealm?: string}>} unique
 *   Already deduplicated by URL.
 * @param {Object} options Options with `timeoutMs`.
 * @returns {Promise<Map<string, BatchEntry>>}
 */
async function rustBatchFetch(unique, options) {
  const payload = { requests: [] };
  for (const request of unique) {
    payload.requests.push({
      id: request.url,
      url: request.url,
      ...(request.accept ? { accept: request.accept } : {}),
      ...(request.authRealm ? { authRealm: request.authRealm } : {}),
    });
  }

  const { ok, stdout, reason } = await runCdxrs("fetch", {
    content: JSON.stringify(payload),
    timeoutMs: options.timeoutMs || DEFAULT_BATCH_TIMEOUT_MS,
    args: buildCacheArgs(),
  });
  if (!ok) {
    if (DEBUG_MODE && reason !== "disabled" && reason !== "binary-not-found") {
      console.log(
        `cdxrs fetch unavailable (${reason}); falling back to the JS batch pool.`,
      );
    }
    // The Rust path failed in a way that is not "binary absent". Fall through
    // to the JS pool rather than returning an empty map, so a transient cdxrs
    // crash does not take the whole batch's concurrency with it.
    return await jsBatchFetch(unique);
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (_err) {
    return await jsBatchFetch(unique);
  }
  if (envelope?.schemaVersion !== BATCH_SCHEMA_VERSION) {
    // A binary from a different generation of this protocol is not something
    // to guess at. Fall back rather than misread its output.
    if (DEBUG_MODE) {
      console.log(
        `cdxrs fetch envelope version ${envelope?.schemaVersion} != ${BATCH_SCHEMA_VERSION}; falling back to the JS batch pool.`,
      );
    }
    return await jsBatchFetch(unique);
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
 * Resolve or create the per-host semaphore and rate limiter.
 *
 * @param {string} host Lowercased hostname.
 * @returns {{sem: ReturnType<typeof makeSemaphore>, limiter: RateLimiter}}
 */
function getHostControls(host) {
  let entry = _hostSemaphores.get(host);
  if (!entry) {
    const policy = policyFor(host, credentialsFor(host));
    entry = {
      sem: makeSemaphore(policy.maxConcurrency),
      limiter: new RateLimiter(policy.minInterval),
    };
    _hostSemaphores.set(host, entry);
    _hostLimiters.set(host, entry.limiter);
  }
  return entry;
}

/**
 * Extract the hostname from a URL, returning null when the URL cannot be
 * parsed. Matching `client.rs::extract_host`.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractHost(url) {
  try {
    return new URL(url).hostname;
  } catch (_err) {
    return null;
  }
}

/**
 * Resolve an Authorization header to attach for this URL's host, if any.
 *
 * Mirrors the Rust client: only GitHub hosts get the token, and only when
 * `GITHUB_TOKEN` is set. The value is never logged.
 *
 * @param {string} host
 * @returns {{Authorization: string}|undefined}
 */
function resolveAuthHeader(host) {
  if (!host) {
    return undefined;
  }
  const lower = host.toLowerCase();
  const isGitHub =
    lower === "api.github.com" ||
    lower === "github.com" ||
    lower.endsWith(".github.com");
  if (isGitHub && process.env.GITHUB_TOKEN) {
    return { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` };
  }
  return undefined;
}

/**
 * Build the `cdxgenAgent.get` options for one request.
 *
 * @param {Object} request The batch request.
 * @param {string} host The request host, for auth resolution.
 * @returns {Object} Options for `cdxgenAgent.get`.
 */
function buildAgentOptions(request, host) {
  const options = {
    responseType: request.responseType || "json",
  };
  const headers = { ...(request.headers || {}) };
  if (request.accept) {
    headers.Accept = request.accept;
  }
  const auth = resolveAuthHeader(host);
  if (auth) {
    headers.Authorization = auth.Authorization;
  }
  if (Object.keys(headers).length) {
    options.headers = headers;
  }
  return options;
}

/**
 * Parse a server-supplied back-off, in milliseconds.
 *
 * `Retry-After` may be seconds or an HTTP-date; `X-RateLimit-Reset` /
 * `RateLimit-Reset` is a Unix timestamp. Returns null when no recognised
 * header is present, so the caller can fall back to exponential backoff.
 * Ported from `client.rs::parse_retry_after`.
 *
 * @param {Object} response The `cdxgenAgent` response or HTTPError response.
 * @returns {number|null} Delay in milliseconds, or null.
 */
function parseRetryAfter(response) {
  const headers = response?.headers || {};
  const retryAfter = headers["retry-after"] || headers["Retry-After"];
  if (retryAfter) {
    const trimmed = String(retryAfter).trim();
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && trimmed === String(seconds)) {
      return seconds * 1000;
    }
    // HTTP-date form.
    const target = Date.parse(trimmed);
    if (Number.isFinite(target)) {
      const delay = target - Date.now();
      return delay > 0 ? delay : 0;
    }
  }
  // GitHub sends the reset timestamp rather than Retry-After.
  for (const name of ["x-ratelimit-reset", "ratelimit-reset"]) {
    const value = headers[name];
    if (value === undefined) {
      continue;
    }
    const ts = Number.parseInt(String(value).trim(), 10);
    if (!Number.isFinite(ts)) {
      continue;
    }
    const now = Math.floor(Date.now() / 1000);
    if (ts > now) {
      return (ts - now) * 1000;
    }
    // A small value (< 1h) is a delta, a large one is an absolute timestamp.
    if (ts < 3600) {
      return ts * 1000;
    }
  }
  return null;
}

/**
 * Exponential backoff with full jitter, capped at {@link BACKOFF_CAP_MS}.
 * Matches `client.rs::exponential_backoff`.
 *
 * @param {number} attempt 1-based attempt number.
 * @returns {number} Delay in milliseconds.
 */
function exponentialBackoffMs(attempt) {
  const shift = Math.min(attempt, 8);
  const baseMs = 100 * (1 << shift);
  const jitter = Math.floor(Math.random() * (baseMs + 1));
  return Math.min(baseMs + jitter, BACKOFF_CAP_MS);
}

/**
 * Issue one request through `cdxgenAgent`, with bounded retries for transient
 * failures and server-supplied back-offs.
 *
 * The caller already holds the global and per-host permits; this function
 * consults the per-host rate limiter on every attempt (including retries) and
 * pushes the gate out when the server asks us to slow down, matching the
 * Rust client's retry loop.
 *
 * @param {Object} request The batch request.
 * @param {RateLimiter} limiter The per-host rate limiter.
 * @returns {Promise<BatchEntry>}
 */
async function issueWithRetries(request, limiter) {
  const host = extractHost(request.url);
  const options = buildAgentOptions(request, host);
  let attempt = 0;
  while (true) {
    attempt++;
    await limiter.wait();
    let result;
    try {
      const res = await cdxgenAgent.get(request.url, options);
      result = {
        retryable: false,
        delay: null,
        entry: { ok: true, body: res.body, status: res.statusCode },
      };
    } catch (err) {
      result = classifyAgentError(err);
    }
    if (result.retryable && attempt <= MAX_RETRIES) {
      const delay =
        result.delay !== null && result.delay !== undefined
          ? result.delay
          : exponentialBackoffMs(attempt);
      // A server-supplied delay wins over our own backoff and is recorded
      // against the host bucket so the next attempt respects it too.
      if (result.delay !== null && result.delay !== undefined) {
        limiter.externalDelay(delay);
      }
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      continue;
    }
    return result.entry;
  }
}

/**
 * Classify an error thrown by `cdxgenAgent.get` into a retry decision and the
 * batch entry to record when retries are exhausted.
 *
 * @param {Error} err
 * @returns {{retryable: boolean, delay: number|null, entry: BatchEntry}}
 */
function classifyAgentError(err) {
  // Secure-mode and dry-run blocks must not be retried, and the caller's own
  // fallback `cdxgenAgent.get` will surface the same error. Recording this as
  // non-definite lets the caller's catch run exactly as it would on the serial
  // path.
  if (err?.options?.context?.activityBlocked) {
    return {
      retryable: false,
      delay: null,
      entry: { ok: false, status: undefined, definite: false },
    };
  }
  const status = err?.response?.statusCode;
  const headers = err?.response?.headers;
  if (status === 429) {
    return {
      retryable: true,
      delay: parseRetryAfter({ headers }),
      entry: { ok: false, status, definite: false },
    };
  }
  if (status >= 500 && status < 600) {
    return {
      retryable: true,
      delay: null,
      entry: { ok: false, status, definite: false },
    };
  }
  if (status >= 400 && status < 500) {
    return {
      retryable: false,
      delay: null,
      entry: { ok: false, status, definite: true },
    };
  }
  // Transport error (timeout, connection reset). The name check mirrors how
  // httpClient.js distinguishes its two error classes.
  if (err?.name === "RequestError") {
    return {
      retryable: true,
      delay: null,
      entry: { ok: false, status: undefined, definite: false },
    };
  }
  // Unknown error shape: do not retry, let the caller's fallback decide.
  return {
    retryable: false,
    delay: null,
    entry: { ok: false, status, definite: false },
  };
}

/**
 * Fetch one URL with global + per-host concurrency control.
 *
 * Permits are held for the whole retry sequence, including back-off sleeps, so
 * a host that is asking us to slow down does not get four more slots opened
 * against it in the meantime. The in-flight counter is incremented after both
 * permits are acquired, so the peak it records is real HTTP concurrency rather
 * than tasks queued behind the semaphores; it matches the Rust client's
 * `InFlightGuard`.
 *
 * @param {Object} request
 * @param {{inFlight: number, peak: number}} gauge Batch-scoped concurrency
 *   gauge. Scoped to one batch rather than to the module so that the peak a
 *   batch reports describes that batch: a process-wide high-water mark would
 *   report the widest batch so far for every batch after it, including a
 *   single-URL one, and so could not evidence that any given batch fanned out.
 * @returns {Promise<BatchEntry>}
 */
async function fetchOne(request, gauge) {
  const host = extractHost(request.url);
  if (!host) {
    return { ok: false, status: undefined, definite: false };
  }
  const controls = getHostControls(host);
  const releaseGlobal = await _globalSemaphore.acquire();
  const releaseHost = await controls.sem.acquire();
  gauge.inFlight += 1;
  if (gauge.inFlight > gauge.peak) {
    gauge.peak = gauge.inFlight;
  }
  try {
    return await issueWithRetries(request, controls.limiter);
  } finally {
    gauge.inFlight -= 1;
    releaseHost();
    releaseGlobal();
  }
}

/**
 * Dedupe key for an in-flight request: the URL, plus everything that changes
 * which response the caller gets back. That is the headers which change what
 * the server returns, and the decode mode, which changes how the same bytes are
 * handed over — two callers wanting one URL as JSON and as text cannot share a
 * promise. Raw credential values are never part of the key; `authRealm` is an
 * opaque label the caller chooses.
 *
 * @param {Object} request
 * @returns {string}
 */
function inFlightKey(request) {
  return [
    request.url,
    request.accept || "",
    request.authRealm || "",
    request.responseType || "json",
  ].join("|");
}

/**
 * Run the batch through the JS pool: every request goes through
 * `cdxgenAgent`, so the secure-mode host allowlist, the activity recorder and
 * the test cassette interceptor all still apply.
 *
 * @param {Array<{url: string, accept?: string, authRealm?: string, responseType?: ("json"|"text"|"buffer"), headers?: Object}>} unique
 *   Already deduplicated by URL.
 * @returns {Promise<Map<string, BatchEntry>>}
 */
async function jsBatchFetch(unique) {
  const started = Date.now();
  let ok = 0;
  let failures = 0;
  const results = new Map();
  // Concurrency is counted per batch. A request served from another batch's
  // in-flight promise is counted against that batch, not this one.
  const gauge = { inFlight: 0, peak: 0 };
  const tasks = unique.map(async (request) => {
    const key = inFlightKey(request);
    // Cross-batch in-flight dedupe. If another batch already has this URL in
    // flight, await its promise rather than issuing a second request. The
    // entry is removed when the promise settles, so a later request for the
    // same URL (after completion) goes through `responseCache` or, under
    // `CDXGEN_NO_CACHE`, issues a fresh request — which is correct.
    let promise = _inFlight.get(key);
    if (!promise) {
      promise = fetchOne(request, gauge);
      _inFlight.set(key, promise);
      // Remove on settle so the map does not grow unbounded and a later,
      // non-overlapping request for the same URL is not served a stale
      // in-flight promise.
      const clear = () => {
        const current = _inFlight.get(key);
        if (current === promise) {
          _inFlight.delete(key);
        }
      };
      promise.then(clear, clear);
    }
    const entry = await promise;
    if (entry.ok) {
      ok += 1;
    } else {
      failures += 1;
    }
    results.set(request.url, entry);
  });
  await Promise.all(tasks);

  _lastStats = {
    requests: unique.length,
    unique: unique.length,
    ok,
    failures,
    cacheHits: 0,
    elapsedMs: Date.now() - started,
    peakConcurrency: gauge.peak,
  };
  if (DEBUG_MODE) {
    const s = _lastStats;
    console.log(
      `js batch: ${s.requests} url(s), ${s.ok} ok, ${s.failures} failed, peak concurrency ${s.peakConcurrency}, ${s.elapsedMs} ms`,
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
 * The JS pool is always available (it is plain JavaScript through
 * `cdxgenAgent`), so this is true for every real run. The single exception is
 * cassette replay: the cassette interceptor lives inside undici inside this
 * process, and the golden harness asserts exact request ordering and counts.
 * The batch pool reorders requests by design, so it is disabled under replay
 * to keep the golden cassettes stable. `CDXGEN_RS_DISABLE=fetch` and
 * `--no-rust` disable only the Rust subprocess; the JS pool still runs, which
 * is the point of this round.
 *
 * @returns {boolean} True when prefetching is allowed.
 */
export function prefetchEnabled() {
  if (process.env.CDXGEN_CASSETTE_REPLAY === "true") {
    return false;
  }
  return true;
}
