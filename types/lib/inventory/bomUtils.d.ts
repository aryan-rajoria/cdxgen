/**
 * The default CycloneDX specification version used across cdxgen when a caller
 * does not specify one (matches the `--spec-version` CLI default).
 */
export declare const DEFAULT_CDX_SPEC_VERSION = 1.7;
/**
 * Frozen map of CycloneDX spec versions (as "major.minor" strings) to the
 * frozen list of component types supported by that version.
 */
export declare const CYCLONEDX_COMPONENT_TYPES_BY_SPEC_VERSION: Readonly<{
    1.4: readonly string[];
    1.5: readonly string[];
    1.6: readonly string[];
    1.7: readonly string[];
    "2.0": readonly string[];
}>;
/**
 * Determine whether the given BOM object is an SPDX JSON-LD document.
 *
 * @param {object} bomJson BOM JSON object to inspect.
 * @returns {boolean} True when the object carries an SPDX `@context` and an `SpdxDocument` graph entry.
 */
export declare const isSpdxJsonLd: (bomJson: object) => boolean;
/**
 * Normalize a CycloneDX spec version to a numeric major.minor value.
 *
 * @param {string|number} specVersion Spec version string or number (e.g. "1.5", 1.6).
 * @returns {number|undefined} Numeric major.minor version, or undefined when unparseable.
 */
export declare const normalizeCycloneDxSpecVersion: (specVersion: string | number) => number | undefined;
/**
 * Format a CycloneDX spec version as a "major.minor" string.
 *
 * @param {string|number} specVersion Spec version string or number.
 * @returns {string|undefined} "major.minor" string, or undefined when unparseable.
 */
export declare const toCycloneDxSpecVersionString: (specVersion: string | number) => string | undefined;
/**
 * Determine whether a spec version is greater than or equal to a minimum version,
 * comparing major then minor components.
 *
 * @param {string|number} specVersion The spec version to test.
 * @param {string|number} minimumVersion The minimum required spec version.
 * @returns {boolean} True when specVersion is at least minimumVersion.
 */
export declare const isCycloneDxSpecVersionAtLeast: (specVersion: string | number, minimumVersion: string | number) => boolean;
/**
 * Determine whether a spec version is CycloneDX 2.0 or later.
 *
 * @param {string|number} specVersion The spec version to test.
 * @returns {boolean} True when the spec version is at least 2.0.
 */
export declare const isCycloneDx20SpecVersion: (specVersion: string | number) => boolean;
/**
 * Return the list of component types supported by a given CycloneDX spec
 * version, falling back to the 1.7 list when the version is unrecognized.
 *
 * @param {string|number} [specVersion=1.7] CycloneDX spec version.
 * @returns {string[]} Supported component type names for that version.
 */
export declare const getSupportedCycloneDxComponentTypes: (specVersion?: string | number) => string[];
/**
 * Normalize a component type filter (single value, array, or falsy) into a
 * deduplicated array of trimmed, non-empty type strings.
 *
 * @param {string|string[]} componentType Component type or array of types.
 * @returns {string[]} Deduplicated, trimmed component type strings.
 */
export declare const normalizeCycloneDxComponentTypeFilter: (componentType: string | string[]) => string[];
/**
 * Determine whether a component type is enabled given the configured type
 * filter and spec version.
 *
 * @param {string} componentType The component type to test.
 * @param {object} [options] Options carrying the filter and spec version.
 * @param {string|string[]} [options.componentType] Explicit type filter from CLI options.
 * @param {string|number} [options.specVersion] CycloneDX spec version for default support lookup.
 * @returns {boolean} True when the component type passes the filter.
 */
export declare const isCycloneDxComponentTypeEnabled: (componentType: string, options?: {
    componentType?: string | string[];
    specVersion?: string | number;
}) => boolean;
/**
 * Return the appropriate CycloneDX root format key ("bomFormat" or
 * "specFormat") for the given spec version or BOM object.
 *
 * @param {string|number|object} specVersionOrBom Spec version, or a BOM object whose `specVersion` is read.
 * @returns {string} The root format key name to use.
 */
export declare const getCycloneDxRootFormatKey: (specVersionOrBom: string | number | object) => string;
/**
 * Return the BOM format identifier string from a BOM object.
 *
 * @param {object} bomJson BOM JSON object.
 * @returns {string|undefined} The `specFormat` or `bomFormat` value.
 */
export declare const getCycloneDxFormat: (bomJson: object) => string | undefined;
/**
 * Determine whether a BOM object carries the CycloneDX format identifier.
 *
 * @param {object} bomJson BOM JSON object.
 * @returns {boolean} True when the format identifier equals "CycloneDX".
 */
export declare const hasCycloneDxFormat: (bomJson: object) => boolean;
/**
 * Determine whether an object is a valid CycloneDX BOM by checking both the
 * format identifier and a parseable spec version.
 *
 * @param {object} bomJson BOM JSON object.
 * @returns {boolean} True when the object is a valid CycloneDX BOM.
 */
export declare const isCycloneDxBom: (bomJson: object) => boolean;
/**
 * Mutates a CycloneDX BOM object so the appropriate root format key is present
 * for the requested spec version, while preserving conventional serialized
 * root-key ordering (`bomFormat`/`specFormat` and `specVersion` first). Only the currently
 * supported CycloneDX major.minor version shape is accepted; multi-component
 * future versions such as `2.0.1` intentionally return `undefined` from the
 * normalizer rather than being silently truncated.
 *
 * @param {object} bomJson BOM JSON object to mutate.
 * @param {string|number} specVersion Desired CycloneDX spec version.
 * @param {object} options Root-key compatibility options.
 * @returns {object} The same `bomJson` object, after in-place mutation.
 */
export declare const setCycloneDxFormat: (bomJson: object, specVersion: string | number, { preserveLegacyBomFormat }?: object) => object;
/**
 * Detect the format of a BOM object, distinguishing CycloneDX, SPDX JSON-LD,
 * and unknown formats.
 *
 * @param {object} bomJson BOM JSON object.
 * @returns {string} "cyclonedx", "spdx", or "unknown".
 */
export declare const detectBomFormat: (bomJson: object) => string;
/**
 * Build a user-facing error message explaining that the supplied BOM is not a
 * CycloneDX document, tailored to the detected format.
 *
 * @param {object} bomJson BOM JSON object that was rejected.
 * @param {string} [commandName="This command"] Name of the command requiring CycloneDX input.
 * @returns {string} Human-readable error message.
 */
export declare const getNonCycloneDxErrorMessage: (bomJson: object, commandName?: string) => string;
//# sourceMappingURL=bomUtils.d.ts.map