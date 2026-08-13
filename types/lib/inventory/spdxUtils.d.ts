/**
 * Convert an SPDX 3.x JSON-LD document into a CycloneDX-like BOM object.
 *
 * Maps `software_Package` and `software_File` graph elements to components and
 * `dependsOn` relationships to a dependency list. Input that is not SPDX
 * JSON-LD is returned unchanged.
 *
 * @param {Object} bomJson SPDX JSON-LD or CycloneDX-like document
 * @returns {Object} BOM object carrying `components` and `dependencies`
 */
export declare const toCycloneDxLikeBom: (bomJson: Object) => Object;
//# sourceMappingURL=spdxUtils.d.ts.map