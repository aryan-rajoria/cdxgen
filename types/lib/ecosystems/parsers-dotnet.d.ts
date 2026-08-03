/**
 * Method to parse .nupkg files
 *
 * @param {String} nupkgFile .nupkg file
 * @returns {Object} Object containing package list and dependencies
 */
export declare function parseNupkg(nupkgFile: string): Object;
/**
 * Method to parse .nuspec files
 *
 * @param {String} nupkgFile .nupkg file
 * @param {String} nuspecData Raw nuspec data
 * @returns {Object} Object containing package list and dependencies
 */
export declare function parseNuspecData(nupkgFile: string, nuspecData: string): Object;
/**
 * Parse a C# packages.config XML file and return a list of NuGet package components.
 *
 * @param {string} pkgData Raw XML string of a packages.config file
 * @param {string} pkgFile Path to the packages.config file, used for evidence properties
 * @param {Object} pkgNameVersions Package name - version map of versions already resolved
 *        from more precise manifests (project.assets.json / packages.lock.json), used to
 *        backfill templated or missing versions
 * @returns {Object[]} Array of NuGet package objects with purl, name, and version
 */
export declare function parseCsPkgData(pkgData: string, pkgFile: string, pkgNameVersions?: Object): Object[];
/**
 * Parse a Directory.Packages.props file and return the package versions it declares
 * centrally via NuGet Central Package Management.
 *
 * @param {String} propsFile Path to a Directory.Packages.props file
 *
 * @returns {Object} Map of lowercased package id to version. NuGet package ids are
 *          case-insensitive, so callers must lowercase before looking up.
 */
export declare function parseDirectoryPackagesProps(propsFile: string): Object;
/**
 * Method to collect the versions declared by NuGet Central Package Management for a
 * given project file, by walking up to the nearest Directory.Packages.props.
 *
 * MSBuild imports the first Directory.Packages.props found while walking up from the
 * project directory, and that file is often at the repository root - above the
 * directory cdxgen was invoked with. The walk therefore deliberately continues past
 * the scan root rather than stopping at it.
 *
 * @param {String} projFile Path to a .csproj like project file
 * @param {Object} cache Optional per-scan cache keyed by props file path, so that a
 *        repository with many projects parses each props file once
 *
 * @returns {Object} Map of lowercased package id to version. Empty when the project
 *          does not use central package management.
 */
export declare function getCentralPackageVersions(projFile: string, cache?: Object): Object;
/**
 * Method to find all text nodes in PropertyGroup elements in .props files.
 *
 * @param {String} propsFiles .props files in this project
 *
 * @returns {Object} Containing text nodes from PropertyGroup elements and their values
 */
export declare function getPropertyGroupTextNodes(propsFiles: string): Object;
/**
 * Method to parse .csproj like xml files
 *
 * @param {String} csProjData Raw data
 * @param {String} projFile File name
 * @param {Object} pkgNameVersions Package name - version map object
 * @param {Boolean} msbuildInstalled Whether msbuild is available to resolve properties
 * @param {Object} pkgVersionLabelCandidates Candidate values for msbuild version properties
 * @param {Object} centralVersions Versions declared centrally in Directory.Packages.props,
 *        keyed by lowercased package id. See {@link getCentralPackageVersions}.
 *
 * @returns {Object} Containing parent component, package, and dependencies
 */
export declare function parseCsProjData(csProjData: string, projFile: string, pkgNameVersions?: Object, msbuildInstalled?: boolean, pkgVersionLabelCandidates?: Object, centralVersions?: Object): Object;
/**
 * Parse a .NET project.assets.json file and return the package list and dependency tree.
 *
 * Extracts NuGet packages and their transitive dependency relationships from the
 * `libraries` and `targets` sections of a project.assets.json file produced by
 * the .NET restore process.
 *
 * @param {string} csProjData Raw JSON string of the project.assets.json file
 * @param {string} assetsJsonFile Path to the project.assets.json file, used for evidence properties
 * @returns {{ pkgList: Object[], dependenciesList: Object[] }}
 */
export declare function parseCsProjAssetsData(csProjData: string, assetsJsonFile: string): {
    pkgList: Object[];
    dependenciesList: Object[];
};
/**
 * Parse a .NET packages.lock.json file and return the package list, dependency tree,
 * and list of direct/root dependencies.
 *
 * @param {string} csLockData Raw JSON string of the packages.lock.json file
 * @param {string} pkgLockFile Path to the packages.lock.json file, used for evidence properties
 * @returns {{ pkgList: Object[], dependenciesList: Object[], rootList: Object[] }}
 */
export declare function parseCsPkgLockData(csLockData: string, pkgLockFile: string): {
    pkgList: Object[];
    dependenciesList: Object[];
    rootList: Object[];
};
/**
 * Parse a Paket dependency manager lock file (paket.lock) and return the package list
 * and dependency tree.
 *
 * @param {string} paketLockData Raw text contents of the paket.lock file
 * @param {string} pkgLockFile Path to the paket.lock file, used for evidence properties
 * @returns {{ pkgList: Object[], dependenciesList: Object[] }}
 */
export declare function parsePaketLockData(paketLockData: string, pkgLockFile: string): {
    pkgList: Object[];
    dependenciesList: Object[];
};
//# sourceMappingURL=parsers-dotnet.d.ts.map