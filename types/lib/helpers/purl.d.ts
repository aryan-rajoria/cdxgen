import { PackageURL } from "packageurl-js";
/**
 * Encode a string for safe inclusion in a PackageURL, percent-encoding special characters
 * while preserving already-encoded `%40` sequences and keeping `:` and `/` unencoded.
 *
 * @param {string} s String to encode
 * @returns {string} Encoded string suitable for use in a PackageURL component
 */
export declare function encodeForPurl(s: string): string;
/**
 * Create a PackageURL object from a repository URL string, package type, and version.
 *
 * Supports HTTPS URLs, SSH `git@` URLs, Bitbucket SSH URLs, and local paths.
 * Extracts the namespace (host + path prefix) and repository name from the URL.
 *
 * @param {string} type PackageURL type (e.g. `"swift"`, `"generic"`)
 * @param {string} repoUrl Repository URL string
 * @param {string} version Package version
 * @returns {PackageURL|undefined} PackageURL object, or undefined for unsupported URL formats
 */
export declare function purlFromUrlString(type: string, repoUrl: string, version: string): PackageURL | undefined;
/**
 * NOT IMPLEMENTED YET.
 * A future method to locate a generic package given some name and properties
 *
 * @param {object} apkg Package to locate
 * @returns Located project with precise purl or the original unmodified input.
 */
export declare function locateGenericPackage(apkg: object): object;
export declare function mapConanPkgRefToPurlStringAndNameAndVersion(conanPkgRef: any): (string | null)[];
//# sourceMappingURL=purl.d.ts.map