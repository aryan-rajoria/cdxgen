/**
 * Resolve a detected algorithm name to a CycloneDX 1.7 `algorithmFamily` enum
 * value. Returns undefined when no rule matches, so the caller can leave the
 * field unset rather than emitting an invalid value.
 *
 * @param {string} name Detected or OID algorithm name
 * @returns {string|undefined} A valid algorithmFamily enum value, or undefined
 */
export declare function resolveAlgorithmFamily(name: string): string | undefined;
/**
 * Resolve a curve name to the CycloneDX 1.7 `ellipticCurve` enum. When the
 * name cannot be mapped to the enum, the deprecated 1.6 free-text `curve`
 * property is returned instead so the cryptographic fact is preserved.
 *
 * @param {string} curveName Detected curve name
 * @returns {Object} `{ ellipticCurve }` when mappable, `{ curve }` when only
 *   the deprecated free-text form is available, or `{}` when no curve is named.
 */
export declare function resolveEllipticCurve(curveName: string): Object;
/**
 * Apply resolved algorithm-family and curve properties to a cryptographic
 * component's `cryptoProperties.algorithmProperties`. The component is mutated
 * in place; the primitive is preserved when already set.
 *
 * @param {Object} component A CycloneDX cryptographic-asset component
 * @param {Object} context Detected context
 * @param {string} [context.name] Algorithm name used to resolve the family
 * @param {string} [context.primitive] Cryptographic primitive (e.g. "signature")
 * @param {string} [context.curve] Curve name to resolve
 * @returns {Object} The mutated component
 */
export declare function applyAlgorithmProperties(component: Object, context?: {
    name?: string;
    primitive?: string;
    curve?: string;
}): Object;
//# sourceMappingURL=cryptoAlgorithmFamily.d.ts.map