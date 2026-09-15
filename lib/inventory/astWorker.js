/**
 * Worker entry for parallel AST analysis. Each task is `{ src, file }`;
 * the result is `{ imports, exports }` produced by `parseFileASTTreeCollected`.
 *
 * Parse failures return `null` so the caller can skip the file, matching the
 * `catch (_err)` behaviour of the serial loop.
 */

import { parentPort } from "node:worker_threads";

import { parseFileASTTreeCollected } from "./analyzer.js";
import { getSvelteTemplateParser } from "./svelteUtils.js";

// The parse runs synchronously on the worker thread, so the optional Svelte
// template parser is resolved eagerly here (a silent no-op when the optional
// package is absent; the built-in script mask covers all scope evidence).
getSvelteTemplateParser();

parentPort.on("message", (task) => {
  try {
    const result = parseFileASTTreeCollected(task.src, task.file);
    parentPort.postMessage({ result });
  } catch {
    parentPort.postMessage({ result: null });
  }
});
