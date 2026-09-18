import { readFileSync } from "node:fs";
import { sep as _sep, basename, dirname, join, resolve } from "node:path";

import { build } from "@cdxgen/cdx-purl";
import { globSync } from "glob";
import * as toml from "smol-toml";

import { DEBUG_MODE } from "../core/activity.js";
import { shouldFetchLicense } from "../core/env.js";
import { safeExistsSync } from "../core/fs.js";
import { traceLog } from "../core/logger.js";
import { getCratesMetadata, normalizeCargoIntegrity } from "./ecosystems.js";

/**
 * Convert list of file paths to components
 *
 * @param {Array} fileList List of file paths
 *
 * @returns {Array} List of components
 */
function fileListToComponents(fileList) {
  const components = [];
  for (const afile of fileList) {
    components.push({
      name: basename(afile),
      type: "file",
      properties: [
        {
          name: "internal:SrcFile",
          value: afile,
        },
      ],
    });
  }
  return components;
}

/**
 * Parse dependency info from the `[package]` node in `cargo.toml` or `cargo.lock`
 * @param {Object} packageNode
 * @returns {Object} dependency info
 * @throws {Error} if dependency name or version is invalid
 */
function parseCargoDependencyFromPackageNode(packageNode) {
  const pkg = {};
  const pkgName = packageNode["name"];
  let group = dirname(pkgName.toString());
  if (group === ".") {
    group = "";
  }
  const pkgChecksum = packageNode["checksum"];
  const pkgVersion = packageNode["version"];
  const pkgAuthors = packageNode["authors"];
  const pkgHomepage = packageNode["homepage"];
  const pkgRepository = packageNode["repository"];
  const pkgLicense = packageNode["license"];
  const pkgDependencies = packageNode["dependencies"];

  //  the value of attributes like:
  //  - `version = 1.0.0`
  //  - `version.workspace = true`
  const isExtendFromWorkspace = (attribute) => {
    return attribute?.workspace;
  };
  // A missing name, or a name/version that only exists as an unresolved
  // `*.workspace = true` reference, cannot identify a package. An absent
  // version is fine though: cargo itself records unversioned local packages
  // such as unpublished workspace members as version 0.0.0 (issue #4327).
  if (
    !pkgName ||
    isExtendFromWorkspace(pkgName) ||
    isExtendFromWorkspace(pkgVersion)
  ) {
    throw new Error("name or version is not defined");
  }

  if (!isExtendFromWorkspace(pkgChecksum) && pkgChecksum) {
    const normalizedCargoIntegrity = normalizeCargoIntegrity(pkgChecksum);
    if (normalizedCargoIntegrity) {
      pkg._integrity = normalizedCargoIntegrity;
    }
  }
  if (!isExtendFromWorkspace(pkgName) && pkgName) {
    pkg.group = group;
    pkg.name = basename(pkgName.toString());
  }
  if (pkgVersion) {
    pkg.version = pkgVersion;
  } else {
    pkg.version = "0.0.0";
  }
  if (!isExtendFromWorkspace(pkgAuthors) && pkgAuthors) {
    if (Array.isArray(pkgAuthors)) {
      pkg.author = pkgAuthors.join(",");
    } else {
      pkg.author = Object.prototype.toString.call(pkgAuthors);
    }
  }
  if (!isExtendFromWorkspace(pkgHomepage) && pkgHomepage) {
    pkg.homepage = { url: pkgHomepage };
  }
  if (!isExtendFromWorkspace(pkgRepository) && pkgRepository) {
    pkg.repository = { url: pkgRepository };
  }
  if (!isExtendFromWorkspace(pkgLicense) && pkgLicense) {
    pkg.license = pkgLicense;
  }
  if (!isExtendFromWorkspace(pkgDependencies) && pkgDependencies) {
    pkg.dependencies = pkgDependencies;
  }
  return pkg;
}

function cargoIntegrityToComponentHash(integrity) {
  const normalizedIntegrity = normalizeCargoIntegrity(integrity);
  if (!normalizedIntegrity) {
    return undefined;
  }
  const [, algorithm, digest] = /^(sha256|sha384)-([a-f0-9]+)$/i.exec(
    normalizedIntegrity,
  );
  return {
    alg: algorithm.toLowerCase() === "sha384" ? "SHA-384" : "SHA-256",
    content: digest,
  };
}

function readCargoTomlData(cargoTomlFile) {
  if (!cargoTomlFile || !safeExistsSync(cargoTomlFile)) {
    return undefined;
  }
  try {
    return toml.parse(readFileSync(cargoTomlFile, { encoding: "utf-8" }));
  } catch (error) {
    traceLog("cargo", {
      cargoTomlFile,
      error: error.message,
    });
    if (DEBUG_MODE) {
      console.warn(`Failed to parse Cargo manifest ${cargoTomlFile}:`, error);
    }
    return undefined;
  }
}

function isCargoWorkspaceReference(value) {
  return Boolean(value?.workspace);
}

function cargoPackageInfoToPurl(pkg) {
  return decodeURIComponent(
    build({
      type: "cargo",
      namespace: pkg?.group || null,
      name: pkg?.name,
      version: pkg?.version || null,
    }),
  );
}

function resolveCargoDependencyAliasName(dependencyName, dependencyNode) {
  if (
    dependencyNode &&
    typeof dependencyNode === "object" &&
    typeof dependencyNode.package === "string" &&
    dependencyNode.package
  ) {
    return dependencyNode.package;
  }
  return dependencyName;
}

