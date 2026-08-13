/**
 * Look up GTFOBins metadata for a binary, falling back to its linked (symlink) name.
 *
 * @param {string} name Binary name to look up
 * @param {string} [linkedName] Optional symlinked/linked binary name used as a fallback match
 * @returns {Object|undefined} Metadata with canonicalName, contexts, functions, mitreTechniques,
 * privilegedContexts, reference, riskTags, and source details, or undefined when unmatched
 */
export declare function getGtfoBinsMetadata(name: string, linkedName?: string): Object | undefined;
/**
 * Build `cdx:gtfobins:*` custom properties for a binary matched against the
 * GTFOBins index.
 *
 * @param {string} name Binary name to look up
 * @param {string} [linkedName] Optional symlinked/linked binary name used as a fallback match
 * @returns {Object[]} CycloneDX custom properties; empty when the binary is not matched
 */
export declare function createGtfoBinsProperties(name: string, linkedName?: string): Object[];
/**
 * Resolve GTFOBins properties for a live Linux osquery row.
 *
 * @param {string} queryCategory Osquery query category
 * @param {object} row Osquery row
 * @returns {Array<object>} CycloneDX custom properties
 */
export declare function createGtfoBinsPropertiesFromRow(queryCategory: string, row: object): Array<object>;
//# sourceMappingURL=gtfobins.d.ts.map