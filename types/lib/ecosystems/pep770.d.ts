import { pypiBomRef } from "../inventory/purl.js";
/**
 * Extract the canonical `Name` and `Version` headers from a distribution
 * METADATA file (RFC 822-style headers, as defined by the PyPA metadata
 * specification). This is the name cdxgen uses when it builds the distribution
 * component's purl, so it is the right basis for rebasing an embedded graph.
 *
 * @param {string} text Raw METADATA content
 * @returns {{name: string, version: string}|null} Headers, or null when missing
 */
declare function distNameVersionFromMetadata(text: string): {
    name: string;
    version: string;
} | null;
/**
 * Rewrite the root reference of an embedded dependency graph so the bundled
 * components become dependencies *of* the distribution component cdxgen already
 * emits, rather than top-level siblings. The embedded SBOM's own root ref is
 * normalised to the `pkg:pypi/<name>@<version>` ref cdxgen assigns.
 *
 * @param {Object[]} dependencies Dependency entries from the embedded document
 * @param {string} distributionRef bom-ref of the distribution component
 * @param {string} [embeddedRootRef] bom-ref the embedded document uses for itself
 * @returns {Object[]} Rebased dependency entries
 */
declare function rebaseDependencies(dependencies: Object[], distributionRef: string, embeddedRootRef?: string): Object[];
/**
 * Parse one embedded document and tag its components with the distribution
 * that carried them.
 *
 * @param {string} text Raw document text
 * @param {string} source Provenance label (path or zip entry name)
 * @param {string} distribution `<name>-<version>` stem of the carrying distribution
 * @returns {Object|null} Parsed and tagged document, or null when unusable
 */
declare function parseEmbeddedSbom(text: string, source: string, distribution: string): Object | null;
/**
 * Discover and parse embedded SBOMs from installed distribution metadata
 * directories and wheel files, per PEP 770. Returns merged components,
 * dependencies, and citations ready for post-processing.
 *
 * Embedded components are returned as dependencies *of* the distribution that
 * supplied them, never as orphan top-level siblings. An embedded SBOM is
 * stronger than cdxgen's inference; the upstream component wins on conflict,
 * which the merge (trimComponents) records by unioning rather than discarding.
 *
 * @param {Object} input Discovery inputs
 * @param {string[]} [input.metadataFiles] Installed `*.dist-info/METADATA` paths
 * @param {string[]} [input.whlFiles] Wheel file paths
 * @returns {Promise<{components: Object[], dependencies: Object[], citations: Object[]}>}
 */
export declare function collectEmbeddedSboms({ metadataFiles, whlFiles, }?: {
    metadataFiles?: string[];
    whlFiles?: string[];
}): Promise<{
    components: Object[];
    dependencies: Object[];
    citations: Object[];
}>;
export declare const _internals: {
    MAX_EMBEDDED_SBOM_BYTES: number;
    parseEmbeddedSbom: typeof parseEmbeddedSbom;
    rebaseDependencies: typeof rebaseDependencies;
    pypiBomRef: typeof pypiBomRef;
    distNameVersionFromMetadata: typeof distNameVersionFromMetadata;
};
export {};
//# sourceMappingURL=pep770.d.ts.map