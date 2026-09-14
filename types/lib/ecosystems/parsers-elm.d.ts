/**
 * Parse an Elm project from its 0.19 `elm.json`.
 *
 * @param {string} elmJsonFile Path to `elm.json`
 * @param {object} [cacheReader] Reader returned by {@link createElmCacheReader};
 *   when omitted, one is derived from the manifest's pinned compiler version
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs: string[] }}
 */
export declare function parseElmProject(elmJsonFile: string, cacheReader?: object): {
    pkgList: object[];
    dependencies: object[];
    parentComponent: object;
    rootInputs: string[];
};
/**
 * Parse a legacy 0.18 Elm project from `elm-package.json` and its optional
 * `elm-stuff/exact-dependencies.json` lock file.
 *
 * @param {string} elmPackageJsonFile Path to `elm-package.json`
 * @param {string} [exactDepsFile] Path to the lock file, if present
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs: string[] }}
 */
export declare function parseLegacyElmProject(elmPackageJsonFile: string, exactDepsFile?: string): {
    pkgList: object[];
    dependencies: object[];
    parentComponent: object;
    rootInputs: string[];
};
/**
 * Tell whether a candidate `elm.json` really is an Elm manifest. The file
 * name is distinctive but lives in every Elm project, so detection only
 * needs a cheap content check before dispatching.
 *
 * @param {string} filePath Path to the candidate `elm.json`
 * @returns {boolean} true when the file declares an Elm project
 */
export declare function isElmProjectFile(filePath: string): boolean;
/**
 * Create a reader for the local Elm package cache. Reads are memoised and
 * silently disabled when the cache directory does not exist.
 *
 * @param {string} [elmVersionHint] Exact compiler version directory to try
 *   first, when the project pins one
 * @returns {{ readMetadata: (name: string, version: string) => object|null, listVersions: (name: string) => string[] }}
 */
export declare function createElmCacheReader(elmVersionHint?: string): {
    readMetadata: (name: string, version: string) => object | null;
    listVersions: (name: string) => string[];
};
/**
 * Whether the registry's `robots.txt` permits fetching a package's documents.
 *
 * @param {string} name Package name, `author/project`
 * @returns {boolean} true when no `Disallow` rule covers the package
 */
export declare function isRegistryCrawlable(name: string): boolean;
/**
 * Enrich Elm components from the package registry.
 *
 * Only the gaps left by the local cache are fetched, and only for packages
 * with a resolved version that `robots.txt` permits. Two documents are read
 * per package, both of which the compiler itself reads when it installs one:
 *
 *   - `elm.json` — the published manifest, carrying the summary, the license
 *     and the package's own dependencies, which close the gaps in the
 *     dependency graph that an unpopulated cache leaves behind.
 *   - `endpoint.json` — the source archive URL and the SHA-1 of its bytes,
 *     which the compiler verifies after downloading. It becomes the
 *     component's distribution reference and hash.
 *
 * Requests carry cdxgen's contact user-agent and pass through the shared
 * per-host rate policy for `package.elm-lang.org` (see `fetchRate.js`).
 *
 * @param {object[]} pkgList Components to enrich, mutated in place
 * @param {object[]} [dependencies] Dependency edges to complete in place
 * @returns {Promise<object[]>} The same package list
 */
export declare function getElmMetadata(pkgList: object[], dependencies?: object[]): Promise<object[]>;
//# sourceMappingURL=parsers-elm.d.ts.map