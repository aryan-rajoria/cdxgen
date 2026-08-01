/**
 * Builds a Go package component object containing purl, bom-ref, integrity hash,
 * and optionally license and VCS external reference information.
 *
 * @param {string} group Package group (module path prefix, may be empty)
 * @param {string} name Package name (full module path when group is empty)
 * @param {string} version Package version string
 * @param {string} hash Integrity hash (e.g. "sha256-…"), used as _integrity
 * @returns {Promise<Object>} Component object ready for inclusion in a BOM package list
 */
export declare function getGoPkgComponent(group: string, name: string, version: string, hash: string): Promise<Object>;
/**
 * Method to parse go.mod files
 *
 * @param {String} goModData Contents of go.mod file
 * @param {Object} gosumMap Data from go.sum files
 *
 * @returns {Object} Object containing parent component, rootList and packages list
 */
export declare function parseGoModData(goModData: string, gosumMap: Object): Object;
/**
 * Parses a Go modules text file (e.g. vendor/modules.txt) and returns a list of
 * Go package components. Cross-references the go.sum map for integrity hashes and
 * sets scope and confidence based on hash availability.
 *
 * @param {string} txtFile Path to the modules.txt file
 * @param {Object} gosumMap Map of "module@version" keys to sha256 hash values from go.sum
 * @returns {Promise<Object[]>} List of Go package component objects with evidence
 */
export declare function parseGoModulesTxt(txtFile: string, gosumMap: Object): Promise<Object[]>;
/**
 * Parse go list output
 *
 * @param {string} rawOutput Output from go list invocation
 * @param {Object} gosumMap go.sum data
 * @returns Object with parent component and List of packages
 */
export declare function parseGoListDep(rawOutput: string, gosumMap: Object): Promise<{
    parentComponent: {};
    pkgList: Object[];
}>;
/**
 * Parse go mod graph
 *
 * @param {string} rawOutput Output from go mod graph invocation
 * @param {string} goModFile go.mod file
 * @param {Object} gosumMap Hashes from gosum for lookups
 * @param {Array} epkgList Existing package list
 * @param {Object} parentComponent Current parent component
 *
 * @returns Object containing List of packages and dependencies
 */
export declare function parseGoModGraph(rawOutput: string, goModFile: string, gosumMap: Object, epkgList?: any[], parentComponent?: Object): Promise<{
    pkgList: any[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
    parentComponent: any;
    rootList: any;
}>;
/**
 * Parse go mod why output.
 *
 * @param {string} rawOutput Output from go mod why
 * @returns {string|undefined} package name or none
 */
export declare function parseGoModWhy(rawOutput: string): string | undefined;
/**
 * Parse go sum data
 * @param {string} gosumData Content of go.sum
 * @returns package list
 */
export declare function parseGosumData(gosumData: string): Promise<any[]>;
/**
 * Parses the contents of a Gopkg.lock or Gopkg.toml file (dep tool format) and
 * returns a list of Go package components. Optionally fetches license information
 * for each package when FETCH_LICENSE is enabled.
 *
 * @param {string} gopkgData Raw string contents of the Gopkg lock/toml file
 * @returns {Promise<Object[]>} List of Go package component objects
 */
export declare function parseGopkgData(gopkgData: string): Promise<Object[]>;
/**
 * Parses the output of `go version -m` (build info) and returns a list of Go
 * package components for each "dep" line, including name, version, and integrity hash.
 *
 * @param {string} buildInfoData Raw string output from `go version -m`
 * @returns {Promise<Object[]>} List of Go package component objects
 */
export declare function parseGoVersionData(buildInfoData: string): Promise<Object[]>;
//# sourceMappingURL=parsers-go.d.ts.map