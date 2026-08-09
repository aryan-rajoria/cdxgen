/**
 * Pure parser for CMakeCache.txt.
 *
 * CMakeCache is produced by `cmake` during configuration. Each non-comment line
 * is `KEY:TYPE=VALUE`, where TYPE is one of BOOL, PATH, FILEPATH, STRING,
 * INTERNAL, STATIC, UNINITIALIZED. Comment lines start with `//`; a leading
 * `# This is the CMakeCache file.` header and blank lines are ignored.
 *
 * This module is layer 1 (pure text in, data out): it has no filesystem or
 * subprocess access. The git/build-directory orchestration that consumes these
 * facts lives in `lib/ecosystems/cmakeResolver.js`.
 */

const FETCH_SOURCE_DIR_PREFIX = "FETCHCONTENT_SOURCE_DIR_";

const CACHE_TYPE_PATTERN =
  /^(?<key>[A-Za-z0-9_.+-]+):(?<type>BOOL|PATH|FILEPATH|STRING|INTERNAL|STATIC|UNINITIALIZED)=(?<value>.*)$/;

/**
 * Parse the raw text of a CMakeCache.txt file into an ordered key→entry map.
 *
 * Only well-formed `KEY:TYPE=VALUE` lines are captured. Comment (`//`), blank,
 * and the `# This is the CMakeCache file.` header lines are ignored, as are
 * lines that do not carry a recognised CMake cache type.
 *
 * @param {string} text Raw CMakeCache.txt contents
 * @returns {Map<string, {type: string, value: string}>} Ordered map of cache entries
 */
export function parseCmakeCache(text) {
  const map = new Map();
  if (!text || typeof text !== "string") {
    return map;
  }
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    if (line.startsWith("//") || line.startsWith("#")) {
      continue;
    }
    const match = line.match(CACHE_TYPE_PATTERN);
    if (!match) {
      continue;
    }
    const { key, type, value } = match.groups;
    if (map.has(key)) {
      continue;
    }
    map.set(key, { type, value });
  }
  return map;
}

/**
 * Extract the version from a `FIND_PACKAGE_MESSAGE_DETAILS_<Pkg>:INTERNAL`
 * value.
 *
 * The value is a sequence of `[...]` groups whose last group is
 * `[v<VERSION>()]`. The version may be empty (`[v()]`). Only the final
 * `[v...]` group is matched so a `[v...]` fragment inside an earlier bracket
 * (a library path) cannot poison the result.
 *
 * @param {string} value The INTERNAL value after `=`
 * @returns {string|null} The resolved version, empty string when the group is
 *   present but empty, or `null` when no `[v...]` group is present.
 */
export function parseFindPackageVersion(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  let lastVersion = null;
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf("[v", i);
    if (open === -1) {
      break;
    }
    const close = value.indexOf("]", open);
    if (close === -1) {
      break;
    }
    const group = value.slice(open + 1, close);
    if (group.startsWith("v") && group.includes("(")) {
      const openParen = group.indexOf("(");
      lastVersion = group.slice(1, openParen);
    }
    i = close + 1;
  }
  return lastVersion;
}

/**
 * Resolve the high-level facts a CMakeCache exposes about a configured build.
 *
 * Harvests the root project, every project directory, FetchContent sources, and
 * the resolved versions of `find_package` lookups. `<name>_VERSION` is **not**
 * present in the cache for subprojects, so fetched/submodule versions must be
 * resolved from git or the gitclone script instead.
 *
 * @param {Map<string, {type: string, value: string}>} map Output of {@link parseCmakeCache}
 * @returns {{ rootProject: {name?: string, version?: string} | null, projects: Map<string, {version?: string, sourceDir?: string, binaryDir?: string, isTopLevel?: boolean, kind: string}>, findPackages: Map<string, string>, fetchContentBase?: string }}
 */
export function resolveCmakeCacheFacts(map) {
  const rootProject = { name: undefined, version: undefined };
  const rootName = map.get("CMAKE_PROJECT_NAME")?.value;
  const rootVersion = map.get("CMAKE_PROJECT_VERSION")?.value;
  if (rootName) {
    rootProject.name = rootName;
  }
  if (rootVersion) {
    rootProject.version = rootVersion;
  }

  const projects = new Map();
  const findPackages = new Map();
  let fetchContentBase;

  for (const [key, entry] of map) {
    if (key.startsWith("FETCHCONTENT_BASE_DIR") && entry.type === "PATH") {
      fetchContentBase = entry.value;
      continue;
    }
    if (key.startsWith(FETCH_SOURCE_DIR_PREFIX) && entry.type === "PATH") {
      const depName = key.slice(FETCH_SOURCE_DIR_PREFIX.length).toLowerCase();
      const project = projects.get(depName) || {
        kind: "fetch",
      };
      project.kind = "fetch";
      project.sourceDir = entry.value;
      projects.set(depName, project);
      continue;
    }
    const sourceDirMatch = key.match(/^(.+)_SOURCE_DIR$/);
    if (sourceDirMatch && entry.type === "STATIC") {
      const name = sourceDirMatch[1].toLowerCase();
      if (name === "cmake") {
        continue;
      }
      const project = projects.get(name) || { kind: "internal" };
      project.sourceDir = entry.value;
      if (!project.kind || project.kind === "internal") {
        project.kind =
          rootName && name === rootName.toLowerCase() ? "internal" : "internal";
      }
      projects.set(name, project);
      continue;
    }
    const binaryDirMatch = key.match(/^(.+)_BINARY_DIR$/);
    if (binaryDirMatch && entry.type === "STATIC") {
      const name = binaryDirMatch[1].toLowerCase();
      if (name === "cmake") {
        continue;
      }
      const project = projects.get(name) || { kind: "internal" };
      project.binaryDir = entry.value;
      projects.set(name, project);
      continue;
    }
    const isTopLevelMatch = key.match(/^(.+)_IS_TOP_LEVEL$/);
    if (isTopLevelMatch && entry.type === "STATIC") {
      const name = isTopLevelMatch[1].toLowerCase();
      const project = projects.get(name) || { kind: "internal" };
      project.isTopLevel = entry.value === "ON";
      projects.set(name, project);
      continue;
    }
    const findPkgMatch = key.match(/^FIND_PACKAGE_MESSAGE_DETAILS_(.+)$/);
    if (findPkgMatch && entry.type === "INTERNAL") {
      const pkg = findPkgMatch[1];
      const version = parseFindPackageVersion(entry.value);
      if (version !== null) {
        findPackages.set(pkg, version);
      }
    }
  }

  for (const [name, project] of projects) {
    if (project.kind === "fetch") {
      continue;
    }
    if (project.isTopLevel === true) {
      project.kind = "internal";
    } else if (project.isTopLevel === false) {
      project.kind = "submodule";
    }
    if (rootVersion && rootName && name === rootName.toLowerCase()) {
      project.version = rootVersion;
    }
    projects.set(name, project);
  }

  return {
    rootProject: rootName || rootVersion ? rootProject : null,
    projects,
    findPackages,
    fetchContentBase,
  };
}
