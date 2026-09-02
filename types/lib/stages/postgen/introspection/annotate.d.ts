/**
 * BOM mutations that carry the introspection verdict inside the document:
 * eight metadata properties and a block of document-level annotations.
 *
 * Sidecar report files get lost; the BOM travels. A consumer who receives
 * only the BOM still learns how much to trust it from the metadata properties,
 * and the annotations carry one entry per remediation the loop should act on.
 * No component or dependency is touched.
 *
 * Both mutations are replace-by-name: a document that was already introspected
 * (a BOM enriched again after an evidence pass) loses its previous
 * introspection state and gains a fresh one, so the verdict always describes
 * the final document.
 */
/**
 * Version of the introspection BOM surface. Matches the JSON report's
 * schemaVersion so the two stay comparable.
 *
 * @type {string}
 */
export declare const INTROSPECTION_SCHEMA_VERSION: string;
/**
 * Namespace of every property and annotation entry this module emits.
 *
 * @type {string}
 */
export declare const INTROSPECTION_PROPERTY_PREFIX: string;
/**
 * The metadata properties that summarize the verdict, in emission order. The
 * overall tier and confidence are omitted when the run produced no scored row
 * (nothing was graded, so no verdict is claimed); per-ecosystem rows cover the
 * scored ecosystems only, since unsupported ones have neither a tier nor a
 * score.
 *
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @returns {{name: string, value: string}[]} Metadata property entries.
 */
export declare function introspectionMetadataProperties(reflection: Object, scored: Object): {
    name: string;
    value: string;
}[];
/**
 * Attach the introspection verdict to the document: metadata properties plus
 * the summary and remediation annotations. Any introspection state left on the
 * document by a previous pass is removed first, so enrichment flows that run
 * post-processing twice leave exactly one verdict.
 *
 * @param {Object} bomJson CycloneDX BOM, mutated in place.
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [guards] Emission guards.
 * @param {boolean} [guards.annotations] False skips the annotations, for documents at a spec version that predates them.
 * @returns {Object} The mutated BOM.
 */
export declare function applyIntrospectionToBom(bomJson: Object, reflection: Object, scored: Object, guards?: {
    annotations?: boolean;
}): Object;
/**
 * Stamp every formulation workflow with the id of the run that reflected over
 * the document, so a later consumer of the BOM can tell a formulation record
 * this run generated from one that arrived with a foreign BOM. The stamp is
 * replace-by-name, matching how the rest of the verdict mutates the
 * document: a BOM enriched twice keeps only the latest run's id.
 *
 * @param {Object} bomJson CycloneDX BOM, mutated in place.
 * @param {string} runId Run id of the introspection pass.
 * @returns {Object} The mutated BOM.
 */
export declare function applyFormulationRunIdMarker(bomJson: Object, runId: string): Object;
/**
 * Whether a BOM already carries an introspection verdict.
 *
 * Evidence collection re-processes a finished BOM through a fresh wrapper, so
 * the document itself is the only marker that survives between passes.
 *
 * @param {Object} bomJson CycloneDX BOM.
 * @returns {boolean} True when the BOM was already introspected.
 */
export declare function hasIntrospectionVerdict(bomJson: Object): boolean;
//# sourceMappingURL=annotate.d.ts.map