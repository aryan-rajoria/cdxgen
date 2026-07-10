export declare const isProtoSupportedSpecVersion: (specVersion: any) => boolean;
export declare const assertProtoSupportedSpecVersion: (specVersion: any, operation?: string) => void;
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
export declare const readBinary: (binFile: string, asJson: boolean, specVersion?: string | number) => any;
//# sourceMappingURL=protobom.d.ts.map