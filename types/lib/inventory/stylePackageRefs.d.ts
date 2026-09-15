/**
 * Patterns matching a package reference inside CSS/SCSS/Less/Stylus content.
 * Capture group 1 holds the reference (for example `bulma/sass/utilities`).
 *
 * @type {RegExp[]}
 */
export declare const STYLE_PACKAGE_REFERENCE_PATTERNS: RegExp[];
/**
 * True when a `url()` reference points at a package rather than a local file.
 * Only the `~package/...` and `node_modules/...` spellings qualify; plain
 * relative URLs stay local.
 *
 * @param {string} reference Value captured from a `url()` rule.
 * @returns {boolean}
 */
export declare const isPackageStyleUrlReference: (reference: string) => boolean;
//# sourceMappingURL=stylePackageRefs.d.ts.map