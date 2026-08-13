import { readFileSync } from "node:fs";

import {
  bomStats,
  convertBom,
  createBom,
  decodeBomBinary,
  decodeBomJson,
  encodeBomBinary,
  encodeBomJson,
  parseBomBinary,
  parseBomJson,
  supportedSpecVersions,
} from "@cdxgen/cdx-proto";

import { safeExistsSync, safeWriteSync } from "../core/fs.js";
import { toCycloneDxSpecVersionString } from "./bomUtils.js";

const JSON_READ_OPTIONS = {
  ignoreUnknownFields: true,
};

const BINARY_READ_OPTIONS = {
  readUnknownFields: true,
};

const BINARY_WRITE_OPTIONS = {
  writeUnknownFields: true,
};

const PROTO_BOM_FILE_EXTENSIONS = [".cdx", ".cdx.bin", ".proto"];

const DEFAULT_SPEC_VERSION =
  supportedSpecVersions[supportedSpecVersions.length - 1];
const PROTO_SUPPORTED_SPEC_VERSIONS = new Set(
  supportedSpecVersions.map((specVersion) =>
    toCycloneDxSpecVersionString(specVersion),
  ),
);

const isProtoMessageBom = (bom) =>
  Boolean(
    bom &&
      typeof bom === "object" &&
      !Array.isArray(bom) &&
      typeof bom.$typeName === "string" &&
      bom.specVersion,
  );

const hasExplicitSpecVersion = (bomJson) =>
  Boolean(
    bomJson &&
      typeof bomJson === "object" &&
      !Array.isArray(bomJson) &&
      (bomJson.specVersion !== undefined || bomJson.spec_version !== undefined),
  );

const resolveExplicitSpecVersion = (bomJson) =>
  bomJson?.specVersion ?? bomJson?.spec_version;

const hasProvidedSpecVersion = (specVersion) =>
  specVersion !== undefined &&
  specVersion !== null &&
  `${specVersion}`.trim() !== "";

/**
 * Determine whether a spec version is supported for protobuf serialization.
 *
 * @param {string|undefined} specVersion CycloneDX spec version string
 * @returns {boolean} `true` when supported by `@cdxgen/cdx-proto`, or when no spec version is provided
 */
export const isProtoSupportedSpecVersion = (specVersion) => {
  if (!hasProvidedSpecVersion(specVersion)) {
    return true;
  }
  const normalizedSpecVersion = toCycloneDxSpecVersionString(specVersion);
  return (
    normalizedSpecVersion !== undefined &&
    PROTO_SUPPORTED_SPEC_VERSIONS.has(normalizedSpecVersion)
  );
};

/**
 * Assert that a spec version is supported by `@cdxgen/cdx-proto`.
 *
 * Throws an `Error` naming the unsupported version and the operation when the
 * spec version cannot be serialized to protobuf; returns without effect
 * otherwise.
 *
 * @param {string|undefined} specVersion CycloneDX spec version string
 * @param {string} [operation="protobuf operations"] Operation label used in the error message
 */
export const assertProtoSupportedSpecVersion = (
  specVersion,
  operation = "protobuf operations",
) => {
  if (!hasProvidedSpecVersion(specVersion)) {
    return;
  }
  const normalizedSpecVersion = toCycloneDxSpecVersionString(specVersion);
  if (isProtoSupportedSpecVersion(specVersion)) {
    return;
  }
  const displaySpecVersion = normalizedSpecVersion || `${specVersion}`.trim();
  throw new Error(
    `CycloneDX ${displaySpecVersion} is not currently supported for ${operation}. @cdxgen/cdx-proto supports ${supportedSpecVersions.join(", ")} only.`,
  );
};

const resolveBomMessage = (bomJson, specVersion = DEFAULT_SPEC_VERSION) => {
  if (isProtoMessageBom(bomJson)) {
    return bomJson;
  }
  const parsedBomJson =
    typeof bomJson === "string" || bomJson instanceof String
      ? JSON.parse(`${bomJson}`)
      : bomJson;
  if (
    parsedBomJson &&
    typeof parsedBomJson === "object" &&
    !Array.isArray(parsedBomJson)
  ) {
    if (hasExplicitSpecVersion(parsedBomJson)) {
      assertProtoSupportedSpecVersion(
        resolveExplicitSpecVersion(parsedBomJson),
        "protobuf serialization",
      );
      return parseBomJson(parsedBomJson, JSON_READ_OPTIONS);
    }
    assertProtoSupportedSpecVersion(specVersion, "protobuf serialization");
    return decodeBomJson(specVersion, parsedBomJson, JSON_READ_OPTIONS);
  }
  return createBom(specVersion);
};

