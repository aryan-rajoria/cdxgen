import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

import semver from "semver";

import { readEnvironmentVariable } from "../core/activity.js";
import { safeExistsSync } from "../core/fs.js";
import { tryBuildPurl } from "../inventory/purl.js";

/**
 * Elm project parser.
 *
 * Three files are consulted, spanning the two manifest generations of the
 * ecosystem:
 *
 *   - `elm.json` (0.19) — `type: "application"` projects pin **exact**
 *     versions for direct, indirect, and test dependencies, so the file
 *     doubles as the lock file. `type: "package"` projects declare bounded
 *     ranges (`"1.0.0 <= v < 2.0.0"`) and carry their own name, version,
 *     license, and summary.
 *   - `elm-package.json` (0.18) — the legacy manifest, declaring ranges only.
 *   - `elm-stuff/exact-dependencies.json` (0.18) — the lock file the old
 *     `elm-package` tool wrote with the exact version of every package.
 *
 * Package metadata (license, summary) is enriched from the local Elm cache
 * when it is populated. The cache layout follows the compiler's own
 * resolution (see `builder/src/Stuff.hs` in elm/compiler): `$ELM_HOME`
 * (defaulting to `~/.elm`, or `%APPDATA%\elm` on Windows) contains one
 * directory per compiler version, and each downloaded package lives at
 * `<version>/packages/<author>/<project>/<version>/elm.json`. No network
 * requests are made.
 *
 * No `elm` purl type is registered in purl-spec, so packages are identified
 * as generic packages carrying a `cdx:purl:proposedType=elm` property,
 * following the convention used for crystal and nim. The `author/project`
 * name maps to the purl namespace and the CycloneDX group so the full
 * identity survives.
 */

/**
 * One path segment of an Elm package name (`author` or `project`). Names are
 * GitHub `user/repo` pairs; the shape check doubles as path-traversal
 * protection because segments are joined into cache paths.
 */
const ELM_NAME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The bounded-interval constraint syntax Elm uses in manifests:
 * `"<lower> <= v < <upper>"`.
 */
const ELM_RANGE_PATTERN = /^(\S+)\s*(<=|<)\s*v\s*(<=|<)\s*(\S+)$/;

/**
 * Parse an Elm project from its 0.19 `elm.json`.
 *
 * @param {string} elmJsonFile Path to `elm.json`
 * @param {object} [cacheReader] Reader returned by {@link createElmCacheReader};
 *   when omitted, one is derived from the manifest's pinned compiler version
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs: string[] }}
 */
export function parseElmProject(elmJsonFile, cacheReader) {
  const manifest = readJsonFile(elmJsonFile);
  if (
    !manifest ||
    (manifest.type !== "application" && manifest.type !== "package")
  ) {
    return {
      pkgList: [],
      dependencies: [],
      parentComponent: {},
      rootInputs: [],
    };
  }

  const elmVersion =
    typeof manifest["elm-version"] === "string"
      ? manifest["elm-version"]
      : undefined;
  const cache =
    cacheReader ||
    createElmCacheReader(
      manifest.type === "application" && semver.valid(elmVersion)
        ? elmVersion
        : undefined,
    );

  const parentComponent = {};
  const properties = [{ name: "internal:SrcFile", value: elmJsonFile }];
  if (elmVersion) {
    properties.push({ name: "cdx:elm:elmVersion", value: elmVersion });
  }
  if (manifest.type === "package") {
    const split = splitElmName(manifest.name);
    parentComponent.type = "application";
    if (split) {
      parentComponent.group = split.author;
      parentComponent.name = split.repo;
    } else {
      parentComponent.name = projectDirectoryName(elmJsonFile);
    }
    if (typeof manifest.version === "string" && manifest.version) {
      parentComponent.version = manifest.version;
    }
    if (typeof manifest.summary === "string" && manifest.summary) {
      parentComponent.description = manifest.summary;
    }
    if (typeof manifest.license === "string" && manifest.license) {
      parentComponent.license = manifest.license;
    }
  } else {
    // Applications carry no name of their own; the directory stands in.
    parentComponent.type = "application";
    parentComponent.name = projectDirectoryName(elmJsonFile);
  }
  parentComponent.properties = properties;

  const pkgList = [];
  const rootInputs = [];
  if (manifest.type === "package") {
    addRangeDependencies(
      pkgList,
      manifest.dependencies,
      "direct",
      elmJsonFile,
      cache,
    );
    addRangeDependencies(
      pkgList,
      manifest["test-dependencies"],
      "direct-test",
      elmJsonFile,
      cache,
    );
  } else {
    for (const [section, kind] of [
      ["dependencies", "direct"],
      ["test-dependencies", "direct-test"],
    ]) {
      const group = manifest[section];
      addExactDependencies(pkgList, group?.direct, kind, elmJsonFile, cache);
      addExactDependencies(
        pkgList,
        group?.indirect,
        kind === "direct" ? "indirect" : "indirect-test",
        elmJsonFile,
        cache,
      );
    }
  }
  for (const pkg of pkgList) {
    const kind = pkg.properties.find(
      (p) => p.name === "cdx:elm:dependency",
    ).value;
    if (kind === "direct" || kind === "direct-test") {
      rootInputs.push(pkg["bom-ref"]);
    }
  }
  return { pkgList, dependencies: [], parentComponent, rootInputs };
}

