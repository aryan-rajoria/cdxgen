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
/**
 * @returns {Object|null} Stats from the last batch (requests, unique, ok,
 *   failures, cacheHits, elapsedMs, peakConcurrency), or null.
 */
export declare function lastBatchStats(): Object | null;
/**
 * Whether batched fetching through cdxrs is available.
 *
 * Memoized because the probe spawns the binary, and this is consulted once per
 * metadata function rather than once per run.
 *
 * @returns {boolean} True when `cdxrs fetch` can be used.
 */
export declare function batchFetchAvailable(): boolean;
/**
 * Reset the memoized availability probe. Tests only.
 */
export declare function resetBatchFetchAvailability(): void;
export type BatchEntry = {
    /**
     * Whether a body was obtained.
     */
    ok: boolean;
    /**
     * Parsed response body when `ok`.
     */
    body?: any;
    /**
     * HTTP status, when the server produced one.
     */
    status?: number;
    /**
     * True when the status is a final answer (a 4xx
     * other than 429) and re-requesting it in JS would be pointless.
     */
    definite?: boolean;
};
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
export declare function prefetchJson(requests: Array<{
    url: string;
    accept?: string;
    authRealm?: string;
}>, options?: {
    timeoutMs?: number;
}): Promise<Map<string, BatchEntry>>;
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
export declare function prefetchedResponse(prefetched: Map<string, BatchEntry>, url: string): {
    body: any;
} | undefined;
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
export declare function prefetchEnabled(): boolean;
//# sourceMappingURL=fetchBatch.d.ts.map