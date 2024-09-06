/**
 * Method to prepare the build environment for BOM generation purposes.
 *
 * @param {String} filePath Path
 * @param {Object} options CLI options
 */
export function prepareEnv(filePath: string, options: any): void;
/**
 * Method to prepare sdkman build environment for BOM generation purposes.
 *
 * @param {String} projectType Project type
 */
export function prepareSdkmanBuild(projectType: string): boolean;
/**
 * Method to check and prepare the environment for python
 *
 * @param {String} filePath Path
 * @param {Object} options CLI Options
 */
export function preparePythonEnv(filePath: string, options: any): void;
/**
 * Method to check and prepare the environment for node
 *
 * @param {String} filePath Path
 * @param {Object} options CLI Options
 */
export function prepareNodeEnv(filePath: string, options: any): void;
/**
 * If NVM_DIR is in path, however nvm command is not loaded.
 * it is possible that required nodeVersion is not installed.
 * This function loads nvm and install the nodeVersion
 *
 * @param {String} nodeVersion required version number
 *
 * @returns {Boolean} true if successful, otherwise false
 */
export function tryLoadNvmAndInstallTool(nodeVersion: string): boolean;
/**
 * This method installs and create package-lock.json
 *
 * @param {String} filePath Path
 * @param {String} nvmNodePath Path to node version in nvm
 */
export function doNpmInstall(filePath: string, nvmNodePath: string): void;
//# sourceMappingURL=pregen.d.ts.map