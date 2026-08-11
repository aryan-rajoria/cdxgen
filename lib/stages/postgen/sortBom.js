/**
 * Deterministic ordering for CycloneDX BOM collections.
 *
 * Several CycloneDX arrays are sets by semantics — `properties`, `hashes`,
 * `licenses`, `externalReferences`, `evidence.occurrences`, `evidence.identity`,
 * `dependencies[].dependsOn`, and `metadata.tools.components` — yet their
 * insertion order in cdxgen output depends on filesystem traversal order, Map
 * iteration order, or the order plugin helpers happened to push in. On a
 * container image that is scanned through ~25 ecosystem legs, two consecutive
 * runs of the same image can therefore disagree on property ordering inside
 * otherwise-identical components, which makes the BOM non-byte-comparable.
 *
 * Sorting these collections once, at finalization time, makes every BOM a
 * pure function of its inputs without touching the component or dependency
 * array order (which callers depend on).
 *
 * The comparators are content-derived string keys, the same strategy the golden
 * normalizer in `contrib/sbom-normalize.js` uses. The two serve opposite ends
 * and neither gates the other: the normalizer sorts a BOM's arrays *before*
 * comparing it to a golden, so it erases emission order and no golden can
 * observe what this module does. Ordering here is covered by `sortBom.poku.js`
 * and by comparing two consecutive scans of the same input.
 */

/**
 * Lexicographic comparator for strings.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function stringCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @param {{name?:string, value?:string}} p */
function propertyKey(p) {
  return `${p.name || ""}\0${p.value || ""}`;
}

/** @param {{alg?:string, content?:string}} h */
function hashKey(h) {
  return `${h.alg || ""}\0${h.content || ""}`;
}

/** @param {{id?:string, name?:string}} l */
function licenseKey(l) {
  return l.id || l.name || "";
}

/** @param {{url?:string, type?:string}} e */
function externalRefKey(e) {
  return `${e.url || ""}\0${e.type || ""}`;
}

/** @param {{location?:string}} o */
function occurrenceKey(o) {
  return o.location || "";
}

/** @param {{field?:string}} i */
function identityKey(i) {
  return i.field || "";
}

/**
 * Sort an array in place using a key extractor, falling back to the
 * stringified item so the sort is total even on unexpected shapes.
 *
 * @template T
 * @param {T[]|undefined} arr
 * @param {(item:T)=>string} keyFn
 * @returns {T[]|undefined}
 */
function sortInPlace(arr, keyFn) {
  if (!Array.isArray(arr) || arr.length < 2) {
    return arr;
  }
  arr.sort((a, b) => stringCompare(keyFn(a), keyFn(b)));
  return arr;
}

/**
 * Sort the unordered internal arrays of a single component (or any object
 * with the same shape). Recurses into nested `components`.
 *
 * @param {object} c
 */
function sortComponentInternals(c) {
  if (!c || typeof c !== "object") {
    return;
  }
  sortInPlace(c.properties, propertyKey);
  sortInPlace(c.hashes, hashKey);
  sortInPlace(c.licenses, licenseKey);
  sortInPlace(c.externalReferences, externalRefKey);
  // CycloneDX 1.5 uses an object for evidence.identity; 1.6+ uses an array.
  // Only sort the array form — a lone object has no ordering to fix.
  if (Array.isArray(c.evidence?.identity)) {
    sortInPlace(c.evidence.identity, identityKey);
  }
  if (Array.isArray(c.evidence?.occurrences)) {
    sortInPlace(c.evidence.occurrences, occurrenceKey);
  }
  if (Array.isArray(c.components)) {
    for (const sub of c.components) {
      sortComponentInternals(sub);
    }
  }
}

/**
 * Sort every unordered collection in a BOM so that two runs on the same input
 * produce byte-identical output (modulo `serialNumber` and
 * `metadata.timestamp`).
 *
 * Called from {@link postProcess} exactly once per BOM generation cycle.
 *
 * @param {object} bomJson CycloneDX BOM object (mutated in place).
 */
export function sortBomCollections(bomJson) {
  if (!bomJson || typeof bomJson !== "object") {
    return bomJson;
  }
  // Component array order follows pathList order by design — do not reorder.
  if (Array.isArray(bomJson.components)) {
    for (const c of bomJson.components) {
      sortComponentInternals(c);
    }
  }
  // Dependency array order follows component order — do not reorder the nodes,
  // only their dependsOn lists.
  if (Array.isArray(bomJson.dependencies)) {
    for (const d of bomJson.dependencies) {
      if (Array.isArray(d.dependsOn)) {
        sortInPlace(d.dependsOn, (s) => String(s));
      }
      // CycloneDX 2.0 replaced dependsOn with provides; sort it too if present.
      if (Array.isArray(d.provides)) {
        sortInPlace(d.provides, (s) => String(s));
      }
    }
  }
  // Metadata component and its sub-components.
  if (bomJson.metadata?.component) {
    sortComponentInternals(bomJson.metadata.component);
  }
  if (bomJson.metadata?.properties) {
    sortInPlace(bomJson.metadata.properties, propertyKey);
  }
  // Tools components are a set of tool descriptors with no meaningful order.
  const toolComponents = bomJson.metadata?.tools?.components;
  if (Array.isArray(toolComponents)) {
    for (const tool of toolComponents) {
      sortComponentInternals(tool);
    }
    if (toolComponents.length > 1) {
      toolComponents.sort((a, b) =>
        stringCompare(
          `${a.purl || a.group || ""}/${a.name || ""}`,
          `${b.purl || b.group || ""}/${b.name || ""}`,
        ),
      );
    }
  }
  // Vulnerability and annotation properties are set-valued in the same way.
  for (const key of ["vulnerabilities", "annotations"]) {
    if (Array.isArray(bomJson[key])) {
      for (const entry of bomJson[key]) {
        if (Array.isArray(entry?.properties)) {
          sortInPlace(entry.properties, propertyKey);
        }
      }
    }
  }
  // Top-level external references.
  if (Array.isArray(bomJson.externalReferences)) {
    sortInPlace(bomJson.externalReferences, externalRefKey);
  }
  // Services: sort internal properties and endpoints.
  if (Array.isArray(bomJson.services)) {
    for (const s of bomJson.services) {
      if (!s || typeof s !== "object") {
        continue;
      }
      if (Array.isArray(s.properties)) {
        sortInPlace(s.properties, propertyKey);
      }
      if (Array.isArray(s.endpoints)) {
        sortInPlace(s.endpoints, (v) => String(v));
      }
    }
  }
  return bomJson;
}
