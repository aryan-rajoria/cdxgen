/**
 * Bounded concurrency utilities for CPU-bound and I/O-bound parallel work.
 *
 * Two primitives live here:
 *
 * - {@link mapWithConcurrency} — a promise pool for async I/O work (file
 *   hashing, registry fetches). Tasks are async; results preserve input order.
 *
 * - {@link mapInWorkers} — a worker-thread pool for synchronous CPU work (AST
 *   parsing). Below a configurable threshold tasks run inline; above it they
 *   are distributed across `worker_threads` workers. Any failure of the thread
 *   machinery itself — an unavailable `worker_threads`, a worker entry that
 *   will not load, a worker that dies mid-task — falls back to running the
 *   remaining tasks inline, so the result is the same whether or not threads
 *   were usable.
 */
/**
 * Run an async mapper over an array with bounded concurrency.
 *
 * Results are placed at their original index so order is preserved regardless
 * of completion order. Below the concurrency limit tasks start immediately;
 * above it they queue in FIFO order.
 *
 * The bound is per call, so two pools running at once can together hold twice
 * the limit open. Every caller today awaits its pool before the next phase
 * begins, so the effective bound is the limit; a caller that starts a pool
 * without awaiting it should pass a smaller `concurrency`.
 *
 * @template T, R
 * @param {Array<T>} items
 * @param {(item: T, index: number) => Promise<R>|R} mapper
 * @param {number} [concurrency]
 * @returns {Promise<Array<R>>}
 */
export declare function mapWithConcurrency<T, R>(items: Array<T>, mapper: (item: T, index: number) => Promise<R> | R, concurrency?: number): Promise<Array<R>>;
/**
 * Maximum number of worker threads the pool will create for a single call.
 *
 * @returns {number}
 */
export declare function getMaxWorkers(): number;
/**
 * The task count at or above which {@link mapInWorkers} dispatches to threads
 * instead of running inline.
 *
 * @returns {number}
 */
export declare function getWorkerThreshold(): number;
/**
 * Workers created by the most recent {@link mapInWorkers} call. Scoped to that
 * one call rather than to the process, so a batch that ran inline reports 0
 * rather than the widest earlier batch.
 *
 * @returns {number}
 */
export declare function lastWorkerPoolSize(): number;
/**
 * Run synchronous CPU-bound tasks across worker threads.
 *
 * Below the threshold (default 24), tasks run inline on the calling thread,
 * because starting a worker costs more than a small batch saves. Above it,
 * tasks are distributed to a pool of ephemeral workers that are terminated
 * before the call returns, so a completed scan does not hold the event loop
 * open.
 *
 * Results are always returned in the original task order.
 *
 * Two kinds of failure are distinguished. A task that fails inside the worker
 * is reported by the worker as `{error}` and is treated as that one task
 * failing: it yields `options.errorResult` when `options.swallowErrors` is set,
 * and rejects otherwise. A failure of the thread machinery — `worker_threads`
 * missing, the entry module refusing to load, a worker exiting mid-task — is
 * not a property of any task, so the tasks that had not completed are run
 * inline instead. That keeps the result independent of whether threads were
 * usable, which matters because callers of this function treat an empty result
 * as "nothing found" rather than as an error.
 *
 * @template T, R
 * @param {URL|string} workerUrl - Resolved URL of the worker entry module
 * @param {Array<T>} tasks - Structured-cloneable task descriptors
 * @param {(task: T) => R} inlineFn - Called per task when running inline
 * @param {Object} [options]
 * @param {number} [options.threshold] - Minimum task count to use threads
 * @param {number} [options.maxWorkers] - Cap on thread count
 * @param {boolean} [options.swallowErrors] - Return errorResult instead of rejecting
 * @param {R} [options.errorResult] - Value used when an error is swallowed
 * @returns {Promise<Array<R|null>>}
 */
export declare function mapInWorkers<T, R>(workerUrl: URL | string, tasks: Array<T>, inlineFn: (task: T) => R, options?: {
    threshold?: number;
    maxWorkers?: number;
    swallowErrors?: boolean;
    errorResult?: R;
}): Promise<Array<R | null>>;
//# sourceMappingURL=parallel.d.ts.map