import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { build } from "@cdxgen/cdx-purl";

import { DEBUG_MODE, readEnvironmentVariable } from "../core/activity.js";
import { shouldFetchLicense, shouldFetchVCS } from "../core/env.js";
import { safeExistsSync } from "../core/fs.js";
import { getNpmMetadata } from "./ecosystems.js";
import {
  buildNpmGitDistributionIntakeRefs,
  buildNpmGitPurlQualifiers,
  buildNpmRegistryTarballUrl,
  classifyNpmManifestSource,
  loadNpmrcConfig,
  normalizeNpmRegistryUrl,
  setNpmDevelopmentProperty,
  setNpmOptionalProperty,
  setNpmPeerProperty,
} from "./npmutils.js";

const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";

/**
 * Split a bun.lock package descriptor (eg `@babel/parser@7.29.7`,
 * `left-pad@1.3.0` or `foo@git+https://github.com/foo/bar#abcdef`) into its
 * group, name and version/specifier components.
 *
 * @param {string} descriptor The `name@specifier` descriptor string.
 * @returns {{group: string, name: string, version: string}} Parsed pieces. The
 *   version is returned verbatim, so non-registry specifiers (git/tarball URLs)
 *   are preserved for the caller to handle.
 */
export function parseBunDescriptor(descriptor) {
  // The name may itself start with `@` (scoped package), so look for the `@`
  // that separates name from specifier, i.e. the first one not at index 0.
  const atIndex = descriptor.indexOf("@", 1);
  let fullName = descriptor;
  let version = "";
  if (atIndex > 0) {
    fullName = descriptor.substring(0, atIndex);
    version = descriptor.substring(atIndex + 1);
  }
  let group = "";
  let name = fullName;
  if (fullName.startsWith("@")) {
    const slashIndex = fullName.indexOf("/");
    if (slashIndex > 0) {
      group = fullName.substring(0, slashIndex);
      name = fullName.substring(slashIndex + 1);
    }
  }
  return { group, name, version };
}

/**
 * Split a bun.lock package key into its package-name segments. A key is the
 * dependency path bun nested the package under (eg `@isaacs/cliui/wrap-ansi`),
 * where every segment is a package name, so scoped names (`@scope/name`)
 * count as a single segment despite containing `/`.
 *
 * @param {string} key The lockfile package key.
 * @returns {string[]} The package names composing the key.
 */
function keySegments(key) {
  const parts = key.split("/");
  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("@") && i + 1 < parts.length) {
      segments.push(`${parts[i]}/${parts[i + 1]}`);
      i++;
    } else {
      segments.push(parts[i]);
    }
  }
  return segments;
}

/**
 * Determine whether a bun version specifier points at a non-registry source
 * (git, tarball URL, workspace or local path).
 *
 * @param {string} version The specifier extracted from the descriptor.
 * @returns {boolean} True when the specifier is not a plain semver version.
 */
function isNonRegistrySpecifier(version) {
  if (!version) {
    return false;
  }
  return (
    version.startsWith("git") ||
    version.includes("://") ||
    version.startsWith("github:") ||
    version.startsWith("gitlab:") ||
    version.startsWith("bitbucket:") ||
    version.startsWith("workspace:") ||
    version.startsWith("file:") ||
    version.startsWith("link:")
  );
}

/**
 * Normalize a lockfile `os`/`cpu` value. Bun writes a single string for the
 * common one-value case (eg `"darwin"`), a negated string (eg `"!linux"`), an
 * array for several values and the string `"none"` when nothing applied, so
 * both shapes have to be handled (see `Negatable.toJson` in bun's npm.zig).
 *
 * @param {string|string[]} value The raw `os`/`cpu` metadata value.
 * @returns {string|undefined} Comma-joined value, or undefined when absent.
 */
function normalizeOsCpu(value) {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : undefined;
  }
  if (typeof value === "string" && value.length && value !== "none") {
    return value;
  }
  return undefined;
}

/**
 * Parse a bun text lockfile (`bun.lock`, lockfileVersion 1-3; v1 was written
 * by the Zig implementation in bun 1.2.x-1.3.x and v2/v3 by the Rust one in
 * bun 1.4+ - the content shape is identical, only parse strictness changed).
 *
 * Bun's text lockfile is JSONC (JSON with trailing commas). It records the
 * workspace roots under `workspaces` and the fully resolved dependency tree
 * under `packages`, where nested duplicate versions are keyed by their
 * dependency path (eg `"parent/child"`). The entry layout after the leading
 * `"name@version"` descriptor depends on the resolution type (see the
 * Stringifier in bun's bun.lock.rs):
 * - npm: `["name@version", tarballUrlOrEmpty, { dependencies, bin, os, ... }, "sha512-..."]`
 * - git/github: `["name@git+repo", { ... }, ".bun-tag", "sha512-..."]`
 * - tarball/folder/symlink: `["name@url", { ... }, "sha512-..."]`
 * - workspace: `["name@workspace:path"]`
 * so the elements are recognised by shape instead of fixed indices.
 *
 * The binary lockfile (`bun.lockb`) is intentionally not supported - callers
 * should ask users to regenerate it with `bun install --save-text-lockfile`.
 *
 * @param {string} bunLockFile Path to the bun.lock file.
 * @param {Object} [options] Parsing options (`parentComponent`).
 * @returns {Promise<{pkgList: Array, dependenciesList: Array}>} Parsed packages
 *   and dependency graph, matching the shape of the other lockfile parsers.
 */
