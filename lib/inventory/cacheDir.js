/**
 * Cache directory resolution for the cdxrs fetch metadata cache.
 *
 * JS is the single source of truth for the path. `fetchBatch.js` passes
 * `--cache-dir <path>` to every `cdxrs fetch` invocation; Rust keeps its own
 * resolution only as the fallback for standalone CLI use. Both sides follow
 * the same rules so they agree — verified by a parity test.
 *
 * Resolution order:
 * 1. `CDXGEN_CACHE_DIR` if set and non-empty (documented escape hatch).
 * 2. Platform cache directory with a `cdxgen` component.
 * 3. `null` — cache disabled. A cache that cannot find a home must not fall
 *    back to the current working directory or a temp dir.
 */

import { homedir } from "node:os";
import path from "node:path";

import { readEnvironmentVariable } from "../core/activity.js";
import { isMac, isWin } from "../core/paths.js";

/**
 * Resolve the cache directory from explicit inputs, with no reference to the
 * ambient environment or the host platform.
 *
 * Mirrors `HttpCache::resolve_cache_for` in cdxrs. Taking the platform as an
 * argument is what lets every branch be tested on every host; keep it that way
 * rather than reading `isWin`/`isMac` here, or the Windows and Linux branches
 * become untestable on a macOS developer machine.
 *
 * @param {Object} inputs Resolution inputs.
 * @param {"linux"|"macos"|"windows"} inputs.platform Which convention to apply.
 * @param {string} [inputs.cdxgenCacheDir] `CDXGEN_CACHE_DIR`.
 * @param {string} [inputs.xdgCacheHome] `XDG_CACHE_HOME`. Ignored unless
 *   absolute, per the XDG spec, so it cannot point inside the working directory.
 * @param {string} [inputs.home] Home directory.
 * @param {string} [inputs.localAppData] `LOCALAPPDATA`.
 * @returns {string|null} Absolute path, or null when nothing resolves.
 */
export function resolveCacheDirFor({
  platform,
  cdxgenCacheDir,
  xdgCacheHome,
  home,
  localAppData,
}) {
  if (cdxgenCacheDir?.trim()) {
    return path.resolve(cdxgenCacheDir);
  }
  if (platform === "windows") {
    if (localAppData?.trim()) {
      return path.join(localAppData, "cdxgen", "cache");
    }
    return home?.trim()
      ? path.join(home, "AppData", "Local", "cdxgen", "cache")
      : null;
  }
  if (platform === "macos") {
    return home?.trim() ? path.join(home, "Library", "Caches", "cdxgen") : null;
  }
  if (xdgCacheHome?.trim() && path.isAbsolute(xdgCacheHome)) {
    return path.join(xdgCacheHome, "cdxgen");
  }
  return home?.trim() ? path.join(home, ".cache", "cdxgen") : null;
}

/**
 * The cache convention this host uses.
 *
 * @returns {"linux"|"macos"|"windows"} Platform key.
 */
function currentPlatform() {
  if (isWin) {
    return "windows";
  }
  return isMac ? "macos" : "linux";
}

/**
 * Resolve the metadata cache directory from the environment.
 *
 * @returns {string|null} Absolute path, or null when no home directory can be
 *   determined and `CDXGEN_CACHE_DIR` is unset.
 */
export function resolveCacheDir() {
  return resolveCacheDirFor({
    platform: currentPlatform(),
    cdxgenCacheDir: readEnvironmentVariable("CDXGEN_CACHE_DIR"),
    xdgCacheHome: readEnvironmentVariable("XDG_CACHE_HOME"),
    home: homedir(),
    localAppData: readEnvironmentVariable("LOCALAPPDATA"),
  });
}

/**
 * The fetch subdirectory inside the cache root. All cdxrs fetch entries live
 * under `<cacheDir>/cdxrs-fetch/<host>/<hash>.json`.
 *
 * @param {string} cacheDir Resolved cache directory.
 * @returns {string} Path to the fetch subdirectory.
 */
export function fetchCacheDir(cacheDir) {
  return path.join(cacheDir, "cdxrs-fetch");
}
