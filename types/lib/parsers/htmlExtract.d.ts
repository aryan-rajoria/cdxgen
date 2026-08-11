/**
 * Decode named (`&amp;`) and numeric (`&#39;` / `&#x27;`) HTML entities.
 * Unrecognised sequences are returned verbatim so licence text is never mangled.
 *
 * @param {string} str Text that may contain entity references.
 * @returns {string} Decoded text.
 */
export declare function decodeEntities(str: string): string;
/**
 * Extract the licence heading from a pkg.go.dev page.
 *
 * Current markup puts the licence in `<section class="License"><h2>`, and
 * several licences arrive as one comma-separated heading — `Apache-2.0, MIT`
 * for gopkg.in/yaml.v3 — which the caller splits on ", ". Older markup used a
 * container with `id="LICENSE"`; that path is tried first and costs one scan.
 *
 * Should a page ever carry several licence sections, their headings are joined
 * with ", " so they split into separate licences rather than fusing into one
 * nonsense identifier.
 *
 * @param {string} html Raw pkg.go.dev HTML.
 * @returns {string} Trimmed licence text, or "" when nothing matches.
 */
export declare function extractLicenseText(html: string): string;
/**
 * Extract the repository URL from a pkg.go.dev page: the decoded `href` of the
 * first direct anchor inside `div.UnitMeta-repo`. Anchors nested deeper in the
 * container are links to other things, so only a direct child counts.
 *
 * @param {string} html Raw pkg.go.dev HTML.
 * @returns {string|undefined}
 */
export declare function extractRepoUrl(html: string): string | undefined;
//# sourceMappingURL=htmlExtract.d.ts.map