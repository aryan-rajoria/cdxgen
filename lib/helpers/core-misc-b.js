import { readFileSync, realpathSync } from "node:fs";
import { platform } from "node:os";
import {
  sep as _sep,
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
} from "node:path";

import { globSync } from "glob";
import { PackageURL } from "packageurl-js";

import { IriValidationStrategy, validateIri } from "../parsers/iri.js";
import { DEFAULT_HBOM_AUDIT_CATEGORIES } from "./auditCategories.js";
import {
  buildReadCountSuffix,
  DEBUG_MODE,
  recordObservedActivity,
  recordSymlinkResolution,
} from "./core-activity.js";
import {
  isBun,
  isDeno,
  isNode,
  PACKAGE_MANAGER_ALIASES,
  PROJECT_TYPE_ALIASES,
} from "./core-env.js";
import { safeExistsSync } from "./core-fs.js";
import { findAppModules } from "./core-misc-a.js";
import {
  addDosaiSetValue,
  buildDosaiPurlAliasMap,
  dosaiSourceLocation,
  dosaiSourceLocationFromNode,
  resolveDosaiComponentPurl,
} from "./dosaiParsers.js";
import {
  createOccurrenceEvidence,
  parseOccurrenceEvidenceLocation,
} from "./evidenceUtils.js";
import { createGtfoBinsPropertiesFromRow } from "./gtfobins.js";
import { thoughtLog } from "./logger.js";
import { createLolbasProperties } from "./lolbas.js";
import {
  createOsQueryFallbackBomRef,
  createOsQueryPurl,
  deriveOsQueryDescription,
  deriveOsQueryName,
  deriveOsQueryPublisher,
  deriveOsQueryVersion,
  sanitizeOsQueryIdentity,
  shouldCreateOsQueryPurl,
} from "./osqueryTransform.js";
import { parsePkgJson } from "./parsers-js.js";
import {
  executeAlpmList,
  executeApkList,
  executeDpkgList,
  executeEqueryList,
  executeRpmList,
  parseCmakeLikeFile,
  parseCUsageSlice,
} from "./parsers-misc.js";
import { dirNameStr } from "./paths.js";
import { locateGenericPackage } from "./purl.js";
import { CPP_STD_MODULES } from "./state.js";

/**
 * Method to add occurrence evidence for components based on import statements. Currently useful for js
 *
 * @param {array} pkgList List of package
 * @param {object} allImports Import statements object with package name as key and an object with file and location details
 * @param {object} allExports Exported modules if available from node_modules
 * @param {Boolean} deep Deep mode
 */
const NPM_BIN_IMPORT_PREFIX = "cdx:npm:bin/";

const isAsciiHexCode = (code) => {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
};

const hasValidPercentEncoding = (value) => {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) !== 0x25) {
      continue;
    }
    const firstHex = value.charCodeAt(index + 1);
    const secondHex = value.charCodeAt(index + 2);
    if (!isAsciiHexCode(firstHex) || !isAsciiHexCode(secondHex)) {
      return false;
    }
    index += 2;
  }
  return true;
};

/**
 * Method to check if a given feature flag is enabled.
 *
 * @param {Object} cliOptions CLI options
 * @param {String} feature Feature flag
 *
 * @returns {Boolean} True if the feature is enabled
 */
export function isFeatureEnabled(cliOptions, feature) {
  if (cliOptions?.featureFlags?.includes(feature)) {
    return true;
  }
  if (
    process.env[feature.toUpperCase()] &&
    ["true", "1"].includes(process.env[feature.toUpperCase()])
  ) {
    return true;
  }
  // Retry by replacing hyphens with underscore
  return !!(
    process.env[feature.replaceAll("-", "_").toUpperCase()] &&
    ["true", "1"].includes(
      process.env[feature.replaceAll("-", "_").toUpperCase()],
    )
  );
}

/**
 * Method to check if the given project types are allowed by checking against include and exclude types passed from the CLI arguments.
 *
 * @param {Array} projectTypes project types to check
 * @param {Object} options CLI options
 * @param {Boolean} defaultStatus Default return value if there are no types provided
 */
export function hasAnyProjectType(projectTypes, options, defaultStatus = true) {
  // If no project type is specified, then consider it as yes
  if (
    !projectTypes ||
    (!options.projectType?.length && !options.excludeType?.length)
  ) {
    return defaultStatus;
  }
  // Convert string project types to an array
  if (
    projectTypes &&
    (typeof projectTypes === "string" || projectTypes instanceof String)
  ) {
    projectTypes = projectTypes.split(",");
  }
  // If only exclude type is specified, then do not allow oci type
  if (
    (projectTypes?.length === 1 || !defaultStatus) &&
    !options.projectType?.length &&
    options.excludeType?.length
  ) {
    const isExcluded = projectTypes.some((pt) => {
      const ptLower = pt.toLowerCase();
      if (options.excludeType.includes(ptLower)) {
        return true;
      }
      for (const et of options.excludeType) {
        const etLower = et.toLowerCase();
        for (const [key, aliases] of Object.entries(PROJECT_TYPE_ALIASES)) {
          if (
            (key === etLower || aliases.includes(etLower)) &&
            (key === ptLower || aliases.includes(ptLower))
          ) {
            return true;
          }
        }
      }
      return false;
    });
    if (isExcluded) {
      return false;
    }
    return (
      !projectTypes.includes("oci") &&
      !projectTypes.includes("oci-dir") &&
      !projectTypes.includes("os") &&
      !projectTypes.includes("docker") &&
      !options.excludeType.includes("oci")
    );
  }
  const allProjectTypes = [...projectTypes];
  // Convert the project types into base types
  const baseProjectTypes = [];
  // Support for arbitrary versioned ruby type
  if (
    options.projectType?.length &&
    projectTypes.filter((p) => p.startsWith("ruby")).length
  ) {
    baseProjectTypes.push("ruby");
  }
  const baseExcludeTypes = [];
  for (const abt of Object.keys(PROJECT_TYPE_ALIASES)) {
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) =>
        new Set(options?.projectType).has(pt),
      ).length
    ) {
      baseProjectTypes.push(abt);
    }
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) => new Set(projectTypes).has(pt))
        .length
    ) {
      allProjectTypes.push(abt);
    }
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) =>
        new Set(options?.excludeType).has(pt),
      ).length
    ) {
      baseExcludeTypes.push(abt);
    }
  }
  const shouldInclude =
    !options.projectType?.length ||
    options.projectType?.includes("universal") ||
    options.projectType?.filter((pt) => new Set(allProjectTypes).has(pt))
      .length > 0 ||
    baseProjectTypes.filter((pt) => new Set(allProjectTypes).has(pt)).length >
      0;
  if (shouldInclude && options.excludeType) {
    return (
      !baseExcludeTypes.filter((pt) => pt && new Set(baseProjectTypes).has(pt))
        .length &&
      !baseExcludeTypes.filter((pt) => pt && new Set(allProjectTypes).has(pt))
        .length
    );
  }
  return shouldInclude;
}

/**
 * Determine whether the predictive dependency audit should run for the current
 * CLI invocation.
 *
 * OBOM-focused runs (`obom` or explicit `-t os` / OS aliases only) should keep
 * the direct BOM audit findings but skip the predictive dependency audit.
 *
 * @param {object} options CLI options
 * @param {string} [commandPath] Invoked command path or name
 * @returns {boolean} True when predictive dependency audit should run
 */
export function shouldRunPredictiveBomAudit(options, commandPath) {
  const normalizedCommandPath = `${commandPath || ""}`.toLowerCase();
  if (normalizedCommandPath.includes("obom")) {
    return false;
  }
  if (normalizedCommandPath.includes("hbom")) {
    return false;
  }
  const projectTypes = Array.isArray(options?.projectType)
    ? options.projectType
    : typeof options?.projectType === "string"
      ? options.projectType.split(",")
      : [];
  const normalizedProjectTypes = projectTypes
    .map((projectType) => `${projectType || ""}`.trim().toLowerCase())
    .filter(Boolean);
  if (!normalizedProjectTypes.length) {
    return true;
  }
  const hbomProjectTypes = new Set(["hbom", "hardware"]);
  if (
    normalizedProjectTypes.every((projectType) =>
      hbomProjectTypes.has(projectType),
    )
  ) {
    return false;
  }
  const osProjectTypes = new Set(["os", ...(PROJECT_TYPE_ALIASES.os || [])]);
  return !normalizedProjectTypes.every((projectType) =>
    osProjectTypes.has(projectType),
  );
}

