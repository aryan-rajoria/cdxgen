/**
 * Build a lowercase type/namespace/name lookup key for a purl.
 *
 * Falls back to a stripped, lowercased form of the raw string when the purl
 * cannot be parsed.
 *
 * @param {string} purl Package URL string
 * @returns {string|undefined} Normalized key, or undefined when the input is empty or not a string
 */
export declare function normalizeDosaiPurlKey(purl: string): string | undefined;
/**
 * Append a value to the Set stored under a key in a map, creating the Set when absent.
 *
 * @param {Object} map Map of key to Set of values, mutated in place
 * @param {string} key Map key (usually a purl)
 * @param {string} value Value to add; no-op when key or value is falsy
 * @returns {void}
 */
export declare function addDosaiSetValue(map: Object, key: string, value: string): void;
/**
 * Format a `file#line` location string from a dosai node or location item.
 *
 * @param {Object} item Dosai node, edge, or location object carrying Path/FileName and LineNumber fields
 * @returns {string|undefined} Location string with a `#line` suffix when available, or undefined when no file is known
 */
export declare function dosaiLocation(item: Object): string | undefined;
/**
 * Return a validated source location for .NET source extensions, from a call graph node.
 *
 * @param {Object} node Dosai call graph node object
 * @returns {string|undefined} Location string, or undefined unless the file is .cs/.vb/.fs/.fsx/.r with a positive line number
 */
export declare function dosaiSourceLocationFromNode(node: Object): string | undefined;
/**
 * Return a validated source location for .NET source extensions, from a location object.
 *
 * @param {Object} location Dosai location object carrying Path/FileName and LineNumber fields
 * @returns {string|undefined} Location string, or undefined unless the file is .cs/.vb/.fs/.fsx/.r with a positive line number
 */
export declare function dosaiSourceLocation(location: Object): string | undefined;
/**
 * Build a purl alias map from BOM components.
 *
 * Maps both exact component purls and normalized type/namespace/name keys to
 * the canonical component purl so dosai-reported purls can be reconciled.
 *
 * @param {Object[]} [components] Component objects with purl fields
 * @returns {Map<string, string>} Map of purl or normalized key to canonical component purl
 */
export declare function buildDosaiPurlAliasMap(components?: Object[]): Map<string, string>;
/**
 * Resolve a purl to the canonical component purl via the alias map.
 *
 * @param {string} purl Purl reported by dosai
 * @param {Map<string, string>} purlAliasMap Alias map built by buildDosaiPurlAliasMap
 * @returns {string|undefined} Canonical component purl, the input purl when unaliased, or undefined when empty
 */
export declare function resolveDosaiComponentPurl(purl: string, purlAliasMap: Map<string, string>): string | undefined;
//# sourceMappingURL=dosaiParsers.d.ts.map