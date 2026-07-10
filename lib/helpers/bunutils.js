import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { PackageURL } from "packageurl-js";

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
import {
  DEBUG_MODE,
  getNpmMetadata,
  safeExistsSync,
  shouldFetchLicense,
  shouldFetchVCS,
} from "./utils.js";

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
 * Parse a bun text lockfile (`bun.lock`, lockfileVersion 1).
 *
 * Bun's text lockfile is JSONC (JSON with trailing commas). It records the
 * workspace roots under `workspaces` and the fully resolved dependency tree
 * under `packages`, where each entry is an array of the form
 * `["name@version", "registry", { dependencies, optionalDependencies, bin,
 * os, cpu, ... }, "sha512-..."]`. Nested duplicate versions are keyed by their
 * dependency path (eg `"parent/child"`).
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
    const registry = entry.length > 1 ? entry[1] : "";
    const meta = entry.length > 2 && entry[2] ? entry[2] : {};
    const integrity = entry.length > 3 ? entry[3] : undefined;
    const { group, name, version } = parseBunDescriptor(descriptor);
    if (!name || !version) {
      continue;
    }
    const isGitDep =
      version.startsWith("git") ||
      version.startsWith("github:") ||
      version.startsWith("gitlab:") ||
      version.startsWith("bitbucket:");
    let qualifiers = null;
    if (isGitDep) {
      qualifiers = buildNpmGitPurlQualifiers(version, group, npmrcConfig);
    } else if (isNonRegistrySpecifier(version)) {
      qualifiers = { download_url: version };
    }
    const purlString = new PackageURL(
      "npm",
      group,
      name,
      version,
      qualifiers,
      null,
    ).toString();
    const bomRef = decodeURIComponent(purlString);
    infoForKey.set(key, {
      group,
      name,
      version,
      registry,
      meta,
      integrity,
      purlString,
      bomRef,
      isGitDep,
      isNonRegistry: isNonRegistrySpecifier(version),
    });
    if (!refToKey.has(bomRef)) {
      refToKey.set(bomRef, key);
    }
  }

  // Resolve a dependency name referenced from `parentKey` to the bom-ref of the
  // concrete package bun installed for it. Prefer the nested path key, then
  // fall back to the top-level entry.
  const resolveDepRef = (parentKey, depName) => {
    const nestedKey = parentKey ? `${parentKey}/${depName}` : depName;
    if (infoForKey.has(nestedKey)) {
      return infoForKey.get(nestedKey).bomRef;
    }
    if (infoForKey.has(depName)) {
      return infoForKey.get(depName).bomRef;
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
    return refs;
  };

  // Seed a production-reachability walk from the non-dev dependencies of every
  // workspace root so dev-only packages can be scoped as optional.
  const rootProdRefs = new Set();
  for (const wsEntry of Object.values(workspaces)) {
    if (!wsEntry) {
      continue;
    }
    for (const depName of Object.keys(wsEntry.dependencies || {})) {
      const ref = resolveDepRef("", depName);
      if (ref) {
        rootProdRefs.add(ref);
      }
    }
    for (const depName of Object.keys(wsEntry.optionalDependencies || {})) {
      const ref = resolveDepRef("", depName);
      if (ref) {
        rootProdRefs.add(ref);
        optionalRefs.add(ref);
      }
    }
    for (const depName of Object.keys(wsEntry.peerDependencies || {})) {
      const ref = resolveDepRef("", depName);
      if (ref) {
        peerRefs.add(ref);
      }
    }
  }
  const prodRefs = new Set();
  const queue = [...rootProdRefs];
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
    const { group, name, version, registry, meta, integrity, purlString } =
      info;
    const properties = [{ name: "SrcFile", value: bunLockFile }];
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
        version,
      );
    }
    if (resolvedUrl) {
      properties.push({ name: "ResolvedUrl", value: resolvedUrl });
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
    if (meta.bin) {
      const binValue =
        typeof meta.bin === "object"
          ? Object.keys(meta.bin).join(", ")
          : meta.bin;
      properties.push({ name: "cdx:npm:bin", value: binValue });
      properties.push({ name: "cdx:npm:has_binary", value: "true" });
    }
    if (Array.isArray(meta.os) && meta.os.length) {
      properties.push({ name: "cdx:npm:os", value: meta.os.join(", ") });
    }
    if (Array.isArray(meta.cpu) && meta.cpu.length) {
      properties.push({ name: "cdx:npm:cpu", value: meta.cpu.join(", ") });
    }

    const pkgObj = {
      group: group || "",
      name,
      version,
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
    dependenciesList.push({
      ref: info.bomRef,
      dependsOn: [...runtimeDepRefs(key, meta)].sort(),
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
    process.env.FETCH_LICENSE === "true"
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
