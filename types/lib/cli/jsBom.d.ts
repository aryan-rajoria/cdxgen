export declare function getDirectAiInventoryType(path: any, options: any): string | undefined;
export declare function createNodejsBom(path: any, options: any): Promise<Object>;
export declare const WASM_IMPORT_PATTERN: RegExp;
/**
 * Adds generic wasm components from discovered source imports.
 *
 * @param {Array<Object>} pkgList Node.js package list
 * @param {Object} allImports analyzer imports map
 * @returns {Array<Object>} pkgList enriched with wasm components
 */
export declare const addWasmComponentsFromImports: (pkgList: Array<Object>, allImports: Object) => Array<Object>;
/**
 * Function to create bom string for caxa SEA binaries
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createCaxaBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create BOM for VS Code / IDE extensions.
 * Supports two modes:
 * 1. Directory scan: Discovers `.vsix` files and installed extension directories
 * 2. IDE discovery: Automatically finds extensions installed by known IDEs
 *
 * @param {string} path to the project or directory to scan
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createVscodeExtensionBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create BOM for Electron ASAR archives.
 *
 * @param {string} path to a single archive or a directory to scan
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createAsarBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create BOM for installed Chrome and Chromium-based browser extensions.
 *
 * @param {string} path to the project path or a directly provided extension path
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createChromeExtensionBom(path: string, options: Object): Promise<Object>;
/**
 * Analyze an extracted extension directory for bundled dependencies.
 * Looks for npm lock files, node_modules, package.json files, minified JS,
 * and runs the babel-based analyzer on the source.
 *
 * @param {string} extDir Path to the extracted extension directory
 * @param {Object} options CLI options
 * @returns {Promise<{pkgList: Object[], dependencies: Object[]}>}
 */
export declare function analyzeExtensionDir(extDir: string, options: Object): Promise<{
    pkgList: Object[];
    dependencies: Object[];
}>;
/**
 * Run deep analysis on installed extension subdirectories within a parent
 * extensions directory. Each subdirectory represents an installed extension.
 *
 * @param {string} extensionsDir Parent directory containing extension subdirs
 * @param {Object} options CLI options
 * @param {Object[]} pkgList Mutable array to push discovered components into
 * @param {Object[]} dependencies Mutable array to merge dependencies into
 */
export declare function analyzeInstalledExtensionDirs(extensionsDir: string, options: Object, pkgList: Object[], dependencies: Object[]): Promise<void>;
//# sourceMappingURL=jsBom.d.ts.map