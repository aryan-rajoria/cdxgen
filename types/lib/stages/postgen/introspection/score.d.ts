/**
 * Scoring and remediation ranking over a completed reflection document.
 *
 * Every function here is pure: the reflection produced by `reflect.js` is the
 * only evidence input, the remediation catalog is a static lookup passed in by
 * the caller, and nothing reads the ledger, the BOM, or the filesystem. The
 * same reflection therefore always yields the same score, on every runtime.
 *
 * The score is the gradient and the tier is the verdict: an ecosystem at its
 * ceiling scores 100 and emits nothing (a manifest-tier helm chart is a
 * success, not a nagging opportunity), an unsupported ecosystem is excluded
 * from the mean entirely (a missing Elm parser is a coverage gap, not a
 * project defect), and everything else starts from its tier base and loses
 * points for each tool fact and corroborated degradation the reflection
 * recorded. Deductions are floored at the tier base minus 15 so a single
 * ecosystem can never fall out of its tier's band.
 */
/**
 * Base score per fidelity tier, from healthiest to worst.
 *
 * @type {Readonly<Record<string, number>>}
 */
export declare const TIER_BASE_SCORES: Readonly<Record<string, number>>;
/**
 * The fidelity ladder, healthiest first, shared by the rank arithmetic and the
 * rule-derived target selection.
 *
 * @type {Readonly<string[]>}
 */
export declare const TIER_LADDER: Readonly<string[]>;
/**
 * Closed vocabulary for catalog action kinds. `container` proposes running
 * cdxgen inside the official image for toolchains that are impractical to
 * provision on the host.
 *
 * @type {Readonly<string[]>}
 */
export declare const REMEDIATION_ACTION_KINDS: Readonly<string[]>;
/**
 * Action kinds that need outbound network access, and are therefore blocked
 * when the run was offline or under a command-execution policy.
 *
 * @type {ReadonlySet<string>}
 */
export declare const NETWORK_ACTION_KINDS: ReadonlySet<string>;
/**
 * Provisioners a catalog action can depend on. An action whose `via` names one
 * of these is blocked when the run recorded the provisioner as unavailable.
 *
 * @type {ReadonlySet<string>}
 */
export declare const PROVISIONER_TOOLS: ReadonlySet<string>;
/**
 * Confidence that the row's verdict reflects reality, derived from the
 * corroboration between the ledger and the rule pack. `high` needs both
 * sources on the row, `low` covers an absent or incomplete ledger and
 * disk-marker-only verdicts, and everything else is `medium`.
 *
 * A foreign BOM's formulation is the asymmetric case. It substitutes for the
 * absent ledger events as primary evidence, which lifts the verdict off the
 * marker-only floor; because the run was never observed, `medium` is a cap
 * it can never exceed, and a formulation without a toolchain record leaves
 * the row at `low`. On a same-run scan the formulation is the ledger's own
 * evidence reported twice, so it moves nothing in either direction.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object} reflection Reflection document.
 * @returns {"high"|"medium"|"low"} Confidence label.
 */
export declare function confidenceFor(row: Object, reflection: Object): "high" | "medium" | "low";
/**
 * Total score deduction for a row: one amount per missing or mismatched tool,
 * plus one impact-keyed amount per distinct corroborated remediation id. The
 * catalog supplies the kind behind each id, so a `command.failed` event keeps
 * its own extra deduction even though the reflection stores degradations by
 * id.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object|null} catalog Remediation catalog keyed by id.
 * @returns {{total: number, byRemediationId: Map<string, number>}} Total deduction and the per-remediation split.
 */
export declare function deductionsFor(row: Object, catalog: Object | null): {
    total: number;
    byRemediationId: Map<string, number>;
};
/**
 * Score one ecosystem row. At-ceiling rows score 100 whatever their tier and
 * unsupported rows score nothing at all — they sit outside the mean.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object|null} catalog Remediation catalog keyed by id.
 * @returns {{score: number, base: number, deduction: number, weight: number}|null} Score facts, or null for unsupported rows.
 */
export declare function scoreEcosystemRow(row: Object, catalog: Object | null): {
    score: number;
    base: number;
    deduction: number;
    weight: number;
} | null;
export type ResolvedActionVersion = {
    /**
     * Declared version, when a source answered.
     */
    version: string | undefined;
    /**
     * Cascade band that answered.
     */
    versionFrom: "mismatch" | "pin" | "expected" | "unresolved";
    /**
     * Where the version came from.
     */
    versionSource: string | undefined;
    /**
     * True when no source answered.
     */
    versionSourceMissing: boolean | undefined;
};
/**
 * Order remediations for the loop: the largest expected gain first, then the
 * largest per-ecosystem recovery, then the most confident evidence, then the
 * id — a total order, so the sequence is identical no matter how the input
 * findings were ordered. The per-ecosystem recovery separates entries whose
 * weighted gains round to the same hundredth.
 *
 * @param {Object[]} entries Remediation entries.
 * @returns {Object[]} Ranked copy of the entries.
 */
export declare function rankRemediations(entries: Object[]): Object[];
/**
 * Score a completed reflection and rank everything an agent could do next.
 *
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object|null} catalog Remediation catalog keyed by id (data/remediations.json).
 * @param {Object} [runContext] Run facts the reflection cannot carry.
 * @param {boolean} [runContext.secureMode] The run executed under secure mode or a command policy.
 * @param {boolean} [runContext.inContainer] The run executed inside a container.
 * @param {boolean} [runContext.offline] Overrides the offline fact derived from the ledger observations.
 * @param {string[]} [runContext.unavailableProvisioners] Overrides the provisioners derived from the reflection.
 * @param {Object} [runContext.commandFacts] Project facts the command variables (`{{mvn}}`, `{{gradle}}`, `{{pythonManager}}`, `{{npmClient}}`) resolve from; without them the variables fall back to the plain executables.
 * @returns {Object} Scoring document with the overall score, per-ecosystem scores, coverage gaps and the ranked remediation list.
 */
export declare function scoreReflection(reflection: Object, catalog: Object | null, runContext?: {
    secureMode?: boolean;
    inContainer?: boolean;
    offline?: boolean;
    unavailableProvisioners?: string[];
    commandFacts?: Object;
}): Object;
//# sourceMappingURL=score.d.ts.map