function resolveCargoWorkspaceContext(cargoTomlFile, cargoData, context = {}) {
  if (
    context?.workspaceRootFile &&
    context?.workspaceRootData &&
    safeExistsSync(context.workspaceRootFile)
  ) {
    return {
      isVirtualWorkspace: !context.workspaceRootData?.package,
      isWorkspaceRoot: context.workspaceRootFile === cargoTomlFile,
      workspaceData: context.workspaceRootData.workspace,
      workspaceRootData: context.workspaceRootData,
      workspaceRootFile: context.workspaceRootFile,
    };
  }
  let currentDir = dirname(cargoTomlFile);
  while (currentDir && currentDir !== dirname(currentDir)) {
    const candidateFile = join(currentDir, "Cargo.toml");
    if (safeExistsSync(candidateFile)) {
      const candidateData =
        candidateFile === cargoTomlFile
          ? cargoData
          : readCargoTomlData(candidateFile);
      if (candidateData?.workspace) {
        return {
          isVirtualWorkspace: !candidateData?.package,
          isWorkspaceRoot: candidateFile === cargoTomlFile,
          workspaceData: candidateData.workspace,
          workspaceRootData: candidateData,
          workspaceRootFile: candidateFile,
        };
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return {};
}

function resolveCargoWorkspaceMembers(workspaceRootFile, workspaceData) {
  const workspaceRootDir = dirname(workspaceRootFile);
  const members = [];
  const excludedRoots = new Set();
  for (const excludedPattern of workspaceData?.exclude || []) {
    excludedRoots.add(resolve(workspaceRootDir, excludedPattern));
  }
  for (const memberPattern of workspaceData?.members || []) {
    const directMemberFile = resolve(
      workspaceRootDir,
      memberPattern,
      "Cargo.toml",
    );
    if (safeExistsSync(directMemberFile)) {
      members.push(directMemberFile);
      continue;
    }
    const matchedMemberFiles = globSync(
      join(memberPattern, "Cargo.toml").replaceAll("\\", "/"),
      {
        absolute: true,
        cwd: workspaceRootDir,
        nodir: true,
        windowsPathsNoEscape: true,
      },
    );
    if (matchedMemberFiles?.length) {
      members.push(...matchedMemberFiles);
    }
  }
  return [...new Set(members)]
    .filter((memberFile) => {
      const memberDir = resolve(dirname(memberFile));
      for (const excludedRoot of excludedRoots) {
        if (
          memberDir === excludedRoot ||
          memberDir.startsWith(`${excludedRoot}${_sep}`)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort();
}

function resolveCargoWorkspacePackageNode(packageNode, workspacePackageNode) {
  if (!packageNode || typeof packageNode !== "object") {
    return packageNode;
  }
  const mergedNode = { ...packageNode };
  for (const fieldName of [
    "authors",
    "description",
    "documentation",
    "edition",
    "homepage",
    "keywords",
    "license",
    "name",
    "readme",
    "repository",
    "rust-version",
    "version",
  ]) {
    if (
      isCargoWorkspaceReference(packageNode[fieldName]) &&
      workspacePackageNode?.[fieldName] !== undefined
    ) {
      mergedNode[fieldName] = workspacePackageNode[fieldName];
    }
  }
  return mergedNode;
}

function resolveCargoManifestPackageIdentity(
  cargoTomlFile,
  cargoData,
  context = {},
) {
  const workspaceContext = resolveCargoWorkspaceContext(
    cargoTomlFile,
    cargoData,
    context,
  );
  const resolvedPackageNode = resolveCargoWorkspacePackageNode(
    cargoData?.package,
    workspaceContext?.workspaceData?.package,
  );
  if (
    resolvedPackageNode &&
    typeof resolvedPackageNode === "object" &&
    !Array.isArray(resolvedPackageNode)
  ) {
    try {
      return parseCargoDependencyFromPackageNode(resolvedPackageNode);
    } catch {
      return undefined;
    }
  }
  if (
    cargoData?.workspace &&
    workspaceContext?.isWorkspaceRoot &&
    workspaceContext?.isVirtualWorkspace
  ) {
    return {
      group: "",
      name: basename(dirname(cargoTomlFile)),
      version: "workspace",
    };
  }
  return undefined;
}

function normalizeCargoDependencySpec(dependencySpec) {
  if (typeof dependencySpec === "string") {
    return { version: dependencySpec };
  }
  if (!dependencySpec || typeof dependencySpec !== "object") {
    return {};
  }
  return { ...dependencySpec };
}

function mergeCargoWorkspaceDependencySpec(
  dependencyName,
  dependencyNode,
  workspaceDependencies,
) {
  if (
    !dependencyNode ||
    typeof dependencyNode !== "object" ||
    dependencyNode.workspace !== true
  ) {
    return dependencyNode;
  }
  const workspaceDependencyNode = workspaceDependencies?.[dependencyName];
  if (workspaceDependencyNode === undefined) {
    return dependencyNode;
  }
  const mergedSpec = {
    ...normalizeCargoDependencySpec(workspaceDependencyNode),
    ...normalizeCargoDependencySpec(dependencyNode),
  };
  mergedSpec.workspace = true;
  if (
    Array.isArray(workspaceDependencyNode?.features) ||
    Array.isArray(dependencyNode?.features)
  ) {
    mergedSpec.features = [
      ...new Set([
        ...(workspaceDependencyNode?.features || []),
        ...(dependencyNode?.features || []),
      ]),
    ];
  }
  return mergedSpec;
}

function resolveCargoWorkspaceMemberMap(
  workspaceRootFile,
  workspaceRootData,
  workspaceMemberCache,
) {
  if (!workspaceRootFile || !workspaceRootData?.workspace) {
    return new Map();
  }
  const cacheKey = resolve(workspaceRootFile);
  if (workspaceMemberCache?.has(cacheKey)) {
    return workspaceMemberCache.get(cacheKey);
  }
  const memberMap = new Map();
  const workspaceMemberFiles = resolveCargoWorkspaceMembers(
    workspaceRootFile,
    workspaceRootData.workspace,
  );
  for (const workspaceMemberFile of workspaceMemberFiles) {
    const memberCargoData = readCargoTomlData(workspaceMemberFile);
    if (!memberCargoData) {
      continue;
    }
    const memberIdentity = resolveCargoManifestPackageIdentity(
      workspaceMemberFile,
      memberCargoData,
      {
        workspaceRootData,
        workspaceRootFile,
      },
    );
    if (!memberIdentity?.name || !memberIdentity?.version) {
      continue;
    }
    memberMap.set(memberIdentity.name, {
      ...memberIdentity,
      filePath: workspaceMemberFile,
      ref: cargoPackageInfoToPurl(memberIdentity),
    });
  }
  workspaceMemberCache?.set(cacheKey, memberMap);
  return memberMap;
}

function resolveCargoWorkspaceDependencyTarget(
  cargoTomlFile,
  dependencyName,
  dependencyNode,
  workspaceContext,
  workspaceMemberMap,
) {
  const resolvedDependencyName = resolveCargoDependencyAliasName(
    dependencyName,
    dependencyNode,
  );
  if (
    dependencyNode &&
    typeof dependencyNode === "object" &&
    dependencyNode.workspace === true &&
    workspaceMemberMap?.has(resolvedDependencyName)
  ) {
    return workspaceMemberMap.get(resolvedDependencyName);
  }
  const dependencyPath =
    dependencyNode &&
    typeof dependencyNode === "object" &&
    typeof dependencyNode.path === "string" &&
    dependencyNode.path
      ? resolve(dirname(cargoTomlFile), dependencyNode.path, "Cargo.toml")
      : undefined;
  if (!dependencyPath || !safeExistsSync(dependencyPath)) {
    return undefined;
  }
  const dependencyCargoData = readCargoTomlData(dependencyPath);
  if (!dependencyCargoData) {
    return undefined;
  }
  const dependencyIdentity = resolveCargoManifestPackageIdentity(
    dependencyPath,
    dependencyCargoData,
    {
      workspaceRootData: workspaceContext?.workspaceRootData,
      workspaceRootFile: workspaceContext?.workspaceRootFile,
    },
  );
  if (!dependencyIdentity?.name || !dependencyIdentity?.version) {
    return undefined;
  }
  return {
    ...dependencyIdentity,
    filePath: dependencyPath,
    ref: cargoPackageInfoToPurl(dependencyIdentity),
  };
}

function ensurePropertiesArray(pkg) {
  if (!pkg.properties) {
    pkg.properties = [];
  }
  return pkg.properties;
}

function appendCargoProperty(pkg, name, value) {
  if (!name || value === undefined || value === null || value === "") {
    return;
  }
  const properties = ensurePropertiesArray(pkg);
  const stringValue = typeof value === "string" ? value : String(value);
  if (
    properties.some(
      (property) => property.name === name && property.value === stringValue,
    )
  ) {
    return;
  }
  properties.push({
    name,
    value: stringValue,
  });
}

function normalizeCargoDependencyVersion(dependencyNode) {
  if (typeof dependencyNode === "string" || dependencyNode instanceof String) {
    return dependencyNode.trim();
  }
  if (!dependencyNode || typeof dependencyNode !== "object") {
    return "";
  }
  if (typeof dependencyNode.version === "string" && dependencyNode.version) {
    return dependencyNode.version;
  }
  if (typeof dependencyNode.git === "string" && dependencyNode.git) {
    return `git+${dependencyNode.git}`;
  }
  if (typeof dependencyNode.path === "string" && dependencyNode.path) {
    return `path+${dependencyNode.path}`;
  }
  if (dependencyNode.workspace === true) {
    return "workspace";
  }
  return "";
}

function applyCargoDependencySpecMetadata(
  pkg,
  dependencyNode,
  dependencyKind,
  targetSelector,
  resolvedWorkspaceTarget,
) {
  appendCargoProperty(pkg, "cdx:cargo:dependencyKind", dependencyKind);
  appendCargoProperty(pkg, "cdx:cargo:scope", dependencyKind);
  if (targetSelector) {
    appendCargoProperty(pkg, "cdx:cargo:target", targetSelector);
  }
  if (!dependencyNode || typeof dependencyNode !== "object") {
    if (dependencyKind === "dev") {
      pkg.scope = "excluded";
    }
    return;
  }
  if (dependencyKind === "dev") {
    pkg.scope = "excluded";
  }
  if (dependencyNode.optional === true) {
    pkg.scope = "optional";
    appendCargoProperty(pkg, "cdx:cargo:optional", "true");
  }
  if (dependencyNode.default_features === false) {
    appendCargoProperty(pkg, "cdx:cargo:defaultFeatures", "false");
  }
  if (dependencyNode["default-features"] === false) {
    appendCargoProperty(pkg, "cdx:cargo:defaultFeatures", "false");
  }
  if (
    Array.isArray(dependencyNode.features) &&
    dependencyNode.features.length
  ) {
    appendCargoProperty(
      pkg,
      "cdx:cargo:dependencyFeatures",
      JSON.stringify(dependencyNode.features),
    );
  }
  appendCargoProperty(pkg, "cdx:cargo:path", dependencyNode.path);
  appendCargoProperty(pkg, "cdx:cargo:git", dependencyNode.git);
  appendCargoProperty(pkg, "cdx:cargo:gitBranch", dependencyNode.branch);
  appendCargoProperty(pkg, "cdx:cargo:gitTag", dependencyNode.tag);
  appendCargoProperty(pkg, "cdx:cargo:gitRev", dependencyNode.rev);
  appendCargoProperty(pkg, "cdx:cargo:registry", dependencyNode.registry);
  appendCargoProperty(pkg, "cdx:cargo:package", dependencyNode.package);
  appendCargoProperty(
    pkg,
    "cdx:cargo:workspaceDependency",
    dependencyNode.workspace === true ? "true" : undefined,
  );
  appendCargoProperty(
    pkg,
    "cdx:cargo:workspaceDependencyResolved",
    resolvedWorkspaceTarget ? "true" : undefined,
  );
  appendCargoProperty(
    pkg,
    "cdx:cargo:resolvedWorkspaceMember",
    resolvedWorkspaceTarget?.name,
  );
  appendCargoProperty(
    pkg,
    "cdx:cargo:resolvedMemberPath",
    resolvedWorkspaceTarget?.filePath,
  );
}

function collectCargoManifestDependencyComponents(
  dependencyEntries,
  addPackageToList,
  pkgList,
  simple,
  dependencyKind,
  targetSelector,
  workspaceDependencies,
  cargoTomlFile,
  workspaceContext,
  workspaceMemberMap,
) {
  if (!dependencyEntries || typeof dependencyEntries !== "object") {
    return;
  }
  for (const dependencyName of Object.keys(dependencyEntries)) {
    const dependencyNode = mergeCargoWorkspaceDependencySpec(
      dependencyName,
      dependencyEntries[dependencyName],
      workspaceDependencies,
    );
    const resolvedWorkspaceTarget = resolveCargoWorkspaceDependencyTarget(
      cargoTomlFile,
      dependencyName,
      dependencyNode,
      workspaceContext,
      workspaceMemberMap,
    );
    const version = normalizeCargoDependencyVersion(dependencyNode);
    if (!dependencyName || !version) {
      continue;
    }
    const pkg = {
      name: dependencyName,
      version,
    };
    applyCargoDependencySpecMetadata(
      pkg,
      dependencyNode,
      dependencyKind,
      targetSelector,
      resolvedWorkspaceTarget,
    );
    addPackageToList(pkgList, pkg, { packageMode: false, simple });
  }
}

/**
 * Method to parse cargo.toml data
 *
 * The component described by a [package] section will be put at the front of
 * the list, regardless of if [package] appears before or after
 * [dependencies]. Found dependencies will be placed at the back of the
 * list.
 *
 * The Cargo documentation specifies that the [package] section should appear
 * first as a convention, but it is not enforced.
 * https://doc.rust-lang.org/stable/style-guide/cargo.html#formatting-conventions
 *
 * @param {String} cargoTomlFile cargo.toml file
 * @param {boolean} simple Return a simpler representation of the component by skipping extended attributes and license fetch.
 * @param {Object} pkgFilesMap Object with package name and list of files
 *
 * @returns {Array} Package list
 */
export async function parseCargoTomlData(
  cargoTomlFile,
  simple = false,
  pkgFilesMap = {},
  context = {},
) {
  const pkgList = [];

  // Helper function to add a component to the package list. It will uphold
  // the guarantee that the component described by the
  // [package]-section remains at the front of the list, and add evidence if
  // requested.
  const addPackageToList = (packageList, pkg, { packageMode, simple }) => {
    if (!pkg) return;

    if (!simple) {
      pkg.properties = [
        {
          name: "internal:SrcFile",
          value: cargoTomlFile,
        },
        ...(pkg.properties || []),
      ];
      if (pkgFilesMap?.[pkg.name]) {
        pkg.components = fileListToComponents(pkgFilesMap[pkg.name]);
      }
      pkg.evidence = {
        identity: {
          field: "purl",
          confidence: pkg.version ? 0.5 : 0,
          methods: [
            {
              technique: "manifest-analysis",
              confidence: pkg.version ? 0.5 : 0,
              value: cargoTomlFile,
            },
          ],
        },
      };
    }
    const ppurl = build({
      type: "cargo",
      namespace: pkg.group || null,
      name: pkg.name,
      version: pkg.version || null,
    });
    pkg.purl = ppurl;
    pkg["bom-ref"] = decodeURIComponent(ppurl);
    pkg.type = "library";

    // Ensure the component described by [package] is in front of the list to
    // give the caller some information about which component the BOM is the
    // parent component and which are dependencies.
    if (packageMode) {
      packageList.unshift(pkg);
    } else {
      packageList.push(pkg);
    }
  };

  if (!cargoTomlFile || !safeExistsSync(cargoTomlFile)) {
    return pkgList;
  }
  const normalizedCargoTomlFile = resolve(cargoTomlFile);
  cargoTomlFile = normalizedCargoTomlFile;
  const visitedCargoTomlFiles = context?.visitedCargoTomlFiles || new Set();
  for (const visitedCargoTomlFile of visitedCargoTomlFiles) {
    if (typeof visitedCargoTomlFile === "string") {
      visitedCargoTomlFiles.add(resolve(visitedCargoTomlFile));
    }
  }
  if (visitedCargoTomlFiles.has(normalizedCargoTomlFile)) {
    return pkgList;
  }
  visitedCargoTomlFiles.add(normalizedCargoTomlFile);
  const cargoData = readCargoTomlData(normalizedCargoTomlFile);
  if (!cargoData) {
    return pkgList;
  }
  const workspaceContext = resolveCargoWorkspaceContext(
    normalizedCargoTomlFile,
    cargoData,
    context,
  );
  const workspacePackageNode = workspaceContext?.workspaceData?.package;
  const workspaceDependencies = workspaceContext?.workspaceData?.dependencies;
  const workspaceMemberCache = context?.workspaceMemberCache || new Map();
  const workspaceMemberMap = resolveCargoWorkspaceMemberMap(
    workspaceContext?.workspaceRootFile,
    workspaceContext?.workspaceRootData,
    workspaceMemberCache,
  );
  const packageNode = resolveCargoWorkspacePackageNode(
    cargoData["package"],
    workspacePackageNode,
  );
  // parse `[package]`
  if (packageNode instanceof Object && !Array.isArray(packageNode)) {
    /** @type {Object} */
    const packageObjNode = packageNode;
    try {
      const pkg = parseCargoDependencyFromPackageNode(packageNode);
      addPackageToList(pkgList, pkg, { packageMode: true, simple });
    } catch (e) {
      console.warn(
        `Failed to parse package: ${packageObjNode?.name}@${packageObjNode?.version},fail with:${e.message}`,
      );
    }
  } else if (
    cargoData.workspace &&
    workspaceContext?.isWorkspaceRoot &&
    workspaceContext?.isVirtualWorkspace
  ) {
    const workspaceComponent = {
      name: basename(dirname(cargoTomlFile)),
      properties: [],
      version: "workspace",
    };
    appendCargoProperty(
      workspaceComponent,
      "cdx:cargo:manifestMode",
      "virtual-workspace",
    );
    addPackageToList(pkgList, workspaceComponent, {
      packageMode: true,
      simple,
    });
  }
  if (pkgList[0] && workspaceContext?.workspaceRootFile) {
    appendCargoProperty(
      pkgList[0],
      "cdx:cargo:workspaceRoot",
      workspaceContext.workspaceRootFile,
    );
    appendCargoProperty(
      pkgList[0],
      "cdx:cargo:manifestMode",
      cargoData?.workspace
        ? workspaceContext?.isVirtualWorkspace
          ? "virtual-workspace"
          : "workspace"
        : "package",
    );
  }
  if (Array.isArray(cargoData?.workspace?.members) && pkgList[0]) {
    appendCargoProperty(pkgList[0], "cdx:cargo:hasWorkspaceMembers", "true");
    appendCargoProperty(
      pkgList[0],
      "cdx:cargo:workspaceMembers",
      cargoData.workspace.members.join(", "),
    );
  }
  collectCargoManifestDependencyComponents(
    cargoData["dependencies"],
    addPackageToList,
    pkgList,
    simple,
    "runtime",
    undefined,
    workspaceDependencies,
    cargoTomlFile,
    workspaceContext,
    workspaceMemberMap,
  );
  collectCargoManifestDependencyComponents(
    cargoData["build-dependencies"],
    addPackageToList,
    pkgList,
    simple,
    "build",
    undefined,
    workspaceDependencies,
    cargoTomlFile,
    workspaceContext,
    workspaceMemberMap,
  );
  collectCargoManifestDependencyComponents(
    cargoData["dev-dependencies"],
    addPackageToList,
    pkgList,
    simple,
    "dev",
    undefined,
    workspaceDependencies,
    cargoTomlFile,
    workspaceContext,
    workspaceMemberMap,
  );
  if (cargoData.target && typeof cargoData.target === "object") {
    for (const targetSelector of Object.keys(cargoData.target)) {
      const targetBlock = cargoData.target[targetSelector];
      if (!targetBlock || typeof targetBlock !== "object") {
        continue;
      }
      collectCargoManifestDependencyComponents(
        targetBlock["dependencies"],
        addPackageToList,
        pkgList,
        simple,
        "runtime",
        targetSelector,
        workspaceDependencies,
        cargoTomlFile,
        workspaceContext,
        workspaceMemberMap,
      );
      collectCargoManifestDependencyComponents(
        targetBlock["build-dependencies"],
        addPackageToList,
        pkgList,
        simple,
        "build",
        targetSelector,
        workspaceDependencies,
        cargoTomlFile,
        workspaceContext,
        workspaceMemberMap,
      );
      collectCargoManifestDependencyComponents(
        targetBlock["dev-dependencies"],
        addPackageToList,
        pkgList,
        simple,
        "dev",
        targetSelector,
        workspaceDependencies,
        cargoTomlFile,
        workspaceContext,
        workspaceMemberMap,
      );
    }
  }
  if (
    context?.includeWorkspaceMembers !== false &&
    workspaceContext?.isWorkspaceRoot &&
    Array.isArray(cargoData?.workspace?.members)
  ) {
    const workspaceMemberFiles = resolveCargoWorkspaceMembers(
      cargoTomlFile,
      cargoData.workspace,
    );
    for (const workspaceMemberFile of workspaceMemberFiles) {
      if (workspaceMemberFile === cargoTomlFile) {
        continue;
      }
      const workspaceMemberPackages = await parseCargoTomlData(
        workspaceMemberFile,
        simple,
        pkgFilesMap,
        {
          includeWorkspaceMembers: false,
          visitedCargoTomlFiles,
          workspaceMemberCache,
          workspaceRootData: cargoData,
          workspaceRootFile: cargoTomlFile,
        },
      );
      if (workspaceMemberPackages?.length) {
        pkgList.push(...workspaceMemberPackages);
      }
    }
  }

  if (!simple && shouldFetchLicense()) {
    return await getCratesMetadata(pkgList);
  }
  return pkgList;
}

/**
 * Parse a Cargo.lock file to find components within the Rust project.
 *
 * @param {String} cargoLockFile A path to a Cargo.lock file. The Cargo.lock-file path may be used as information for extended attributes, such as manifest based evidence.
 * @param {boolean} simple Return a simpler representation of the component by skipping extended attributes and license fetch.
 * @param {Object} pkgFilesMap Object with package name and list of files
 *
 * @returns {Array} A list of the project's components as described by the Cargo.lock-file.
 */
export async function parseCargoData(
  cargoLockFile,
  simple = false,
  pkgFilesMap = {},
) {
  const addPackageToList = (packageList, newPackage, { simple }) => {
    if (!newPackage) {
      return;
    }

    const purl = build({
      type: "cargo",
      namespace: "" || null,
      name: newPackage.name,
      version: newPackage.version || null,
    });
    const component = {
      type: "library",
      group: newPackage.group,
      "bom-ref": purl,
      purl: purl,
      name: newPackage.name,
      version: newPackage.version,
    };

    const integrityHash = cargoIntegrityToComponentHash(newPackage._integrity);
    if (integrityHash) {
      component.hashes = [integrityHash];
    }

    if (!simple) {
      // Assign evidence according to CycloneDX's confidence recommendations in section Evidence of:
      // * https://cyclonedx.org/guides/OWASP_CycloneDX-Authoritative-Guide-to-SBOM-en.pdf
      // The evidence is deemed to be reliable because Cargo itself generates
      // the Cargo.lock-file based on the listed dependencies in the
      // Cargo.toml-file and registry information. So, either we get a direct
      // dependency (very likely), or a transitive dependency based on
      // evidence from the package information in the Cargo registry.
      component.evidence = {
        identity: {
          field: "purl",
          confidence: 0.6,
          methods: [
            {
              technique: "manifest-analysis",
              confidence: 0.6,
              value: cargoLockFile,
            },
          ],
        },
      };

      // Evidence information for CyclondDX specification version < 1.5.
      component.properties = [
        {
          name: "internal:SrcFile",
          value: cargoLockFile,
        },
      ];
      if (pkgFilesMap?.[newPackage.name]) {
        component.components = fileListToComponents(
          pkgFilesMap[component.name],
        );
      }
    }
    packageList.push(component);
  };
  const pkgList = [];
  if (!cargoLockFile) {
    return pkgList;
  }

  const cargoData = toml.parse(
    readFileSync(cargoLockFile, { encoding: "utf-8" }),
  );
  if (!cargoData) {
    return pkgList;
  }

  const packageNode = cargoData["package"];
  // parse `[[package]]`
  if (Array.isArray(packageNode)) {
    packageNode.forEach((packageItem) => {
      try {
        const pkg = parseCargoDependencyFromPackageNode(packageItem);
        addPackageToList(pkgList, pkg, { simple });
      } catch (e) {
        console.warn(
          `Failed to parse package: ${packageItem["name"]}@${packageItem["version"]},fail with:${e.message}`,
        );
      }
    });
  }
  if (shouldFetchLicense() && !simple) {
    return await getCratesMetadata(pkgList);
  }
  return pkgList;
}

function collectCargoManifestDependencyRefs(
  cargoTomlFile,
  dependencyEntries,
  workspaceDependencies,
  workspaceContext,
  workspaceMemberMap,
  dependsOn,
) {
  if (!dependencyEntries || typeof dependencyEntries !== "object") {
    return;
  }
  for (const dependencyName of Object.keys(dependencyEntries)) {
    const dependencyNode = mergeCargoWorkspaceDependencySpec(
      dependencyName,
      dependencyEntries[dependencyName],
      workspaceDependencies,
    );
    const resolvedWorkspaceTarget = resolveCargoWorkspaceDependencyTarget(
      cargoTomlFile,
      dependencyName,
      dependencyNode,
      workspaceContext,
      workspaceMemberMap,
    );
    if (resolvedWorkspaceTarget?.ref) {
      dependsOn.add(resolvedWorkspaceTarget.ref);
    }
  }
}

/**
 * Build a Cargo dependency graph from manifest relationships so workspace roots
 * and member-to-member links can complement lockfile-derived dependency data.
 *
 * @param {string} cargoTomlFile Cargo.toml path
 * @param {object} [context] manifest graph context
 * @returns {object[]} Cargo dependency relationships
 */
export function parseCargoManifestDependencyData(cargoTomlFile, context = {}) {
  if (!cargoTomlFile || !safeExistsSync(cargoTomlFile)) {
    return [];
  }
  const normalizedCargoTomlFile = resolve(cargoTomlFile);
  cargoTomlFile = normalizedCargoTomlFile;
  const visitedCargoTomlFiles =
    context?.visitedCargoTomlDependencyGraphFiles || new Set();
  for (const visitedCargoTomlFile of visitedCargoTomlFiles) {
    if (typeof visitedCargoTomlFile === "string") {
      visitedCargoTomlFiles.add(resolve(visitedCargoTomlFile));
    }
  }
  if (visitedCargoTomlFiles.has(normalizedCargoTomlFile)) {
    return [];
  }
  visitedCargoTomlFiles.add(normalizedCargoTomlFile);
  const cargoData = readCargoTomlData(normalizedCargoTomlFile);
  if (!cargoData) {
    return [];
  }
  const workspaceContext = resolveCargoWorkspaceContext(
    cargoTomlFile,
    cargoData,
    context,
  );
  const workspaceMemberCache = context?.workspaceMemberCache || new Map();
  const workspaceMemberMap = resolveCargoWorkspaceMemberMap(
    workspaceContext?.workspaceRootFile,
    workspaceContext?.workspaceRootData,
    workspaceMemberCache,
  );
  const workspaceDependencies = workspaceContext?.workspaceData?.dependencies;
  const currentIdentity = resolveCargoManifestPackageIdentity(
    cargoTomlFile,
    cargoData,
    context,
  );
  const dependencyGraph = [];
  const dependsOn = new Set();
  if (workspaceContext?.isWorkspaceRoot) {
    for (const workspaceMember of workspaceMemberMap.values()) {
      if (workspaceMember?.ref) {
        dependsOn.add(workspaceMember.ref);
      }
    }
  }
  collectCargoManifestDependencyRefs(
    cargoTomlFile,
    cargoData.dependencies,
    workspaceDependencies,
    workspaceContext,
    workspaceMemberMap,
    dependsOn,
  );
  collectCargoManifestDependencyRefs(
    cargoTomlFile,
    cargoData["build-dependencies"],
    workspaceDependencies,
    workspaceContext,
    workspaceMemberMap,
    dependsOn,
  );
  collectCargoManifestDependencyRefs(
    cargoTomlFile,
    cargoData["dev-dependencies"],
    workspaceDependencies,
    workspaceContext,
    workspaceMemberMap,
    dependsOn,
  );
  if (cargoData.target && typeof cargoData.target === "object") {
    for (const targetBlock of Object.values(cargoData.target)) {
      if (!targetBlock || typeof targetBlock !== "object") {
        continue;
      }
      collectCargoManifestDependencyRefs(
        cargoTomlFile,
        targetBlock.dependencies,
        workspaceDependencies,
        workspaceContext,
        workspaceMemberMap,
        dependsOn,
      );
      collectCargoManifestDependencyRefs(
        cargoTomlFile,
        targetBlock["build-dependencies"],
        workspaceDependencies,
        workspaceContext,
        workspaceMemberMap,
        dependsOn,
      );
      collectCargoManifestDependencyRefs(
        cargoTomlFile,
        targetBlock["dev-dependencies"],
        workspaceDependencies,
        workspaceContext,
        workspaceMemberMap,
        dependsOn,
      );
    }
  }
  if (currentIdentity?.name && currentIdentity?.version) {
    dependencyGraph.push({
      dependsOn: [...dependsOn].sort(),
      ref: cargoPackageInfoToPurl(currentIdentity),
    });
  }
  if (
    context?.includeWorkspaceMembers !== false &&
    workspaceContext?.isWorkspaceRoot &&
    Array.isArray(cargoData?.workspace?.members)
  ) {
    for (const workspaceMemberFile of resolveCargoWorkspaceMembers(
      cargoTomlFile,
      cargoData.workspace,
    )) {
      if (workspaceMemberFile === cargoTomlFile) {
        continue;
      }
      dependencyGraph.push(
        ...parseCargoManifestDependencyData(workspaceMemberFile, {
          includeWorkspaceMembers: false,
          visitedCargoTomlDependencyGraphFiles: visitedCargoTomlFiles,
          workspaceMemberCache,
          workspaceRootData: cargoData,
          workspaceRootFile: cargoTomlFile,
        }),
      );
    }
  }
  return dependencyGraph;
}

/**
 * Parses a Cargo.lock file's TOML data and returns a flat dependency graph as an
 * array of objects mapping each package purl to the purls it directly depends on.
 *
 * @param {string} cargoLockData Raw TOML string contents of a Cargo.lock file
 * @returns {Object[]} Array of dependency relationship objects with ref and dependsOn fields
 */
export function parseCargoDependencyData(cargoLockData) {
  const purlFromPackageInfo = (pkg) =>
    decodeURIComponent(
      build({
        type: "cargo",
        namespace: "" || null,
        name: pkg.name,
        version: pkg.version || null,
      }),
    );
  const cargoData = toml.parse(cargoLockData);
  const packageNode = cargoData?.package;
  if (!packageNode || !Array.isArray(packageNode)) {
    return [];
  }
  /** @type {Array<Object>} */
  const packageArrayNode = packageNode;
  /** @type {Array<{ name: string, version: string, dependencies: Array<string>}>} */
  const pkgList = [];
  packageArrayNode.forEach((packageItem) => {
    try {
      const pkg = parseCargoDependencyFromPackageNode(packageItem);
      pkgList.push(pkg);
    } catch (e) {
      console.warn(
        `Failed to parse package: ${packageItem["name"]}@${packageItem["version"]},fail with:${e.message}`,
      );
    }
  });
  // Create a map of package names to package objects
  const pkgMap = pkgList.reduce((acc, item) => {
    acc[item.name] = item;
    return acc;
  }, {});
  const result = [];
  // parse dependency version
  Object.values(pkgMap).forEach((pkg) => {
    const dependsOn = new Set();
    pkg.dependencies?.forEach((dep) => {
      if (dep.indexOf(" ") !== -1) {
        // fill version in dependency definition like `libc 0.2.79`
        const depSplit = dep.split(" ");
        dependsOn.add(
          purlFromPackageInfo({
            name: depSplit[0].trim(),
            version: depSplit[1].trim(),
          }),
        );
      } else if (pkgMap[dep]) {
        dependsOn.add(purlFromPackageInfo(pkgMap[dep]));
      } else if (DEBUG_MODE) {
        console.warn(
          `The package "${dep.name}" appears as a dependency to "${pkg.name}" but is not itself listed in the Cargo.lock file. The Cargo.lock file is invalid! The produced SBOM will not list ${dep.name} as a dependency.`,
        );
      }
    });
    result.push({
      ref: purlFromPackageInfo(pkg),
      dependsOn: [...dependsOn],
    });
  });
  return result;
}

/**
 * Normalize a cargo dependency kind to the vocabulary used by the cargo
 * manifest parsers.
 *
 * `cargo metadata` encodes a normal dependency as `null` rather than a string,
 * so a truthiness test would silently leave runtime dependencies unlabelled.
 *
 * @param {string|null|undefined} kind Dependency kind as reported by cargo
 * @returns {string} One of `runtime`, `build` or `dev`
 */
export function normalizeCargoDepKind(kind) {
  if (kind === null || kind === undefined || kind === "" || kind === "normal") {
    return "runtime";
  }
  return kind;
}

/**
 * Parse a cargo package id into its name and version.
 *
 * cargo 1.77 and later emit the package id spec form
 * (`registry+https://...#name@1.0.0`, or `path+file:///p/foo#1.0.0` where the
 * name is carried by the path); earlier releases emit `name 1.0.0 (source)`.
 *
 * @param {string} packageId cargo package id
 * @returns {{name: string, version: string}|undefined} Parsed identity
 */
export function parseCargoPackageId(packageId) {
  if (!packageId || typeof packageId !== "string") {
    return undefined;
  }
  const hashIndex = packageId.indexOf("#");
  if (hashIndex !== -1) {
    const source = packageId.slice(0, hashIndex);
    const fragment = packageId.slice(hashIndex + 1);
    const atIndex = fragment.lastIndexOf("@");
    if (atIndex > 0) {
      return {
        name: fragment.slice(0, atIndex),
        version: fragment.slice(atIndex + 1),
      };
    }
    // `path+file:///workspace/crates/foo#1.0.0` - the name is the last path segment.
    const sourcePath = source.replace(/^[a-z+]+\+/, "").replace(/\/+$/, "");
    const name = basename(sourcePath.split("?")[0]);
    if (name) {
      return { name, version: fragment };
    }
    return undefined;
  }
  const legacyMatch = packageId.match(/^(\S+)\s+(\S+)(\s+\(.*\))?$/);
  if (legacyMatch) {
    return { name: legacyMatch[1], version: legacyMatch[2] };
  }
  return undefined;
}

/**
 * Build the `name@version` key used to correlate cargo components across the
 * lock file, the manifests and `cargo metadata`.
 *
 * @param {{name: string, version: string}} pkg Package identity
 * @returns {string} Correlation key
 */
export function cargoComponentKey(pkg) {
  if (!pkg?.name) {
    return "";
  }
  return `${pkg.name}@${pkg.version || ""}`;
}

/**
 * Convert a cargo purl or bom-ref into a `name@version` correlation key.
 *
 * @param {string} purl cargo purl
 * @returns {string} Correlation key
 */
export function cargoPurlToComponentKey(purl) {
  if (!purl || typeof purl !== "string") {
    return "";
  }
  const withoutPrefix = decodeURIComponent(purl).replace(/^pkg:cargo\//, "");
  const [identity] = withoutPrefix.split("?");
  const slashIndex = identity.lastIndexOf("/");
  return slashIndex === -1 ? identity : identity.slice(slashIndex + 1);
}

/**
 * Collect the dependency kinds and platform gates declared by a single
 * `Cargo.toml`, keyed by the crate name that cargo resolves the entry to.
 *
 * Manifests declare version requirements rather than resolved versions, so the
 * returned map is keyed by name alone and is meant to label the edges leaving a
 * workspace member in the lock file graph.
 *
 * @param {string} cargoTomlFile Cargo.toml path
 * @param {object} [context] Workspace resolution context
 * @returns {Map<string, {kinds: Set<string>, targets: Set<string>, optional: boolean}>} Declared edges
 */
export function parseCargoManifestDependencyKinds(cargoTomlFile, context = {}) {
  const declaredEdges = new Map();
  if (!cargoTomlFile || !safeExistsSync(cargoTomlFile)) {
    return declaredEdges;
  }
  const normalizedCargoTomlFile = resolve(cargoTomlFile);
  const cargoData = readCargoTomlData(normalizedCargoTomlFile);
  if (!cargoData) {
    return declaredEdges;
  }
  const workspaceContext = resolveCargoWorkspaceContext(
    normalizedCargoTomlFile,
    cargoData,
    context,
  );
  const workspaceDependencies = workspaceContext?.workspaceData?.dependencies;
  const collect = (dependencyEntries, dependencyKind, targetSelector) => {
    if (!dependencyEntries || typeof dependencyEntries !== "object") {
      return;
    }
    for (const dependencyName of Object.keys(dependencyEntries)) {
      const dependencyNode = mergeCargoWorkspaceDependencySpec(
        dependencyName,
        dependencyEntries[dependencyName],
        workspaceDependencies,
      );
      // `foo = { package = "bar" }` renames the crate; the lock file graph
      // carries the real crate name.
      const resolvedName =
        (typeof dependencyNode === "object" && dependencyNode?.package) ||
        dependencyName;
      const existing = declaredEdges.get(resolvedName) || {
        kinds: new Set(),
        targets: new Set(),
        optional: false,
      };
      existing.kinds.add(dependencyKind);
      if (targetSelector) {
        existing.targets.add(targetSelector);
      }
      if (typeof dependencyNode === "object" && dependencyNode?.optional) {
        existing.optional = true;
      }
      declaredEdges.set(resolvedName, existing);
    }
  };
  collect(cargoData.dependencies, "runtime", undefined);
  collect(cargoData["build-dependencies"], "build", undefined);
  collect(cargoData["dev-dependencies"], "dev", undefined);
  if (cargoData.target && typeof cargoData.target === "object") {
    for (const targetSelector of Object.keys(cargoData.target)) {
      const targetBlock = cargoData.target[targetSelector];
      if (!targetBlock || typeof targetBlock !== "object") {
        continue;
      }
      collect(targetBlock.dependencies, "runtime", targetSelector);
      collect(targetBlock["build-dependencies"], "build", targetSelector);
      collect(targetBlock["dev-dependencies"], "dev", targetSelector);
    }
  }
  return declaredEdges;
}

/**
 * Roll per-edge cargo dependency kinds up to an effective kind per component.
 *
 * A crate is only dev-only when *every* path reaching it from a workspace root
 * traverses a dev edge, so a crate shared between a dev dependency and a normal
 * one keeps its runtime kind. Cargo never builds the dev dependencies of a
 * dependency, so dev edges are followed from the workspace roots alone.
 *
 * @param {object} graph Dependency graph
 * @param {string[]} graph.rootKeys Workspace member component keys
 * @param {Map<string, Array<{to: string, kind: string, target?: string}>>} graph.edges Adjacency map
 * @returns {Map<string, {kind: string, kinds: Set<string>, targets: Set<string>, targetGated: boolean}>} Effective kinds
 */
export function rollupCargoDependencyKinds({ rootKeys, edges }) {
  const states = new Map();
  const queue = [];
  const visit = (key, kind, gated, targets) => {
    let state = states.get(key);
    if (!state) {
      state = { kinds: new Map(), targets: new Set() };
      states.set(key, state);
    }
    for (const target of targets) {
      state.targets.add(target);
    }
    const previous = state.kinds.get(kind);
    // An ungated path subsumes a gated one; revisit only when the knowledge improves.
    if (previous !== undefined && (previous === false || gated === true)) {
      return;
    }
    state.kinds.set(kind, gated);
    queue.push({ key, kind, gated, targets });
  };
  for (const rootKey of rootKeys || []) {
    if (rootKey) {
      visit(rootKey, "root", false, new Set());
    }
  }
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges.get(current.key) || []) {
      const edgeKind = normalizeCargoDepKind(edge.kind);
      let nextKind;
      if (current.kind === "root") {
        nextKind = edgeKind;
      } else if (edgeKind === "dev") {
        // The dev dependencies of a dependency are never built.
        continue;
      } else if (edgeKind === "build") {
        nextKind = "build";
      } else {
        nextKind = current.kind;
      }
      const nextTargets = new Set(current.targets);
      if (edge.target) {
        nextTargets.add(edge.target);
      }
      visit(edge.to, nextKind, current.gated || !!edge.target, nextTargets);
    }
  }
  const rollup = new Map();
  for (const [key, state] of states) {
    const kinds = new Set(state.kinds.keys());
    let kind;
    for (const candidate of ["root", "runtime", "build", "dev"]) {
      if (state.kinds.has(candidate)) {
        kind = candidate;
        break;
      }
    }
    if (!kind) {
      continue;
    }
    rollup.set(key, {
      kind,
      kinds,
      targets: state.targets,
      targetGated: state.kinds.get(kind) === true,
    });
  }
  return rollup;
}

/**
 * Build a cargo dependency graph from the `resolve` section of
 * `cargo metadata --format-version 1`.
 *
 * @param {object} metadata Parsed `cargo metadata` output
 * @returns {{rootKeys: string[], edges: Map<string, Array<object>>, packageInfo: Map<string, object>, resolvedKeys: Set<string>}} Graph
 */
export function parseCargoMetadataResolve(metadata) {
  const edges = new Map();
  const packageInfo = new Map();
  const rootKeys = [];
  // Every package the resolver kept. With `--filter-platform` this is the set
  // that a build for that triple actually pulls in.
  const resolvedKeys = new Set();
  if (!metadata || typeof metadata !== "object") {
    return { rootKeys, edges, packageInfo, resolvedKeys };
  }
  const keyById = new Map();
  for (const pkg of metadata.packages || []) {
    if (!pkg?.id) {
      continue;
    }
    const key = cargoComponentKey({ name: pkg.name, version: pkg.version });
    keyById.set(pkg.id, key);
    const targetKinds = new Set();
    for (const cargoTarget of pkg.targets || []) {
      for (const targetKind of cargoTarget?.kind || []) {
        targetKinds.add(targetKind);
      }
    }
    packageInfo.set(key, {
      procMacro: targetKinds.has("proc-macro"),
      source: pkg.source || "",
      manifestPath: pkg.manifest_path,
    });
  }
  const resolveIdToKey = (packageId) => {
    const known = keyById.get(packageId);
    if (known) {
      return known;
    }
    // A `[patch]`ed or vendored package can appear in `resolve` under an id the
    // package list spells differently.
    const parsed = parseCargoPackageId(packageId);
    return parsed ? cargoComponentKey(parsed) : "";
  };
  // `resolve.root` is null for a virtual workspace, so the roots always come
  // from `workspace_members`.
  for (const memberId of metadata.workspace_members || []) {
    const key = resolveIdToKey(memberId);
    if (key) {
      rootKeys.push(key);
    }
  }
  if (!rootKeys.length && metadata.resolve?.root) {
    const key = resolveIdToKey(metadata.resolve.root);
    if (key) {
      rootKeys.push(key);
    }
  }
  for (const node of metadata.resolve?.nodes || []) {
    const fromKey = resolveIdToKey(node?.id);
    if (!fromKey) {
      continue;
    }
    resolvedKeys.add(fromKey);
    const nodeEdges = edges.get(fromKey) || [];
    for (const dep of node.deps || []) {
      const toKey = resolveIdToKey(dep?.pkg);
      if (!toKey) {
        continue;
      }
      // A single edge can carry several kinds, for example a crate used both
      // as a normal and as a dev dependency by the same package.
      const depKinds = dep.dep_kinds?.length
        ? dep.dep_kinds
        : [{ kind: null, target: null }];
      for (const depKind of depKinds) {
        nodeEdges.push({
          to: toKey,
          kind: normalizeCargoDepKind(depKind?.kind),
          target: depKind?.target || undefined,
        });
      }
    }
    edges.set(fromKey, nodeEdges);
  }
  return { rootKeys, edges, packageInfo, resolvedKeys };
}

/**
 * Build a cargo dependency graph from the lock file relationships, labelling
 * the edges that leave a workspace member with the kinds declared by its
 * manifest.
 *
 * The lock file is the union of every dependency kind and every target triple,
 * so only the manifests can distinguish them. The resulting labels are exact at
 * depth one and inherited below it, which is enough to identify dev-only and
 * build-only subtrees without invoking cargo.
 *
 * @param {object[]} lockDependencies Relationships from {@link parseCargoDependencyData}
 * @param {Map<string, Map<string, object>>} declaredEdgesByRoot Declared edges keyed by root component key
 * @returns {{rootKeys: string[], edges: Map<string, Array<object>>}} Graph
 */
export function buildCargoLockDependencyGraph(
  lockDependencies,
  declaredEdgesByRoot,
) {
  const edges = new Map();
  const rootKeys = [...(declaredEdgesByRoot?.keys() || [])];
  for (const relationship of lockDependencies || []) {
    const fromKey = cargoPurlToComponentKey(relationship?.ref);
    if (!fromKey) {
      continue;
    }
    const declaredEdges = declaredEdgesByRoot?.get(fromKey);
    const nodeEdges = edges.get(fromKey) || [];
    for (const dependsOnRef of relationship.dependsOn || []) {
      const toKey = cargoPurlToComponentKey(dependsOnRef);
      if (!toKey) {
        continue;
      }
      const declared = declaredEdges?.get(toKey.split("@")[0]);
      if (!declared) {
        nodeEdges.push({ to: toKey, kind: "runtime" });
        continue;
      }
      const targets = declared.targets.size ? [...declared.targets] : [null];
      for (const kind of declared.kinds) {
        for (const target of targets) {
          nodeEdges.push({ to: toKey, kind, target: target || undefined });
        }
      }
    }
    edges.set(fromKey, nodeEdges);
  }
  return { rootKeys, edges };
}

/**
 * Annotate cargo components with their effective dependency kind, platform
 * gates and scope.
 *
 * Components reachable only through dev edges are scoped `excluded` so
 * `--required-only` drops them. Build dependencies stay required because a
 * build script is part of producing the artifact; the kind is recorded as a
 * property so a consumer can filter on it.
 *
 * @param {object[]} pkgList Components to annotate
 * @param {Map<string, object>} rollup Effective kinds from {@link rollupCargoDependencyKinds}
 * @param {Map<string, object>} [packageInfo] Extra per-package facts
 * @param {object} [options] Annotation options
 * @param {boolean} [options.resolveIsComplete] The rollup covers every workspace in the scan, so a
 *        component missing from it is an optional dependency no feature activates
 * @returns {object[]} The annotated components
 */
export function applyCargoDependencyKindMetadata(
  pkgList,
  rollup,
  packageInfo = new Map(),
  options = {},
) {
  for (const pkg of pkgList || []) {
    const key = cargoComponentKey(pkg);
    const effective = rollup?.get(key);
    const info = packageInfo?.get(key);
    if (info?.procMacro) {
      // A proc-macro crate is compiled for the host, never for the target.
      appendCargoProperty(pkg, "cdx:cargo:procMacro", "true");
      appendCargoProperty(pkg, "cdx:cargo:hostOnly", "true");
      pkg.isExternal = true;
    }
    if (
      options?.filterPlatform &&
      options?.targetIncludedKeys &&
      effective?.kind !== "root" &&
      !options.targetIncludedKeys.has(key)
    ) {
      // The resolver for the requested triple did not keep this crate, so no
      // build for that triple links it.
      appendCargoProperty(pkg, "cdx:cargo:targetExcluded", "true");
      appendCargoProperty(
        pkg,
        "cdx:cargo:filterPlatform",
        options.filterPlatform,
      );
      pkg.scope = "excluded";
    }
    if (!effective) {
      // The lock file keeps optional dependencies that no enabled feature
      // pulls in; the resolve graph is what says they are never built.
      if (options?.resolveIsComplete) {
        appendCargoProperty(pkg, "cdx:cargo:activated", "false");
        if (!pkg.scope) {
          pkg.scope = "optional";
        }
      }
      continue;
    }
    if (effective.kind === "root") {
      continue;
    }
    appendCargoProperty(pkg, "cdx:cargo:dependencyKind", effective.kind);
    appendCargoProperty(pkg, "cdx:cargo:scope", effective.kind);
    if (effective.kinds.size > 1) {
      appendCargoProperty(
        pkg,
        "cdx:cargo:dependencyKinds",
        [...effective.kinds].sort().join(", "),
      );
    }
    if (effective.targets.size) {
      appendCargoProperty(
        pkg,
        "cdx:cargo:target",
        [...effective.targets].sort().join(", "),
      );
    }
    if (effective.targetGated) {
      appendCargoProperty(pkg, "cdx:cargo:targetGated", "true");
    }
    if (effective.kind === "build") {
      appendCargoProperty(pkg, "cdx:cargo:hostOnly", "true");
      // A build dependency is not part of the assembly: it is provided by the
      // build environment. CycloneDX 1.7 states that with `isExternal`, and
      // the spec-version downgrade drops the field for older documents.
      pkg.isExternal = true;
    }
    if (effective.kind === "dev" && pkg.scope !== "optional") {
      pkg.scope = "excluded";
    }
  }
  return pkgList;
}

/**
 * Parses tab-separated cargo-auditable binary metadata output and returns a list
 * of Rust package components. Optionally fetches crates.io metadata when
 * FETCH_LICENSE is enabled.
 *
 * @param {string} cargoData Tab-separated string output from cargo-auditable or similar tool
 * @returns {Promise<Object[]>} List of Rust package component objects with group, name, and version
 */
export async function parseCargoAuditableData(cargoData) {
  const pkgList = [];
  if (!cargoData) {
    return pkgList;
  }
  cargoData.split("\n").forEach((l) => {
    l = l.replaceAll("\r", "");
    const tmpA = l.split("\t");
    if (tmpA && tmpA.length > 2) {
      let group = dirname(tmpA[0].trim());
      const name = basename(tmpA[0].trim());
      if (group === ".") {
        group = "";
      }
      const version = tmpA[1];
      pkgList.push({
        group,
        name,
        version,
      });
    }
  });
  if (shouldFetchLicense()) {
    return await getCratesMetadata(pkgList);
  }
  return pkgList;
}
