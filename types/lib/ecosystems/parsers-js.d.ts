export declare function parsePkgJson(pkgJsonFile: any, simple?: boolean, securityProps?: boolean): Promise<any[]>;
/**
 * Parse nodejs package lock file
 *
 * @param {string} pkgLockFile package-lock.json file
 * @param {object} options Command line options
 */
export declare function parsePkgLock(pkgLockFile: string, options?: object): Promise<{
    pkgList: any;
    dependenciesList: any;
}>;
/**
 * Given a lock file this method would return an Object with the identity as the key and parsed name and value
 * eg: "@actions/core@^1.2.6", "@actions/core@^1.6.0":
 *        version "1.6.0"
 * would result in two entries
 *
 * @param {string} lockData Yarn Lockfile data
 */
export declare function yarnLockToIdentMap(lockData: string): {};
/**
 * Parse nodejs yarn lock file
 *
 * @param {string} yarnLockFile yarn.lock file
 * @param {Object} parentComponent parent component
 * @param {Array[String]} workspacePackages Workspace packages
 * @param {Object} workspaceSrcFiles Workspace package.json files
 * @param {Object} _workspaceDirectDeps Direct dependencies of each workspace
 * @param {Object} depsWorkspaceRefs Workspace references for each dependency
 */
export declare function parseYarnLock(yarnLockFile: string, parentComponent?: Object, workspacePackages?: any, workspaceSrcFiles?: Object, _workspaceDirectDeps?: Object, depsWorkspaceRefs?: Object): Promise<{
    pkgList: any[];
    dependenciesList: any[];
}>;
/**
 * Parse nodejs shrinkwrap deps file
 *
 * @param {string} swFile shrinkwrap-deps.json file
 */
export declare function parseNodeShrinkwrap(swFile: string): Promise<any[]>;
/**
 * Strip the peer-dependency resolution that pnpm encodes into a version string.
 *
 * pnpm 5 and below append it after an underscore, either as a peer spec or as a hash
 * of one, while 6 and above wrap it in parentheses:
 *
 *   7.26.0_typescript@6.0.2
 *   2.3.3_5b3b7d3a75edb27abc53579646941536
 *   3.0.1(ajv@8.14.0)
 *
 * An npm version can contain neither an underscore nor a parenthesis, so both are
 * unambiguous separators. The suffix must not survive into a version or a purl: no
 * SCA tool can match `2.3.3_5b3b7d...` against an advisory, so a component carrying
 * one is effectively invisible to vulnerability lookups.
 *
 * @param {String} version Version string from a pnpm lock file
 *
 * @returns {String} The published version, without the peer-resolution suffix
 */
export declare function stripPnpmPeerSuffix(version: string): string;
export declare function getVersionNumPnpm(depPkg: any, relativePath: any): Promise<any>;
/**
 * Resolve a pnpm dependency to its PURL string.
 *
 * Moved here from npmutils.js to break the npmutils ↔ parsers-js cycle.
 * Only callers are in this file.
 *
 * @param {string|object} depPkg Dependency package version or object
 * @param {string} packageName Package name
 * @param {object} gitPkgRefs Git package refs map
 * @param {string} relativePath Relative path for resolution
 * @param {string} githubServerHost GitHub server host
 * @param {object} [npmrcConfig={}] npmrc configuration
 * @returns {Promise<string>} Decoded PURL string
 */
export declare function getPnpmDepPurl(depPkg: string | object, packageName: string, gitPkgRefs: object, relativePath: string, githubServerHost: string, npmrcConfig?: object): Promise<string>;
/**
 * Parse pnpm workspace file
 *
 * @param {string} workspaceFile pnpm-workspace.yaml
 * @returns {object} Object containing packages and catalogs
 */
export declare function parsePnpmWorkspace(workspaceFile: string): object;
/**
 * Parses the workspaces field from a package.json file and returns the list of
 * workspace glob patterns. Handles both array and object (with packages key) formats.
 *
 * @param {string} packageJsonFile Path to the package.json file to parse
 * @returns {Object} Object with a packages array of workspace glob patterns, or an empty object on error
 */
