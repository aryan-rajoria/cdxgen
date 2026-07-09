export declare const SPDX_JSONLD_CONTEXT = "https://spdx.org/rdf/3.0.1/spdx-context.jsonld";
export declare const SPDX_SPEC_VERSION = "3.0.1";
/**
 * Convert a CycloneDX BOM JSON document into an SPDX 3.0.1 JSON-LD document.
 *
 * @param {object|string} bomJson CycloneDX BOM JSON
 * @param {object} [options] CLI options
 * @returns {object|undefined} SPDX 3.0.1 JSON-LD document
 */
export declare function convertCycloneDxToSpdx(bomJson: object | string, options?: object): object | undefined;
//# sourceMappingURL=spdxConverter.d.ts.map