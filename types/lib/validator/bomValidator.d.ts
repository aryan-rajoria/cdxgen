/**
 * Validate the generated bom using jsonschema
 *
 * @param {object} bomJson content
 *
 * @returns {Boolean} true if the BOM is valid. false otherwise.
 */
export declare const validateBom: (bomJson: object) => boolean;
/**
 * Validate the generated SPDX export.
 *
 * @param {object|string} spdxJson SPDX json object
 * @returns {boolean} true if the SPDX export is valid
 */
export declare const validateSpdx: (spdxJson: object | string) => boolean;
/**
 * Validate the metadata object
 *
 * @param {object} bomJson Bom json object
 */
export declare const validateMetadata: (bomJson: object) => boolean;
/**
 * Validate the format of all purls
 *
 * @param {object} bomJson Bom json object
 */
export declare const validatePurls: (bomJson: object) => boolean;
/**
 * Validate the refs in dependencies block
 *
 * @param {object} bomJson Bom json object
 */
export declare const validateRefs: (bomJson: object) => boolean;
/**
 * Validate the component properties
 *
 * @param {object} bomJson Bom json object
 */
export declare function validateProps(bomJson: object): boolean;
//# sourceMappingURL=bomValidator.d.ts.map