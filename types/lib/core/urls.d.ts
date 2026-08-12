/**
 * Host-aware URL predicates.
 *
 * Substring tests such as `url.includes("github.com")` also match hosts that
 * merely embed the name (`github.com.example.org`, `evil-github.com`) and
 * paths that mention it (`https://example.org/mirror/github.com/o/r`). The
 * helpers here parse the URL and compare the hostname, so a match means the
 * request really is destined for the named host.
 */
/**
 * Parses a URL, tolerating scheme-relative and scheme-less inputs commonly
 * found in package metadata.
 *
 * @param {String} url URL to parse
 * @returns {URL|undefined} Parsed URL or undefined when unparseable
 */
export declare function parseUrl(url: string): URL | undefined;
/**
 * Whether the url's host is the given host or one of its subdomains.
 *
 * @param {String} url URL to test
 * @param {String} host Bare host name, such as `github.com`
 * @returns {Boolean} True when the url targets that host
 */
export declare function urlHostMatches(url: string, host: string): boolean;
/**
 * Whether the url points at a github.com repository. Requires an explicit
 * scheme so that bare module paths are not mistaken for URLs.
 *
 * @param {String} url URL to test
 * @returns {Boolean} True for `https://github.com/owner/repo` style urls
 */
export declare function isGitHubUrl(url: string): boolean;
/**
 * Whether a slash-separated module path (a Go import path, for instance) is
 * rooted at the given host.
 *
 * @param {String} modulePath Module path such as `github.com/owner/repo`
 * @param {String} host Bare host name
 * @returns {Boolean} True when the first path segment is that host
 */
export declare function modulePathHost(modulePath: string, host: string): boolean;
//# sourceMappingURL=urls.d.ts.map