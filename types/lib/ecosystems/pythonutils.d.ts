/**
 * Universal virtual environment metadata detector
 * @param {Object} env - Environment variables (defaults to process.env)
 * @param {string} [explicitPath] - Optional explicit venv path to inspect
 * @returns {Object} Structured environment metadata
 */
export declare function getVenvMetadata(env?: Object, explicitPath?: string): Object;
/**
 * Determines the appropriate Python executable path from a virtual environment.
 * Inspects the virtual environment metadata to detect the Python type (system,
 * conda, pyenv, etc.) and returns the most specific executable found, falling
 * back to the global `PYTHON_CMD` constant when no executable is detected.
 *
 * @param {string} env Path to the Python virtual environment directory
 * @returns {string} Path to the Python executable or the fallback command name
 */
export declare function get_python_command_from_env(env: string): string;
/**
 * Method to find python modules by parsing the imports and then checking with PyPI to obtain the latest version
 *
 * @param {string} src directory
 * @param {Array} epkgList Existing package list
 * @param {Object} options CLI options
 * @returns List of packages
 */
export declare function getPyModules(src: string, epkgList: any[], options: Object): Promise<{
    allImports: {};
    pkgList: any;
    dependenciesList: {
        ref: string;
        dependsOn: never[];
    }[];
    modList: any;
}>;
/**
 * Create uv.lock file with uv sync command.
 *
 * @param {string} basePath Path
 * @param {Object} options CLI options
 */
export declare function createUVLock(basePath: string, options: Object): void;
/**
 * Execute pip freeze by creating a virtual env in a temp directory and construct the dependency tree
 *
 * @param {string} basePath Base path
 * @param {string} reqOrSetupFile Requirements or setup.py file
 * @param {string} tempVenvDir Temp venv dir
 * @param {Object} parentComponent Parent component
 *
 * @returns {Object} List of packages from the virtual env
 */
export declare function getPipFrozenTree(basePath: string, reqOrSetupFile: string, tempVenvDir: string, parentComponent: Object, projectRoot: any, getTreeWithPluginFn: any): Object;
export declare function getPipTreeForPackages(basePath: any, pkgList: any, tempVenvDir: any, parentComponent: any, getTreeWithPluginFn: any): {
    failedPkgList?: undefined;
    rootList?: undefined;
    dependenciesList?: undefined;
} | {
    failedPkgList: any[];
    rootList: {
        name: any;
        version: any;
        purl: any;
        "bom-ref": string;
    }[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
};
//# sourceMappingURL=pythonutils.d.ts.map