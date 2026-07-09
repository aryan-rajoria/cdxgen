/**
 * The default CycloneDX specification version used across cdxgen when a caller
 * does not specify one (matches the `--spec-version` CLI default).
 */
export declare const DEFAULT_CDX_SPEC_VERSION = 1.7;
export declare const CYCLONEDX_COMPONENT_TYPES_BY_SPEC_VERSION: Readonly<{
    1.4: readonly string[];
    1.5: readonly string[];
    1.6: readonly string[];
    1.7: readonly string[];
    "2.0": readonly string[];
}>;
export declare const isSpdxJsonLd: (bomJson: any) => boolean;
export declare const normalizeCycloneDxSpecVersion: (specVersion: any) => number | undefined;
export declare const toCycloneDxSpecVersionString: (specVersion: any) => string | undefined;
export declare const isCycloneDxSpecVersionAtLeast: (specVersion: any, minimumVersion: any) => boolean;
export declare const isCycloneDx20SpecVersion: (specVersion: any) => boolean;
export declare const getSupportedCycloneDxComponentTypes: (specVersion?: number) => any[];
export declare const normalizeCycloneDxComponentTypeFilter: (componentType: any) => string[];
export declare const isCycloneDxComponentTypeEnabled: (componentType: any, options?: {}) => boolean;
export declare const getCycloneDxRootFormatKey: (specVersionOrBom: any) => "bomFormat" | "specFormat";
export declare const getCycloneDxFormat: (bomJson: any) => any;
export declare const hasCycloneDxFormat: (bomJson: any) => boolean;
export declare const isCycloneDxBom: (bomJson: any) => boolean;
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
export declare const detectBomFormat: (bomJson: any) => "cyclonedx" | "spdx" | "unknown";
export declare const getNonCycloneDxErrorMessage: (bomJson: any, commandName?: string) => string;
//# sourceMappingURL=bomUtils.d.ts.map