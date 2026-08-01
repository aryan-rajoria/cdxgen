/**
 * HTTP cassette record/replay layer for golden SBOM tests.
 *
 * This module installs an interceptor into `lib/helpers/httpClient.js` (the
 * single network seam — every outbound HTTP request in cdxgen flows through
 * `createHttpClient()` → `doRequest()`).  See `setHttpInterceptor`.
 *
 * Modes:
 *
 * - **replay** (default for `test:golden`): serves responses from a committed
 *   cassette JSON file.  An unmatched request throws `CassetteMissError` so an
 *   accidental live-network call in CI is impossible to miss.
 * - **record**: lets requests through, captures both the request and response,
 *   and writes them to the cassette file on `stop()`.
 *
 * Cassette format (one JSON file per scenario):
 *
 * ```json
 * [
 *   {
 *     "request":  { "method": "GET", "url": "https://..." },
 *     "response": { "statusCode": 200, "headers": {...}, "body": {...} }
 *   }
 * ]
 * ```
 *
 * Matching is on `method` + full `url` (including query string).  This is
 * intentionally strict: a query-parameter change is a real signal that the
 * code path changed, and should be reviewed, not silently swallowed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  setHttpInterceptor,
  clearHttpInterceptor,
  CassetteMissError,
} from "../lib/core/httpClient.js";

export { CassetteMissError };

/**
 * Normalize a response body for storage in a cassette.
 * Buffers are stored as base64 with a marker; strings as-is; objects as-is.
 */
function encodeBody(body) {
  if (Buffer.isBuffer(body)) {
    return { __cassette_base64: body.toString("base64") };
  }
  return body;
}

/**
 * Decode a cassette body back to its original type.
 */
function decodeBody(stored) {
  if (stored && typeof stored === "object" && stored.__cassette_base64) {
    return Buffer.from(stored.__cassette_base64, "base64");
  }
  return stored;
}

/**
 * Build the cassette key for matching.  Method + full URL.
 */
function cassetteKey(method, url) {
  return `${method}:${url}`;
}

/**
 * Start replaying from a cassette file.
 *
 * Every HTTP request is matched against the cassette.  A hit returns the
 * recorded response; a miss throws `CassetteMissError`.
 *
 * @param {string} cassettePath Path to the cassette JSON file.
 * @returns {{ stop: () => void, missCount: number, hitCount: number }}
 *   A controller with a `stop()` method and live hit/miss counters.
 */
export function startReplay(cassettePath) {
  const interactions = existsSync(cassettePath)
    ? JSON.parse(readFileSync(cassettePath, "utf-8"))
    : [];

  const lookup = new Map();
  for (const entry of interactions) {
    const key = cassetteKey(entry.request.method, entry.request.url);
    lookup.set(key, entry.response);
  }

  let hitCount = 0;
  let missCount = 0;

  setHttpInterceptor(async (req) => {
    const key = cassetteKey(req.method, req.url.toString());
    const recorded = lookup.get(key);
    if (recorded) {
      hitCount++;
      return {
        statusCode: recorded.statusCode,
        headers: recorded.headers || {},
        body: decodeBody(recorded.body),
        rawBody: undefined,
        url: req.url.toString(),
        request: { options: req.options },
      };
    }
    missCount++;
    throw new CassetteMissError(req.method, req.url.toString());
  });

  return {
    stop() {
      clearHttpInterceptor();
    },
    get hitCount() {
      return hitCount;
    },
    get missCount() {
      return missCount;
    },
  };
}

/**
 * Start recording into a cassette file.
 *
 * Requests pass through to the live network.  Both request and response are
 * captured and written to the cassette file when `stop()` is called.
 *
 * @param {string} cassettePath Path to the cassette JSON file to write.
 * @returns {{ stop: () => void, recordCount: number }}
 *   A controller with a `stop()` method that flushes the cassette.
 */
