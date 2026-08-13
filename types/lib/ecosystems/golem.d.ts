/**
 * Determine whether a project language is a Go variant that should trigger golem analysis.
 *
 * @param {string} language Project language identifier.
 * @returns {boolean} True when the language maps to a Go variant.
 */
export declare function isGolemGoLanguage(language: string): boolean;
/**
 * Read and parse a golem analysis JSON report file.
 *
 * @param {string} jsonFile Path to the golem JSON report.
 * @returns {object|undefined} Parsed report object, or undefined when the file
 *   is missing or cannot be parsed.
 */
export declare function readGolemJsonFile(jsonFile: string): object | undefined;
/**
 * Invoke the golem analyzer binary over a source directory to produce a JSON report.
 *
 * Assembles the analyze invocation (callgraph mode, data-flow mode, patterns,
 * tags, tests, stdlib flags) from the options and writes the result to
 * `outputFile`.
 *
 * @param {string} src Source directory to analyze.
 * @param {string} outputFile Destination path for the JSON report.
 * @param {object} [options={}] Options controlling golem behavior.
 * @returns {boolean} True when the analysis succeeded and the report was written.
 */
export declare function runGolemAnalysis(src: string, outputFile: string, options?: object): boolean;
/**
 * Orchestrate a full golem run: execute the analyzer, read the report, and clean up.
 *
 * When `options.semanticsSlicesFile` is set the report is persisted there;
 * otherwise it is written to a temporary directory that is removed after parsing.
 *
 * @param {string} src Source directory to analyze.
 * @param {object} [options={}] Options forwarded to {@link runGolemAnalysis}.
 * @returns {object|undefined} Parsed golem report, or undefined on failure.
 */
export declare function analyzeGolemProject(src: string, options?: object): object | undefined;
/**
 * Project a golem report into CycloneDX component evidence, properties, and crypto assets.
 *
 * Aggregates import/usage/call-graph/data-flow evidence and crypto signals from
 * the report, attaching per-component properties and occurrence evidence while
 * collecting any derived cryptographic-asset components.
 *
 * @param {object} [golemReport={}] Parsed golem analysis report.
 * @param {Array<object>} [components=[]] Existing BOM components to match against.
 * @returns {{componentPropertiesMap: Object<string, Array<object>>, cryptoComponents: Array<object>, cryptoGeneratePurls: Object<string, boolean>, dataFlowFrames: Object<string, Array>, metadataProperties: Array<object>, purlLocationMap: Object<string, Array>}}
 *   Projected evidence maps and crypto components.
 */
export declare function collectGolemEvidence(golemReport?: object, components?: Array<object>): {
    componentPropertiesMap: Record<string, object[]>;
    cryptoComponents: Array<object>;
    cryptoGeneratePurls: Record<string, boolean>;
    dataFlowFrames: Record<string, any[]>;
    metadataProperties: Array<object>;
    purlLocationMap: Record<string, any[]>;
};
//# sourceMappingURL=golem.d.ts.map