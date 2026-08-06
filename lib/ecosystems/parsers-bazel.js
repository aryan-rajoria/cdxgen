import { readFileSync } from "node:fs";

import { tryBuildPurl } from "../inventory/purl.js";

/**
 * Bazel bzlmod dependency extraction.
 *
 * bzlmod (`MODULE.bazel` + `MODULE.bazel.lock`) pulls dependencies from many
 * ecosystems. The whole point of parsing it for an SBOM is to map each
 * resolved dependency onto its true ecosystem purl so vulnerability
 * advisories match — a Maven dependency pulled through bzlmod is a `pkg:maven`
 * package, not a `pkg:bazel` one.
 *
 * Two sources are consulted:
 *
 *   - `MODULE.bazel` (Starlark): the manifest. `bazel_dep(name, version)`
 *     declares Bazel Central Registry modules, which ARE the registered
 *     `bazel` purl type's intended target (flat name, no namespace, default
 *     `repository_url = https://bcr.bazel.build`). Extension calls such as
 *     `maven.artifact(...)` declare dependencies in their native ecosystem.
 *
 *   - `MODULE.bazel.lock` (JSON): the resolved lock. Its structure has changed
 *     across `lockFileVersion`, so this parser reads defensively — a legacy
 *     `modules` array when present, and the modern `moduleExtensions` whose
 *     `generatedRepoSpecs` carry resolved Maven coordinates.
 *
 * `pkg:bazel/...` is used only for BCR modules. Squatting it for a Maven
 * artifact would silently break every vulnerability match.
 */

const BCR_DEFAULT_REPOSITORY_URL = "https://bcr.bazel.build";

/**
 * Parse a `MODULE.bazel` manifest and return its BCR modules and ecosystem
 * dependencies. The MODULE.bazel file is Starlark; this extractor finds calls
 * by name and reads their keyword/string arguments using a balanced-paren scan
 * rather than a regex, because MODULE.bazel calls can nest.
 *
 * @param {string} moduleFile Path to `MODULE.bazel`
 * @returns {{ pkgList: object[], parentComponent: object, rootInputs: string[] }}
 */
export function parseModuleBazel(moduleFile) {
  let src;
  try {
    src = readFileSync(moduleFile, "utf-8");
  } catch (error) {
    console.warn(`Failed to parse ${moduleFile}: ${error.message}`);
    return { pkgList: [], parentComponent: {}, rootInputs: [] };
  }

  const pkgList = [];
  const parentComponent = {};

  const moduleName = scalarArg(findFirstCall(src, "module"), "name");
  const moduleVersion = scalarArg(findFirstCall(src, "module"), "version");
  if (moduleName) {
    Object.assign(parentComponent, {
      type: "application",
      name: moduleName,
      ...(moduleVersion ? { version: moduleVersion } : {}),
      description: `Bazel module: ${moduleName}`,
      properties: [{ name: "SrcFile", value: moduleFile }],
    });
  }

  for (const call of findAllCalls(src, "bazel_dep")) {
    const name = scalarArg(call, "name");
    const version = scalarArg(call, "version");
    const repoName = scalarArg(call, "repo_name");
    if (!name || !version) continue;
    pkgList.push(buildBcrPackage(repoName || name, name, version, moduleFile));
  }

  for (const call of findAllCalls(src, "maven.artifact")) {
    const pkg = mavenPackageFromCall(call, moduleFile);
    if (pkg) pkgList.push(pkg);
  }
  // rules_jvm_external exposes `maven.artifact`; some projects call it on a
  // locally aliased handle. Catch the common alias shapes too.
  for (const call of findAllCalls(src, "artifact")) {
    if (looksLikeMavenArtifactCall(call)) {
      const pkg = mavenPackageFromCall(call, moduleFile);
      if (pkg) pkgList.push(pkg);
    }
  }

  const rootInputs = pkgList.map((p) => p["bom-ref"]);
  return { pkgList, parentComponent, rootInputs };
}

/**
 * Parse a `MODULE.bazel.lock` for resolved dependencies and the module graph.
 *
 * @param {string} lockFile Path to `MODULE.bazel.lock`
 * @returns {{ pkgList: object[], dependencies: object[] }}
 */
