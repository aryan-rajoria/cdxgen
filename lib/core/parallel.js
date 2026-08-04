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

import { availableParallelism } from "node:os";
import process from "node:process";

const _isDeno = globalThis.Deno?.version?.deno !== undefined;
const _isBun = globalThis.Bun?.version !== undefined;

const DEFAULT_HASH_CONCURRENCY = Math.min(
  Math.max(availableParallelism(), 4),
  16,
);

const WORKER_THRESHOLD = Number.parseInt(
  process.env.CDXGEN_WORKER_THRESHOLD || "24",
  10,
);

const MAX_WORKERS = Number.parseInt(
  process.env.CDXGEN_MAX_WORKERS ||
    String(Math.min(availableParallelism() || 4, 8)),
  10,
);

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
export async function mapWithConcurrency(items, mapper, concurrency) {
  const limit = Math.max(1, concurrency || DEFAULT_HASH_CONCURRENCY);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const i = nextIndex;
      nextIndex++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(runner());
  }
  await Promise.all(runners);
  return results;
}

/**
 * Maximum number of worker threads the pool will create for a single call.
 *
 * @returns {number}
 */
export function getMaxWorkers() {
  return Math.max(1, MAX_WORKERS);
}

/**
 * The task count at or above which {@link mapInWorkers} dispatches to threads
 * instead of running inline.
 *
 * @returns {number}
 */
export function getWorkerThreshold() {
  return WORKER_THRESHOLD;
}

let _workerSupported = null;
let lastWorkerCount = 0;

/**
 * Workers created by the most recent {@link mapInWorkers} call. Scoped to that
 * one call rather than to the process, so a batch that ran inline reports 0
 * rather than the widest earlier batch.
 *
 * @returns {number}
 */
export function lastWorkerPoolSize() {
  return lastWorkerCount;
}

async function checkWorkerSupport() {
  if (_workerSupported !== null) return _workerSupported;
  if (_isDeno || _isBun) {
    _workerSupported = false;
    return false;
  }
  try {
    await import("node:worker_threads");
    _workerSupported = true;
  } catch {
    _workerSupported = false;
  }
  return _workerSupported;
}

/**
 * A task failed inside a worker, as opposed to the worker itself failing. The
 * two are handled differently: the first belongs to one task, the second means
 * threads cannot be used at all.
 */
class TaskError extends Error {}

/**
 * Apply `inlineFn` to the tasks at the given indices on the calling thread.
 *
 * @template T, R
 * @param {Array<T>} tasks
 * @param {(task: T) => R} inlineFn
 * @param {Array<R|null>} results Filled in place at each index.
 * @param {Iterable<number>} indices
 * @param {boolean} swallowErrors
 * @param {R|null} errorResult
 */
function runInline(
  tasks,
  inlineFn,
  results,
  indices,
  swallowErrors,
  errorResult,
) {
  for (const i of indices) {
    try {
      results[i] = inlineFn(tasks[i]);
    } catch (err) {
      if (!swallowErrors) {
        throw err;
      }
      results[i] = errorResult;
    }
  }
}

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
export async function mapInWorkers(workerUrl, tasks, inlineFn, options = {}) {
  const threshold = options.threshold ?? WORKER_THRESHOLD;
  const swallowErrors = Boolean(options.swallowErrors);
  const errorResult = options.errorResult ?? null;
  const results = new Array(tasks.length).fill(null);
  const useWorkers = tasks.length >= threshold && (await checkWorkerSupport());

  lastWorkerCount = 0;
  if (!useWorkers) {
    runInline(
      tasks,
      inlineFn,
      results,
      tasks.keys(),
      swallowErrors,
      errorResult,
    );
    return results;
  }

  const maxWorkers = Math.min(options.maxWorkers ?? MAX_WORKERS, tasks.length);
  const done = new Set();
  let nextTask = 0;
  let workersUsable = true;

  const { Worker } = await import("node:worker_threads");
  const workers = [];

  function runOnWorker(worker, task) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.removeListener("message", onMessage);
        worker.removeListener("error", onError);
        worker.removeListener("exit", onExit);
      };
      const onMessage = (msg) => {
        cleanup();
        if (msg?.error) {
          reject(new TaskError(msg.error));
        } else {
          resolve(msg?.result);
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      // A worker can end without ever emitting `error` — it can be terminated,
      // call `process.exit`, or be killed for running out of memory. Without
      // this the pending request would never settle and the scan would hang.
      const onExit = (code) => {
        cleanup();
        reject(new Error(`Worker exited with code ${code} before replying`));
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      worker.postMessage(task);
    });
  }

  async function workerLoop() {
    let worker;
    try {
      worker = new Worker(workerUrl);
    } catch {
      workersUsable = false;
      return;
    }
    workers.push(worker);
    lastWorkerCount = workers.length;
    try {
      while (workersUsable) {
        const i = nextTask;
        nextTask++;
        if (i >= tasks.length) {
          break;
        }
        try {
          results[i] = await runOnWorker(worker, tasks[i]);
          done.add(i);
        } catch (err) {
          if (err instanceof TaskError) {
            if (!swallowErrors) {
              throw err;
            }
            results[i] = errorResult;
            done.add(i);
            continue;
          }
          // The worker, not the task, failed. Stop the pool and let the
          // caller finish the outstanding tasks inline.
          workersUsable = false;
          return;
        }
      }
    } finally {
      await worker.terminate().catch(() => {
        /* already exited */
      });
    }
  }

  try {
    const loops = [];
    for (let i = 0; i < maxWorkers; i++) {
      loops.push(workerLoop());
    }
    await Promise.all(loops);
  } finally {
    await Promise.allSettled(workers.map((w) => w.terminate()));
  }

  if (!workersUsable) {
    const pending = [];
    for (let i = 0; i < tasks.length; i++) {
      if (!done.has(i)) {
        pending.push(i);
      }
    }
    runInline(tasks, inlineFn, results, pending, swallowErrors, errorResult);
  }

  return results;
}
