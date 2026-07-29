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

import { platform } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

let url = import.meta?.url;
if (url && !url.startsWith("file://")) {
  url = new URL(`file://${import.meta.url}`).toString();
}
// TODO: verify if this is a good method (Prabhu)
// this is due to dirNameStr being "cdxgen/lib/helpers" which causes errors
export const dirNameStr = url
  ? dirname(dirname(dirname(fileURLToPath(url))))
  : __dirname;

export const isWin = platform() === "win32";
export const isMac = platform() === "darwin";