export function parseModuleBazelLock(lockFile) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf-8"));
  } catch (error) {
    console.warn(`Failed to parse ${lockFile}: ${error.message}`);
    return { pkgList: [], dependencies: [] };
  }

  const pkgList = [];
  const dependencies = [];

  // Legacy lockFileVersion (<= ~9) carries a resolved `modules` array.
  if (Array.isArray(lock.modules)) {
    const byKey = new Map();
    for (const mod of lock.modules) {
      const name = mod.name;
      const version = mod.version;
      if (!name || !version) continue;
      const pkg = buildBcrPackage(
        mod.repoName || name,
        name,
        version,
        lockFile,
      );
      pkgList.push(pkg);
      byKey.set(`${name}@${version}`, pkg["bom-ref"]);
    }
    for (const mod of lock.modules) {
      const ref = byKey.get(`${mod.name}@${mod.version}`);
      if (!ref) continue;
      const dependsOn = (mod.deps || [])
        .map((d) => byKey.get(`${d.name}@${d.version}`))
        .filter(Boolean);
      dependencies.push({ ref, dependsOn: [...new Set(dependsOn)].sort() });
    }
  }

  // Modern lockFileVersion carries resolved Maven coordinates under module
  // extensions' generatedRepoSpecs.
  if (lock.moduleExtensions) {
    for (const ext of Object.values(lock.moduleExtensions)) {
      const specs = ext?.general?.generatedRepoSpecs;
      if (!specs || typeof specs !== "object") continue;
      for (const spec of Object.values(specs)) {
        const pkg = mavenPackageFromRepoSpec(spec, lockFile);
        if (pkg) pkgList.push(pkg);
      }
    }
  }

  return { pkgList, dependencies };
}

/**
 * Build a component record for a BCR (Bazel Central Registry) module.
 *
 * BCR modules are the registered `bazel` purl type's intended target: a flat
 * module name, no namespace, and the BCR as the default repository.
 *
 * @param {string} displayRepoName Repository name used in the build (for SrcFile context)
 * @param {string} moduleName Canonical module name
 * @param {string} version Resolved version
 * @param {string} srcFile Source file for evidence
 * @returns {object} Package record
 */
function buildBcrPackage(displayRepoName, moduleName, version, srcFile) {
  const purl = tryBuildPurl({
    type: "bazel",
    name: moduleName,
    version,
    qualifiers: { repository_url: BCR_DEFAULT_REPOSITORY_URL },
  });
  return {
    name: moduleName,
    version,
    type: "library",
    scope: "required",
    purl,
    "bom-ref": decodeURIComponent(purl),
    properties: [
      { name: "SrcFile", value: srcFile },
      { name: "cdx:bazel:module", value: moduleName },
      { name: "cdx:bazel:repository_url", value: BCR_DEFAULT_REPOSITORY_URL },
      ...(displayRepoName !== moduleName
        ? [{ name: "cdx:bazel:repo_name", value: displayRepoName }]
        : []),
    ],
    evidence: {
      identity: {
        field: "purl",
        confidence: 1.0,
        methods: [
          {
            technique: "manifest-analysis",
            confidence: 1.0,
            value: srcFile,
          },
        ],
      },
    },
  };
}

/**
 * Build a Maven package from a Starlark `maven.artifact(...)` call.
 *
 * rules_jvm_external accepts either a coordinate string
 * (`"group:artifact:version"`) or separate `group`/`artifact`/`version`
 * keyword arguments.
 *
 * @param {Map<string, string|string[]>} call Parsed call arguments
 * @param {string} srcFile Source file for evidence
 * @returns {object|null} Package record, or null when no coordinates parse
 */
function mavenPackageFromCall(call, srcFile) {
  const parsed = parseMavenCoordinates(
    scalarArg(call, "artifact") ||
      scalarArg(call, "coord") ||
      scalarArg(call, "coordinates") ||
      scalarArg(call, ""),
    call,
  );
  if (!parsed) return null;
  return buildMavenPackage(parsed.group, parsed.name, parsed.version, srcFile);
}

/**
 * Build a Maven package from a lock generatedRepoSpec entry.
 *
 * `jvm_maven_import_external` records the coordinates either as a single
 * `artifact` string (`group:artifact:version`) or as separate
 * `group`/`artifact`/`version` attributes.
 *
 * @param {object} spec A generatedRepoSpec value with `attributes`
 * @param {string} srcFile Lock file path for evidence
 * @returns {object|null} Package record, or null when it is not a Maven spec
 */
function mavenPackageFromRepoSpec(spec, srcFile) {
  if (!spec || typeof spec !== "object") return null;
  const ruleId = `${spec.repoRuleId || ""}`;
  if (!/maven|jvm_import_external/.test(ruleId)) return null;
  const attrs = spec.attributes || {};
  const parsed = parseMavenCoordinates(attrs.artifact, attrs);
  if (!parsed) return null;
  return buildMavenPackage(parsed.group, parsed.name, parsed.version, srcFile);
}