export function startRecord(cassettePath) {
  const recordings = [];

  // In record mode, the interceptor wraps the eventual response. We return
  // null to let doRequest proceed, but we hook into the response promise to
  // capture the result. Since doRequest returns the response after our
  // interceptor returns null, we need a different approach.
  //
  // Instead, we wrap by returning a promise that resolves to null *after*
  // making the real request ourselves. But that would bypass the existing
  // request logic.
  //
  // The cleanest approach: install a capturing interceptor that returns null
  // (pass-through), then separately hook into createBom's output to correlate.
  // However, that misses the response.
  //
  // Better: install the interceptor to record by wrapping. We make the real
  // request using the underlying undici, then capture.
  //
  // Actually, the simplest reliable approach: use a Proxy-like pattern. We
  // return null from the interceptor, and instrument the afterResponse hooks
  // to capture. But we don't control the hooks from here.
  //
  // Cleanest reliable approach for recording: temporarily patch the cassette
  // to use a record-on-exit strategy. We collect request/response pairs by
  // having the interceptor make the actual HTTP call itself (delegating to
  // the real doRequest by temporarily clearing itself), then recording.
  //
  // This is complex. Instead, let's use a simpler strategy: the record mode
  // uses an afterResponse hook added via createHttpClient. But we're
  // intercepting at the doRequest level, not the client level.
  //
  // The simplest correct approach: have the recording interceptor call the
  // real doRequest logic by temporarily removing itself, capturing the
  // result, then reinstalling. Since doRequest checks the interceptor at
  // the top, if we clear it before calling doRequest again, the real request
  // will proceed.
  //
  // Actually this won't work cleanly because doRequest is not exported.
  //
  // SIMPLEST CORRECT APPROACH: record mode returns null (pass-through), and
  // we use a separate mechanism. We'll install a wrapper on the cdxgenAgent
  // or use a global tap. Let's do it differently: we'll dynamically import
  // utils.js and wrap cdxgenAgent's verb methods. But that only covers
  // cdxgenAgent, not all clients.
  //
  // FINAL APPROACH: The recording interceptor wraps the request by returning
  // null (pass-through). But before doing so, it wraps the `options` object's
  // hooks to add an afterResponse hook that captures the response. Since
  // doRequest merges hooks, we can inject a capturing hook into the options.

  setHttpInterceptor(async (req) => {
    // Inject an afterResponse hook that captures the response.
    const options = req.options;
    if (!options.hooks) {
      options.hooks = {};
    }
    if (!options.hooks.afterResponse) {
      options.hooks.afterResponse = [];
    }
    options.hooks.afterResponse.push((response) => {
      recordings.push({
        request: {
          method: req.method,
          url: req.url.toString(),
        },
        response: {
          statusCode: response.statusCode,
          headers: response.headers || {},
          body: encodeBody(response.body),
        },
      });
      return response;
    });
    // Return null to let doRequest proceed with the real network call.
    return null;
  });

  return {
    stop() {
      clearHttpInterceptor();
      // Deduplicate recordings by method+url (last wins, like a cache).
      const deduped = new Map();
      for (const r of recordings) {
        deduped.set(cassetteKey(r.request.method, r.request.url), r);
      }
      const dir = path.dirname(cassettePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        cassettePath,
        `${JSON.stringify([...deduped.values()], null, 2)}\n`,
      );
    },
    get recordCount() {
      return recordings.length;
    },
  };
}

/**
 * Start a cassette session in the specified mode.
 *
 * @param {"replay"|"record"} mode Replay or record.
 * @param {string} cassettePath Path to the cassette file.
 * @returns {{ stop: () => void, hitCount: number, missCount: number, recordCount: number }}
 */
export function startCassette(mode, cassettePath) {
  if (mode === "record") {
    const c = startRecord(cassettePath);
    return {
      stop: c.stop,
      get hitCount() {
        return 0;
      },
      get missCount() {
        return 0;
      },
      get recordCount() {
        return c.recordCount;
      },
    };
  }
  const c = startReplay(cassettePath);
  return {
    stop: c.stop,
    get hitCount() {
      return c.hitCount;
    },
    get missCount() {
      return c.missCount;
    },
    get recordCount() {
      return 0;
    },
  };
}
