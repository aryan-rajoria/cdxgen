/**
 * The spellings under which a config file may list custom metadata
 * properties: those of the `--metadata-property` flag, and the plural that
 * the CDXGEN_METADATA_PROPERTIES environment variable maps to.
 */
export declare const METADATA_PROPERTY_CONFIG_KEYS: string[];
/**
 * Report whether a property name belongs to a namespace cdxgen reserves for
 * the facts it establishes itself, such as `cdx:bom:componentSrcFiles`.
 *
 * @param {string} name Property name
 * @returns {boolean} true for a reserved name
 */
export declare function isReservedMetadataPropertyName(name: string): boolean;
/**
 * Normalize user-supplied metadata properties into `[{name, value}]`
 * (discussion 4391).
 *
 * Accepted shapes:
 * - a `name=value` string, or a JSON document holding any of the shapes below
 *   — an environment variable
 * - an array of `name=value` strings or `{name, value}` objects — the
 *   `--metadata-property` flag and a JSON config file
 * - a plain object mapping a name to a value, or to a list of values for a
 *   property that repeats — a JSON document or a YAML config file
 *
 * Values must be strings, numbers, or booleans. An entry without a name, a
 * `name=value` string without a separator, and an empty or structured value
 * are dropped rather than guessed at: a property with a mangled name or an
 * `[object Object]` value is worse than none.
 *
 * @param {unknown} input Properties in any accepted shape
 * @returns {{name: string, value: string}[]} Normalized properties
 */
export declare function parseMetadataProperties(input: unknown): {
    name: string;
    value: string;
}[];
//# sourceMappingURL=metadataProperties.d.ts.map