/**
 * Parse Maven coordinates from a coordinate string or a set of attributes.
 *
 * @param {string|undefined} coordStr A `group:artifact:version` string
 * @param {object|Map} attrs Attribute map with group/artifact/version keys
 * @returns {{group: string, name: string, version: string}|null}
 */
function parseMavenCoordinates(coordStr, attrs) {
  if (coordStr && typeof coordStr === "string") {
    const parts = coordStr.split(":");
    if (parts.length >= 3) {
      return { group: parts[0], name: parts[1], version: parts[2] };
    }
  }
  const group = scalarArg(attrs, "group");
  const name = scalarArg(attrs, "artifact") || scalarArg(attrs, "name");
  const version = scalarArg(attrs, "version");
  if (group && name && version) {
    return { group, name, version };
  }
  return null;
}

/**
 * Construct a Maven package record. Maven purls require a group (namespace).
 *
 * @param {string} group Group ID
 * @param {string} name Artifact ID
 * @param {string} version Version
 * @param {string} srcFile Source file for evidence
 * @returns {object} Package record
 */
function buildMavenPackage(group, name, version, srcFile) {
  const purl = tryBuildPurl({
    type: "maven",
    namespace: group,
    name,
    version,
  });
  const pkg = {
    name,
    version,
    type: "library",
    scope: "required",
    group,
    properties: [
      { name: "SrcFile", value: srcFile },
      { name: "cdx:bazel:ecosystem", value: "maven" },
    ],
  };
  if (purl) {
    pkg.purl = purl;
    pkg["bom-ref"] = decodeURIComponent(purl);
  } else {
    pkg["bom-ref"] = `library:${group}:${name}:${version}`;
  }
  return pkg;
}

/**
 * Heuristic: does an `artifact(...)` call look like a Maven artifact
 * declaration? Used to avoid treating unrelated `artifact` calls (e.g. test
 * fixtures) as Maven coordinates. A Maven coordinate string has at least two
 * colons; separate group/artifact/version args are a stronger signal.
 *
 * @param {Map<string, string|string[]>} call Parsed call arguments
 * @returns {boolean}
 */
function looksLikeMavenArtifactCall(call) {
  const coord =
    scalarArg(call, "artifact") ||
    scalarArg(call, "coord") ||
    scalarArg(call, "coordinates");
  if (coord && coord.split(":").length >= 3) {
    return true;
  }
  return !!(
    scalarArg(call, "group") &&
    (scalarArg(call, "artifact") || scalarArg(call, "name")) &&
    scalarArg(call, "version")
  );
}

// ---------------------------------------------------------------------------
// Starlark call extraction
// ---------------------------------------------------------------------------

/**
 * Find every top-level call to `name(...)` in Starlark source and return the
 * parsed keyword/string arguments of each. Scanning uses a balanced-paren
 * counter rather than a regex, because MODULE.bazel calls can nest other calls
 * inside their argument lists.
 *
 * @param {string} src Starlark source
 * @param {string} name Function name to match (dotted names supported)
 * @returns {Array<Map<string, string|string[]>>} one argument map per call
 */
export function findAllCalls(src, name) {
  const calls = [];
  let i = 0;
  while (i < src.length) {
    const hit = src.indexOf(name, i);
    if (hit === -1) break;
    // Ensure the match is a whole token, not a suffix of a longer identifier.
    const before = hit > 0 ? src[hit - 1] : "";
    if (/[A-Za-z0-9_.]/.test(before)) {
      i = hit + 1;
      continue;
    }
    let j = hit + name.length;
    while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
    if (src[j] !== "(") {
      i = hit + 1;
      continue;
    }
    const close = matchingParen(src, j);
    if (close === -1) break;
    const argSrc = src.substring(j + 1, close);
    calls.push(parseCallArgs(argSrc));
    i = close + 1;
  }
  return calls;
}

/**
 * Find the first call to `name(...)` and return its arguments, or null.
 *
 * @param {string} src Starlark source
 * @param {string} name Function name
 * @returns {Map<string, string|string[]>|null}
 */
function findFirstCall(src, name) {
  return findAllCalls(src, name)[0] || null;
}

/**
 * Return the index of the closing paren that matches the opening paren at
 * `open`, skipping string literals. Returns -1 if unbalanced.
 *
 * @param {string} src Source
 * @param {number} open Index of the opening `(`
 * @returns {number} index of the matching `)`, or -1
 */
