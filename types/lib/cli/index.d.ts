export { summarizeAiInventory } from "../inventory/aiInventory.js";
export { createAndroidBom, createBinaryBom, dedupeBom, listComponents, } from "./bomAssembly.js";
export { createAsarBom, createCaxaBom, createChromeExtensionBom, createNodejsBom, createVscodeExtensionBom, } from "./jsBom.js";
export { createJarBom, createJavaBom } from "./jvmBom.js";
export { createCloudBuildBom, createCryptoCertsBom, createCsharpBom, createGitHubBom, createHelmBom, createJenkinsBom, createPHPBom, createPixiBom, createPythonBom, createRubyBom, } from "./managedBom.js";
export { createClojureBom, createCocoaBom, createCppBom, createDartBom, createElixirBom, createGleamBom, createGoBom, createHaskellBom, createNixBom, createRustBom, createSwiftBom, createZigBom, } from "./nativeBom.js";
/**
 * Function to create obom string for the current OS using osquery
 *
 * @param {string} _path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createOSBom(_path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for docker compose
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createContainerSpecLikeBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for all languages
 *
 * @param {string[]} pathList list of to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createMultiXBom(pathList: string[], options: Object): Promise<Object>;
/**
 * Function to create a dynamic SBOM by executing a command and tracing the
 * shared libraries it loads at runtime via instrumentation.
 *
 * Components receive scope=required, evidence.identity[].methods[].technique=
 * instrumentation, and confidence 0.8 (version known) or 0.5 (version unknown).
 *
 * @param {string} path - Target path (used as working directory fallback)
 * @param {Object} options - CLI options; must include options.traceCmd
 * @returns {Promise<Object>} Promise resolving to BOM data object
 */
export declare function createDynamicBom(path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for various languages
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object|undefined>} Promise resolving to BOM object, or undefined if path is not readable
 */
export declare function createXBom(path: string, options: Object): Promise<Object | undefined>;
/**
 * Function to create a hardware BOM for the current host.
 *
 * @param {string} _path Source path (unused for live host HBOM generation)
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createHBom(_path: string, options: Object): Promise<Object>;
/**
 * Function to create bom string for various languages
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createBom(path: string, options: Object): Promise<Object>;
/**
 * Method to submit the generated bom to dependency-track or cyclonedx server
 *
 * @param {Object} args CLI args
 * @param {Object} bomContents BOM Json
 * @return {Promise<{ token: string } | undefined>} a promise with a token (if request was successful) or undefined (in case of invalid arguments)
 * @throws {Error} if the request fails
 */
export declare function submitBom(args: Object, bomContents: Object): Promise<{
    token: string;
} | undefined>;
//# sourceMappingURL=index.d.ts.map