/**
 * Determine whether a path looks like a CycloneDX protobuf file.
 *
 * @param {string} filePath File path
 * @returns {boolean} true when the path looks like a protobuf BOM file
 */
export const isProtoBomFile = (filePath) => {
  const normalizedPath = `${filePath || ""}`.toLowerCase();
  return PROTO_BOM_FILE_EXTENSIONS.some((extension) =>
    normalizedPath.endsWith(extension),
  );
};

/**
 * Method to convert the given bom json to proto binary
 *
 * @param {string | Object} bomJson BOM Json
 * @param {string} binFile Binary file name
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 */
export const writeBinary = (
  bomJson,
  binFile,
  specVersion = DEFAULT_SPEC_VERSION,
) => {
  if (bomJson && binFile) {
    const bomMessage = resolveBomMessage(bomJson, specVersion);
    safeWriteSync(binFile, encodeBomBinary(bomMessage, BINARY_WRITE_OPTIONS));
  }
};

/**
 * Method to read a serialized binary
 *
 * @param {string} binFile Binary file name
 * @param {boolean} asJson Convert to JSON
 * @param {string | number} [specVersion] Optional specification version. When omitted, cdxgen auto-detects the matching schema.
 */
export const readBinary = (binFile, asJson, specVersion) => {
  asJson = asJson ?? true;
  assertProtoSupportedSpecVersion(specVersion, "protobuf decoding");
  if (!safeExistsSync(binFile)) {
    return undefined;
  }
  const binaryData = readFileSync(binFile);
  const bomObject =
    specVersion !== undefined && specVersion !== null && specVersion !== ""
      ? decodeBomBinary(specVersion, binaryData, BINARY_READ_OPTIONS)
      : parseBomBinary(binaryData, BINARY_READ_OPTIONS);
  if (asJson) {
    return encodeBomJson(bomObject);
  }
  return bomObject;
};

/**
 * Method to compute size and count statistics for a BOM.
 *
 * @param {string | Object} bomJson BOM Json, BOM Json string, or proto message
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 * @returns {Object} Component and dependency counts with JSON/binary byte sizes and compression ratio
 */
export const getBomStats = (bomJson, specVersion = DEFAULT_SPEC_VERSION) =>
  bomStats(resolveBomMessage(bomJson, specVersion));

/**
 * Method to cross-convert a BOM between CycloneDX specification versions using
 * the protobuf schemas.
 *
 * Downgrades are lossy: fields that the target version does not define are
 * dropped and reported in `warnings` as field paths.
 *
 * This is the raw `@cdxgen/cdx-proto` conversion. It reshapes nothing that the
 * two schemas model with different cardinality, so a BOM crossing the 1.5/1.6
 * `evidence.identity` boundary must be normalized first. Prefer
 * `applySpecVersionCompatibility` from the postgen stage for that.
 *
 * @param {string | Object} bomJson BOM Json, BOM Json string, or proto message
 * @param {string | number} targetSpecVersion Target CycloneDX spec version
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 * @returns {{bomJson: Object, warnings: string[]}} Converted BOM Json and the field paths dropped
 */
export const convertBomSpecVersion = (
  bomJson,
  targetSpecVersion,
  specVersion = DEFAULT_SPEC_VERSION,
) => {
  assertProtoSupportedSpecVersion(targetSpecVersion, "protobuf conversion");
  const normalizedTargetSpecVersion =
    toCycloneDxSpecVersionString(targetSpecVersion) || `${targetSpecVersion}`;
  const { bom, warnings } = convertBom(
    resolveBomMessage(bomJson, specVersion),
    normalizedTargetSpecVersion,
  );
  return { bomJson: encodeBomJson(bom), warnings };
};
