/**
 * Retrieve the structure information of a .swift file in json format
 *
 * @param {String} filePath Path to .swift file
 *
 * @returns {undefined|Object} JSON representation of the swift file or undefined.
 */
export function getStructure(filePath: string): undefined | any;
/**
 * Parse the data from the structure command
 *
 * @param {Object} structureJson Json from the structure command
 * @returns {Object|undefined} Parsed value
 */
export function parseStructure(structureJson: any): any | undefined;
/**
 * Method to perform swift build in verbose mode.
 *
 * @param {String} basePath Path
 * @returns {undefined|String} Verbose build output
 */
export function verboseBuild(basePath: string): undefined | string;
/**
 * Method to parse the verbose swift build output to identify key compiler parameters.
 *
 * @param {String} buildOutput Verbose build output
 * @returns {Object} compiler build parameters
 */
export function extractCompilerParamsFromBuild(buildOutput: string): any;
/**
 * Method to index a swift file and extract metadata
 *
 * @param {String} filePath Path to .swift file
 * @param {String} compilerArgs Compiler arguments extracted from verbose build log
 * @returns {undefined|Object} metadata
 */
export function index(filePath: string, compilerArgs: string): undefined | any;
/**
 * Parse the data from the index command
 *
 * @param {Object} indexJson Json from the index command
 * @returns {Object|undefined} Parsed value
 */
export function parseIndex(indexJson: any): any | undefined;
/**
 * Method to execute dump-package package command.
 *
 * @param {String} basePath Path
 * @returns {undefined|Object} Output from dump-package command
 */
export function dumpPackage(basePath: string): undefined | any;
/**
 * Parse the data from dump-package command
 *
 * @param {Object} dumpJson Json from dump-package command
 * @returns {Object|undefined} Parsed value
 */
export function parseDumpPackage(dumpJson: any): any | undefined;
/**
 * Retrieve the module information of the swift project
 *
 * @param {String} moduleName Module name
 * @param {String} compilerArgs Compiler arguments extracted from verbose build log
 * @returns {undefined|Object} JSON representation of the swift module or undefined.
 */
export function moduleInfo(moduleName: string, compilerArgs: string): undefined | any;
/**
 * Parse the data from module-info command to replicate the swift interface
 *
 * @param {Object} moduleInfoJson Json from module-info command
 * @returns {Object|undefined} Parsed classes, protocols, enums and their functions
 */
export function parseModuleInfo(moduleInfoJson: any): any | undefined;
/**
 * Method to collect the build symbols from the output file maps generated by swift build.
 *
 * @param {String} basePath Path
 * @param {Object} options CLI options
 * @returns {Object} symbols map
 */
export function collectBuildSymbols(basePath: string, options: any): any;
/**
 * Method to parse output file map to identify the module and their symbols.
 * This list is imprecise when compared with the data from module-info command.
 *
 * @param filemap {String} File name
 * @returns {Object} parsed module metadata
 */
export function parseOutputFileMap(filemap: string): any;
/**
 * Create a precise semantics slices file for a swift project.
 *
 * @param basePath basePath Path
 * @param options options CLI options
 */
export function createSemanticsSlices(basePath: any, options: any): {
    packageMetadata: any;
    buildSymbols: any;
    moduleInfos: {};
    fileStructures: {};
    fileIndexes: {};
};
//# sourceMappingURL=swiftsem.d.ts.map