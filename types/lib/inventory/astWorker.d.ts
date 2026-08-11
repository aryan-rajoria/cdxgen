/**
 * Worker entry for parallel AST analysis. Each task is `{ src, file }`;
 * the result is `{ imports, exports }` produced by `parseFileASTTreeCollected`.
 *
 * Parse failures return `null` so the caller can skip the file, matching the
 * `catch (_err)` behaviour of the serial loop.
 */
export {};
//# sourceMappingURL=astWorker.d.ts.map