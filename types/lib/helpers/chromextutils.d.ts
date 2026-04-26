/**
 * Discover known Chromium-based browser user-data directories.
 *
 * @returns {Array<{browser: string, channel: string, dir: string}>}
 */
export function getChromiumExtensionDirs(): Array<{
    browser: string;
    channel: string;
    dir: string;
}>;
/**
 * Discover existing Chromium-based browser user-data directories.
 *
 * @returns {Array<{browser: string, channel: string, dir: string}>}
 */
export function discoverChromiumExtensionDirs(): Array<{
    browser: string;
    channel: string;
    dir: string;
}>;
/**
 * Compare Chromium extension versions with numeric dot-separated semantics.
 *
 * @param {string} leftVersion Left version
 * @param {string} rightVersion Right version
 * @returns {number} Negative when left<right, positive when left>right, zero when equal
 */
export function compareChromiumExtensionVersions(leftVersion: string, rightVersion: string): number;
/**
 * Read profile names from Chromium user-data directory.
 *
 * @param {string} userDataDir Browser user-data directory
 * @returns {string[]} Profile directory names
 */
export function getChromiumProfiles(userDataDir: string): string[];
/**
 * Parse a Chromium extension manifest file.
 *
 * @param {string} manifestFile Absolute path to manifest.json
 * @returns {Object|undefined} Parsed manifest metadata
 */
export function parseChromiumExtensionManifest(manifestFile: string): Object | undefined;
/**
 * Infer browser context from a resolved Chromium extension manifest path.
 *
 * @param {string} manifestFile Absolute path to manifest.json
 * @returns {{browser?: string, channel?: string, profile?: string, profilePath?: string}}
 */
export function inferChromiumContextFromManifest(manifestFile: string): {
    browser?: string;
    channel?: string;
    profile?: string;
    profilePath?: string;
};
/**
 * Collect one directly specified extension from a path.
 *
 * Supported path forms:
 * - `<...>/manifest.json`
 * - `<...>/<extension-id>/<version>/manifest.json`
 * - `<...>/<version>/` (contains manifest.json)
 * - `<...>/<extension-id>/` (contains version subdirectories)
 *
 * Note: a standalone `<...>/<version>/` directory is not sufficient unless its
 * parent directory name is the extension id, because the parser derives the
 * extension id from the version directory's parent path.
 *
 * @param {string} extensionPath Candidate extension path
 * @returns {{components: Object[], extensionDirs: string[]}}
 */
export function collectChromeExtensionsFromPath(extensionPath: string): {
    components: Object[];
    extensionDirs: string[];
};
/**
 * Convert parsed Chromium extension metadata into a CycloneDX component object.
 *
 * @param {Object} extInfo Extension metadata
 * @returns {Object|undefined} CycloneDX component object or undefined
 */
export function toComponent(extInfo: Object): Object | undefined;
/**
 * Collect installed Chromium extension components from discovered browser directories.
 *
 * @param {Array<{browser: string, channel: string, dir: string}>} browserDirs Browser directories
 * @returns {Object[]} Array of CycloneDX component objects
 */
export function collectInstalledChromeExtensions(browserDirs: Array<{
    browser: string;
    channel: string;
    dir: string;
}>): Object[];
/**
 * The purl type for Chrome extensions as defined by the packageurl spec.
 */
export const CHROME_EXTENSION_PURL_TYPE: "chrome-extension";
//# sourceMappingURL=chromextutils.d.ts.map