/**
 * Determine the default BOM audit categories for the current CLI invocation.
 *
 * OBOM-focused runs should default to the runtime-specific rule pack unless the
 * user explicitly requests other categories.
 *
 * @param {object} options CLI options
 * @param {string} [commandPath] Invoked command path or name
 * @returns {string | undefined} Default category string, if any
 */
export function getDefaultBomAuditCategories(options, commandPath) {
  const normalizedCommandPath = `${commandPath || ""}`.toLowerCase();
  const defaultHbomCategories = options?.includeRuntime
    ? `${DEFAULT_HBOM_AUDIT_CATEGORIES},host-topology`
    : DEFAULT_HBOM_AUDIT_CATEGORIES;
  if (normalizedCommandPath.includes("hbom")) {
    return defaultHbomCategories;
  }
  const projectTypes = Array.isArray(options?.projectType)
    ? options.projectType
    : typeof options?.projectType === "string"
      ? options.projectType.split(",")
      : [];
  const normalizedProjectTypes = projectTypes
    .map((projectType) => `${projectType || ""}`.trim().toLowerCase())
    .filter(Boolean);
  if (
    normalizedProjectTypes.length &&
    normalizedProjectTypes.every((projectType) =>
      ["hbom", "hardware"].includes(projectType),
    )
  ) {
    return defaultHbomCategories;
  }
  if (!shouldRunPredictiveBomAudit(options, commandPath)) {
    return "obom-runtime";
  }
  return undefined;
}

/**
 * Convenient method to check if the given package manager is allowed.
 *
 * @param {String} name Package manager name
 * @param {Array} conflictingManagers List of package managers
 * @param {Object} options CLI options
 *
 * @returns {Boolean} True if the package manager is allowed
 */
export function isPackageManagerAllowed(name, conflictingManagers, options) {
  for (const apm of conflictingManagers) {
    if (options?.projectType?.includes(apm)) {
      return false;
    }
  }
  const res = !options.excludeType?.filter(
    (p) => p === name || PACKAGE_MANAGER_ALIASES[p]?.includes(name),
  ).length;
  if (res) {
    thoughtLog(
      `**PACKAGE MANAGER**: Let's make use of the package manager '${name}', which is allowed.`,
    );
  }
  return res;
}

/**
 * Convert OS query results
 *
 * @param {string} queryCategory Query category
 * @param {Object} queryObj Query Object from the queries.json configuration
 * @param {Array} results Query Results
 * @param {Boolean} enhance Optionally enhance results by invoking additional package manager commands
 */
export function convertOSQueryResults(
  queryCategory,
  queryObj,
  results,
  enhance = false,
) {
  const pkgList = [];
  if (results?.length) {
    for (const res of results) {
      const version = deriveOsQueryVersion(res);
      let name = deriveOsQueryName(res, results.length === 1, queryObj.name);
      if (queryObj.purlType === "chrome-extension") {
        name = (res.identifier || res.extension_id || name || "").toLowerCase();
      }
      let group = "";
      const subpath = res.path || res.admindir || res.source;
      const publisher = deriveOsQueryPublisher(res);
      // For vscode-extension purl type, the publisher is used as the namespace
      if (queryObj.purlType === "vscode-extension" && publisher) {
        group = publisher.toLowerCase();
      }
      let scope;
      const compScope = res.priority;
      if (["required", "optional", "excluded"].includes(compScope)) {
        scope = compScope;
      }
      const description =
        deriveOsQueryDescription(res) ||
        (queryObj.purlType === "chrome-extension" ? res.name || "" : "");
      let qualifiers;
      if (res.identifying_number?.length) {
        qualifiers = {
          tag_id: res.identifying_number.replace("{", "").replace("}", ""),
        };
      }
      if (name) {
        name = sanitizeOsQueryIdentity(name);
        group = sanitizeOsQueryIdentity(group);
        const isCryptoAsset = queryObj.componentType === "cryptographic-asset";
        const purl = shouldCreateOsQueryPurl(queryObj.componentType)
          ? createOsQueryPurl(
              queryObj.purlType,
              group,
              name,
              version,
              qualifiers,
              subpath,
            )
          : undefined;
        const props = [{ name: "cdx:osquery:category", value: queryCategory }];
        props.push(...createLolbasProperties(queryCategory, res));
        if (platform() === "linux") {
          props.push(...createGtfoBinsPropertiesFromRow(queryCategory, res));
        }
        let providesList;
        if (enhance) {
          switch (queryObj.purlType) {
            case "deb":
              providesList = executeDpkgList(name);
              break;
            case "rpm":
              providesList = executeRpmList(name);
              break;
            case "apk":
              providesList = executeApkList(name);
              break;
            case "ebuild":
              providesList = executeEqueryList(name);
              break;
            case "alpm":
              providesList = executeAlpmList(name);
              break;
            default:
              break;
          }
        }
        if (providesList) {
          props.push({ name: "PkgProvides", value: providesList.join(", ") });
        }
        const cryptoProperties = isCryptoAsset
          ? createOsQueryCryptoProperties(queryCategory, res, version)
          : undefined;
        const hashes = createOsQueryComponentHashes(res);
        const apkg = {
          name,
          group,
          version: version || "",
          description,
          publisher,
          "bom-ref": createOsQueryBomRef(
            queryCategory,
            queryObj.componentType,
            res,
            name,
            version,
            purl,
          ),
          purl,
          scope,
          type: queryObj.componentType,
        };
        if (hashes?.length) {
          apkg.hashes = hashes;
        }
        if (cryptoProperties) {
          apkg.cryptoProperties = cryptoProperties;
        }
        for (const k of Object.keys(res).filter((p) => {
          if (["version", "description", "publisher"].includes(p)) {
            return false;
          }
          return !(queryObj.purlType !== "chrome-extension" && p === "name");
        })) {
          if (res[k] && res[k] !== "null") {
            props.push({
              name: k,
              value: res[k],
            });
          }
        }
        apkg.properties = props;
        pkgList.push(apkg);
      }
    }
  }
  return pkgList;
}

function createOsQueryComponentHashes(res) {
  const hashes = [];
  if (res?.md5) {
    hashes.push({ alg: "MD5", content: res.md5 });
  }
  if (res?.sha1) {
    hashes.push({ alg: "SHA-1", content: res.sha1 });
  }
  if (res?.sha256) {
    hashes.push({ alg: "SHA-256", content: res.sha256 });
  }
  return hashes.length ? hashes : undefined;
}

function createOsQueryBomRef(
  queryCategory,
  componentType,
  res,
  name,
  version,
  purl,
) {
  if (purl) {
    return decodeURIComponent(purl);
  }
  if (componentType === "cryptographic-asset") {
    return createOsQueryCryptoBomRef(queryCategory, res, name, version);
  }
  const identityEntry = [
    ["path", res?.path],
    ["key_file", res?.key_file],
    ["history_file", res?.history_file],
    ["fragment_path", res?.fragment_path],
    ["source_path", res?.source_path],
    ["source", res?.source],
    ["key", res?.key],
    ["label", res?.label],
    ["identifier", res?.identifier],
    ["uuid", res?.uuid],
    ["device_id", res?.device_id],
    ["sid", res?.sid],
    ["logon_id", res?.logon_id],
    ["pid", res?.pid],
    ["uid", res?.uid],
  ].find(
    ([, value]) =>
      value !== undefined && value !== null && String(value).length,
  );
  return createOsQueryFallbackBomRef(
    queryCategory,
    componentType,
    name,
    version,
    identityEntry?.[0],
    identityEntry?.[1],
  );
}

function createOsQueryCryptoBomRef(queryCategory, res, name, version) {
  const encodedName = encodeURIComponent(
    name || queryCategory || "crypto-asset",
  );
  switch (queryCategory) {
    case "trusted_gpg_keys":
      return `crypto/related-crypto-material/public-key/${encodedName}@sha256:${res?.sha256 || version || "unknown"}`;
    case "kernel_keys":
      return `crypto/related-crypto-material/key/${encodedName}@${version || res?.serial_number || "unknown"}`;
    case "certificates":
    case "secureboot_certificates":
      return `crypto/certificate/${encodedName}@${res?.sha256 ? `sha256:${res.sha256}` : version || "unknown"}`;
    default:
      return `crypto/related-crypto-material/unknown/${encodedName}@${version || "unknown"}`;
  }
}

