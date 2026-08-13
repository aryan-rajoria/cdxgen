/**
 * Determine whether a spec version is supported for protobuf serialization.
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
 * Determine whether a path looks like a CycloneDX protobuf file.
 *
 * @param {string} filePath File path
 * @returns {boolean} true when the path looks like a protobuf BOM file
 */
export declare const isProtoBomFile: (filePath: string) => boolean;
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
export declare const convertBomSpecVersion: (bomJson: string | Object, targetSpecVersion: string | number, specVersion?: string | number) => {
    bomJson: Object;
    warnings: string[];
};
//# sourceMappingURL=protobom.d.ts.map