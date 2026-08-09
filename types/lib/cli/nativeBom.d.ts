export declare function getCargoCacheDir(): any;
/**
 * Function to create bom string for Go projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object | undefined>} Promise resolving to a BOM object or `undefined`
 */
export declare function createGoBom(path: string, options: Object): Promise<Object | undefined>;
/**
 * Function to create bom string for Rust projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object|undefined>} Promise resolving to a BOM object or undefined
 */
export declare function createRustBom(path: string, options: Object): Promise<Object | undefined>;
export declare function buildCargoCacheComponent(crateFile: any): {
    "bom-ref": string;
    group: string;
    name: any;
    properties: {
        name: string;
        value: any;
    }[];
    purl: any;
    type: string;
    version: any;
} | undefined;
export declare function enrichCargoCacheComponent(crateFile: any, component: any): Promise<any>;
export declare function createCargoCacheBom(path: any, options: any): Promise<Object>;
/**
 * Function to create bom string for Dart projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createDartBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for cpp projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object} BOM object
 */
export declare function createCppBom(path: string, options: Object): Object;
/**
 * Function to create bom string for clojure projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object} BOM object
 */
export declare function createClojureBom(path: string, options: Object): Object;
/**
 * Function to create bom string for Haskell projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object} BOM object
 */
export declare function createHaskellBom(path: string, options: Object): Object;
/**
 * Function to create bom string for Elixir projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object} BOM object
 */
export declare function createElixirBom(path: string, options: Object): Object;
/**
 * Function to create bom string for swift projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createSwiftBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for cocoa projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object | undefined>} Promise resolving to a BOM object, or `undefined` when no Podfiles are found
 */
export declare function createCocoaBom(path: string, options: Object): Promise<Object | undefined>;
/**
 * Function to create bom string for Nix flakes
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createNixBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for Zig projects.
 *
 * Zig moved package management into the build system, so the dependency list
 * lives in `build.zig.zon` (ZON, not JSON). The resolver walks the full
 * dependency graph by locating each dependency's manifest through the in-tree
 * `zig-pkg/` directory or the global cache, producing both a flat component
 * list and a CycloneDX `dependencies[]` edge list.
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createZigBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for Gleam projects.
 *
 * Gleam resolves through Hex, so packages carry `pkg:hex/...` purls and no new
 * purl type is introduced. The `manifest.toml` lock is the source of truth for
 * resolved versions and the direct/transitive distinction; `gleam.toml` is the
 * manifest.
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createGleamBom(path: string, options: Object): Promise<Object>;
//# sourceMappingURL=nativeBom.d.ts.map