/**
 * Map Scala semantic-slice used types back to purls and their source locations.
 *
 * Builds a type-to-purl cache from the component `internal:Namespaces`
 * properties, then for each `.scala` entry in the semantic slice records the
 * source file locations where each used type's purl appears.
 *
 * @param {Object[]} components CycloneDX components carrying namespace properties
 * @param {Object} semanticsSlice Parsed Scala semantic slice object keyed by source file
 * @returns {{ purlLocationMap: Object<string, string[]> }} Map of purl to sorted source location arrays
 */
export declare function findPurlLocations(components: Object[], semanticsSlice: Object): {
    purlLocationMap: Record<string, string[]>;
};
//# sourceMappingURL=scalasem.d.ts.map