function createOsQueryCryptoProperties(queryCategory, res, version) {
  switch (queryCategory) {
    case "trusted_gpg_keys":
      return {
        assetType: "related-crypto-material",
        relatedCryptoMaterialProperties: {
          type: "public-key",
          id: res?.sha256 || version || res?.path || res?.name || "unknown",
          state: "active",
        },
      };
    case "kernel_keys":
      return {
        assetType: "related-crypto-material",
        relatedCryptoMaterialProperties: {
          type: "key",
          id:
            res?.serial_number ||
            version ||
            res?.description ||
            res?.name ||
            "unknown",
          state: res?.timeout === "expd" ? "deactivated" : "active",
        },
      };
    case "certificates":
    case "secureboot_certificates": {
      const certificateFileExtension = extname(res?.path || "")
        .replace(/^\./, "")
        .toLowerCase();
      const certificateFormat =
        queryCategory === "secureboot_certificates"
          ? "X.509"
          : deriveCertificateFormat(certificateFileExtension);
      return {
        assetType: "certificate",
        algorithmProperties: {
          executionEnvironment: "unknown",
          implementationPlatform: "unknown",
        },
        certificateProperties: {
          serialNumber: res?.serial || undefined,
          subjectName: res?.subject || res?.common_name || undefined,
          issuerName: res?.issuer || undefined,
          notValidBefore: normalizeCertificateDate(res?.not_valid_before),
          notValidAfter: normalizeCertificateDate(res?.not_valid_after),
          certificateFormat,
          certificateFileExtension: certificateFileExtension || undefined,
          fingerprint: res?.sha1
            ? { alg: "SHA-1", content: res.sha1 }
            : undefined,
        },
      };
    }
    default:
      return {
        assetType: "related-crypto-material",
        relatedCryptoMaterialProperties: {
          type: "unknown",
          id: version || res?.path || res?.name || "unknown",
        },
      };
  }
}

function deriveCertificateFormat(certificateFileExtension) {
  switch ((certificateFileExtension || "").toLowerCase()) {
    case "pem":
      return "PEM";
    case "der":
      return "DER";
    case "cer":
    case "crt":
      return "X.509";
    default:
      return undefined;
  }
}

function normalizeCertificateDate(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const stringValue = `${value}`.trim();
  if (!stringValue) {
    return undefined;
  }
  const numericValue = Number(stringValue);
  if (Number.isFinite(numericValue)) {
    const millis = stringValue.length > 10 ? numericValue : numericValue * 1000;
    const parsedDate = new Date(millis);
    return Number.isNaN(parsedDate.getTime())
      ? undefined
      : parsedDate.toISOString();
  }
  const parsedDate = new Date(stringValue);
  return Number.isNaN(parsedDate.getTime())
    ? undefined
    : parsedDate.toISOString();
}

/**
 * Collect bom-refs from metadata.tools entries.
 *
 * @param {Object[]|Object} tools CycloneDX metadata.tools section
 * @param {Function} predicate Optional filter function
 * @returns {string[]} Unique tool bom-refs
 */
export function extractToolRefs(tools, predicate) {
  if (!tools) {
    return [];
  }
  const toolRefs = new Set();
  const toolList = Array.isArray(tools)
    ? tools
    : [...(tools.components || []), ...(tools.services || [])];
  for (const tool of toolList) {
    let toolRef = tool?.["bom-ref"];
    if (!toolRef && tool?.purl) {
      toolRef = decodeURIComponent(tool.purl);
    }
    if (!toolRef && tool?.name) {
      try {
        toolRef = new PackageURL(
          "generic",
          tool.group || tool.publisher || tool.manufacturer?.name || undefined,
          tool.name,
          tool.version || undefined,
          null,
          null,
        ).toString();
      } catch (_err) {
        thoughtLog("Unable to derive bom-ref for external tool", {
          group: tool.group,
          manufacturer: tool.manufacturer?.name,
          name: tool.name,
          publisher: tool.publisher,
          version: tool.version,
        });
        toolRef = undefined;
      }
    }
    if (!toolRef) {
      continue;
    }
    if (!tool["bom-ref"]) {
      tool["bom-ref"] = toolRef;
    }
    if (predicate && !predicate(tool)) {
      continue;
    }
    toolRefs.add(toolRef);
  }
  return Array.from(toolRefs);
}

/**
 * Attach evidence.identity.tools references to the supplied subjects.
 *
 * @param {Object|Object[]} subjects Component or service objects
 * @param {string[]} toolRefs Tool bom-refs
 * @returns {Object|Object[]} The same mutated subject(s)
 */
export function attachIdentityTools(subjects, toolRefs) {
  if (!subjects || !toolRefs?.length) {
    return subjects;
  }
  const uniqueToolRefs = Array.from(new Set(toolRefs.filter(Boolean)));
  if (!uniqueToolRefs.length) {
    return subjects;
  }
  const subjectList = Array.isArray(subjects) ? subjects : [subjects];
  for (const subject of subjectList) {
    const identities = Array.isArray(subject?.evidence?.identity)
      ? subject.evidence.identity
      : subject?.evidence?.identity
        ? [subject.evidence.identity]
        : [];
    for (const identity of identities) {
      identity.tools = Array.from(
        new Set([...(identity.tools || []), ...uniqueToolRefs]),
      );
    }
  }
  return subjects;
}

function getNpmBinPropertyValues(pkg, propertyName) {
  if (!Array.isArray(pkg?.properties)) {
    return [];
  }
  return pkg.properties
    .filter((property) => property.name === propertyName && property.value)
    .map((property) => String(property.value));
}

function splitNpmBinPropertyList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getNpmPackageBinCommandNames(pkg) {
  const binNames = new Set();
  if (pkg?.bin && typeof pkg.bin === "object") {
    for (const binName of Object.keys(pkg.bin)) {
      binNames.add(binName);
    }
  } else if (typeof pkg?.bin === "string") {
    binNames.add(pkg.name);
  }
  for (const binValue of getNpmBinPropertyValues(pkg, "cdx:npm:bin")) {
    for (const binName of splitNpmBinPropertyList(binValue)) {
      binNames.add(binName);
    }
  }
  for (const binPathValue of getNpmBinPropertyValues(pkg, "cdx:npm:binPaths")) {
    for (const binPath of splitNpmBinPropertyList(binPathValue)) {
      const normalizedBinPath = binPath.replaceAll("\\", "/");
      const binName = normalizedBinPath.split("/").filter(Boolean).pop();
      if (binName) {
        binNames.add(binName);
      }
    }
  }
  return binNames;
}

function getNpmBinCommandEvidenceKeys(allImports, pkg) {
  const binCommandNames = getNpmPackageBinCommandNames(pkg);
  if (!binCommandNames.size) {
    return [];
  }
  return Object.keys(allImports || {}).filter(
    (importName) =>
      importName.startsWith(NPM_BIN_IMPORT_PREFIX) &&
      binCommandNames.has(importName.slice(NPM_BIN_IMPORT_PREFIX.length)),
  );
}

function applyNpmBinCommandEvidence(pkg, allImports) {
  const binEvidenceKeys = getNpmBinCommandEvidenceKeys(allImports, pkg);
  if (!binEvidenceKeys.length) {
    return;
  }
  pkg.scope = "required";
  const seenOccurrenceLocations = new Set(
    (pkg.evidence?.occurrences || []).map(
      (occurrence) =>
        `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`,
    ),
  );
  for (const binEvidenceKey of binEvidenceKeys) {
    for (const evidence of allImports[binEvidenceKey] || []) {
      if (!evidence?.fileName) {
        continue;
      }
      const occurrence = createOccurrenceEvidence(evidence.fileName, {
        ...(evidence.lineNumber ? { line: evidence.lineNumber } : {}),
      });
      if (!occurrence) {
        continue;
      }
      const occurrenceLocation = `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`;
      if (seenOccurrenceLocations.has(occurrenceLocation)) {
        continue;
      }
      pkg.evidence = pkg.evidence || {};
      pkg.evidence.occurrences = pkg.evidence.occurrences || [];
      pkg.evidence.occurrences.push(occurrence);
      seenOccurrenceLocations.add(occurrenceLocation);
    }
  }
}

