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
 * Sort every unordered collection in a BOM so that two runs on the same input
 * produce byte-identical output (modulo `serialNumber` and
 * `metadata.timestamp`).
 *
 * Called from {@link postProcess} exactly once per BOM generation cycle.
 *
 * @param {object} bomJson CycloneDX BOM object (mutated in place).
 */
export declare function sortBomCollections(bomJson: object): object;
//# sourceMappingURL=sortBom.d.ts.map