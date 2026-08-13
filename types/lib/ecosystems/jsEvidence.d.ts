/**
 * Attach JS/TS import and export usage evidence to matching package components.
 *
 * For each component, resolves its module aliases (including the deno jsr
 * specifier), records imported/exported modules as properties, attaches
 * occurrence evidence, and adjusts the component scope to "required" when the
 * package is used or "optional" when it is not.
 *
 * @param {Array<object>} pkgList Package components to enrich.
 * @param {object} allImports Map of import specifier to usage evidence objects.
 * @param {object} allExports Map of export specifier to export evidence objects.
 * @param {boolean} deep When true, fill in missing description/author/license
 *   metadata from the local node_modules copy of each package.
 * @returns {Promise<Array<object>>} The enriched package list (same reference as pkgList).
 */
export declare function addEvidenceForImports(pkgList: Array<object>, allImports: object, allExports: object, deep: boolean): Promise<Array<object>>;
//# sourceMappingURL=jsEvidence.d.ts.map