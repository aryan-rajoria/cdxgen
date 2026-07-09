/**
 * CycloneDX annotation reporter — embeds findings as `annotations[]` entries
 * on a copy of the input BOM. Can be reused by `bom-audit`.
 *
 * CycloneDX supports the annotation schema from spec version 1.5 onward.
 */
/**
 * Render a set of findings into CycloneDX annotations.
 *
 * @param {Array<object>} findings Finding objects emitted by the validator or auditBom engine.
 * @param {object} bomJson Full CycloneDX BOM (needed for annotator/subject wiring).
 * @returns {Array<object>} CycloneDX annotation objects.
 */
export declare function buildAnnotations(findings: Array<object>, bomJson: object): Array<object>;
/**
 * Produce a new BOM object with findings embedded as annotations. The caller
 * is responsible for writing the result to disk.
 *
 * @param {object} bomJson
 * @param {Array<object>} findings
 * @returns {object}
 */
export declare function renderBom(bomJson: object, findings: Array<object>): object;
/**
 * Convenience wrapper matching the signature of the other reporters. The
 * second argument expects `{ bomJson }` because annotations are BOM-shaped,
 * not report-shaped.
 *
 * @param {object} report Output of validateBomAdvanced().
 * @param {object} options
 * @param {object} options.bomJson The BOM to annotate.
 * @returns {string} JSON string of the annotated BOM.
 */
export declare function render(report: object, options?: {
    bomJson: object;
}): string;
//# sourceMappingURL=annotations.d.ts.map