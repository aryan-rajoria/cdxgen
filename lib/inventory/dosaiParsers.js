import { Purl } from "@cdxgen/cdx-purl";

/**
 * Build a lowercase type/namespace/name lookup key for a purl.
 *
 * Falls back to a stripped, lowercased form of the raw string when the purl
 * cannot be parsed.
 *
 * @param {string} purl Package URL string
 * @returns {string|undefined} Normalized key, or undefined when the input is empty or not a string
 */
export function normalizeDosaiPurlKey(purl) {
  if (!purl || typeof purl !== "string") {
    return undefined;
  }
  try {
    const purlObj = Purl.parse(purl);
    return [
      purlObj.type?.toLowerCase(),
      purlObj.namespace?.toLowerCase() || "",
      purlObj.name?.toLowerCase(),
    ].join("/");
  } catch (_err) {
    return purl.split("?")[0].split("#")[0].split("@")[0].toLowerCase();
  }
}

/**
 * Append a value to the Set stored under a key in a map, creating the Set when absent.
 *
 * @param {Object} map Map of key to Set of values, mutated in place
 * @param {string} key Map key (usually a purl)
 * @param {string} value Value to add; no-op when key or value is falsy
 * @returns {void}
 */
export function addDosaiSetValue(map, key, value) {
  if (!key || !value) {
    return;
  }
  map[key] ??= new Set();
  map[key].add(value);
}

/**
 * Format a `file#line` location string from a dosai node or location item.
 *
 * @param {Object} item Dosai node, edge, or location object carrying Path/FileName and LineNumber fields
 * @returns {string|undefined} Location string with a `#line` suffix when available, or undefined when no file is known
 */
export function dosaiLocation(item) {
  const location = item?.Location || item?.CallLocation || item;
  const fileName =
    location?.Path || location?.FileName || item?.Path || item?.FileName;
  if (!fileName || fileName === "<unknown>") {
    return undefined;
  }
  const lineNumber = location?.LineNumber || item?.LineNumber;
  if (lineNumber && lineNumber > 0) {
    return `${fileName}#${lineNumber}`;
  }
  return fileName;
}

function dosaiSourceFileName(item) {
  const location = item?.Location || item?.CallLocation || item;
  return String(
    location?.Path || location?.FileName || item?.Path || item?.FileName || "",
  );
}

function dosaiSourceLineNumber(item) {
  const location = item?.Location || item?.CallLocation || item;
  return location?.LineNumber || item?.LineNumber;
}

/**
 * Return a validated source location for .NET source extensions, from a call graph node.
 *
 * @param {Object} node Dosai call graph node object
 * @returns {string|undefined} Location string, or undefined unless the file is .cs/.vb/.fs/.fsx/.r with a positive line number
 */
export function dosaiSourceLocationFromNode(node) {
  const location = dosaiLocation(node);
  const fileName = dosaiSourceFileName(node).toLowerCase();
  const lineNumber = dosaiSourceLineNumber(node);
  if (!location || !/\.(cs|vb|fs|fsx|r)$/i.test(fileName)) {
    return undefined;
  }
  if (!lineNumber || lineNumber <= 0) {
    return undefined;
  }
  return location;
}

/**
 * Return a validated source location for .NET source extensions, from a location object.
 *
 * @param {Object} location Dosai location object carrying Path/FileName and LineNumber fields
 * @returns {string|undefined} Location string, or undefined unless the file is .cs/.vb/.fs/.fsx/.r with a positive line number
 */
export function dosaiSourceLocation(location) {
  const sourceLocation = dosaiLocation(location);
  const fileName = dosaiSourceFileName(location);
  const lineNumber = dosaiSourceLineNumber(location);
  if (!sourceLocation || !/\.(cs|vb|fs|fsx|r)$/i.test(fileName)) {
    return undefined;
  }
  if (!lineNumber || lineNumber <= 0) {
    return undefined;
  }
  return sourceLocation;
}

/**
 * Build a purl alias map from BOM components.
 *
 * Maps both exact component purls and normalized type/namespace/name keys to
 * the canonical component purl so dosai-reported purls can be reconciled.
 *
 * @param {Object[]} [components] Component objects with purl fields
 * @returns {Map<string, string>} Map of purl or normalized key to canonical component purl
 */
export function buildDosaiPurlAliasMap(components = []) {
  const purlAliasMap = new Map();
  for (const component of components) {
    if (!component?.purl) {
      continue;
    }
    purlAliasMap.set(component.purl, component.purl);
    const key = normalizeDosaiPurlKey(component.purl);
    if (key && !purlAliasMap.has(key)) {
      purlAliasMap.set(key, component.purl);
    }
  }
  return purlAliasMap;
}

/**
 * Resolve a purl to the canonical component purl via the alias map.
 *
 * @param {string} purl Purl reported by dosai
 * @param {Map<string, string>} purlAliasMap Alias map built by buildDosaiPurlAliasMap
 * @returns {string|undefined} Canonical component purl, the input purl when unaliased, or undefined when empty
 */
export function resolveDosaiComponentPurl(purl, purlAliasMap) {
  if (!purl) {
    return undefined;
  }
  return (
    purlAliasMap.get(purl) ||
    purlAliasMap.get(normalizeDosaiPurlKey(purl)) ||
    purl
  );
}
