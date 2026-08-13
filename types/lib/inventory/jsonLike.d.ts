/**
 * Strip line (`//`) and block comments from JSON-like text without altering
 * string literals.
 *
 * @param {string} raw Raw JSON-like text
 * @returns {string} Text with comments removed
 */
export declare function stripJsonComments(raw: string): string;
/**
 * Remove trailing commas before `}` or `]` without altering string literals.
 *
 * @param {string} raw Raw JSON-like text
 * @returns {string} Text with trailing commas removed
 */
export declare function stripJsonTrailingCommas(raw: string): string;
/**
 * Parse JSONC/JSON5-like text (comments and trailing commas allowed) into a value.
 *
 * @param {string} raw Raw JSON-like text
 * @returns {*} Parsed value; throws when the normalized text is not valid JSON
 */
export declare function parseJsonLike(raw: string): any;
//# sourceMappingURL=jsonLike.d.ts.map