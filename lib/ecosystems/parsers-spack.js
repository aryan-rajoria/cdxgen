import { readFileSync } from "node:fs";

import { tryBuildPurl } from "../inventory/purl.js";

/**
 * HPC Spack parser for `spack.lock`.
 *
 * Spack writes a JSON lock file when an environment is concretised:
 *
 *   - `roots` — the specs the user asked for, each as `{hash, spec}`.
 *   - `concrete_specs` — every node of the resolved DAG, keyed by its DAG
 *     hash. A node carries its `name`, `version`, `namespace`, the compiler
 *     and architecture it was built for, and a `dependencies` list whose
 *     entries reference other nodes by hash.
 *
 * The DAG hash is the identity Spack itself uses: two builds of the same
 * version with different variants or compilers are different hashes, so the
 * graph is keyed by hash throughout and the hash is carried into each
 * component's bom-ref.
 *
 * No `spack` purl type is registered, so nodes are identified as generic
 * packages carrying a `cdx:purl:proposedType=spack` property, following the
 * convention used for nix and zig. The DAG hash is kept as a property because
 * it identifies the concrete build, not the artifact bytes.
 */

/**
 * Parse a `spack.lock` file.
 *
 * @param {string} spackLockFile Path to `spack.lock`
 * @returns {{ pkgList: object[], dependencies: object[], rootInputs: string[] }}
 */
export function parseSpackLock(spackLockFile) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(spackLockFile, "utf-8"));
  } catch (error) {
    console.warn(`Failed to parse ${spackLockFile}: ${error.message}`);
    return emptyResult();
  }
  const concreteSpecs =
    lock?.concrete_specs && typeof lock.concrete_specs === "object"
      ? lock.concrete_specs
      : undefined;
  if (!concreteSpecs) {
    return emptyResult();
  }

  const pkgList = [];
  const refByHash = new Map();
  for (const [hash, node] of Object.entries(concreteSpecs)) {
    if (typeof node?.name !== "string" || !node.name) {
      continue;
    }
    const pkg = spackPackage(node.name, stringOrUndefined(node.version), {
      hash,
      namespace: stringOrUndefined(node.namespace),
      arch: architectureLabel(node.arch),
      compiler: compilerLabel(node.compiler),
      srcFile: spackLockFile,
    });
    pkgList.push(pkg);
    refByHash.set(hash, pkg["bom-ref"]);
  }

  const dependencies = [];
  for (const [hash, node] of Object.entries(concreteSpecs)) {
    const ref = refByHash.get(hash);
    if (!ref) {
      continue;
    }
    // Link and run edges are the ones that survive into the installed DAG;
    // build-only edges are dropped to keep the graph at runtime relevance.
    const dependsOn = new Set();
    for (const dep of Array.isArray(node.dependencies)
      ? node.dependencies
      : []) {
      const types = Array.isArray(dep?.type) ? dep.type : [];
      if (!types.includes("link") && !types.includes("run")) {
        continue;
      }
      const targetRef = refByHash.get(dep?.hash);
      if (targetRef && targetRef !== ref) {
        dependsOn.add(targetRef);
      }
    }
    dependencies.push({ ref, dependsOn: [...dependsOn].sort() });
  }

  // The environment names its own roots; nothing has to be inferred.
  const rootInputs = (Array.isArray(lock.roots) ? lock.roots : [])
    .map((root) => refByHash.get(root?.hash))
    .filter(Boolean);
  return { pkgList, dependencies, rootInputs: [...new Set(rootInputs)] };
}

/**
 * Build a component-like package record for a Spack node.
 *
 * @param {string} name Node name
 * @param {string|undefined} version Node version
 * @param {object} opts Extra context (`hash`, `namespace`, `arch`, `compiler`, `srcFile`)
 * @returns {object} Package record
 */
function spackPackage(name, version, opts) {
  const purl = tryBuildPurl({
    type: "generic",
    namespace: "spack",
    name,
    version: version || undefined,
  });
  const properties = [
    { name: "internal:SrcFile", value: opts.srcFile },
    { name: "cdx:purl:proposedType", value: "spack" },
  ];
  if (opts.hash) {
    properties.push({ name: "cdx:spack:hash", value: opts.hash });
  }
  if (opts.namespace) {
    properties.push({ name: "cdx:spack:namespace", value: opts.namespace });
  }
  if (opts.arch) {
    properties.push({ name: "cdx:spack:arch", value: opts.arch });
  }
  if (opts.compiler) {
    properties.push({ name: "cdx:spack:compiler", value: opts.compiler });
  }
  const pkg = {
    name,
    ...(version ? { version } : {}),
    type: "library",
    scope: "required",
    properties,
  };
  if (purl) {
    pkg.purl = purl;
    // An environment can hold two builds of one version that differ only in
    // their variants or compiler, and the DAG hash is what tells them apart,
    // so it is carried in the bom-ref as a subpath to keep the refs distinct.
    pkg["bom-ref"] = opts.hash
      ? `${decodeURIComponent(purl)}#${opts.hash}`
      : decodeURIComponent(purl);
  } else {
    pkg["bom-ref"] = `library:${name}:${version || ""}:${opts.hash || ""}`;
  }
  return pkg;
}

/**
 * Render a node's architecture as `platform-os-target`.
 *
 * @param {object|undefined} arch Node `arch` object
 * @returns {string|undefined} Architecture label
 */
function architectureLabel(arch) {
  if (!arch || typeof arch !== "object") {
    return undefined;
  }
  // Newer lock versions nest the microarchitecture under `target.name`.
  const target =
    typeof arch.target === "string"
      ? arch.target
      : stringOrUndefined(arch.target?.name);
  const parts = [
    stringOrUndefined(arch.platform),
    stringOrUndefined(arch.platform_os),
    target,
  ].filter(Boolean);
  return parts.length ? parts.join("-") : undefined;
}

/**
 * Render a node's compiler as `name@version`.
 *
 * @param {object|undefined} compiler Node `compiler` object
 * @returns {string|undefined} Compiler label
 */
function compilerLabel(compiler) {
  const name = stringOrUndefined(compiler?.name);
  if (!name) {
    return undefined;
  }
  const version = stringOrUndefined(compiler?.version);
  return version ? `${name}@${version}` : name;
}

/**
 * Narrow a value to a non-empty string.
 *
 * @param {*} value Value to check
 * @returns {string|undefined} The string, or undefined
 */
function stringOrUndefined(value) {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Shared empty result for unreadable or malformed locks.
 *
 * @returns {{pkgList: object[], dependencies: object[], rootInputs: string[]}}
 */
function emptyResult() {
  return { pkgList: [], dependencies: [], rootInputs: [] };
}
