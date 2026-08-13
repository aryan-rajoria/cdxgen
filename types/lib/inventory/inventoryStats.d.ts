/**
 * Return the value of a named CycloneDX property.
 *
 * @param {Object[]|Object} propertiesOrObject Property array or an object with a `properties` array
 * @param {string} propertyName Property name to look up
 * @returns {string|undefined} First matching property value, or undefined when absent
 */
export declare function getPropertyValue(propertiesOrObject: Object[] | Object, propertyName: string): string | undefined;
/**
 * Filter components down to unpackaged executable file components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} File components flagged `internal:is_executable=true`
 */
export declare function getUnpackagedExecutableComponents(components?: Object[]): Object[];
/**
 * Filter components down to unpackaged shared-library file components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} File components flagged `internal:is_shared_library=true`
 */
export declare function getUnpackagedSharedLibraryComponents(components?: Object[]): Object[];
/**
 * Filter components down to source-derived (js-ast) cryptographic-asset components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} Crypto assets whose `cdx:crypto:sourceType` starts with `js-ast:`
 */
export declare function getSourceDerivedCryptoComponents(components?: Object[]): Object[];
/**
 * Compute counts and lists of unpackaged executables and shared libraries.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {{unpackagedExecutables: Object[], unpackagedSharedLibraries: Object[], unpackagedExecutableCount: number, unpackagedSharedLibraryCount: number}} Container file inventory stats
 */
export declare function getContainerFileInventoryStats(components?: Object[]): {
    unpackagedExecutables: Object[];
    unpackagedSharedLibraries: Object[];
    unpackagedExecutableCount: number;
    unpackagedSharedLibraryCount: number;
};
//# sourceMappingURL=inventoryStats.d.ts.map