export async function addEvidenceForImports(
  pkgList,
  allImports,
  allExports,
  deep,
) {
  const impPkgs = Object.keys(allImports);
  const exportedPkgs = Object.keys(allExports);
  for (const pkg of pkgList) {
    if (impPkgs?.length) {
      // Assume that all packages are optional until we see an evidence
      pkg.scope = "optional";
    }
    const { group, name } = pkg;
    // Evidence belonging to a type must be associated with the package
    if (group === "@types") {
      continue;
    }
    const aliases = group?.length
      ? [name, `${group}/${name}`, `@${group}/${name}`]
      : [name];
    // Deno jsr packages are published under the `@jsr` npm-compat scope
    // (e.g. `@jsr/std__assert`) but are imported in source using their
    // original jsr specifier (e.g. `@std/assert`). Match occurrence evidence
    // against that specifier too, recovered from the `cdx:deno:jsrKey`
    // property recorded during deno.lock parsing.
    const jsrKey = (pkg.properties || []).find(
      (p) => p.name === "cdx:deno:jsrKey",
    )?.value;
    if (jsrKey) {
      const atIndex = jsrKey.lastIndexOf("@");
      const jsrSpecifier = atIndex > 0 ? jsrKey.substring(0, atIndex) : jsrKey;
      if (jsrSpecifier && !aliases.includes(jsrSpecifier)) {
        aliases.push(jsrSpecifier);
      }
    }
    let isImported = false;
    for (const alias of aliases) {
      const isWasmAlias = /\.wasm([?#].*)?$/i.test(alias);
      const all_includes = impPkgs.filter(
        (find_pkg) =>
          find_pkg.startsWith(alias) &&
          (find_pkg.length === alias.length || find_pkg[alias.length] === "/"),
      );
      const all_exports = exportedPkgs.filter((find_pkg) =>
        find_pkg.startsWith(alias),
      );
      if (all_exports?.length) {
        let exportedModules = new Set(isWasmAlias ? [] : all_exports);
        pkg.properties = pkg.properties || [];
        for (const subevidence of all_exports) {
          const evidences = allExports[subevidence];
          for (const evidence of evidences) {
            if (evidence && Object.keys(evidence).length) {
              if (isWasmAlias) {
                for (const wasmImportedModule of evidence.importedModules ||
                  []) {
                  if (wasmImportedModule?.length) {
                    exportedModules.add(wasmImportedModule);
                  }
                }
              }
              if (evidence.exportedModules.length > 1) {
                for (const aexpsubm of evidence.exportedModules) {
                  // Be selective on the submodule names
                  if (
                    !evidence.importedAs
                      .toLowerCase()
                      .includes(aexpsubm.toLowerCase()) &&
                    !alias.endsWith(aexpsubm)
                  ) {
                    // Store both the short and long form of the exported sub modules
                    if (aexpsubm.length > 3) {
                      exportedModules.add(aexpsubm);
                    }
                    exportedModules.add(
                      `${evidence.importedAs.replace("./", "")}/${aexpsubm}`,
                    );
                  }
                }
              }
            }
          }
        }
        exportedModules = Array.from(exportedModules);
        if (exportedModules.length) {
          pkg.properties.push({
            name: "ExportedModules",
            value: exportedModules.join(","),
          });
        }
      }
      // Identify all the imported modules of a component
      if (impPkgs.includes(alias) || all_includes.length) {
        isImported = true;
        let importedModules = new Set();
        let wasmExportedModules = new Set();
        const seenOccurrenceLocations = new Set();
        pkg.scope = "required";
        for (const subevidence of all_includes) {
          const evidences = allImports[subevidence];
          for (const evidence of evidences) {
            if (evidence && Object.keys(evidence).length && evidence.fileName) {
              const occurrence = createOccurrenceEvidence(evidence.fileName, {
                ...(evidence.lineNumber ? { line: evidence.lineNumber } : {}),
              });
              if (occurrence) {
                pkg.evidence = pkg.evidence || {};
                pkg.evidence.occurrences = pkg.evidence.occurrences || [];
                const occurrenceLocation = `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`;
                if (!seenOccurrenceLocations.has(occurrenceLocation)) {
                  pkg.evidence.occurrences.push(occurrence);
                  seenOccurrenceLocations.add(occurrenceLocation);
                }
              }
              importedModules.add(evidence.importedAs);
              for (const importedSm of evidence.importedModules || []) {
                if (!importedSm) {
                  continue;
                }
                if (isWasmAlias) {
                  wasmExportedModules.add(importedSm);
                }
                // Store both the short and long form of the imported sub modules
                if (importedSm.length > 3) {
                  importedModules.add(importedSm);
                }
                importedModules.add(`${evidence.importedAs}/${importedSm}`);
              }
            }
          }
        }
        importedModules = Array.from(importedModules);
        wasmExportedModules = Array.from(wasmExportedModules);
        if (importedModules.length) {
          pkg.properties = pkg.properties || [];
          pkg.properties.push({
            name: "ImportedModules",
            value: importedModules.join(","),
          });
        }
        if (isWasmAlias && wasmExportedModules.length) {
          pkg.properties = pkg.properties || [];
          if (!pkg.properties.some((p) => p.name === "ExportedModules")) {
            pkg.properties.push({
              name: "ExportedModules",
              value: wasmExportedModules.join(","),
            });
          }
        }
        break;
      }
      if (
        impPkgs?.length > 0 &&
        !isImported &&
        DEBUG_MODE &&
        pkg?.scope !== "optional"
      ) {
        console.debug(
          `\x1b[1;35mNotice: Package ${pkg.name} has no usage in code. Check if it is needed.\x1b[0m`,
        );
      }
      // Capture metadata such as description from local node_modules in deep mode
      if (deep && !pkg.description && pkg.properties) {
        let localNodeModulesPath;
        for (const aprop of pkg.properties) {
          if (aprop.name === "LocalNodeModulesPath") {
            localNodeModulesPath = resolve(join(aprop.value, "package.json"));
            break;
          }
        }
        if (localNodeModulesPath && safeExistsSync(localNodeModulesPath)) {
          const lnmPkgList = await parsePkgJson(localNodeModulesPath, true);
          if (lnmPkgList && lnmPkgList.length === 1) {
            const lnmMetadata = lnmPkgList[0];
            if (lnmMetadata && Object.keys(lnmMetadata).length) {
              pkg.description = lnmMetadata.description;
              pkg.author = lnmMetadata.author;
              pkg.license = lnmMetadata.license;
              pkg.homepage = lnmMetadata.homepage;
              pkg.repository = lnmMetadata.repository;
            }
          }
        }
      }
    } // for alias
    // Trim the properties
    applyNpmBinCommandEvidence(pkg, allImports);
    pkg.properties = pkg.properties.filter(
      (p) => p.name !== "LocalNodeModulesPath",
    );
  } // for pkg
  return pkgList;
}

/**
 * Find the OS package component that provides a given file, by searching the
 * `PkgProvides` property of each package in the OS package list.
 *
 * @param {string} afile Filename or path to look up (matched case-insensitively)
 * @param {Object[]} osPkgsList Array of OS package component objects to search
 * @returns {Object|undefined} The matching OS package component, or undefined if not found
 */
export function getOSPackageForFile(afile, osPkgsList) {
  for (const ospkg of osPkgsList) {
    for (const props of ospkg.properties || []) {
      if (
        props.name === "PkgProvides" &&
        props.value.includes(afile.toLowerCase())
      ) {
        delete ospkg.scope;
        // dev packages are libraries
        ospkg.type = "library";
        // Set the evidence to indicate how we identified this package from the header or .so file
        ospkg.evidence = {
          identity: {
            field: "purl",
            confidence: 0.8,
            methods: [
              {
                technique: "filename",
                confidence: 0.8,
                value: `PkgProvides ${afile}`,
              },
            ],
          },
        };
        return ospkg;
      }
    }
  }
  return undefined;
}

/**
 * Method to find c/c++ modules by collecting usages with atom
 *
 * @param {string} src directory
 * @param {object} options Command line options
 * @param {array} osPkgsList Array of OS pacakges represented as components
 * @param {array} epkgList Existing packages list
 */
export function getCppModules(src, options, osPkgsList, epkgList) {
  // Generic is the type to use where the package registry could not be located
  const pkgType = "generic";
  const pkgList = [];
  const pkgAddedMap = {};
  let sliceData;
  const epkgMap = {};
  let parentComponent;
  const dependsOn = new Set();

  (epkgList || []).forEach((p) => {
    epkgMap[`${p.group}/${p.name}`] = p;
  });
  // Let's look for any vcpkg.json file to tell us about the directory we're scanning
  // users can use this file to give us a clue even if they do not use vcpkg library manager
  if (safeExistsSync(join(src, "vcpkg.json"))) {
    const vcPkgData = JSON.parse(
      readFileSync(join(src, "vcpkg.json"), { encoding: "utf-8" }),
    );
    if (vcPkgData && Object.keys(vcPkgData).length && vcPkgData.name) {
      const parentPurl = new PackageURL(
        pkgType,
        "",
        vcPkgData.name,
        vcPkgData.version || "",
        null,
        null,
      ).toString();
      parentComponent = {
        name: vcPkgData.name,
        version: vcPkgData.version || "",
        description: vcPkgData.description,
        license: vcPkgData.license,
        purl: parentPurl,
        type: "application",
        "bom-ref": decodeURIComponent(parentPurl),
      };
      if (vcPkgData.homepage) {
        parentComponent.homepage = { url: vcPkgData.homepage };
      }
      // Are there any dependencies declared in vcpkg.json
      if (vcPkgData.dependencies && Array.isArray(vcPkgData.dependencies)) {
        for (const avcdep of vcPkgData.dependencies) {
          let avcpkgName;
          let scope;
          if (typeof avcdep === "string" || avcdep instanceof String) {
            avcpkgName = avcdep;
          } else if (Object.keys(avcdep).length && avcdep.name) {
            avcpkgName = avcdep.name;
            if (avcdep.host) {
              scope = "optional";
            }
          }
          // Is this a dependency we haven't seen before including the all lower and upper case version?
          if (
            avcpkgName &&
            !epkgMap[`/${avcpkgName}`] &&
            !epkgMap[`/${avcpkgName.toLowerCase()}`] &&
            !epkgMap[`/${avcpkgName.toUpperCase()}`]
          ) {
            const pkgPurl = new PackageURL(
              pkgType,
              "",
              avcpkgName,
              "",
              null,
              null,
            ).toString();
            const apkg = {
              group: "",
              name: avcpkgName,
              type: pkgType,
              version: "",
              purl: pkgPurl,
              scope,
              "bom-ref": decodeURIComponent(pkgPurl),
              evidence: {
                identity: {
                  field: "purl",
                  confidence: 0.5,
                  methods: [
                    {
                      technique: "source-code-analysis",
                      confidence: 0.5,
                      value: `Filename ${join(src, "vcpkg.json")}`,
                    },
                  ],
                },
              },
            };
            if (!pkgAddedMap[avcpkgName]) {
              pkgList.push(apkg);
              dependsOn.add(apkg["bom-ref"]);
              pkgAddedMap[avcpkgName] = true;
            }
          }
        }
      }
    } // if
  } else if (safeExistsSync(join(src, "CMakeLists.txt"))) {
    const retMap = parseCmakeLikeFile(join(src, "CMakeLists.txt"), pkgType);
    if (retMap.parentComponent && Object.keys(retMap.parentComponent).length) {
      parentComponent = retMap.parentComponent;
    }
  } else if (options.projectName && options.projectVersion) {
    parentComponent = {
      group: options.projectGroup || "",
      name: options.projectName || "",
      version: `${options.projectVersion}` || "latest",
      type: "application",
    };
    const parentPurl = new PackageURL(
      pkgType,
      parentComponent.group,
      parentComponent.name,
      parentComponent.version,
      null,
      null,
    ).toString();
    parentComponent.purl = parentPurl;
    parentComponent["bom-ref"] = decodeURIComponent(parentPurl);
  }
  if (options.usagesSlicesFile && safeExistsSync(options.usagesSlicesFile)) {
    sliceData = JSON.parse(
      readFileSync(options.usagesSlicesFile, { encoding: "utf-8" }),
    );
    if (DEBUG_MODE) {
      console.log("Re-using existing slices file", options.usagesSlicesFile);
    }
  } else {
    sliceData = findAppModules(
      src,
      options.deep ? "c" : "h",
      "usages",
      options.usagesSlicesFile,
      options,
    );
  }
  const usageData = parseCUsageSlice(sliceData);
  for (let afile of Object.keys(usageData)) {
    // Normalize windows separator
    afile = afile.replace("..\\", "").replace(/\\/g, "/");
    const fileName = basename(afile);
    if (!fileName?.length) {
      continue;
    }
    const extn = extname(fileName);
    let group = dirname(afile);
    if (
      group.startsWith(".") ||
      group.startsWith(_sep) ||
      safeExistsSync(resolve(afile)) ||
      safeExistsSync(resolve(src, afile))
    ) {
      group = "";
    }
    const version = "";
    // We need to resolve the name to an os package here
    const name = fileName.replace(extn, "");
    // Logic here if name matches the standard library of cpp
    // we skip it
    // Load the glibc-stdlib.json file, which contains std lib for cpp
    if (CPP_STD_MODULES.includes(name)) {
      continue;
    }
    let apkg = getOSPackageForFile(afile, osPkgsList) ||
      epkgMap[`${group}/${name}`] || {
        name,
        group,
        version: "",
        type: pkgType,
      };
    // If this is a relative file, there is a good chance we can reuse the project group
    if (!afile.startsWith(_sep) && !group.length) {
      group = options.projectGroup || "";
    }
    if (!apkg.purl) {
      apkg.purl = new PackageURL(
        pkgType,
        group,
        name,
        version,
        null,
        afile,
      ).toString();
      apkg.evidence = {
        identity: {
          field: "purl",
          confidence: 0,
          methods: [
            {
              technique: "source-code-analysis",
              confidence: 0,
              value: `Filename ${afile}`,
            },
          ],
        },
      };
      apkg["bom-ref"] = decodeURIComponent(apkg["purl"]);
    }
    if (usageData[afile]) {
      const usymbols = Array.from(usageData[afile])
        .filter(
          (v) =>
            !v.startsWith("<") &&
            !v.startsWith("__") &&
            v !== "main" &&
            !v.includes("anonymous_") &&
            !v.includes(afile),
        )
        .map((v) => v.split(":")[0])
        .sort();
      if (!apkg["properties"] && usymbols.length) {
        apkg["properties"] = [
          { name: "ImportedSymbols", value: usymbols.join("|") },
        ];
      } else {
        apkg["properties"] = [];
      }
      const newProps = [];
      let symbolsPropertyFound = false;
      for (const prop of apkg["properties"]) {
        if (prop.name === "ImportedSymbols") {
          symbolsPropertyFound = true;
          let existingSymbols = prop.value.split("|");
          existingSymbols = existingSymbols.concat(usymbols);
          prop.value = Array.from(new Set(existingSymbols)).sort().join("|");
        }
        newProps.push(prop);
      }
      if (!symbolsPropertyFound && usymbols.length) {
        apkg["properties"].push({
          name: "ImportedSymbols",
          value: usymbols.join("|"),
        });
      }
      apkg["properties"] = newProps;
    }
    // At this point, we have a package but we don't know what it's called
    // So let's try to locate this generic package using some heuristics
    apkg = locateGenericPackage(apkg);
    if (!pkgAddedMap[name]) {
      pkgList.push(apkg);
      dependsOn.add(apkg["bom-ref"]);
      pkgAddedMap[name] = true;
    }
  }
  const dependenciesList =
    dependsOn.size && parentComponent
      ? [
          {
            ref: parentComponent["bom-ref"],
            dependsOn: [...dependsOn].sort(),
          },
        ]
      : [];
  return {
    parentComponent,
    pkgList: pkgList.sort((a, b) => a.purl.localeCompare(b.purl)),
    dependenciesList,
  };
}

function addDotnetIdentityMethod(apkg, value) {
  if (!value) {
    return;
  }
  apkg.evidence = apkg.evidence || {};
  const identityList = Array.isArray(apkg.evidence.identity)
    ? apkg.evidence.identity
    : undefined;
  let identity = identityList
    ? identityList.find((entry) => entry?.field === "purl") ||
      identityList.find((entry) => !entry?.field)
    : apkg.evidence.identity;
  if (!identity) {
    identity = { field: "purl", confidence: 1, methods: [] };
    if (identityList) {
      identityList.push(identity);
    }
  }
  identity.field ??= "purl";
  identity.confidence ??= 1;
  identity.methods ??= [];
  if (
    !identity.methods.some(
      (method) =>
        method.technique === "source-code-analysis" && method.value === value,
    )
  ) {
    identity.methods.push({
      technique: "source-code-analysis",
      confidence: 1,
      value,
    });
  }
  apkg.evidence.identity = identityList || identity;
}

/**
 * Enrich .NET package components with occurrence evidence and imported module/method
 * information from a dosai dependency slices file.
 *
 * Builds a mapping of DLL filenames to purls using the `PackageFiles` property of each
 * package, then reads the slices file to add occurrence locations, imported modules,
 * called methods, and assembly version information where available.
 *
 * @param {Object[]} pkgList Array of .NET package component objects to enrich
 * @param {string} slicesFile Path to the dosai dependency slices JSON file
 * @returns {Object[]} The enriched package list (same array, mutated in place)
 */
export function addEvidenceForDotnet(pkgList, slicesFile) {
  // We need two datastructures.
  // dll to purl mapping from the pkgList
  // purl to occurrences list using the slicesFile
  if (!slicesFile || !safeExistsSync(slicesFile)) {
    return pkgList;
  }
  const pkgFilePurlMap = {};
  const purlLocationMap = {};
  const purlModulesMap = {};
  const purlMethodsMap = {};
  const purlAliasMap = buildDosaiPurlAliasMap(pkgList);
  for (const apkg of pkgList) {
    if (apkg.properties && Array.isArray(apkg.properties)) {
      apkg.properties
        .filter((p) => p.name === "PackageFiles")
        .forEach((aprop) => {
          if (aprop.value) {
            const tmpA = aprop.value.split(", ");
            if (tmpA?.length) {
              tmpA.forEach((dllFile) => {
                pkgFilePurlMap[dllFile] = apkg.purl;
              });
            }
          }
        });
    }
  }
  let slicesData;
  try {
    slicesData = JSON.parse(readFileSync(slicesFile, "utf-8"));
  } catch (_err) {
    return pkgList;
  }
  if (slicesData && Object.keys(slicesData)) {
    thoughtLog(
      "Let's thoroughly inspect the dependency slice to identify where and how the components are used.",
    );
    if (slicesData.Dependencies) {
      for (const adep of slicesData.Dependencies) {
        if (adep.Purl) {
          const modPurl = resolveDosaiComponentPurl(adep.Purl, purlAliasMap);
          if (modPurl) {
            addDosaiSetValue(
              purlLocationMap,
              modPurl,
              dosaiSourceLocation(adep),
            );
            addDosaiSetValue(
              purlModulesMap,
              modPurl,
              adep.Name || adep.Namespace,
            );
          }
        }
        // Case 1: Dependencies slice has the .dll file
        if (adep.Module?.endsWith(".dll") && pkgFilePurlMap[adep.Module]) {
          const modPurl = pkgFilePurlMap[adep.Module];
          if (!purlLocationMap[modPurl]) {
            purlLocationMap[modPurl] = new Set();
          }
          purlLocationMap[modPurl].add(`${adep.Path}#${adep.LineNumber}`);
        } else if (
          adep?.Name &&
          (adep?.Namespace?.startsWith("System") ||
            adep?.Namespace?.startsWith("Microsoft"))
        ) {
          // Case 2: System packages where the .dll information is missing
          // In this case, the dll file name is the name followed by dll.
          const moduleDll = `${adep.Name}.dll`;
          if (pkgFilePurlMap[moduleDll]) {
            const modPurl = pkgFilePurlMap[moduleDll];
            if (!purlLocationMap[modPurl]) {
              purlLocationMap[modPurl] = new Set();
            }
            purlLocationMap[modPurl].add(`${adep.Path}#${adep.LineNumber}`);
          }
        }
      }
    }
    if (slicesData.PackageReachability) {
      const graphEdges = Object.fromEntries(
        (slicesData.CallGraph?.Edges || []).map((edge) => [edge.Id, edge]),
      );
      const graphNodes = Object.fromEntries(
        (slicesData.CallGraph?.Nodes || []).map((node) => [node.Id, node]),
      );
      for (const reachability of slicesData.PackageReachability) {
        const modPurl = resolveDosaiComponentPurl(
          reachability.Purl,
          purlAliasMap,
        );
        if (!modPurl) {
          continue;
        }
        let hasExplicitSourceLocations = false;
        for (const sourceLocation of reachability.SourceLocations || []) {
          const location = dosaiSourceLocation(sourceLocation);
          addDosaiSetValue(purlLocationMap, modPurl, location);
          hasExplicitSourceLocations ||= Boolean(location);
        }
        for (const edgeId of reachability.EdgeIds || []) {
          const edge = graphEdges[edgeId];
          if (!hasExplicitSourceLocations) {
            addDosaiSetValue(
              purlLocationMap,
              modPurl,
              dosaiSourceLocation(edge),
            );
          }
          addDosaiSetValue(
            purlMethodsMap,
            modPurl,
            edge?.CalledMethodName || edge?.TargetName,
          );
        }
        for (const nodeId of reachability.NodeIds || []) {
          const node = graphNodes[nodeId];
          if (!hasExplicitSourceLocations) {
            addDosaiSetValue(
              purlLocationMap,
              modPurl,
              dosaiSourceLocationFromNode(node),
            );
          }
          addDosaiSetValue(
            purlModulesMap,
            modPurl,
            node?.ClassName || node?.Module,
          );
          addDosaiSetValue(
            purlMethodsMap,
            modPurl,
            node?.Name || node?.Identity?.MethodName,
          );
        }
      }
    }
    if (slicesData.MethodCalls) {
      for (const amethodCall of slicesData.MethodCalls) {
        if (
          amethodCall.Module?.endsWith(".dll") &&
          pkgFilePurlMap[amethodCall.Module]
        ) {
          const modPurl = pkgFilePurlMap[amethodCall.Module];
          if (!purlLocationMap[modPurl]) {
            purlLocationMap[modPurl] = new Set();
          }
          if (!purlModulesMap[modPurl]) {
            purlModulesMap[modPurl] = new Set();
          }
          if (!purlMethodsMap[modPurl]) {
            purlMethodsMap[modPurl] = new Set();
          }
          purlLocationMap[modPurl].add(
            `${amethodCall.Path}#${amethodCall.LineNumber}`,
          );
          purlModulesMap[modPurl].add(amethodCall.ClassName);
          purlMethodsMap[modPurl].add(amethodCall.CalledMethod);
        }
      }
    }
    if (slicesData.AssemblyInformation) {
      for (const apkg of pkgList) {
        if (!apkg.version) {
          for (const assemblyInfo of slicesData.AssemblyInformation) {
            if (apkg.name === assemblyInfo.Name) {
              apkg.version = assemblyInfo.Version;
            }
          }
        }
      }
    }
  }
  if (Object.keys(purlLocationMap).length) {
    for (const apkg of pkgList) {
      if (purlLocationMap[apkg.purl]) {
        const locationOccurrences = Array.from(
          purlLocationMap[apkg.purl],
        ).sort();
        // Add the occurrences evidence
        apkg.evidence = apkg.evidence || {};
        apkg.evidence.occurrences = locationOccurrences.map((l) =>
          parseOccurrenceEvidenceLocation(l),
        );
        addDotnetIdentityMethod(apkg, locationOccurrences[0]);
        // Set the package scope
        apkg.scope = "required";
      }
      // Add the imported modules to properties
      if (purlModulesMap[apkg.purl]) {
        apkg.properties = apkg.properties || [];
        apkg.properties.push({
          name: "ImportedModules",
          value: Array.from(purlModulesMap[apkg.purl]).sort().join(", "),
        });
      }
      // Add the called methods to properties
      if (purlMethodsMap[apkg.purl]) {
        apkg.properties = apkg.properties || [];
        apkg.properties.push({
          name: "CalledMethods",
          value: Array.from(purlMethodsMap[apkg.purl]).sort().join(", "),
        });
      }
    }
  } else if (slicesData?.Dependencies || slicesData?.MethodCalls) {
    thoughtLog(
      "I didn't find any occurrence evidence or detailed imported modules, even though there is good dependency slice data from dosai. This is surprising.",
    );
  }
  return pkgList;
}

/**
 * Function to validate an externalReference URL for conforming to the JSON schema or bomLink
 * https://github.com/CycloneDX/cyclonedx-core-java/blob/75575318b268dda9e2a290761d7db11b4f414255/src/main/resources/bom-1.5.schema.json#L1140
 * https://datatracker.ietf.org/doc/html/rfc3987#section-2.2
 * https://cyclonedx.org/capabilities/bomlink/
 *
 * @param {String} iri IRI to validate
 *
 * @returns {Boolean} Flag indicating whether the supplied URL is valid or not
 *
 */
export function isValidIriReference(iri) {
  if (typeof iri !== "string") {
    return false;
  }
  const trimmedIri = iri.trim();
  if (iri === "" || iri !== trimmedIri) {
    return false;
  }

  if (/[${}]/.test(iri)) {
    return false;
  }

  // Validate percent-encoding with a linear scan to avoid regex backtracking
  // issues on very long attacker-controlled inputs.
  if (!hasValidPercentEncoding(iri)) {
    return false;
  }

  // Use the dedicated IRI validator for strict RFC 3987 compliance check
  const validateIriResult = validateIri(iri, IriValidationStrategy.Strict);

  // If the IRI validator reports an error, it's invalid.
  if (validateIriResult instanceof Error) {
    return false;
  }

  // Optional: Additional check for common URI schemes (like http/https)
  //    using the built-in URL constructor for stricter URI syntax conformance.
  //    This might catch cases where an IRI is valid per RFC 3987 but not
  //    strictly a valid URI as parsed by the URL constructor (e.g., missing host for http).
  //    Only apply this if the IRI looks like it starts with a scheme like http.
  if (/^https?:/i.test(iri)) {
    // Case-insensitive check for http/https
    try {
      // Attempt to construct a URL object. If it fails, it's likely not a valid URI structure.
      new URL(iri); // Use iri here
    } catch (_error) {
      // If URL construction fails, consider the IRI reference invalid for http-like schemes.
      return false;
    }
  }

  // 8. If all checks pass, the IRI reference is considered valid.
  return true;
}

/**
 * Method to check if a given dependency tree is partial or not.
 *
 * @param {Array} dependencies List of dependencies
 * @param {Number} componentsCount Number of components
 * @returns {Boolean} True if the dependency tree lacks any non-root parents without children. False otherwise.
 */
export function isPartialTree(dependencies, componentsCount = 1) {
  if (componentsCount <= 1) {
    return false;
  }
  if (dependencies?.length <= 1) {
    return true;
  }
  let isCbom = false;
  let parentsWithChildsCount = 0;
  for (const adep of dependencies) {
    if (adep?.dependsOn.length > 0) {
      parentsWithChildsCount++;
    }
    if (!isCbom && adep?.provides?.length > 0) {
      isCbom = true;
    }
  }
  return (
    !isCbom &&
    parentsWithChildsCount <
      Math.min(Math.round(componentsCount / 3), componentsCount)
  );
}

/**
 * Re-compute and set the scope based on the dependency tree
 *
 * @param {Array} pkgList List of components
 * @param {Array} dependencies List of dependencies
 *
 * @returns {Array} Updated list
 */
export function recomputeScope(pkgList, dependencies) {
  const requiredPkgs = {};
  if (!pkgList || !dependencies) {
    return pkgList;
  }
  for (const pkg of pkgList) {
    if (!pkg.scope || !pkg["bom-ref"]) {
      continue;
    }
    if (pkg.scope === "required") {
      requiredPkgs[pkg["bom-ref"]] = true;
    }
  }
  for (const adep of dependencies) {
    if (requiredPkgs[adep.ref]) {
      for (const ado of adep.dependsOn) {
        requiredPkgs[ado] = true;
      }
    }
  }
  // Prevent marking every component as optional
  if (!Object.keys(requiredPkgs).length) {
    return pkgList;
  }
  for (const pkg of pkgList) {
    if (requiredPkgs[pkg["bom-ref"]]) {
      pkg.scope = "required";
    } else if (!pkg.scope) {
      pkg.scope = "optional";
    }
  }
  return pkgList;
}

/**
 * Function to parse a list of environment variables to identify the paths containing executable binaries
 *
 * @param envValues {Array[String]} Environment variables list
 * @returns {Array[String]} Binary Paths identified from the environment variables
 */
export function extractPathEnv(envValues) {
  if (!envValues) {
    return [];
  }
  let binPaths = new Set();
  const shellVariables = {};
  // Let's focus only on linux container images for now
  for (const env of envValues) {
    if (env.startsWith("PATH=")) {
      binPaths = new Set(env.replace("PATH=", "").split(":"));
    } else {
      const tmpA = env.split("=");
      if (tmpA.length === 2) {
        shellVariables[`$${tmpA[0]}`] = tmpA[1];
        shellVariables[`\${${tmpA[0]}}`] = tmpA[1];
      }
    }
  }
  binPaths = Array.from(binPaths);
  const expandedBinPaths = [];
  for (let apath of binPaths) {
    // Filter empty paths
    if (!apath.length) {
      continue;
    }
    if (apath.includes("$")) {
      for (const k of Object.keys(shellVariables)) {
        apath = apath.replace(k, shellVariables[k]);
      }
    }
    // We're here, but not all paths got substituted
    // Let's ignore them for now instead of risking substitution based on host values.
    // Eg: ${GITHUB_TOKEN} could get expanded with the values from the host
    if (apath.length && !apath.includes("$")) {
      expandedBinPaths.push(apath);
    }
  }
  recordObservedActivity("path-resolution", "PATH", {
    metadata: {
      capability: "path-lookup",
      pathCount: expandedBinPaths.length,
    },
    reasonBuilder: (count) =>
      `Expanded PATH into ${expandedBinPaths.length} executable search path(s)${buildReadCountSuffix(count)}.`,
  });
  return expandedBinPaths;
}

/**
 * Collect all executable files from the given list of binary paths
 *
 * @param basePath Base directory
 * @param binPaths {Array[String]} Paths containing potential binaries
 * @param excludePaths {Array[String]} Container-relative paths that should be excluded from the result set
 * @return {Array[String]} List of executables
 */
export function collectExecutables(basePath, binPaths, excludePaths = []) {
  if (!binPaths) {
    return [];
  }
  const executablesByResolvedPath = new Map();
  const excludedPathSet = new Set(
    (excludePaths || []).map((f) => f.replace(/^\/+/, "").replace(/\\/g, "/")),
  );
  const ignoreList = [
    "**/*.{h,c,cpp,hpp,man,txt,md,htm,html,jar,ear,war,zip,tar,egg,keepme,gitignore,json,js,py,pyc}",
    "[",
  ];
  for (const apath of binPaths) {
    try {
      const files = globSync(`**${apath}/*`, {
        cwd: basePath,
        absolute: false,
        nocase: true,
        nodir: true,
        dot: true,
        follow: true,
        ignore: ignoreList,
      });
      for (const file of files) {
        let resolvedFile = file;
        try {
          resolvedFile = relative(basePath, realpathSync(join(basePath, file)));
          if (resolvedFile !== file) {
            recordSymlinkResolution(join(basePath, file), resolvedFile, {
              basePath,
              metadata: {
                resolutionKind: "executable",
              },
              reason: `Resolved executable candidate ${file} to ${resolvedFile}.`,
            });
          }
        } catch (err) {
          recordSymlinkResolution(join(basePath, file), undefined, {
            basePath,
            errorCode: err?.code || err?.name,
            metadata: {
              resolutionKind: "executable",
            },
            reason: `Failed to resolve executable candidate ${file}.`,
            status: "failed",
          });
          // Broken symlinks or permission errors can prevent realpath resolution.
          if (DEBUG_MODE) {
            console.log(`Unable to resolve executable path alias for ${file}`);
          }
        }
        if (
          excludedPathSet.has(file.replace(/^\/+/, "").replace(/\\/g, "/")) ||
          excludedPathSet.has(
            resolvedFile.replace(/^\/+/, "").replace(/\\/g, "/"),
          )
        ) {
          continue;
        }
        const existingFile = executablesByResolvedPath.get(resolvedFile);
        if (shouldPreferUsrMergedExecutablePath(file, existingFile)) {
          executablesByResolvedPath.set(resolvedFile, file);
        }
      }
    } catch (_err) {
      // ignore
    }
  }
  return Array.from(executablesByResolvedPath.values()).sort();
}

function shouldPreferUsrMergedExecutablePath(file, existingFile) {
  if (!existingFile) {
    return true;
  }
  const fileUsesUsrPrefix = file.startsWith("usr/");
  const existingFileUsesUsrPrefix = existingFile.startsWith("usr/");
  if (fileUsesUsrPrefix !== existingFileUsesUsrPrefix) {
    return fileUsesUsrPrefix;
  }
  return file < existingFile;
}

/**
 * Collect all shared library files from the given list of paths
 *
 * @param basePath Base directory
 * @param libPaths {Array[String]} Paths containing potential libraries
 * @param ldConf {String} Config file used by ldconfig to locate additional paths
 * @param ldConfDirPattern {String} Config directory that can contain more .conf files for ldconfig
 * @param excludePaths {Array[String]} Container-relative paths that should be excluded from the result set
 *
 * @return {Array[String]} List of executables
 */
export function collectSharedLibs(
  basePath,
  libPaths,
  ldConf,
  ldConfDirPattern,
  excludePaths = [],
) {
  if (!libPaths) {
    return [];
  }
  const sharedLibs = [];
  const excludedPathSet = new Set(
    (excludePaths || []).map((f) => f.replace(/^\/+/, "").replace(/\\/g, "/")),
  );
  const ignoreList = [
    "**/*.{h,c,cpp,hpp,man,txt,md,htm,html,jar,ear,war,zip,tar,egg,keepme,gitignore,json,js,py,pyc}",
  ];
  const allLdConfDirs = ldConfDirPattern ? [ldConfDirPattern] : [];
  collectAllLdConfs(basePath, ldConf, allLdConfDirs, libPaths);
  if (allLdConfDirs.length) {
    for (const aldconfPattern of allLdConfDirs) {
      const confFiles = globSync(aldconfPattern, {
        cwd: basePath,
        absolute: false,
        nocase: true,
        nodir: true,
        dot: true,
        follow: false,
      });
      for (const moreConf of confFiles) {
        collectAllLdConfs(basePath, moreConf, allLdConfDirs, libPaths);
      }
    }
  }
  for (const apath of Array.from(new Set(libPaths))) {
    try {
      const files = globSync(`**${apath}/*.{so,so.*,a,lib,dll}`, {
        cwd: basePath,
        absolute: false,
        nocase: true,
        nodir: true,
        dot: true,
        follow: true,
        ignore: ignoreList,
      });
      for (const file of files) {
        let resolvedFile = file;
        try {
          resolvedFile = relative(basePath, realpathSync(join(basePath, file)));
          recordSymlinkResolution(join(basePath, file), resolvedFile, {
            basePath,
            metadata: {
              resolutionKind: "shared-library",
            },
            reason: `Resolved shared library candidate ${file} to ${resolvedFile}.`,
          });
        } catch (err) {
          recordSymlinkResolution(join(basePath, file), undefined, {
            basePath,
            errorCode: err?.code || err?.name,
            metadata: {
              resolutionKind: "shared-library",
            },
            reason: `Failed to resolve shared library candidate ${file}.`,
            status: "failed",
          });
          // Broken symlinks or permission errors can prevent realpath resolution.
        }
        if (
          excludedPathSet.has(file.replace(/^\/+/, "").replace(/\\/g, "/")) ||
          excludedPathSet.has(
            resolvedFile.replace(/^\/+/, "").replace(/\\/g, "/"),
          )
        ) {
          continue;
        }
        sharedLibs.push(file);
      }
    } catch (_err) {
      // ignore
    }
  }
  return Array.from(new Set(sharedLibs)).sort();
}

function collectAllLdConfs(basePath, ldConf, allLdConfDirs, libPaths) {
  if (ldConf && safeExistsSync(join(basePath, ldConf))) {
    const ldConfData = readFileSync(join(basePath, ldConf), "utf-8");
    for (let line of ldConfData.split("\n")) {
      line = line.replace("\r", "").trim();
      if (!line.length || line.startsWith("#")) {
        continue;
      }
      if (line.startsWith("include ")) {
        let apattern = line.replace("include ", "");
        if (!apattern.includes("*")) {
          apattern = `${apattern}/*.conf`;
        }
        if (!allLdConfDirs.includes(apattern)) {
          allLdConfDirs.push(apattern);
        }
      } else if (line.startsWith("/")) {
        if (!libPaths.includes(line)) {
          libPaths.push(line);
        }
      }
    }
  }
}

/**
 * Get information about the runtime.
 *
 * @returns {Object} Object containing the name and version of the runtime
 */
export function getRuntimeInformation() {
  const runtimeInfo = {};
  if (isDeno) {
    runtimeInfo.runtime = "Deno";
    runtimeInfo.version = globalThis.Deno.version.deno;
  } else if (isBun) {
    runtimeInfo.runtime = "Bun";
    runtimeInfo.version = globalThis.Bun.version;
  } else if (isNode) {
    runtimeInfo.runtime = "Node.js";
    runtimeInfo.version = globalThis.process.versions.node;
    const report = process.report.getReport();
    const nodeSourceUrl = report?.header?.release?.sourceUrl;
    // Collect the bundled components in node.js
    if (report?.header?.componentVersions) {
      const nodeBundledComponents = [];
      for (const [name, version] of Object.entries(
        report.header.componentVersions,
      )) {
        if (name === "node") {
          continue;
        }
        const apkg = {
          name,
          version,
          description: `Bundled with Node.js ${runtimeInfo.version}`,
          type: "library",
          scope: "excluded",
          purl: `pkg:generic/${name}@${version}`,
          "bom-ref": `pkg:generic/${name}@${version}`,
        };
        if (nodeSourceUrl) {
          apkg.externalReferences = [
            {
              url: nodeSourceUrl,
              type: "source-distribution",
              comment: "Node.js release url",
            },
          ];
        }
        nodeBundledComponents.push(apkg);
      }
      if (nodeBundledComponents.length) {
        runtimeInfo.components = nodeBundledComponents;
      }
    }
    if (report.sharedObjects) {
      const osSharedObjects = [];
      for (const aso of report.sharedObjects) {
        const name = basename(aso);
        if (name === "node") {
          continue;
        }
        const apkg = {
          name,
          type: "library",
          scope: "excluded",
          purl: `pkg:generic/${name}#${aso}`,
          "bom-ref": `pkg:generic/${name}`,
        };
        osSharedObjects.push(apkg);
      }
      if (osSharedObjects.length) {
        runtimeInfo.components = osSharedObjects;
      }
    }
  } else {
    runtimeInfo.runtime = "Unknown";
    runtimeInfo.version = "N/A";
  }

  return runtimeInfo;
}

/**
 * Checks for dangerous Unicode characters that could enable homograph attacks
  if (zeroWidthChars.test(str)) {
    return true;
  }

  // Check for control characters (except common ones like \n, \r, \t)
  const controlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  return controlChars.test(str);
}
// biome-ignore-end lint/suspicious/noControlCharactersInRegex: validation

/**
 * Validates that a root is a legitimate Windows drive letter format
 *
 * @param {string} root Root to validate
 * @returns {boolean} true if valid drive format
 */
export function isValidDriveRoot(root) {
  // Must be at most 3 characters: letter, colon, backslash
  if (root.length > 3) {
    return false;
  }

  // Check each character individually to prevent Unicode lookalikes
  const driveLetter = root.charAt(0);
  const colon = root.charAt(1);
  const backslash = root.charAt(2);

  // Drive letter must be ASCII A-Z or a-z
  const charCode = driveLetter.charCodeAt(0);
  const isAsciiLetter =
    (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122);
  if (!isAsciiLetter) {
    return false;
  }

  // Colon must be exactly ASCII colon (0x3A)
  if (colon.charCodeAt(0) !== 0x3a) {
    return false;
  }

  // Backslash (optional) must be exactly ASCII backslash (0x5C)
  return !(backslash && backslash.charCodeAt(0) !== 0x5c);
}

/**
 * Get version and runtime information
 */
export function retrieveCdxgenVersion() {
  const packageJsonAsString = readFileSync(
    join(dirNameStr, "package.json"),
    "utf-8",
  );
  const packageJson = JSON.parse(packageJsonAsString);

  const runtimeInfo = getRuntimeInformation();

  return `\x1b[1mCycloneDX Generator ${packageJson.version}\x1b[0m\nRuntime: ${runtimeInfo.runtime}, Version: ${runtimeInfo.version}`;
}

/**
 * Retrieve the version of the cdxgen plugins binary package from package.json.
 *
 * Reads the local package.json and searches the `optionalDependencies` for a package
 * whose name starts with `@cdxgen/cdxgen-plugins-bin`, returning its declared version.
 *
 * @returns {string|undefined} Version string of the plugins binary package, or undefined if not found
 */
export function retrieveCdxgenPluginVersion() {
  const packageJsonAsString = readFileSync(
    join(dirNameStr, "package.json"),
    "utf-8",
  );
  const packageJson = JSON.parse(packageJsonAsString);
  for (const adepName of Object.keys(packageJson.optionalDependencies || {})) {
    if (adepName.startsWith("@cdxgen/cdxgen-plugins-bin")) {
      return packageJson.optionalDependencies[adepName];
    }
  }
  return undefined;
}

/**
 * Convert hyphenated strings to camel case.
 *
 * @param {String} str String to convert
 * @returns {String} camelCased string
 */
export function toCamel(str) {
  return str.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
}