/**
 * Parse a legacy 0.18 Elm project from `elm-package.json` and its optional
 * `elm-stuff/exact-dependencies.json` lock file.
 *
 * @param {string} elmPackageJsonFile Path to `elm-package.json`
 * @param {string} [exactDepsFile] Path to the lock file, if present
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs: string[] }}
 */
export function parseLegacyElmProject(elmPackageJsonFile, exactDepsFile) {
  const manifest = readJsonFile(elmPackageJsonFile);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    (!manifest["elm-version"] && !manifest.dependencies)
  ) {
    return {
      pkgList: [],
      dependencies: [],
      parentComponent: {},
      rootInputs: [],
    };
  }

  const parentComponent = {
    type: "application",
    name: projectDirectoryName(elmPackageJsonFile),
  };
  if (typeof manifest.version === "string" && manifest.version) {
    parentComponent.version = manifest.version;
  }
  if (typeof manifest.summary === "string" && manifest.summary) {
    parentComponent.description = manifest.summary;
  }
  if (typeof manifest.license === "string" && manifest.license) {
    parentComponent.license = manifest.license;
  }
  const properties = [{ name: "internal:SrcFile", value: elmPackageJsonFile }];
  if (typeof manifest["elm-version"] === "string" && manifest["elm-version"]) {
    properties.push({
      name: "cdx:elm:elmVersion",
      value: manifest["elm-version"],
    });
  }
  parentComponent.properties = properties;

  const declared = new Set(
    manifest.dependencies && typeof manifest.dependencies === "object"
      ? Object.keys(manifest.dependencies)
      : [],
  );
  const ranges =
    manifest.dependencies && typeof manifest.dependencies === "object"
      ? manifest.dependencies
      : {};

  const pkgList = [];
  const exact = exactDepsFile ? readJsonFile(exactDepsFile) : undefined;
  const pinned =
    exact && typeof exact === "object" && !Array.isArray(exact) ? exact : {};
  for (const [name, version] of Object.entries(pinned)) {
    pkgList.push(
      elmPackage(name, typeof version === "string" ? version : undefined, {
        dependency: declared.has(name) ? "direct" : "indirect",
        srcFile: exactDepsFile,
        versionRange:
          typeof ranges[name] === "string" ? ranges[name] : undefined,
      }),
    );
  }
  if (!pkgList.length) {
    // Lockless fallback: the declared dependencies without resolved versions.
    for (const [name, range] of Object.entries(ranges)) {
      pkgList.push(
        elmPackage(name, undefined, {
          dependency: "direct",
          srcFile: elmPackageJsonFile,
          versionRange: typeof range === "string" ? range : undefined,
        }),
      );
    }
  }
  const rootInputs = pkgList
    .filter(
      (pkg) =>
        pkg.properties.find((p) => p.name === "cdx:elm:dependency").value ===
        "direct",
    )
    .map((pkg) => pkg["bom-ref"]);
  return { pkgList, dependencies: [], parentComponent, rootInputs };
}

/**
 * Tell whether a candidate `elm.json` really is an Elm manifest. The file
 * name is distinctive but lives in every Elm project, so detection only
 * needs a cheap content check before dispatching.
 *
 * @param {string} filePath Path to the candidate `elm.json`
 * @returns {boolean} true when the file declares an Elm project
 */
export function isElmProjectFile(filePath) {
  const manifest = readJsonFile(filePath);
  return manifest?.type === "application" || manifest?.type === "package";
}

