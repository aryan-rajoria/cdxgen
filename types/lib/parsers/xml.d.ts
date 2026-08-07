/**
 * Non-validating XML parser for the manifest formats cdxgen reads: Maven poms,
 * NuGet nuspec and packages.config, MSBuild project and props files, VSIX
 * manifests and Apple plists.
 *
 * Namespace prefixes are kept verbatim in element and attribute names rather
 * than resolved, so `<PackageManifest:Metadata>` stays under that literal key.
 * Doctypes are recorded but never interpreted: no internal subset is read and
 * no external entity is fetched, so a declared entity reference is an unknown
 * entity and is rejected like any other.
 */
/**
 * Parse an XML document into a plain object.
 *
 * In compact form each element becomes a key on its parent, with text under
 * `textKey`, attributes under `attributesKey` and comments under `commentKey`;
 * a name that repeats becomes an array. In verbose form the document becomes a
 * list of typed nodes under `elements`.
 *
 * @param {string} source XML document
 * @param {object} [options] Parse options
 * @param {Boolean} [options.compact] Emit the compact form
 * @param {Boolean} [options.alwaysArray] Wrap every compact-form value in an array
 * @param {string} [options.textKey] Key holding element text
 * @param {string} [options.attributesKey] Key holding element attributes
 * @param {string} [options.commentKey] Key holding comment text
 * @param {string} [options.cdataKey] Key holding CDATA text
 * @param {Boolean} [options.ignoreComment] Drop comments
 * @param {Boolean} [options.ignoreCdata] Drop CDATA sections
 * @param {Boolean} [options.trim] Trim text in the verbose form
 *
 * @returns {object} Parsed document
 *
 * @throws {Error} When the document is not well formed
 */
export declare function xml2js(source: string, options?: {
    compact?: boolean;
    alwaysArray?: boolean;
    textKey?: string;
    attributesKey?: string;
    commentKey?: string;
    cdataKey?: string;
    ignoreComment?: boolean;
    ignoreCdata?: boolean;
    trim?: boolean;
}): object;
//# sourceMappingURL=xml.d.ts.map