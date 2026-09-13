/**
 * The purl type used for installed agentic CLI tools. These tools ship as
 * self-contained executables rather than as a resolvable source package, so a
 * `pkg:generic/...` identifier is the honest representation.
 */
export declare const AGENTIC_TOOL_PURL_TYPE = "generic";
/**
 * Rewrite an absolute path under the user's home directory to a `~`-relative
 * form so the emitted BOM does not carry the local username.
 *
 * @param {string} filePath Absolute path
 * @returns {string} Home-relative path when applicable, else the input
 */
export declare function redactHomePath(filePath: string): string;
/**
 * Describe where each supported agentic CLI tool stores its per-user state.
 *
 * Each entry lists the tool key, a display name, and the candidate home
 * directories per platform (mirroring how `getIdeExtensionDirs` models IDE
 * extension locations). Only the current platform's directories plus
 * always-present dot-directories are included.
 *
 * @returns {Array<{tool: string, name: string, dirs: string[], supportDirs?: string[]}>}
 *   One entry per known agentic CLI tool.
 */
export declare function getAgenticToolDirs(): Array<{
    tool: string;
    name: string;
    dirs: string[];
    supportDirs?: string[];
}>;
/**
 * Discover which agentic CLI tools are installed for the current user by
 * checking their known home directories.
 *
 * @returns {Array<{tool: string, name: string, dir: string, supportDir?: string}>}
 *   One entry per discovered tool, using the first existing directory.
 */
export declare function discoverAgenticTools(): Array<{
    tool: string;
    name: string;
    dir: string;
    supportDir?: string;
}>;
/**
 * Compute safe, redacted signal counts for a discovered tool. Only structural
 * counts and small enumerated values are returned; no credential, transcript,
 * or telemetry content is read.
 *
 * @param {string} tool Tool key
 * @param {string} dir Discovered tool home directory
 * @param {string} [supportDir] Optional platform support directory
 * @returns {Object} Map of signal name to count/boolean/small-string value
 */
export declare function collectToolSignals(tool: string, dir: string, supportDir?: string): Object;
/**
 * Build a CycloneDX application component for one discovered agentic tool.
 *
 * @param {{tool: string, name: string, dir: string, supportDir?: string}} entry
 *   Discovered tool entry
 * @returns {Object} CycloneDX component
 */
export declare function componentForAgenticTool(entry: {
    tool: string;
    name: string;
    dir: string;
    supportDir?: string;
}): Object;
/**
 * Discover installed agentic CLI tools on the current host and return CycloneDX
 * components describing each one, plus the child agents, plugins, and providers
 * they define and the dependency edges linking children to their tool.
 *
 * This host scan is unconditional: it does not consult scan filters such as
 * `--exclude` or profile/technique options, because it inventories fixed tool
 * home directories rather than a project tree. The `options` argument is
 * accepted for signature parity and is intentionally not used to alter results.
 *
 * @param {Object} [options={}] Collection options (accepted but not applied)
 * @returns {{components: Object[], services: Object[], dependencies: Object[]}} Discovered inventory
 */
export declare function collectAgenticTools(_options?: {}): {
    components: Object[];
    services: Object[];
    dependencies: Object[];
};
//# sourceMappingURL=agenticToolutils.d.ts.map