/**
 * Attach JS/TS import and export usage evidence to matching package components.
 *
 * For each component, resolves its module aliases (including the deno jsr
 * specifier), records imported/exported modules as properties, attaches
 * occurrence evidence, and promotes the component scope to "required" when the
 * package is used. A package with no observed usage keeps the scope its
 * manifest parser assigned: static import analysis cannot see packages loaded
 * from configuration, bundler entrypoints, stylesheets, or plugins, so a
 * missing import is not evidence that a package is optional.
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