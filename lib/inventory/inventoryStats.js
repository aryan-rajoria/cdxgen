function toProperties(propertiesOrObject) {
  if (Array.isArray(propertiesOrObject)) {
    return propertiesOrObject;
  }
  if (Array.isArray(propertiesOrObject?.properties)) {
    return propertiesOrObject.properties;
  }
  return [];
}

/**
 * Return the value of a named CycloneDX property.
 *
 * @param {Object[]|Object} propertiesOrObject Property array or an object with a `properties` array
 * @param {string} propertyName Property name to look up
 * @returns {string|undefined} First matching property value, or undefined when absent
 */
export function getPropertyValue(propertiesOrObject, propertyName) {
  return toProperties(propertiesOrObject).find(
    (property) => property?.name === propertyName,
  )?.value;
}

function hasPropertyValue(propertiesOrObject, propertyName, valuePredicate) {
  const propertyValue = getPropertyValue(propertiesOrObject, propertyName);
  if (typeof valuePredicate === "function") {
    return valuePredicate(propertyValue);
  }
  return propertyValue === valuePredicate;
}

function isFileComponent(component) {
  return component?.type === "file";
}

function isCryptographicAssetComponent(component) {
  return component?.type === "cryptographic-asset";
}

/**
 * Filter components down to unpackaged executable file components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} File components flagged `internal:is_executable=true`
 */
export function getUnpackagedExecutableComponents(components = []) {
  return (components || []).filter(
    (component) =>
      isFileComponent(component) &&
      hasPropertyValue(component, "internal:is_executable", "true"),
  );
}

/**
 * Filter components down to unpackaged shared-library file components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} File components flagged `internal:is_shared_library=true`
 */
export function getUnpackagedSharedLibraryComponents(components = []) {
  return (components || []).filter(
    (component) =>
      isFileComponent(component) &&
      hasPropertyValue(component, "internal:is_shared_library", "true"),
  );
}

/**
 * Filter components down to source-derived (js-ast) cryptographic-asset components.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {Object[]} Crypto assets whose `cdx:crypto:sourceType` starts with `js-ast:`
 */
export function getSourceDerivedCryptoComponents(components = []) {
  return (components || []).filter(
    (component) =>
      isCryptographicAssetComponent(component) &&
      hasPropertyValue(component, "cdx:crypto:sourceType", (propertyValue) =>
        propertyValue?.startsWith("js-ast:"),
      ),
  );
}

/**
 * Compute counts and lists of unpackaged executables and shared libraries.
 *
 * @param {Object[]} [components=[]] CycloneDX components
 * @returns {{unpackagedExecutables: Object[], unpackagedSharedLibraries: Object[], unpackagedExecutableCount: number, unpackagedSharedLibraryCount: number}} Container file inventory stats
 */
export function getContainerFileInventoryStats(components = []) {
  const unpackagedExecutables = getUnpackagedExecutableComponents(components);
  const unpackagedSharedLibraries =
    getUnpackagedSharedLibraryComponents(components);
  return {
    unpackagedExecutables,
    unpackagedSharedLibraries,
    unpackagedExecutableCount: unpackagedExecutables.length,
    unpackagedSharedLibraryCount: unpackagedSharedLibraries.length,
  };
}