/**
 * Create a reader for the local Elm package cache. Reads are memoised and
 * silently disabled when the cache directory does not exist.
 *
 * @param {string} [elmVersionHint] Exact compiler version directory to try
 *   first, when the project pins one
 * @returns {{ readMetadata: (name: string, version: string) => object|null, listVersions: (name: string) => string[] }}
 */
export function createElmCacheReader(elmVersionHint) {
  const home = elmHomeDir();
  const metadataCache = new Map();
  const versionsCache = new Map();
  let versionDirs;

  function listVersionDirs() {
    if (versionDirs) {
      return versionDirs;
    }
    try {
      versionDirs = readdirSync(home)
        .filter((entry) => semver.valid(entry))
        .sort()
        .reverse();
    } catch {
      versionDirs = [];
    }
    return versionDirs;
  }

  function packageDir(name) {
    const split = splitElmName(name);
    return split
      ? { author: split.author, repo: split.repo, valid: true }
      : { valid: false };
  }

  return {
    readMetadata(name, version) {
      const key = `${name}@${version}`;
      if (metadataCache.has(key)) {
        return metadataCache.get(key);
      }
      let metadata = null;
      const dir = packageDir(name);
      if (dir.valid && semver.valid(version)) {
        const dirs =
          elmVersionHint && semver.valid(elmVersionHint)
            ? [
                elmVersionHint,
                ...listVersionDirs().filter((d) => d !== elmVersionHint),
              ]
            : listVersionDirs();
        for (const versionDir of dirs) {
          const metaFile = join(
            home,
            versionDir,
            "packages",
            dir.author,
            dir.repo,
            version,
            "elm.json",
          );
          if (safeExistsSync(metaFile)) {
            metadata = readJsonFile(metaFile);
            if (metadata) {
              break;
            }
          }
        }
      }
      metadataCache.set(key, metadata);
      return metadata;
    },
    listVersions(name) {
      if (versionsCache.has(name)) {
        return versionsCache.get(name);
      }
      const versions = new Set();
      const dir = packageDir(name);
      if (dir.valid) {
        for (const versionDir of listVersionDirs()) {
          try {
            for (const entry of readdirSync(
              join(home, versionDir, "packages", dir.author, dir.repo),
            )) {
              if (semver.valid(entry)) {
                versions.add(entry);
              }
            }
          } catch {
            // No cached copy under this compiler version.
          }
        }
      }
      const list = [...versions];
      versionsCache.set(name, list);
      return list;
    },
  };
}

/**
 * Resolve the Elm home directory the way the compiler does: `$ELM_HOME` when
 * set, otherwise the OS per-user data directory for "elm" (`~/.elm` on Unix,
 * `%APPDATA%\elm` on Windows).
 *
 * @returns {string} Elm home directory
 */
function elmHomeDir() {
  const custom = readEnvironmentVariable("ELM_HOME");
  if (custom) {
    return custom;
  }
  if (process.platform === "win32") {
    const appData =
      readEnvironmentVariable("APPDATA") ||
      join(homedir(), "AppData", "Roaming");
    return join(appData, "elm");
  }
  return join(homedir(), ".elm");
}

/**
 * Split an Elm package name into its author and project segments.
 *
 * @param {string} name Package name, e.g. `elm/http`
 * @returns {{author: string, repo: string}|null} null when the name is not a
 *   well-formed `author/project` pair
 */
function splitElmName(name) {
  if (typeof name !== "string") {
    return null;
  }
  const parts = name.split("/");
  if (parts.length !== 2 || !parts.every((p) => ELM_NAME_SEGMENT.test(p))) {
    return null;
  }
  return { author: parts[0], repo: parts[1] };
}

/**
 * Derive a project display name from the manifest's directory, used by
 * application manifests, which carry no name of their own.
 *
 * @param {string} manifestFile Manifest path
 * @returns {string} Directory base name
 */
function projectDirectoryName(manifestFile) {
  return basename(dirname(resolve(manifestFile)));
}

/**
 * Parse an Elm version constraint. Only the documented bounded interval
 * (`"1.0.0 <= v < 2.0.0"`) is understood; anything else is returned as null
 * and treated as an opaque constraint.
 *
 * @param {string} range Constraint string from a manifest
 * @returns {{lower: string, upper: string, upperInclusive: boolean}|null}
 */
function parseElmRange(range) {
  if (typeof range !== "string") {
    return null;
  }
  const match = range.match(ELM_RANGE_PATTERN);
  if (!match) {
    return null;
  }
  const [, lower, lowerOp, upperOp, upper] = match;
  // The grammar allows `<= v` lower bounds only; a `< v` lower bound would
  // exclude the very version the resolver needs, so treat it as opaque.
  if (lowerOp !== "<=" || !semver.valid(lower) || !semver.valid(upper)) {
    return null;
  }
  return { lower, upper, upperInclusive: upperOp === "<=" };
}

