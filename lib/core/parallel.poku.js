import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { assert, describe, it } from "poku";

import {
  getWorkerThreshold,
  lastWorkerPoolSize,
  mapInWorkers,
  mapWithConcurrency,
} from "./parallel.js";

const baseTempDir = mkdtempSync(join(tmpdir(), "cdxgen-parallel-poku-"));

process.on("exit", () => {
  rmSync(baseTempDir, { recursive: true, force: true });
});

/**
 * Write a worker entry module and return its URL. Fixtures are generated rather
 * than committed so that the shipped file list holds only runtime modules.
 *
 * @param {string} name File name to write under the temp dir.
 * @param {string} source Module source.
 * @returns {URL}
 */
const writeWorker = (name, source) => {
  const file = join(baseTempDir, name);
  writeFileSync(file, source, { encoding: "utf-8" });
  return pathToFileURL(file);
};

/** A worker that answers each task with its double. */
const doublingWorker = writeWorker(
  "doubling.js",
  [
    'import { parentPort } from "node:worker_threads";',
    "parentPort.on('message', (task) => {",
    "  parentPort.postMessage({ result: task * 2 });",
    "});",
  ].join("\n"),
);

/** A worker that ends the thread instead of replying. */
const exitingWorker = writeWorker(
  "exiting.js",
  [
    'import { parentPort } from "node:worker_threads";',
    'import process from "node:process";',
    "parentPort.on('message', () => {",
    "  process.exit(0);",
    "});",
  ].join("\n"),
);

/** A worker whose entry module cannot be resolved. */
const unloadableWorker = writeWorker(
  "unloadable.js",
  'import "./no-such-module.js";\n',
);

/** A worker that reports a per-task failure. */
const failingTaskWorker = writeWorker(
  "failing-task.js",
  [
    'import { parentPort } from "node:worker_threads";',
    "parentPort.on('message', (task) => {",
    "  if (task === 3) {",
    "    parentPort.postMessage({ error: 'task 3 refused' });",
    "  } else {",
    "    parentPort.postMessage({ result: task * 2 });",
    "  }",
    "});",
  ].join("\n"),
);

const range = (n) => Array.from({ length: n }, (_, i) => i);
const doubled = (n) => range(n).map((i) => i * 2);
const WORKER_TASKS = 40;

describe("mapWithConcurrency", async () => {
  await it("returns results in input order regardless of completion order", async () => {
    // Descending delays, so completion order is the reverse of input order.
    const items = [40, 30, 20, 10, 0];
    const results = await mapWithConcurrency(
      items,
      (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)),
      4,
    );
    assert.deepStrictEqual(results, items);
  });

  await it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      range(50),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
      },
      4,
    );
    assert.strictEqual(peak, 4, `peak concurrency was ${peak}, expected 4`);
  });

  await it("propagates a rejection from the mapper", async () => {
    await assert.rejects(
      () =>
        mapWithConcurrency(range(10), (i) => {
          if (i === 5) {
            return Promise.reject(new Error("mapper failed"));
          }
          return Promise.resolve(i);
        }),
      /mapper failed/,
    );
  });
});

describe("mapInWorkers", async () => {
  await it("runs inline below the threshold and reports no workers", async () => {
    const tasks = range(4);
    const results = await mapInWorkers(
      doublingWorker,
      tasks,
      (task) => task * 2,
      { threshold: 24 },
    );
    assert.deepStrictEqual(results, doubled(4));
    assert.strictEqual(
      lastWorkerPoolSize(),
      0,
      "a batch below the threshold must report no workers, not the size of an earlier batch",
    );
  });

  await it("fans out to workers above the threshold, in input order", async () => {
    const results = await mapInWorkers(
      doublingWorker,
      range(WORKER_TASKS),
      () => {
        throw new Error("the inline path must not run for this batch");
      },
      { threshold: 24, maxWorkers: 4 },
    );
    assert.deepStrictEqual(results, doubled(WORKER_TASKS));
    assert.strictEqual(
      lastWorkerPoolSize(),
      4,
      `expected 4 workers, got ${lastWorkerPoolSize()}`,
    );
  });

  await it("reports no workers for an inline batch that follows a threaded one", async () => {
    await mapInWorkers(doublingWorker, range(WORKER_TASKS), (t) => t * 2, {
      threshold: 24,
      maxWorkers: 4,
    });
    assert.strictEqual(lastWorkerPoolSize(), 4);
    await mapInWorkers(doublingWorker, range(2), (t) => t * 2, {
      threshold: 24,
    });
    assert.strictEqual(
      lastWorkerPoolSize(),
      0,
      "a counter that outlives the call cannot evidence that any given call parallelised",
    );
  });

  await it("completes every task inline when a worker exits without replying", async () => {
    // A worker can end without emitting `error`. Left unhandled the request
    // never settles and the scan hangs after the work is done.
    const results = await mapInWorkers(
      exitingWorker,
      range(WORKER_TASKS),
      (task) => task * 2,
      { threshold: 24, maxWorkers: 4 },
    );
    assert.deepStrictEqual(results, doubled(WORKER_TASKS));
  });

  await it("completes every task inline when the worker entry cannot load", async () => {
    // This is the shape a packaging mistake takes: the module resolves in a
    // checkout and not in a shipped build.
    const results = await mapInWorkers(
      unloadableWorker,
      range(WORKER_TASKS),
      (task) => task * 2,
      { threshold: 24, maxWorkers: 4 },
    );
    assert.deepStrictEqual(results, doubled(WORKER_TASKS));
  });

  await it("completes every task inline when no worker can be constructed", async () => {
    const results = await mapInWorkers(
      "not-a-usable-worker-specifier",
      range(WORKER_TASKS),
      (task) => task * 2,
      { threshold: 24, maxWorkers: 4 },
    );
    assert.deepStrictEqual(results, doubled(WORKER_TASKS));
  });

  await it("swallows a single failing task without abandoning the rest", async () => {
    const results = await mapInWorkers(
      failingTaskWorker,
      range(WORKER_TASKS),
      (task) => task * 2,
      {
        threshold: 24,
        maxWorkers: 4,
        swallowErrors: true,
        errorResult: null,
      },
    );
    const expected = doubled(WORKER_TASKS);
    expected[3] = null;
    assert.deepStrictEqual(results, expected);
  });

  await it("rejects on a failing task when errors are not swallowed", async () => {
    await assert.rejects(
      () =>
        mapInWorkers(failingTaskWorker, range(WORKER_TASKS), (t) => t * 2, {
          threshold: 24,
          maxWorkers: 4,
        }),
      /task 3 refused/,
    );
  });

  await it("exposes a threshold above one, so trivial batches stay inline", async () => {
    assert.ok(
      getWorkerThreshold() > 1,
      "a threshold of 1 would pay worker startup for a single-file project",
    );
  });
});