export async function parseBunLock(bunLockFile, options = {}) {
  let pkgList = [];
  const dependenciesList = [];
  if (!safeExistsSync(bunLockFile)) {
    return { pkgList, dependenciesList };
  }
  const npmrcConfig = loadNpmrcConfig(
    options.projectRoot || dirname(bunLockFile),
  );
  const defaultRegistry =
    normalizeNpmRegistryUrl(npmrcConfig.registry) || DEFAULT_NPM_REGISTRY;
  const rawData = readFileSync(bunLockFile, "utf8");
  let lockData;
  try {
    // Strip JSONC trailing commas (bun.lock does not use comments) before
    // parsing. Package names, versions and integrity hashes never contain the
    // `,}`/`,]` sequences this targets, so the replacement is safe.
    const jsonText = rawData.replace(/,(\s*[}\]])/g, "$1");
    lockData = JSON.parse(jsonText);
  } catch (err) {
    if (DEBUG_MODE) {
      console.log(`Unable to parse ${bunLockFile}`, err);
    }
    return { pkgList, dependenciesList };
  }
  const packages = lockData.packages || {};
  const workspaces = lockData.workspaces || {};

  // First pass: build per-key metadata and purl/bom-ref lookups. Bun keys
  // nested duplicate versions by dependency path (eg `parent/child`), which we
  // handle per-lookup in resolveDepRef below.
  const infoForKey = new Map();
  const refToKey = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry) || !entry.length) {
      continue;
    }
    const descriptor = entry[0];
    if (typeof descriptor !== "string") {
      continue;
    }
    const { group, name, version } = parseBunDescriptor(descriptor);
    if (!name || !version || version === "root:") {
      continue;
    }
    const isWorkspaceDep = version.startsWith("workspace:");
    const isGitDep =
      version.startsWith("git") ||
      version.startsWith("github:") ||
      version.startsWith("gitlab:") ||
      version.startsWith("bitbucket:");
    const isNonRegistry = isGitDep || isNonRegistrySpecifier(version);
    // The elements after the descriptor depend on the resolution type, so
    // recognise them by shape: the metadata object, the integrity hash and,
    // for npm packages on a custom registry, the tarball URL. The git
    // `.bun-tag` string is not needed.
    let meta = {};
    let integrity;
    let tarballUrl;
    let sawMeta = false;
    for (const el of entry.slice(1)) {
      if (el && typeof el === "object" && !Array.isArray(el)) {
        if (!sawMeta) {
          meta = el;
          sawMeta = true;
        }
      } else if (typeof el === "string" && el.length) {
        if (/^sha\d+-/.test(el)) {
          integrity = integrity || el;
        } else if (!isNonRegistry) {
          tarballUrl = tarballUrl || el;
        }
      }
    }
    // Workspace members point back at their manifest via `workspace:<path>`;
    // use the version declared there for the component identity.
    let componentVersion = version;
    if (isWorkspaceDep) {
      const wsEntry = workspaces[version.slice("workspace:".length)];
      componentVersion = wsEntry?.version || null;
    }
    let qualifiers = null;
    if (isGitDep) {
      qualifiers = buildNpmGitPurlQualifiers(version, group, npmrcConfig);
    } else if (isNonRegistry && !isWorkspaceDep) {
      qualifiers = { download_url: version };
    }
    const purlString = build({
      type: "npm",
      namespace: group || null,
      name: name,
      version: componentVersion,
      qualifiers: qualifiers || null,
    });
    const bomRef = decodeURIComponent(purlString);
    infoForKey.set(key, {
      group,
      name,
      version,
      componentVersion,
      registry: tarballUrl || "",
      meta,
      integrity,
      purlString,
      bomRef,
      isGitDep,
      isWorkspaceDep,
      isNonRegistry,
    });
    if (!refToKey.has(bomRef)) {
      refToKey.set(bomRef, key);
    }
  }

  // Resolve a dependency name referenced from `parentKey` to the bom-ref of
  // the concrete package bun installed for it. Bun walks up the parent's key
  // one package segment at a time (eg for `a/@scope/b/c` it tries
  // `a/@scope/b/c/<dep>`, `a/@scope/b/<dep>`, `a/<dep>`, then `<dep>`) and
  // uses the first entry it finds, so a version nested at an intermediate
  // level must win over the top-level one.
  const resolveDepRef = (parentKey, depName) => {
    const segments = parentKey ? keySegments(parentKey) : [];
    for (let i = segments.length; i >= 0; i--) {
      const key = [...segments.slice(0, i), depName].join("/");
      if (infoForKey.has(key)) {
        return infoForKey.get(key).bomRef;
      }
    }
    return undefined;
  };

  // Track packages surfaced as optional / peer dependencies anywhere in the
  // tree so they can be annotated with the matching cdx properties.
  const optionalRefs = new Set();
  const peerRefs = new Set();

  // Collect the runtime dependency refs declared by a package's metadata.
  const runtimeDepRefs = (parentKey, meta) => {
    const refs = new Set();
    const collect = (depBlock, markSet) => {
      if (!depBlock) {
        return;
      }
      for (const depName of Object.keys(depBlock)) {
        const ref = resolveDepRef(parentKey, depName);
        if (ref) {
          refs.add(ref);
          if (markSet) {
            markSet.add(ref);
          }
        }
      }
    };
    collect(meta.dependencies, null);
    collect(meta.optionalDependencies, optionalRefs);
    collect(meta.peerDependencies, peerRefs);
    // Peers bun could not resolve are listed by name and stay optional.
    if (Array.isArray(meta.optionalPeers)) {
      for (const depName of meta.optionalPeers) {
        const ref = resolveDepRef(parentKey, depName);
        if (ref) {
          optionalRefs.add(ref);
        }
      }
    }
    return refs;
  };

  // Resolve the dependencies a workspace declares (the root resolves at the
  // top level, members under their package name - bun nests a member's own
  // versions under its name, eg `pkg-a/strip-ansi`), annotating optional /
  // peer markers along the way.
  const workspaceDepRefs = (wsKey, wsEntry) => {
    const refs = new Set();
    for (const depName of Object.keys(wsEntry.dependencies || {})) {
      const ref = resolveDepRef(wsKey, depName);
      if (ref) {
        refs.add(ref);
      }
    }
    for (const depName of Object.keys(wsEntry.optionalDependencies || {})) {
      const ref = resolveDepRef(wsKey, depName);
      if (ref) {
        refs.add(ref);
        optionalRefs.add(ref);
      }
    }
    for (const depName of Object.keys(wsEntry.peerDependencies || {})) {
      const ref = resolveDepRef(wsKey, depName);
      if (ref) {
        // Bun resolves workspace peers like any other dependency (it
        // auto-installs them), so they are real edges of the workspace.
        refs.add(ref);
        peerRefs.add(ref);
      }
    }
    return refs;
  };

  // Seed a production-reachability walk from the workspace roots so dev-only
  // packages can be scoped as optional. Every member is itself production
  // code, but its dependencies belong on the member's component, not on the
  // root, so they are recorded per member key for the graph below.
  const rootProdRefs = new Set();
  const memberRefsByKey = new Map();
  const prodSeeds = new Set();
  let sawRootWorkspace = false;
  for (const [wsPath, wsEntry] of Object.entries(workspaces)) {
    if (!wsEntry) {
      continue;
    }
    const isRoot = wsPath === "";
    const wsKey = isRoot ? "" : wsEntry.name || "";
    const refs = workspaceDepRefs(wsKey, wsEntry);
    if (isRoot) {
      sawRootWorkspace = true;
      for (const ref of refs) {
        rootProdRefs.add(ref);
      }
    } else {
      memberRefsByKey.set(wsKey, refs);
      const memberRef = infoForKey.get(wsKey)?.bomRef;
      if (memberRef) {
        prodSeeds.add(memberRef);
      }
    }
    for (const ref of refs) {
      prodSeeds.add(ref);
    }
  }
  // Defensive fallback for lockfiles without a `""` root entry: keep the
  // pre-workspace-split behaviour of seeding from every workspace.
  if (!sawRootWorkspace) {
    for (const ref of prodSeeds) {
      rootProdRefs.add(ref);
    }
  }
  const prodRefs = new Set();
  const queue = [...prodSeeds];
  while (queue.length) {
    const ref = queue.shift();
    if (prodRefs.has(ref)) {
      continue;
    }
    prodRefs.add(ref);
    const key = refToKey.get(ref);
    if (!key) {
      continue;
    }
    for (const childRef of runtimeDepRefs(key, infoForKey.get(key).meta)) {
      if (!prodRefs.has(childRef)) {
        queue.push(childRef);
      }
    }
  }

  // Second pass: emit the package list and dependency graph.
  const seenRefs = new Set();
  for (const [key, info] of infoForKey.entries()) {
    if (seenRefs.has(info.bomRef)) {
      continue;
    }
    seenRefs.add(info.bomRef);
    const {
      group,
      name,
      version,
      componentVersion,
      registry,
      meta,
      integrity,
      purlString,
    } = info;
    const properties = [{ name: "internal:SrcFile", value: bunLockFile }];
    const externalReferences = [];

    // Resolve the distribution (tarball) URL. Bun leaves the registry field
    // empty for the default npm registry, so synthesise the tarball URL in
    // that case; otherwise use the recorded resolution.
    let resolvedUrl;
    if (registry && typeof registry === "string" && registry.length) {
      resolvedUrl = registry;
    } else if (!info.isNonRegistry) {
      resolvedUrl = buildNpmRegistryTarballUrl(
        defaultRegistry,
        group,
        name,
        componentVersion,
      );
    }
    if (resolvedUrl) {
      properties.push({ name: "internal:ResolvedUrl", value: resolvedUrl });
      externalReferences.push({ type: "distribution", url: resolvedUrl });
    }
    if (info.isGitDep) {
      const gitIntakeRefs = buildNpmGitDistributionIntakeRefs(
        group,
        name,
        version,
        npmrcConfig,
      );
      if (gitIntakeRefs) {
        externalReferences.push(...gitIntakeRefs);
      }
      const manifestSource = classifyNpmManifestSource(version);
      if (manifestSource) {
        properties.push({
          name: "cdx:npm:manifestSourceType",
          value: manifestSource.type,
        });
        properties.push({
          name: "cdx:npm:manifestSource",
          value: manifestSource.value,
        });
      }
    }
    if (info.isNonRegistry) {
      properties.push({ name: "cdx:npm:isRegistryDependency", value: "false" });
    }
    if (meta.bundled === true) {
      properties.push({ name: "cdx:npm:bundled", value: "true" });
    }
    if (meta.bin) {
      const binValue =
        typeof meta.bin === "object"
          ? Object.keys(meta.bin).join(", ")
          : meta.bin;
      properties.push({ name: "cdx:npm:bin", value: binValue });
      properties.push({ name: "cdx:npm:has_binary", value: "true" });
    }
    const osValue = normalizeOsCpu(meta.os);
    if (osValue) {
      properties.push({ name: "cdx:npm:os", value: osValue });
    }
    const cpuValue = normalizeOsCpu(meta.cpu);
    if (cpuValue) {
      properties.push({ name: "cdx:npm:cpu", value: cpuValue });
    }

    const pkgObj = {
      group: group || "",
      name,
      version: componentVersion ?? undefined,
      purl: purlString,
      "bom-ref": info.bomRef,
      _integrity: integrity || undefined,
      properties,
      evidence: {
        identity: {
          field: "purl",
          confidence: 1,
          methods: [
            {
              technique: "manifest-analysis",
              confidence: 1,
              value: bunLockFile,
            },
          ],
        },
      },
    };
    if (externalReferences.length) {
      pkgObj.externalReferences = externalReferences;
    }
    // Packages that are not reachable through production dependencies are
    // development-only tooling.
    if (!prodRefs.has(info.bomRef)) {
      pkgObj.scope = "optional";
      setNpmDevelopmentProperty(pkgObj);
    }
    if (optionalRefs.has(info.bomRef)) {
      pkgObj.scope = "optional";
      setNpmOptionalProperty(pkgObj);
    }
    if (peerRefs.has(info.bomRef)) {
      setNpmPeerProperty(pkgObj);
    }
    pkgList.push(pkgObj);
    // A workspace member's dependencies come from its `workspaces` entry (its
    // package entry has no metadata), possibly unioned with metadata ones.
    const memberRefs = memberRefsByKey.get(key);
    const dependsOn = memberRefs
      ? [...new Set([...memberRefs, ...runtimeDepRefs(key, meta)])]
      : [...runtimeDepRefs(key, meta)];
    dependenciesList.push({
      ref: info.bomRef,
      dependsOn: dependsOn.sort(),
    });
  }

  // Add the dependency entry for the workspace root.
  if (options.parentComponent?.["bom-ref"]) {
    dependenciesList.push({
      ref: options.parentComponent["bom-ref"],
      dependsOn: [...rootProdRefs].sort(),
    });
  }

  if (
    shouldFetchLicense() ||
    shouldFetchVCS() ||
    readEnvironmentVariable("FETCH_LICENSE") === "true"
  ) {
    if (DEBUG_MODE) {
      console.log(
        `About to fetch npm registry metadata for ${pkgList.length} packages in parseBunLock`,
      );
    }
    pkgList = await getNpmMetadata(pkgList);
  }
  return { pkgList, dependenciesList };
}
