/**
 * Returns true if the identifier is a LicenseRef-/DocumentRef- style document
 * reference rather than an SPDX short identifier.
 *
 * @param {string} id Identifier
 * @returns {boolean}
 */
export declare function isLicenseRef(id: string): boolean;
/**
 * Normalizes a key by lowercasing and removing non-alphanumeric characters.
 * Matches the key normalization in data generation.
 *
 * @returns {string} Normalized lookup key
 */
export declare function normalizeKey(name: any): string;
/**
 * Performs fuzzy correction on a license ID using aliases and direct case-insensitive lookups.
 *
 * @param {string} id License ID to correct
 * @returns {string|null} Corrected ID or null if not found
 */
export declare function correctLicenseId(id: string): string | null;
/**
 * Tokenize a raw license expression string.
 *
 * @param {string} expr Expression
 * @returns {string[]} Tokens
 */
export declare function tokenize(expr: string): string[];
/**
 * Parses and validates an SPDX expression.
 *
 * @param {string} expr Raw expression string
 * @returns {object} Results: { valid: boolean, ast: object|null, unknown: string[] }
 */
export declare function parseSpdxExpression(expr: string): object;
/**
 * Renders an AST node back to a normalized string.
 *
 * @param {object} node AST Node
 * @returns {string} Normalized string
 */
export declare function renderAST(node: object): string;
/**
 * Canonicalizes operand casing in the AST based on reference data.
 *
 * @param {object} node AST Node
 * @returns {object} Canonicalized AST Node
 */
export declare function canonicalizeAST(node: object): object;
/**
 * Resolves deprecation replacements inside the AST recursively.
 *
 * @param {object} node AST Node
 * @returns {object} Upgraded AST Node
 */
export declare function upgradeDeprecatedAST(node: object): object;
//# sourceMappingURL=spdxExpression.d.ts.map