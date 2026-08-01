export declare const CHROMIUM_EXTENSION_CAPABILITY_CATEGORIES: string[];
export declare const JS_CAPABILITY_CATEGORIES: string[];
export declare function analyzeSuspiciousJsSource(source: any): {
    executionIndicators: any[];
    indicators: any[];
    networkIndicators: any[];
    obfuscationIndicators: any[];
};
/**
 * Find all imports and exports
 */
export declare const findJSImportsExports: (src: any, deep: any) => Promise<{
    allImports: {};
    allExports: {};
}>;
/**
 * Detect suspicious obfuscation, execution, and network indicators in a single
 * JavaScript/TypeScript source file using Babel AST analysis.
 *
 * @param {string} filePath Source file path
 * @returns {{executionIndicators: string[], indicators: string[], networkIndicators: string[], obfuscationIndicators: string[]}}
 */
export declare const analyzeSuspiciousJsFile: (filePath: string) => {
    executionIndicators: string[];
    indicators: string[];
    networkIndicators: string[];
    obfuscationIndicators: string[];
};
export declare function analyzeJsCapabilitiesSource(source: any): {
    capabilities: string[];
    hasDynamicFetch: boolean;
    hasDynamicImport: boolean;
    hasEval: boolean;
    indicatorMap: {};
};
export declare const analyzeJsCapabilitiesFile: (filePath: any) => {
    capabilities: string[];
    hasDynamicFetch: boolean;
    hasDynamicImport: boolean;
    hasEval: boolean;
    indicatorMap: {};
};
export declare function analyzeJsCryptoSource(source: any): {
    algorithms: any[];
    libraries: any[];
};
export declare const analyzeJsCryptoFile: (filePath: any) => {
    algorithms: any[];
    libraries: any[];
};
export declare const detectJsCryptoInventory: (src: any, deep?: boolean) => Promise<{
    algorithms: any[];
    libraries: any[];
}>;
/**
 * Detect browser-extension capability signals from source code using Babel AST analysis.
 *
 * @param {string} src Path to the extension source directory
 * @param {boolean} deep When true, includes node_modules and nested directories
 * @returns {{capabilities: string[], indicators: Object<string, string[]>}}
 * `indicators` is keyed by capability category name and contains arrays of
 * detected signal strings (for example property chains and call names).
 */
export declare const detectExtensionCapabilities: (src: string, deep?: boolean) => {
    capabilities: string[];
    indicators: Record<string, string[]>;
};
/**
 * Detect MCP server inventory from Python source using import and decorator heuristics.
 *
 * @param {string} src Absolute or relative path to the project source directory
 * @param {boolean} deep When true, also scans nested paths more aggressively
 * @returns {{components: Object[], dependencies: Object[], services: Object[]}}
 */
export declare const detectPythonMcpInventory: (src: string, deep?: boolean) => {
    components: Object[];
    dependencies: Object[];
    services: Object[];
};
/**
 * Detect MCP server inventory from JavaScript/TypeScript source using AST analysis.
 *
 * @param {string} src Absolute or relative path to the project source directory
 * @param {boolean} deep When true, also scans nested paths more aggressively
 * @returns {{components: Object[], dependencies: Object[], services: Object[]}}
 */
export declare const detectMcpInventory: (src: string, deep?: boolean) => {
    components: Object[];
    dependencies: Object[];
    services: Object[];
};
//# sourceMappingURL=analyzer.d.ts.map