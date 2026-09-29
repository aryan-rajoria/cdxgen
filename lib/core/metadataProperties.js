/**
 * The spellings under which a config file may list custom metadata
 * properties: those of the `--metadata-property` flag, and the plural that
 * the CDXGEN_METADATA_PROPERTIES environment variable maps to.
 */
export const METADATA_PROPERTY_CONFIG_KEYS = [
  "metadata-property",
  "metadataProperty",
  "metadata-properties",
  "metadataProperties",
];

// Namespaces whose properties cdxgen itself asserts: `cdx:` is its registered
// taxonomy, and `internal:` carries its own bookkeeping
const RESERVED_METADATA_PROPERTY_PREFIXES = ["cdx:", "internal:"];

/**
 * Report whether a property name belongs to a namespace cdxgen reserves for
 * the facts it establishes itself, such as `cdx:bom:componentSrcFiles`.
 *
 * @param {string} name Property name
 * @returns {boolean} true for a reserved name
 */
export function isReservedMetadataPropertyName(name) {
  return RESERVED_METADATA_PROPERTY_PREFIXES.some((prefix) =>
    `${name}`.startsWith(prefix),
  );
}

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
export function parseMetadataProperties(input) {
  const properties = [];
  if (typeof input === "string") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (_err) {
      parsed = undefined;
    }
    input =
      parsed && typeof parsed === "object"
        ? parsed
        : [typeof parsed === "string" ? parsed : input];
  }
  const append = (name, value) => {
    if (typeof name !== "string" && typeof name !== "number") {
      return;
    }
    const propName = `${name}`.trim();
    if (
      !propName.length ||
      !["string", "number", "boolean"].includes(typeof value) ||
      !`${value}`.length
    ) {
      return;
    }
    properties.push({ name: propName, value: `${value}` });
  };
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") {
        const separator = entry.indexOf("=");
        if (separator > 0) {
          append(entry.slice(0, separator), entry.slice(separator + 1));
        }
      } else if (entry && typeof entry === "object") {
        append(entry.name, entry.value);
      }
    }
  } else if (input && typeof input === "object") {
    for (const [name, value] of Object.entries(input)) {
      for (const avalue of Array.isArray(value) ? value : [value]) {
        append(name, avalue);
      }
    }
  }
  return properties;
}
