export declare const shouldIncludeNodeModulesDir: (options?: {}, baseProjectTypes?: any[]) => boolean;
export declare const HASH_PATTERN = "^([a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[a-fA-F0-9]{96}|[a-fA-F0-9]{128})$";
/**
 * Creates a default parent component based on the directory name.
 *
 * @param {String} path Directory or file name
 * @param {String} type Package type
 * @param {Object} options CLI options
 * @returns component object
 */
export declare const createDefaultParentComponent: (path: string, type?: string, options?: Object) => {
    group: any;
    name: any;
    version: string;
    type: string;
};
export declare const determineParentComponent: (options: any) => any;
export declare const addToolsSection: (options: any, context?: {}) => {
    vendor: string;
    name: string;
    version: any;
}[] | {
    components: any[];
};
export declare const componentToSimpleFullName: (comp: any) => any;
export declare const cleanParentComponent: (comp: any) => any;
export declare const addAuthorsSection: (options: any) => {
    name: any;
}[];
/**
 * Method to generate metadata.lifecycles section. We assume that we operate during "build"
 * most of the time and under "post-build" for containers.
 *
 * @param {Object} options
 * @returns {Array} Lifecycles array
 */
export declare const addLifecyclesSection: (options: Object) => any[];
/**
 * Function to create metadata block
 *
 */
export declare function addMetadata(parentComponent?: {}, options?: {}, context?: {}): {
    timestamp: string;
    tools: {
        vendor: string;
        name: string;
        version: any;
    }[] | {
        components: any[];
    };
    authors: {
        name: any;
    }[];
    supplier: undefined;
};
/**
 * Method to create external references
 *
 * @param {Array | Object} opkg
 * @returns {Array}
 */
export declare function addExternalReferences(opkg: any[] | Object): any[];
/**
 * For all modules in the specified package, creates a list of
 * component objects from each one.
 *
 * @param {Object} options CLI options
 * @param {Object} allImports All imports
 * @param {Object} pkg Package object
 * @param {string} ptype Package type
 * @returns {Object[]} Array of component objects
 */
export declare function listComponents(options: Object, allImports: Object, pkg: Object, ptype?: string): Object[];
export declare const NON_PURL_TYPES: string[];
export declare const NPM_BIN_IMPORT_PREFIX = "cdx:npm:bin/";
export declare function getPackagePropertyValues(pkg: any, propertyName: any): any;
export declare function splitPackagePropertyList(value: any): string[];
export declare function getPackageBinCommandNames(pkg: any): Set<any>;
export declare function hasNpmBinCommandEvidence(allImports: any, pkg: any): boolean;
/**
 * Given the specified package, create a CycloneDX component and add it to the list.
 */
export declare function addComponent(options: any, allImports: any, pkg: any, ptype: any, compMap: any, isRootPkg?: boolean): void;
/**
 * If the author has described the module as a 'framework', the take their
 * word for it, otherwise, identify the module as a 'library'.
 */
export declare function determinePackageType(pkg: any): any;
/**
 * Uses the SHA1 shasum (if present) otherwise utilizes Subresource Integrity
 * of the package with support for multiple hashing algorithms.
 */
export declare function processHashes(pkg: any, component: any): void;
/**
 * Adds a hash to component.
 */
export declare function addComponentHash(alg: any, digest: any, component: any): void;
/**
 * Return the BOM in json format including any namespace mapping
 *
 * @param {Object} options Options
 * @param {Object} pkgInfo Package information
 * @param {string} ptype Package type
 * @param {Object} context Context
 *
 * @returns {Object} BOM with namespace mapping
 */
export declare const buildBomNSData: (options: Object, pkgInfo: Object, ptype: string, context: Object) => Object;
/**
 * Function to create bom string for Android apps using blint
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object|undefined} BOM object
 */
export declare function createAndroidBom(path: string, options: Object): Object | undefined;
/**
 * Function to create bom string for binaries using blint
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Object|undefined} BOM object
 */
export declare function createBinaryBom(path: string, options: Object): Object | undefined;
/**
 * Identify the requested AI inventory project types.
 *
 * @param {Object} options Parse options from the cli
 * @returns {string[]} Requested AI inventory types
 */
export declare function getRequestedAiInventoryTypes(options: Object): string[];
export declare function getExcludedAiInventoryTypes(options: any): string[];
export declare function filterIncludedAiInventoryTypes(includedAiInventoryTypes: any, excludedAiInventoryTypes: any): any[];
/**
 * Determine which AI inventory types should be collected for a scan.
 *
 * This combines explicit project-type opt-ins with BOM audit category-driven
 * opt-ins, then removes any explicitly excluded inventory types.
 *
 * @param {Object} options Parse options from the CLI
 * @returns {string[]} AI inventory types to collect
 */
export declare function getIncludedAiInventoryTypes(options: Object): string[];
export declare function getExactAiInventoryType(options: any): string | undefined;
/**
 * Determine whether MCP source-code analysis should run for the current scan.
 *
 * @param {string[]} includedAiInventoryTypes AI inventory types selected for collection
 * @returns {boolean} True when MCP inventory collection is enabled
 */
export declare function shouldDetectMcpInventory(includedAiInventoryTypes: string[]): boolean;
export declare function summarizeAiInventoryNames(subjects: any, discoveryPath: any, kindSet: any): any[];
export declare function summarizeAiInventoryServiceNames(services: any): any[];
export declare function formatAiInventorySummaryLine(label: any, count: any, nameList: any): string;
export declare function emitAiInventorySummary(aiInventory: any, discoveryPath: any): void;
/**
 * Dedupe components
 *
 * @param {Object} options Options
 * @param {Array} components Components
 * @param {Object} parentComponent Parent component
 * @param {Array} dependencies Dependencies
 *
 * @returns {Object} Object including BOM Json
 */
export declare function dedupeBom(options: Object, components: any[], parentComponent: Object, dependencies: any[]): Object;
export declare const hasExplicitProjectTypeSelection: (options: any, baseProjectType: any) => any;
//# sourceMappingURL=bomAssembly.d.ts.map