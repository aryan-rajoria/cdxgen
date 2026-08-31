/**
 * Reflection: join what cdxgen did (the build ledger) with what it produced
 * (the BOM, through the build-fidelity rule pack) and commit to a per-
 * ecosystem fidelity verdict.
 *
 * The two evidence sources are kept independent on purpose. A finding backed
 * by both the ledger and a BOM-side rule is high confidence; either alone is
 * lower confidence. A ledger event with no BOM-side corroboration is reported
 * as an observation, never as a defect: an event says the run degraded
 * somewhere, but only the BOM shows whether the output paid for it. The
 * rule-only path is a first-class path — reflecting over a foreign BOM with
 * no ledger at all still produces a complete verdict.
 *
 * Every ecosystem present in the scan is assigned exactly one tier from the
 * ladder `resolved > lockfile > manifest > heuristic > absent`, or excluded
 * from scoring entirely as `unsupported` when its markers name an ecosystem
 * cdxgen has no project type for. Ties break toward the worse tier: a report
 * that overstates fidelity stops the remediation loop early, while one that
 * understates it merely costs an extra iteration.
 */
/**
 * The fidelity tier ladder, from healthiest to worst.
 *
 * @type {string[]}
 */
export declare const FIDELITY_TIERS: string[];
/**
 * Ecosystem states. `graded` rows carry a tier below their ceiling and are
 * the remediation loop's business; `at-ceiling` rows already parse as
 * completely as their ecosystem permits; `absent` rows produced zero
 * components for a supported ecosystem and are real failures; `unsupported`
 * rows are coverage gaps in cdxgen itself, excluded from the score.
 *
 * @type {string[]}
 */
export declare const ECOSYSTEM_STATES: string[];
/**
 * Ecosystems whose best achievable tier is below `resolved`, because the
 * ecosystem has no resolved graph for cdxgen to read. Any ecosystem not
 * listed here defaults to a ceiling of `resolved`, so a newly supported
 * ecosystem fails safe by demanding the most. Every entry below is backed by
 * a measurement recorded in the deliverable handoff; none is added from
 * reading a table.
 *
 * @type {Readonly<Record<string, string>>}
 */
export declare const ECOSYSTEM_CEILINGS: Readonly<Record<string, string>>;
/**
 * True when introspection is enabled for a run: the CLI option is set or the
 * documented environment opt-in is present. Everything in this module sits
 * behind this check, so a disabled run pays one boolean test.
 *
 * @param {Object} options CLI options.
 * @returns {boolean} True when the reflection should run.
 */
export { isIntrospectionEnabled } from "../../../core/buildLedger.js";
/**
 * Review a completed run and produce a per-ecosystem fidelity assessment.
 *
 * @param {Object} bomJson Generated CycloneDX BOM.
 * @param {Object} options CLI options.
 * @param {Object} [context] Overrides for testing.
 * @param {Object[]} [context.ledgerEvents] Events, defaulting to the sidecar or in-memory ledger.
 * @param {string} [context.ledgerSource] Force the reported ledger source.
 * @param {boolean} [context.ledgerComplete] Force the reported ledger completeness.
 * @param {string} [context.projectPath] Directory scanned, for marker detection.
 * @param {Object} [context.markerHooks] Directory-lister overrides for marker detection tests.
 * @returns {Promise<Object>} The reflection document.
 */
export declare function reflectOnRun(bomJson: Object, options?: Object, context?: {
    ledgerEvents?: Object[];
    ledgerSource?: string;
    ledgerComplete?: boolean;
    projectPath?: string;
    markerHooks?: Object;
}): Promise<Object>;
//# sourceMappingURL=reflect.d.ts.map