/**
 * Check a concrete version against a parsed Elm range.
 *
 * @param {string} version Semver version
 * @param {{lower: string, upper: string, upperInclusive: boolean}} range Parsed range
 * @returns {boolean} true when the version satisfies the range
 */
function satisfiesElmRange(version, range) {
  if (!semver.valid(version) || !range) {
    return false;
  }
  if (semver.lt(version, range.lower)) {
    return false;
  }
  return range.upperInclusive
    ? semver.lte(version, range.upper)
    : semver.lt(version, range.upper);
}

/**
 * Append the dependencies of one exact-version section of an application
 * `elm.json`, enriching each from the local cache when possible.
 */
function addExactDependencies(pkgList, section, kind, srcFile, cache) {
  if (!section || typeof section !== "object") {
    return;
  }
  for (const [name, version] of Object.entries(section)) {
    const exact = typeof version === "string" && version ? version : undefined;
    const metadata =
      cache && exact && semver.valid(exact) && splitElmName(name)
        ? cache.readMetadata(name, exact)
        : null;
    pkgList.push(
      elmPackage(name, exact, {
        dependency: kind,
        srcFile,
        metadata,
      }),
    );
  }
}

/**
 * Append the dependencies of a range-constrained section of a package
 * `elm.json`. When the local Elm cache holds exactly one version satisfying
 * the declared range — the version the compiler would resolve — it becomes
 * the component version; otherwise the component keeps only the constraint.
 */
function addRangeDependencies(pkgList, section, kind, srcFile, cache) {
  if (!section || typeof section !== "object") {
    return;
  }
  for (const [name, range] of Object.entries(section)) {
    let version;
    let metadata;
    const parsed = parseElmRange(range);
    if (cache && parsed && splitElmName(name)) {
      const candidates = cache
        .listVersions(name)
        .filter((v) => satisfiesElmRange(v, parsed))
        .sort(semver.rcompare);
      if (candidates.length) {
        // Elm's solver picks the newest version within the constraints.
        version = candidates[0];
        metadata = cache.readMetadata(name, version);
      }
    }
    pkgList.push(
      elmPackage(name, version, {
        dependency: kind,
        srcFile,
        metadata,
        versionRange: typeof range === "string" ? range : undefined,
      }),
    );
  }
}

/**
 * Build a component-like package record for an Elm dependency.
 *
 * @param {string} name Package name as Elm writes it (`author/project`)
 * @param {string|undefined} version Resolved version, if known
 * @param {object} opts Extra context (`dependency`, `srcFile`, `metadata`, `versionRange`)
 * @returns {object} Package record
 */
function elmPackage(name, version, opts) {
  const split = splitElmName(name);
  const test =
    opts.dependency === "direct-test" || opts.dependency === "indirect-test";
  const purl = tryBuildPurl({
    type: "generic",
    namespace: split?.author,
    name: split?.repo ?? name,
    version: version || undefined,
  });
  const properties = [
    { name: "internal:SrcFile", value: opts.srcFile },
    { name: "cdx:purl:proposedType", value: "elm" },
    { name: "cdx:elm:dependency", value: opts.dependency },
  ];
  if (opts.versionRange) {
    properties.push({
      name: "cdx:elm:versionRange",
      value: opts.versionRange,
    });
  }
  const pkg = {
    name: split?.repo ?? name,
    group: split?.author,
    ...(version ? { version } : {}),
    type: "library",
    scope: test ? "optional" : "required",
    properties,
  };
  if (typeof opts.metadata?.license === "string" && opts.metadata.license) {
    pkg.license = opts.metadata.license;
  }
  if (typeof opts.metadata?.summary === "string" && opts.metadata.summary) {
    pkg.description = opts.metadata.summary;
  }
  if (purl) {
    pkg.purl = purl;
    pkg["bom-ref"] = decodeURIComponent(purl);
  } else {
    pkg["bom-ref"] = `library:${name}:${version || ""}`;
  }
  return pkg;
}

/**
 * Read and parse a JSON file, warning instead of throwing on invalid input.
 *
 * @param {string} filePath File to read
 * @returns {object|undefined} Parsed value
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.warn(`Failed to parse ${filePath}: ${error.message}`);
    return undefined;
  }
}
