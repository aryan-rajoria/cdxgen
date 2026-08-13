/**
 * Resolve container-risk metadata for a binary, considering a linked alias name
 * and GTFOBins-derived techniques.
 *
 * @param {string} name Binary name to look up
 * @param {string} [linkedName] Optional symlinked/linked binary name used as a fallback match
 * @returns {Object|undefined} Merged risk metadata (attack tactics/techniques, risk tags,
 * offense tools, seccomp details) or undefined when no entry matches
 */
export declare function getContainerRiskMetadata(name: string, linkedName?: string): Object | undefined;
/**
 * Build `cdx:container:*` custom properties for a binary matched against the
 * container-risk index.
 *
 * @param {string} name Binary name to look up
 * @param {string} [linkedName] Optional symlinked/linked binary name used as a fallback match
 * @returns {Object[]} CycloneDX custom properties; empty when the binary is not matched
 */
export declare function createContainerRiskProperties(name: string, linkedName?: string): Object[];
//# sourceMappingURL=containerRisk.d.ts.map