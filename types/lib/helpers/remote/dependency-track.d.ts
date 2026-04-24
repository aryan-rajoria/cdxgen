/**
 * Returns the Dependency-Track BOM API URL.
 *
 * @param {string} serverUrl Dependency-Track server URL
 * @returns {string} API URL to submit BOM payload
 */
export function getDependencyTrackBomUrl(serverUrl: string): string;
/**
 * Build the payload for Dependency-Track BOM submission.
 *
 * @param {Object} args CLI/server arguments
 * @param {Object} bomContents BOM Json
 * @returns {Object | undefined} payload object if project coordinates are valid
 */
export function buildDependencyTrackBomPayload(args: Object, bomContents: Object): Object | undefined;
//# sourceMappingURL=dependency-track.d.ts.map