/**
 * Normalize the requested export formats.
 *
 * @param {string|string[]|undefined|null} format Raw format value
 * @returns {string[]} Normalized export formats
 */
export declare function normalizeOutputFormats(format: string | string[] | undefined | null): string[];
/**
 * Derive the SPDX output path from a base output path.
 *
 * @param {string} outputPath Output path
 * @returns {string} SPDX output path
 */
export declare function deriveSpdxOutputPath(outputPath: string): string;
/**
 * Derive the CycloneDX output path from a base output path.
 *
 * @param {string} outputPath Output path
 * @returns {string} CycloneDX output path
 */
export declare function deriveCycloneDxOutputPath(outputPath: string): string;
/**
 * Derive the output path for a CycloneDX BOM converted to another spec version.
 *
 * The spec version is inserted ahead of the existing extension so the source
 * BOM is never overwritten, and the extension is preserved so a protobuf input
 * keeps producing a protobuf-suffixed name.
 *
 * @param {string} inputPath Input BOM path
 * @param {string} specVersion Target CycloneDX spec version
 * @returns {string} Converted CycloneDX output path
 */
export declare function deriveSpecVersionOutputPath(inputPath: string, specVersion: string): string;
/**
 * Determine the final output plan for the requested export formats.
 *
 * @param {object} options CLI options
 * @returns {{ formats: Set<string>, outputs: Record<string, string>, explicitFormat: boolean }} Output plan
 */
export declare function createOutputPlan(options: object): {
    formats: Set<string>;
    outputs: Record<string, string>;
    explicitFormat: boolean;
};
/**
 * Return the output directory for a planned export path.
 *
 * @param {string} outputPath Output path
 * @returns {string} Output directory
 */
export declare function getOutputDirectory(outputPath: string): string;
//# sourceMappingURL=exportUtils.d.ts.map