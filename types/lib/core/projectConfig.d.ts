/**
 * Config file names cdxgen reads from the directory it is invoked in.
 */
export declare const PROJECT_CONFIG_FILENAMES: string[];
/**
 * Apply the trust boundary between cdxgen and the directory it is scanning.
 *
 * A config file lives in the tree under analysis, so it is attacker-controlled
 * whenever that tree is. Path options are therefore confined to the config's
 * own directory - a scanned project may choose where in itself the BOM lands,
 * but not write outside it - and options that redirect data off the host or
 * widen what cdxgen executes are announced on the console. A project may
 * describe itself with custom metadata properties, but not in the namespaces
 * cdxgen reserves for the facts it establishes, so a scanned tree cannot pass
 * its own claims off as cdxgen's.
 *
 * @param {Object} config parsed config file contents
 * @param {string} configDir directory the config file was read from
 * @returns {{config: Object, rejected: string[], announced: string[], reservedProperties: string[]}} sanitized config and what it did
 */
export declare function sanitizeProjectConfig(config: Object, configDir: string): {
    config: Object;
    rejected: string[];
    announced: string[];
    reservedProperties: string[];
};
//# sourceMappingURL=projectConfig.d.ts.map