export declare function parseYarnWorkspace(packageJsonFile: string): Object;
/**
 * Helper function to find a package path in pnpm node_modules structure
 *
 * @param {string} baseDir Base directory containing node_modules
 * @param {string} packageName Package name (with or without scope)
 * @param {string} version Package version
 * @returns {string|null} Path to the package directory or null if not found
 */
export declare function findPnpmPackagePath(baseDir: string, packageName: string, version: string): string | null;
/**
 * pnpm packages with metadata from local node_modules
 *
 * @param {Array} pkgList Package list to enhance
 * @param {string} lockFilePath Path to the pnpm-lock.yaml file
 * @returns {Array} Enhanced package list
 */
export declare function pnpmMetadata(pkgList: any[], lockFilePath: string): any[];
/**
 * Resolve a pnpm dependency value that is an alias pointing at another lock entry
 * rather than a plain version.
 *
 * pnpm writes such a value in the same shape as its package keys, and that shape
 * changed between lockfile versions:
 *
 *   v5 and below: /@wdio/utils/7.26.0_typescript@6.0.2, /string-width/4.2.3
 *   v6 and above: /@wdio/utils@7.26.0, string-width@4.2.3
 *
 * The version is returned verbatim, peer-dependency suffix included, because that
 * is how the aliased package's own lock key is turned into a version elsewhere in
 * parsePnpmLock - stripping it here would leave the dependency ref pointing at a
 * component that does not exist.
 *
 * @param {String} value Raw dependency value from the lock file
 *
 * @returns {Object|undefined} `{name, version}`, or undefined when the value is a
 *          plain version and not an alias
 */
export declare function parsePnpmAliasRef(value: string): Object | undefined;
/**
 * Parse nodejs pnpm lock file
 *
 * @param {string} pnpmLock pnpm-lock.yaml file
 * @param {Object} parentComponent parent component
 * @param {Array[String]} workspacePackages Workspace packages
 * @param {Object} workspaceSrcFiles Workspace package.json files
 * @param {Object} _workspaceCatalogs Workspace catalogs
 * @param {Object} _workspaceDirectDeps Direct dependencies of each workspace
 * @param {Object} depsWorkspaceRefs Workspace references for each dependency
 * @param {string} projectRoot Root path used to relativize pnpm-lock evidence paths
 */
export declare function parsePnpmLock(pnpmLock: string, parentComponent?: Object, workspacePackages?: any, workspaceSrcFiles?: Object, _workspaceCatalogs?: Object, _workspaceDirectDeps?: Object, depsWorkspaceRefs?: Object, projectRoot?: string): Promise<{
    pkgList?: undefined;
    dependenciesList?: undefined;
    parentSubComponents?: undefined;
} | {
    pkgList: any[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
    parentSubComponents: {
        group: any;
        name: any;
        version: any;
        type: string;
        purl: any;
        "bom-ref": string;
    }[];
}>;
/**
 * Parse bower json file
 *
 * @param {string} bowerJsonFile bower.json file
 */
export declare function parseBowerJson(bowerJsonFile: string): Promise<any[]>;
/**
 * Parse minified js file
 *
 * @param {string} minJsFile min.js file
 */
export declare function parseMinJs(minJsFile: string): Promise<any[]>;
/**
 * Parse a package.json `name` field (or a plain string) and extract its scope,
 * full name, project name, and module name components.
 *
 * @param {string|Object} name The package name string or an object with a `name` property
 * @returns {{ scope: string|null, fullName: string, projectName: string|null, moduleName: string|null }}
 */
export declare function parsePackageJsonName(name: string | Object): {
    scope: string | null;
    fullName: string;
    projectName: string | null;
    moduleName: string | null;
};
/**
 * Helper to split a command line string into an array of arguments,
 * respecting single and double quotes.
 *
 * @param {String} commandString The full command line string
 * @returns {Array<String>} Array of tokens
 */
export declare function splitCommandArgs(commandString: string): Array<string>;
//# sourceMappingURL=parsers-js.d.ts.map