function matchingParen(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === "#") {
      // Line comment; skip to end of line.
      i = src.indexOf("\n", i);
      if (i === -1) return -1;
      i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Advance past a string literal starting at `start` (the opening quote),
 * respecting backslash escapes. Returns the index after the closing quote.
 *
 * @param {string} src Source
 * @param {number} start Index of the opening quote
 * @returns {number} index after the closing quote
 */
function skipString(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Parse the argument list of a Starlark call into a map of keyword arguments.
 *
 * Handles `key = "value"`, `key = [list, of, values]`, bare positional string
 * arguments (collected under the special `""` key), and nested calls (the
 * value is captured as the raw source span). Only the constructs that appear
 * in MODULE.bazel are supported.
 *
 * @param {string} argSrc Source inside the call's parentheses
 * @returns {Map<string, string|string[]>} parsed arguments
 */
function parseCallArgs(argSrc) {
  const args = new Map();
  let i = 0;
  while (i < argSrc.length) {
    i = skipSpaceAndComments(argSrc, i);
    if (i >= argSrc.length || argSrc[i] === ",") {
      i++;
      continue;
    }
    // Read a key (identifier) when followed by '='.
    let key = "";
    while (i < argSrc.length && /[A-Za-z0-9_.]/.test(argSrc[i])) {
      key += argSrc[i];
      i++;
    }
    const afterKey = skipSpaceAndComments(argSrc, i);
    if (key && argSrc[afterKey] === "=") {
      i = skipSpaceAndComments(argSrc, afterKey + 1);
      const { value, end } = readValue(argSrc, i);
      args.set(key, value);
      i = end;
    } else {
      // Positional argument; capture as a bare value under "".
      const { value, end } = readValue(argSrc, key ? i - key.length : i);
      const existing = args.get("");
      const next = value;
      args.set(
        "",
        Array.isArray(existing)
          ? [...existing, next]
          : existing !== undefined
            ? [existing, next]
            : next,
      );
      i = end;
    }
  }
  return args;
}

/**
 * Read a single Starlark value (string, list, or nested call span) starting at
 * `start`, returning the decoded value and the index past it.
 *
 * @param {string} src Source
 * @param {number} start Start index
 * @returns {{value: string|string[], end: number}}
 */
function readValue(src, start) {
  const i = skipSpaceAndComments(src, start);
  const c = src[i];
  if (c === '"' || c === "'") {
    const end = skipString(src, i);
    return { value: unquote(src.substring(i, end)), end };
  }
  if (c === "[") {
    return readList(src, i);
  }
  // A nested call or bare token: read until a top-level comma or closing paren.
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'") {
      j = skipString(src, j);
      continue;
    }
    if (ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      break;
    }
    j++;
  }
  return { value: src.substring(i, j).trim(), end: j };
}

/**
 * Read a Starlark list literal, returning its string elements.
 *
 * @param {string} src Source
 * @param {number} start Index of the opening `[`
 * @returns {{value: string[], end: number}}
 */
function readList(src, start) {
  const items = [];
  let i = start + 1;
  while (i < src.length && src[i] !== "]") {
    i = skipSpaceAndComments(src, i);
    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === "]") break;
    const { value, end } = readValue(src, i);
    if (typeof value === "string" && value) {
      items.push(value);
    } else if (Array.isArray(value)) {
      items.push(...value);
    }
    i = end;
  }
  return { value: items, end: i < src.length ? i + 1 : i };
}

/**
 * Skip whitespace and Starlark line comments, returning the next significant
 * index.
 *
 * @param {string} src Source
 * @param {number} i Current index
 * @returns {number} next significant index
 */
function skipSpaceAndComments(src, i) {
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
    } else if (c === "#") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
    } else if (c === "\\" && src[i + 1] === "\n") {
      // Line continuation.
      i += 2;
    } else {
      return i;
    }
  }
  return i;
}

/**
 * Remove surrounding quotes and resolve backslash escapes from a string token.
 *
 * @param {string} token A quoted string token including the quotes
 * @returns {string} the decoded string value
 */
function unquote(token) {
  if (!token) return "";
  const quote = token[0];
  if (quote !== '"' && quote !== "'") return token;
  const inner = token.slice(1, -1);
  return inner.replace(/\\(.)/g, (_m, ch) =>
    ch === "n" ? "\n" : ch === "t" ? "\t" : ch,
  );
}

/**
 * Extract a scalar string value for a key from a parsed call argument map,
 * accepting either a plain object or a Map (so the same helper works for
 * Starlark call args and lock attribute objects).
 *
 * @param {Map|object} call Parsed arguments
 * @param {string} key Argument name
 * @returns {string|undefined}
 */
function scalarArg(call, key) {
  if (!call) return undefined;
  let v;
  if (typeof call.get === "function") {
    v = call.get(key);
  } else {
    v = call[key];
  }
  if (v == null) return undefined;
  if (Array.isArray(v)) return `${v[0]}`;
  return `${v}`;
}
