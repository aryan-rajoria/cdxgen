/**
 * R project parser for renv lock files.
 *
 * `renv.lock` records the R version, the repositories packages were resolved
 * from, and every package in the project library with its exact version, an
 * integrity hash, and the names of the packages it requires. The lock is a
 * JSON document, which makes it a reliable offline source of both the
 * resolved dependency set and the graph between packages.
 *
 * Packages are identified with the registered `cran` purl type
 * (`pkg:cran/<Package>@<Version>`). Requirement strings may carry version
 * constraints (`"R (>= 3.6)"`); only the leading package name is used, and
 * the R runtime itself is recorded as the parent's version rather than an
 * edge.
 */
/**
 * Parse an `renv.lock` file.
 *
 * @param {string} renvLockFile Path to `renv.lock`
 * @returns {{
 *   pkgList: object[],
 *   dependencies: object[],
 *   rootInputs: string[],
 *   parentComponent: object,
 *   rVersion: string|undefined
 * }}
 */
export declare function parseRenvLock(renvLockFile: string): {
    pkgList: object[];
    dependencies: object[];
    rootInputs: string[];
    parentComponent: object;
    rVersion: string | undefined;
};
//# sourceMappingURL=parsers-r.d.ts.map