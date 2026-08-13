/**
 * Look up plugin manifest entries for the given tool names and return their
 * CycloneDX tool component objects, de-duplicated by bom-ref.
 *
 * @param {string[]} [toolNames=[]] Plugin tool names to resolve.
 * @returns {Object[]} De-duplicated CycloneDX tool component objects.
 */
export declare function getPluginToolComponents(toolNames?: string[]): Object[];
/**
 * Run the `cargo-auditable` companion binary against the given source path and
 * return its stdout.
 *
 * @param {string} src Path to the Rust binary or source to inspect.
 * @returns {string|undefined} The tool's stdout, or undefined when the binary
 *   is unavailable or produced no output.
 */
export declare function getCargoAuditableInfo(src: string): string | undefined;
/**
 * Execute sourcekitten plugin with the given arguments
 *
 * @param args {Array} Arguments
 * @returns {undefined|Object} Command output
 */
export declare function executeSourcekitten(args: any[]): undefined | Object;
/**
 * Get the packages installed in the container image filesystem.
 *
 * @param src {String} Source directory containing the extracted filesystem.
 * @param imageConfig {Object} Image configuration containing environment variables, command, entrypoints etc
 * @param options CLI options controlling inventory generation
 *
 * @returns {Object} Metadata containing packages, dependencies, etc
 */
export declare function getOSPackages(src: string, imageConfig: Object, options?: {}): Object;
/**
 * Batch-enrich operating-system components with host-path trust data using the
 * `trustinspector` helper on darwin and Windows.
 *
 * @param {Object[]} [components=[]] OS components to enrich.
 * @returns {{components: Object[], tools: Object[]}} The enriched components
 *   and any trust-inspector tool components that should be attached to the BOM
 *   metadata.
 */
export declare function enrichOSComponentsWithTrustData(components?: Object[]): {
    components: Object[];
    tools: Object[];
};
/**
 * Execute a SQL query against the bundled osquery binary and return the parsed
 * JSON result.
 *
 * @param {string} query The SQL query string to run.
 * @returns {Object|undefined} The parsed JSON result, or undefined when the
 *   binary is unavailable, dry-run blocks execution, or the output cannot be
 *   parsed.
 */
export declare function executeOsQuery(query: string): Object | undefined;
/**
 * Method to execute dosai to create slices for dotnet
 *
 * @param {string} src Source Path
 * @param {string} slicesFile Slices file name
 * @returns boolean
 */
export declare function getDotnetSlices(src: string, slicesFile: string): boolean;
/**
 * Method to generate binary SBOM using blint
 *
 * @param {string} src Path to binary or its directory
 * @param {string} binaryBomFile Path to binary
 * @param {boolean} deepMode Deep mode flag
 *
 * @return {boolean} Result of the generation
 */
export declare function getBinaryBom(src: string, binaryBomFile: string, deepMode: boolean): boolean;
//# sourceMappingURL=binary.d.ts.map