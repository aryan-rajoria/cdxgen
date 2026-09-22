import { isProtoBomFile } from "@cdxgen/cdx-proto/node";
export { isProtoBomFile };
/**
 * Determine whether a spec version is supported for protobuf serialization.
 *
 * Delegates to cdx-proto's `isSupportedSpecVersion`, which accepts the
 * spellings seen in the wild (`v1.6`, `1.6`, `1.6.0`) in addition to the
 * canonical strings.
 *
 * @param {string|undefined} specVersion CycloneDX spec version string
 * @returns {boolean} `true` when supported by `@cdxgen/cdx-proto`, or when no spec version is provided
 */
export declare const isProtoSupportedSpecVersion: (specVersion: string | undefined) => boolean;
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
export declare const assertProtoSupportedSpecVersion: (specVersion: string | undefined, operation?: string) => void;
/**
 * Method to convert the given bom json to proto binary
 *
 * @param {string | Object} bomJson BOM Json
 * @param {string} binFile Binary file name
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 */
export declare const writeBinary: (bomJson: string | Object, binFile: string, specVersion?: string | number) => void;
/**
 * Method to read a serialized binary
 *
 * @param {string} binFile Binary file name
 * @param {boolean} asJson Convert to JSON
 * @param {string | number} [specVersion] Optional specification version. When omitted, cdxgen auto-detects the matching schema.
 */
export declare const readBinary: (binFile: string, asJson: boolean, specVersion?: string | number) => import("@cdxgen/cdx-proto").AnyBom | import("@cdxgen/cdx-proto").AnyBomJson | undefined;
/**
 * Method to compute size and count statistics for a BOM.
 *
 * @param {string | Object} bomJson BOM Json, BOM Json string, or proto message
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 * @returns {Object} Component and dependency counts with JSON/binary byte sizes and compression ratio
 */
export declare const getBomStats: (bomJson: string | Object, specVersion?: string | number) => Object;
/**
 * Method to cross-convert a BOM between CycloneDX specification versions using
 * the protobuf schemas.
 *
 * cdx-proto's conversion is cardinality-safe: fields that change shape between
 * versions (`metadata.licenses` and `evidence.identity`, singular in 1.5 and an
 * array since 1.6) are reshaped automatically — wrapped on upgrade, collapsed
 * to their first entry on downgrade — including `evidence.identity` on nested
 * components, `metadata.component`, `metadata.tools.components[]`, and
 * `formulation[].components[]`. Downgrades are otherwise lossy: fields the
 * target version does not define are dropped and reported in `warnings` as
 * field paths, alongside collapsed list siblings.
 *
 * Only the protobuf-supported versions (1.5–1.7) can be targeted here. For the
 * full JSON-level normalization across every version cdxgen emits (component
 * types, license attributes, 1.4/2.0 reshaping), prefer
 * `applySpecVersionCompatibility` from the postgen stage.
 *
 * @param {string | Object} bomJson BOM Json, BOM Json string, or proto message
 * @param {string | number} targetSpecVersion Target CycloneDX spec version
 * @param {string | number} [specVersion] CycloneDX spec version fallback for BOMs without specVersion
 * @returns {{bomJson: Object, warnings: string[]}} Converted BOM Json and the field paths dropped
 */
export declare const convertBomSpecVersion: (bomJson: string | Object, targetSpecVersion: string | number, specVersion?: string | number) => {
    bomJson: Object;
    warnings: string[];
};
//# sourceMappingURL=protobom.d.ts.map