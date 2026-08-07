/**
 * Decode named (`&amp;`) and numeric (`&#39;` / `&#x27;`) HTML entities.
 * Unrecognised sequences are returned verbatim so licence text is never mangled.
 *
 * @param {string} str Text that may contain entity references.
 * @returns {string} Decoded text.
 */
export declare function decodeEntities(str: string): string;
/**
 * Extract licence text from a pkg.go.dev page, reproducing the observable
 * result of cheerio's `$("#LICENSE > h2").text()` with a fallback to
 * `$("section.License > h2").text()`. Returns the trimmed concatenation of every
 * matching heading's text in document order. `#LICENSE` is retained for
 * backward compatibility with older markup even though current pages emit
 * `<section class="License">`.
 *
 * @param {string} html Raw pkg.go.dev HTML.
 * @returns {string} Trimmed licence text, or "" when no selector matches.
 */
export declare function extractLicenseText(html: string): string;
/**
 * Extract the repository URL from a pkg.go.dev page, reproducing
 * `$("div.UnitMeta-repo").children("a").attr("href")`. Returns the decoded
 * `href` of the first direct anchor inside the first matching div, or
 * `undefined` when the container or anchor is absent.
 *
 * @param {string} html Raw pkg.go.dev HTML.
 * @returns {string|undefined}
 */
export declare function extractRepoUrl(html: string): string | undefined;
//# sourceMappingURL=htmlExtract.d.ts.map