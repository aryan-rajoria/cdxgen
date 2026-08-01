/**
 * Repo-root resolution, shared by every helper that loads a file from `data/`.
 *
 * This lives in its own leaf module — importing nothing from `utils.js` — because
 * the value is consumed at *module-evaluation* time (`JSON.parse(readFileSync(
 * join(dirNameStr, "data", …)))`). A module in a cycle with `utils.js` that reads
 * `dirNameStr` while `utils.js` is still evaluating gets the binding in its
 * temporal dead zone and throws `ReferenceError: Cannot access 'dirNameStr'
 * before initialization`. Keeping the definition in a leaf guarantees it is
 * initialized before any consumer runs.
 *
 * The `file://` normalization below is load-bearing, not defensive noise:
 * `jsr.json` publishes `lib/cli/index.js` to JSR, so `import.meta.url` can be an
 * `https://` URL, and `fileURLToPath` throws `ERR_INVALID_URL_SCHEME` on those.
 */
export declare const dirNameStr: any;
export declare const isWin: boolean;
export declare const isMac: boolean;
//# sourceMappingURL=paths.d.ts.map