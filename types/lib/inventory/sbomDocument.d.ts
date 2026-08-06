export declare const MAX_SBOM_DOCUMENT_BYTES: number;
/**
 * Parse a third-party SBOM document into components and dependencies.
 *
 * Returns null — never throws — when the document is too large, is not JSON, is
 * not a recognised SBOM shape, or carries nothing worth merging. Every rejection
 * is reported once, naming the source, so a skipped document is visible rather
 * than silent.
 *
 * @param {string} text Raw document text
 * @param {Object} [input] Parse inputs
 * @param {string} [input.source] Provenance label used in warnings (path, entry name or URL)
 * @param {number} [input.maxBytes] Size bound. Defaults to `MAX_SBOM_DOCUMENT_BYTES`
 * @returns {{components: Object[], dependencies: Object[], format: string, rootRef: (string|undefined)}|null}
 */
export declare function parseSbomDocument(text: string, { source, maxBytes }?: {
    source?: string;
    maxBytes?: number;
}): {
    components: Object[];
    dependencies: Object[];
    format: string;
    rootRef: (string | undefined);
} | null;
/**
 * Attach provenance properties to every component of a parsed document. The
 * caller owns the property names so each provenance channel stays
 * distinguishable in the merged BOM.
 *
 * @param {Object[]} components Components from `parseSbomDocument`
 * @param {Array<{name: string, value: string}>} properties Properties to add
 * @returns {Object[]} The same array, with properties attached
 */
export declare function tagSbomComponents(components: Object[], properties: Array<{
    name: string;
    value: string;
}>): Object[];
//# sourceMappingURL=sbomDocument.d.ts.map