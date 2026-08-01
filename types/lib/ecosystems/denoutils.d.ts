/**
 * Remove JSONC (JSON-with-comments) noise from a source string so it can be
 * parsed with `JSON.parse`. Handles `//` line comments, `/* block *​/`
 * comments and trailing commas, while leaving string literals untouched.
 *
 * Implemented as a small single-pass scanner rather than a regex, per the
 * cdxgen convention of avoiding hard-to-review/exponential regexes for
 * untrusted input.
 *
 * @param {string} text Raw JSONC source.
 * @returns {string} Plain JSON text.
 */
export declare function stripJsonc(text: string): string;
/**
 * Parse a JSON or JSONC file (deno.json or deno.jsonc) into a plain object.
 *
 * @param {string} jsonFile Path to the deno.json(c) file.
 * @returns {Object|undefined} Parsed config, or undefined on failure.
 */
export declare function parseDenoJsonFile(jsonFile: string): Object | undefined;
/**
 * Locate the deno.json or deno.jsonc manifest for a given directory.
 *
 * @param {string} dir Directory to search.
 * @returns {string|undefined} Path to the manifest, if present.
 */
export declare function findDenoJson(dir: string): string | undefined;
/**
 * Fetch license, description and repository metadata for jsr components from
 * jsr's metadata API (api.jsr.io). jsr's npm mirror does not expose license
 * data, so this is the authoritative source for it.
 *
 * @param {Array} pkgList jsr components (identified by `cdx:deno:jsrKey`).
 * @returns {Promise<Array>} The same component list.
 */
export declare function getJsrMetadata(pkgList: any[]): Promise<any[]>;
/**
 * Parse a deno.lock file (versions 2 through 5) and return the package list
 * and dependency graph in the same shape as the other lockfile parsers.
 *
 * Lock version summary:
 *  - v5 (Deno >= 2.x, current): flat top-level `specifiers`, `jsr`, `npm` and
 *    optional `remote` maps. jsr entries list their own jsr dependencies; npm
 *    entries only carry an integrity hash and DO NOT list their own transitive
 *    npm dependencies (see the limitation note below).
 *  - v2/v3/v4: `npm.specifiers` + `npm.packages` (packages carry a
 *    `dependencies` map of `name` -> `name@version`), optional `jsr` map and
 *    `remote` map.
 *
 * purl mapping:
 *  - `jsr:@scope/name@ver` -> `pkg:npm/@jsr/scope__name@ver` (see
 *    `JSR_NPM_SCOPE` doc comment for the rationale).
 *  - `npm:name@ver` -> `pkg:npm/name@ver` with the sha512 integrity as
 *    `_integrity`.
 *  - `https://...` remote imports -> `pkg:generic/<basename>` with a
 *    `download_url` external reference.
 *
 * v5 npm-transitive limitation: in v5 lockfiles the `npm` map is flat and each
 * npm entry contains only an integrity hash, never a dependencies list. As a
 * result the CycloneDX dependency graph for npm packages under v5 is shallow
 * (only the parent component -> direct npm deps). Resolving the full npm
 * transitive graph would require hitting the npm registry or the deno
 * `node_modules` cache, which cdxgen intentionally does not do by default.
 *
 * @param {string} lockFile Path to the deno.lock file.
 * @param {Object} [options] Parsing options (`parentComponent`, `projectRoot`).
 * @returns {Promise<{pkgList: Array, dependenciesList: Array}>} Parsed
 *   packages and dependency graph.
 */
export declare function parseDenoLock(lockFile: string, options?: Object): Promise<{
    pkgList: any[];
    dependenciesList: any[];
}>;
//# sourceMappingURL=denoutils.d.ts.map