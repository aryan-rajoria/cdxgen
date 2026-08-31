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

import { SEVERITY_ORDER } from "../../../core/severity.js";

/**
 * Base score per fidelity tier, from healthiest to worst.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const TIER_BASE_SCORES = Object.freeze({
  resolved: 100,
  lockfile: 85,
  manifest: 55,
  heuristic: 25,
  absent: 0,
});

/**
 * The fidelity ladder, healthiest first, shared by the rank arithmetic and the
 * rule-derived target selection.
 *
 * @type {Readonly<string[]>}
 */
export const TIER_LADDER = Object.freeze([
  "resolved",
  "lockfile",
  "manifest",
  "heuristic",
  "absent",
]);

/** Ladder position of each tier; higher is worse. */
const TIER_RANK = new Map(TIER_LADDER.map((tier, index) => [tier, index]));

/** Deduction applied for each entry in a row's toolsMissing array. */
const TOOL_MISSING_DEDUCTION = 8;
/** Deduction applied for each entry in a row's toolsMismatched array. */
const TOOL_MISMATCH_DEDUCTION = 5;
/** Extra deduction for a degradation whose catalog kind is command.failed. */
const COMMAND_FAILED_DEDUCTION = 6;
/** Deduction per distinct remediation id, keyed by the degradation's impact. */
const IMPACT_DEDUCTIONS = Object.freeze({
  "transitive-deps": 10,
  versions: 6,
  integrity: 6,
  components: 8,
  licenses: 3,
  none: 0,
});

/** Widest a score may fall below its tier base. */
const MAX_DEDUCTION_SPAN = 15;

/**
 * Closed vocabulary for catalog action kinds. `container` proposes running
 * cdxgen inside the official image for toolchains that are impractical to
 * provision on the host.
 *
 * @type {Readonly<string[]>}
 */
export const REMEDIATION_ACTION_KINDS = Object.freeze([
  "install",
  "env",
  "build",
  "config",
  "container",
  "rerun",
]);

/**
 * Action kinds that need outbound network access, and are therefore blocked
 * when the run was offline or under a command-execution policy.
 *
 * @type {ReadonlySet<string>}
 */
export const NETWORK_ACTION_KINDS = new Set(["install", "build", "container"]);

/**
 * Provisioners a catalog action can depend on. An action whose `via` names one
 * of these is blocked when the run recorded the provisioner as unavailable.
 *
 * @type {ReadonlySet<string>}
 */
export const PROVISIONER_TOOLS = new Set([
  "sdk",
  "sdkman",
  "nvm",
  "rbenv",
  "winget",
]);

/** Ledger remediation id whose presence in the observations marks an offline run. */
const OFFLINE_REMEDIATION_ID = "policy.offline";

/** Ledger event kinds that describe a tool or provisioner failing. */
const UNAVAILABLE_KINDS = new Set([
  "tool.missing",
  "command.failed",
  "evidence.degraded",
]);

/**
 * Clamp a number into a closed range.
 *
 * @param {number} value Value to clamp.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round to two decimal places for stable expected-gain reporting.
 *
 * @param {number} value Value to round.
 * @returns {number} Value rounded to 0.01.
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Order a list of rows by ecosystem name so every downstream sum, mean and
 * ranking iterates the same sequence regardless of how the reflection was
 * assembled.
 *
 * @param {Object[]} rows Ecosystem rows from the reflection.
 * @returns {Object[]} Rows sorted by ecosystem name.
 */
function sortedRows(rows) {
  return [...(rows || [])].sort((a, b) =>
    `${a?.ecosystem || ""}`.localeCompare(`${b?.ecosystem || ""}`),
  );
}

/**
 * Resolve the effective weight of a scored row in the overall mean. Absent
 * ecosystems carry component weight 1 rather than 0 — an ecosystem cdxgen
 * produced nothing for must stay visible in the score, which is the failure
 * the feature exists to catch.
 *
 * @param {Object} row Ecosystem row.
 * @returns {number} Positive weight.
 */
function rowWeight(row) {
  if (row.state === "absent") {
    return 1;
  }
  const count = Number(row.componentCount);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * Confidence that the row's verdict reflects reality, derived from the
 * corroboration between the ledger and the rule pack. `high` needs both
 * sources on the row, `low` covers an absent or incomplete ledger and
 * disk-marker-only verdicts, and everything else is `medium`.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object} reflection Reflection document.
 * @returns {"high"|"medium"|"low"} Confidence label.
 */
export function confidenceFor(row, reflection) {
  const reasons = Array.isArray(row?.tierReasons) ? row.tierReasons : [];
  const determining = reasons.filter((reason) => reason?.determining);
  if (
    reflection?.ledgerSource === "none" ||
    reflection?.ledgerComplete === false ||
    (determining.length > 0 &&
      determining.every((reason) => reason?.source === "disk"))
  ) {
    return "low";
  }
  const sources = new Set(reasons.map((reason) => reason?.source));
  if (sources.has("ledger") && sources.has("rule")) {
    return "high";
  }
  return "medium";
}

/**
 * Sort a row's degradations by remediation id and merge duplicates, so the
 * deduction and remediation arithmetic never depends on the order the events
 * arrived in. The representative of a merged group is chosen after sorting,
 * so even its detail text is shuffle-stable.
 *
 * @param {Object} row Ecosystem row.
 * @returns {{remediationId: string, impact: string, detail: string, count: number}[]} Deduplicated degradations, sorted by id.
 */
function mergedDegradations(row) {
  const all = (Array.isArray(row?.degradations) ? row.degradations : []).map(
    (degradation) => ({
      id: `${degradation?.remediationId || ""}`,
      impact: degradation?.impact,
      detail: degradation?.detail,
    }),
  );
  all.sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      `${a.detail || ""}`.localeCompare(`${b.detail || ""}`) ||
      `${a.impact || ""}`.localeCompare(`${b.impact || ""}`),
  );
  const merged = [];
  for (const degradation of all) {
    const last = merged[merged.length - 1];
    if (last && last.remediationId === degradation.id) {
      last.count += 1;
      continue;
    }
    merged.push({
      remediationId: degradation.id,
      impact: degradation.impact,
      detail: degradation.detail,
      count: 1,
    });
  }
  return merged;
}

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
export function deductionsFor(row, catalog) {
  let total = 0;
  const byRemediationId = new Map();
  const missingCount = Array.isArray(row?.toolsMissing)
    ? row.toolsMissing.length
    : 0;
  const mismatchCount = Array.isArray(row?.toolsMismatched)
    ? row.toolsMismatched.length
    : 0;
  total += missingCount * TOOL_MISSING_DEDUCTION;
  total += mismatchCount * TOOL_MISMATCH_DEDUCTION;
  for (const degradation of mergedDegradations(row)) {
    const entry = catalog?.[degradation.remediationId];
    const amount =
      (IMPACT_DEDUCTIONS[degradation.impact] ?? 0) +
      (entry?.kind === "command.failed" ? COMMAND_FAILED_DEDUCTION : 0);
    byRemediationId.set(degradation.remediationId, amount);
    total += amount;
  }
  return { total, byRemediationId };
}

/**
 * Score one ecosystem row. At-ceiling rows score 100 whatever their tier and
 * unsupported rows score nothing at all — they sit outside the mean.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object|null} catalog Remediation catalog keyed by id.
 * @returns {{score: number, base: number, deduction: number, weight: number}|null} Score facts, or null for unsupported rows.
 */
export function scoreEcosystemRow(row, catalog) {
  if (!row || row.state === "unsupported") {
    return null;
  }
  const weight = rowWeight(row);
  if (row.state === "at-ceiling") {
    return { score: 100, base: 100, deduction: 0, weight };
  }
  const tier = TIER_RANK.has(row.tier) ? row.tier : "absent";
  const base = TIER_BASE_SCORES[tier];
  const deduction = deductionsFor(row, catalog).total;
  const floor = Math.max(0, base - MAX_DEDUCTION_SPAN);
  const score = clamp(base - deduction, floor, 100);
  return { score, base, deduction, weight };
}

/**
 * Score the ecosystem would reach at a target tier once a given remediation's
 * own deduction is gone. Deductions from other sources stay, so the projection
 * stays honest about what one remediation alone can recover.
 *
 * @param {string} targetTier Tier the remediation aims for.
 * @param {number} totalDeduction Current total deduction for the row.
 * @param {number} removedDeduction Deduction attributable to this remediation.
 * @returns {number} Projected score.
 */
function projectedScore(targetTier, totalDeduction, removedDeduction) {
  const base = TIER_BASE_SCORES[targetTier] ?? TIER_BASE_SCORES.absent;
  const floor = Math.max(0, base - MAX_DEDUCTION_SPAN);
  return clamp(base - (totalDeduction - removedDeduction), floor, 100);
}

/**
 * Expected version a row declared for a tool, resolved deterministically when
 * several sources declared one: candidates are ordered by source, then wanted
 * value, and the first wins.
 *
 * @param {Object} row Ecosystem row.
 * @param {string} tool Tool name from a catalog action.
 * @returns {string|undefined} Declared version, when the row recorded one.
 */
function expectedVersionFor(row, tool) {
  const candidates = (
    Array.isArray(row?.toolsExpected) ? row.toolsExpected : []
  )
    .filter((entry) => entry?.tool === tool && entry?.wanted)
    .sort(
      (a, b) =>
        `${a.source || ""}`.localeCompare(`${b.source || ""}`) ||
        `${a.wanted}`.localeCompare(`${b.wanted}`),
    );
  return candidates[0]?.wanted;
}

/**
 * Fill the `{{version}}` and `{{major}}` placeholders of an action command
 * from the row's declared expectations, leaving the placeholder for the agent
 * to resolve when the run recorded no expected version.
 *
 * @param {Object} action Catalog action.
 * @param {Object} row Ecosystem row.
 * @returns {string|undefined} Command with placeholders resolved where possible.
 */
function resolveActionCommand(action, row) {
  const command = action?.command;
  if (!command?.includes("{{")) {
    return command;
  }
  const expected = expectedVersionFor(row, action?.tool);
  if (!expected) {
    return command;
  }
  const major = expected.split(/[.-]/)[0] || "";
  return command
    .split("{{version}}")
    .join(expected)
    .split("{{major}}")
    .join(major);
}

/**
 * Provisioners the run recorded as unavailable, so remediations that depend on
 * one can be blocked instead of sending the loop off to retry an impossible
 * fix.
 *
 * @param {Object} reflection Reflection document.
 * @returns {string[]} Provisioner names recorded as unavailable.
 */
function unavailableProvisionersFromReflection(reflection) {
  const unavailable = new Set();
  const mark = (name) => {
    if (name && PROVISIONER_TOOLS.has(name)) {
      unavailable.add(name);
    }
  };
  for (const row of sortedRows(reflection?.ecosystems)) {
    for (const entry of Array.isArray(row?.toolsMissing)
      ? row.toolsMissing
      : []) {
      mark(entry?.source);
      mark(entry?.tool);
    }
  }
  for (const observation of Array.isArray(reflection?.observations)
    ? reflection.observations
    : []) {
    if (observation && UNAVAILABLE_KINDS.has(observation.kind)) {
      mark(observation.tool);
    }
  }
  return [...unavailable].sort((a, b) => a.localeCompare(b));
}

/**
 * Reasons a remediation cannot run in this environment. Every action must be
 * runnable for the remediation to proceed; a single blocked action blocks the
 * entry while keeping its expected gain visible to human readers.
 *
 * @param {Object[]} actions Resolved catalog actions.
 * @param {Object} runContext Run facts: secureMode, offline, inContainer, unavailableProvisioners.
 * @returns {string[]} Blocked reasons, one per blocked action.
 */
function blockedReasonsFor(actions, runContext) {
  const reasons = [];
  for (const action of actions) {
    if (
      NETWORK_ACTION_KINDS.has(action?.kind) &&
      (runContext.secureMode || runContext.offline)
    ) {
      reasons.push(
        `the ${action.kind} action needs network access and this run is offline or under a command-execution policy`,
      );
      continue;
    }
    if (
      action?.via &&
      PROVISIONER_TOOLS.has(action.via) &&
      runContext.unavailableProvisioners.includes(action.via)
    ) {
      reasons.push(
        `the ${action.via} provisioner was recorded as unavailable during the run`,
      );
      continue;
    }
    if (action?.kind === "container" && runContext.inContainer) {
      reasons.push(
        "the action proposes a container run while cdxgen itself is already inside a container",
      );
    }
  }
  return reasons;
}

/**
 * Build the remediation entries for one row: catalog entries from the row's
 * corroborated degradations plus one entry per demoting rule finding. Each
 * entry carries the projection arithmetic it was ranked with, so the report
 * can show its work.
 *
 * @param {Object} row Ecosystem row.
 * @param {Object} scored Row score facts from scoreEcosystemRow.
 * @param {Object} deductionSplit Deductions keyed by remediation id.
 * @param {Object} reflection Reflection document.
 * @param {Object|null} catalog Remediation catalog keyed by id.
 * @param {Object} runContext Run facts used for blocked detection.
 * @param {number} weightsTotal Sum of all scored row weights.
 * @returns {Object[]} Unranked remediation entries with positive expected gain.
 */
function buildRemediationsForRow(
  row,
  scored,
  deductionSplit,
  reflection,
  catalog,
  runContext,
  weightsTotal,
) {
  const confidence = confidenceFor(row, reflection);
  const ceilingRank = TIER_RANK.has(row.ceilingTier)
    ? TIER_RANK.get(row.ceilingTier)
    : TIER_RANK.get("resolved");
  const entries = [];

  for (const degradation of mergedDegradations(row)) {
    const catalogEntry = catalog?.[degradation.remediationId];
    if (!catalogEntry) {
      continue;
    }
    const requestedTier = TIER_RANK.has(catalogEntry.targetTier)
      ? catalogEntry.targetTier
      : undefined;
    const currentTier = TIER_RANK.has(row.tier) ? row.tier : "absent";
    // A remediation may not promise a tier better than the ecosystem's
    // ceiling: the loop would chase a score the ecosystem can never reach.
    // A catalog entry that names no tier is tier-neutral — a policy or
    // configuration fix that recovers its own deduction without moving the
    // row up the ladder — so it targets the tier the row already holds and
    // earns whatever its deduction was worth.
    const capped =
      requestedTier && TIER_RANK.get(requestedTier) < ceilingRank
        ? TIER_LADDER[ceilingRank]
        : requestedTier;
    const targetTier = capped || currentTier;
    if (capped && TIER_RANK.get(capped) >= TIER_RANK.get(currentTier)) {
      continue;
    }
    const actions = Array.isArray(catalogEntry.actions)
      ? catalogEntry.actions.map((action) => ({
          ...action,
          command: resolveActionCommand(action, row),
          windows:
            typeof action?.windows === "string" && action.windows.includes("{{")
              ? resolveActionCommand(
                  { ...action, command: action.windows },
                  row,
                )
              : action?.windows,
        }))
      : [];
    const blockedReasons = blockedReasonsFor(actions, runContext);
    const projected = projectedScore(
      targetTier,
      scored.deduction,
      deductionSplit.get(degradation.remediationId) || 0,
    );
    entries.push({
      remediationId: degradation.remediationId,
      source: "ledger",
      ecosystem: row.ecosystem,
      confidence,
      summary: catalogEntry.title,
      actions,
      verify: catalogEntry.verify,
      docs: catalogEntry.docs,
      impact: degradation.impact,
      targetTier,
      currentScore: scored.score,
      projectedScore: projected,
      expectedGain: round2(
        ((projected - scored.score) * scored.weight) / weightsTotal,
      ),
      evidenceCount: degradation.count,
      blocked: blockedReasons.length > 0,
      blockedReason: [...new Set(blockedReasons)].join("; ") || undefined,
    });
  }

  const seenRuleIds = new Set();
  // Sorting before the dedupe keeps the surviving representative of a
  // repeated rule id independent of the order the findings arrived in.
  const sortedFindings = [
    ...(Array.isArray(row?.findings) ? row.findings : []),
  ].sort(
    (a, b) =>
      `${a?.ruleId || ""}`.localeCompare(`${b?.ruleId || ""}`) ||
      `${a?.message || ""}`.localeCompare(`${b?.message || ""}`),
  );
  for (const finding of sortedFindings) {
    const ruleId = `${finding?.ruleId || ""}`;
    if (!ruleId || seenRuleIds.has(ruleId)) {
      continue;
    }
    seenRuleIds.add(ruleId);
    const signalRank = TIER_RANK.get(finding?.tierSignal);
    if (signalRank === undefined || signalRank === 0) {
      continue;
    }
    // A rule finding demotes the row to its tier signal; resolving it lifts
    // the row one rung, never past the ecosystem's ceiling.
    let targetTier = TIER_LADDER[signalRank - 1];
    if (TIER_RANK.get(targetTier) < ceilingRank) {
      targetTier = TIER_LADDER[ceilingRank];
    }
    if (
      !targetTier ||
      TIER_RANK.get(targetTier) >= TIER_RANK.get(row.tier || "absent")
    ) {
      continue;
    }
    const projected = projectedScore(targetTier, scored.deduction, 0);
    entries.push({
      remediationId: ruleId,
      source: "rule",
      ecosystem: row.ecosystem,
      confidence,
      summary: finding.message,
      guidance: finding.mitigation,
      actions: [],
      verify: { rules: [ruleId], expectTier: targetTier },
      impact: undefined,
      targetTier,
      severity: finding.severity,
      currentScore: scored.score,
      projectedScore: projected,
      expectedGain: round2(
        ((projected - scored.score) * scored.weight) / weightsTotal,
      ),
      evidenceCount: 1,
      blocked: false,
      blockedReason: undefined,
    });
  }

  // Filtered on the projection rather than the rounded gain: a single-component
  // ecosystem inside a large monorepo can carry a real recovery worth less than
  // 0.01 of the overall score, and dropping it would hide the very ecosystem
  // the weighting already speaks quietly about.
  // Ranked before folding so a subsumed rule lands on the best fix that clears
  // it, which is the one the loop reads first.
  return subsumeRuleEntries(
    rankRemediations(
      entries.filter((entry) => entry.projectedScore > entry.currentScore),
    ),
  );
}

/**
 * Fold rule-derived entries into the ledger entry that already promises to
 * clear them.
 *
 * A catalog entry's `verify.rules` names the findings its fix resolves, so a
 * separate entry for one of those rules is the same repair counted twice: the
 * loop would be told three things need fixing when doing the first makes the
 * other two disappear. The rule ids move onto the surviving entry as
 * `subsumes`, so nothing the run detected goes unreported.
 *
 * @param {Object[]} entries Remediation entries for one ecosystem.
 * @returns {Object[]} Entries with subsumed rule entries folded in.
 */
function subsumeRuleEntries(entries) {
  const coveredBy = new Map();
  for (const entry of entries) {
    if (entry.source !== "ledger") {
      continue;
    }
    for (const ruleId of Array.isArray(entry.verify?.rules)
      ? entry.verify.rules
      : []) {
      if (!coveredBy.has(ruleId)) {
        coveredBy.set(ruleId, entry);
      }
    }
  }
  if (!coveredBy.size) {
    return entries;
  }
  const kept = [];
  for (const entry of entries) {
    const cover =
      entry.source === "rule" ? coveredBy.get(entry.remediationId) : undefined;
    if (!cover) {
      kept.push(entry);
      continue;
    }
    cover.subsumes = [
      ...new Set([...(cover.subsumes || []), entry.remediationId]),
    ].sort();
  }
  return kept;
}

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
export function rankRemediations(entries) {
  return [...(entries || [])].sort(
    (a, b) =>
      b.expectedGain - a.expectedGain ||
      b.projectedScore - b.currentScore - (a.projectedScore - a.currentScore) ||
      (SEVERITY_ORDER[b.confidence] ?? -1) -
        (SEVERITY_ORDER[a.confidence] ?? -1) ||
      `${a.remediationId}`.localeCompare(`${b.remediationId}`),
  );
}

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
 * @returns {Object} Scoring document with the overall score, per-ecosystem scores, coverage gaps and the ranked remediation list.
 */
export function scoreReflection(reflection, catalog, runContext = {}) {
  const rows = sortedRows(reflection?.ecosystems);
  const observations = Array.isArray(reflection?.observations)
    ? reflection.observations
    : [];
  const runContextResolved = {
    secureMode: runContext.secureMode === true,
    inContainer: runContext.inContainer === true,
    offline:
      runContext.offline ??
      observations.some(
        (observation) => observation?.remediationId === OFFLINE_REMEDIATION_ID,
      ),
    unavailableProvisioners:
      runContext.unavailableProvisioners ||
      unavailableProvisionersFromReflection(reflection),
  };

  const unsupported = [];
  const pending = [];
  let weightedTotal = 0;
  let weightsTotal = 0;
  for (const row of rows) {
    if (row?.state === "unsupported") {
      unsupported.push({
        ecosystem: row.ecosystem,
        markersOnDisk: Array.isArray(row.markersOnDisk)
          ? row.markersOnDisk
          : [],
      });
      continue;
    }
    const scored = scoreEcosystemRow(row, catalog);
    if (!scored) {
      continue;
    }
    weightedTotal += scored.score * scored.weight;
    weightsTotal += scored.weight;
    pending.push({ row, scored });
  }
  // The gain fraction of a remediation is measured against the full scored
  // set, so the weights must be complete before any entry is built.
  const safeWeightsTotal = Math.max(weightsTotal, 1);
  const scoredRows = [];
  const allRemediations = [];
  for (const { row, scored } of pending) {
    const ecosystemEntry = {
      ecosystem: row.ecosystem,
      state: row.state,
      tier: row.tier,
      ceilingTier: row.ceilingTier,
      componentCount: row.componentCount || 0,
      dependencyEdgeCount: row.dependencyEdgeCount || 0,
      confidence: confidenceFor(row, reflection),
      weight: scored.weight,
      base: scored.base,
      deduction: scored.deduction,
      score: scored.score,
      remediations: [],
    };
    scoredRows.push(ecosystemEntry);
    if (row.state === "at-ceiling") {
      continue;
    }
    const { byRemediationId } = deductionsFor(row, catalog);
    const remediations = buildRemediationsForRow(
      row,
      scored,
      byRemediationId,
      reflection,
      catalog,
      runContextResolved,
      safeWeightsTotal,
    );
    ecosystemEntry.remediations = rankRemediations(remediations);
    allRemediations.push(...remediations);
  }

  return {
    overallScore:
      weightsTotal > 0 ? Math.round(weightedTotal / safeWeightsTotal) : 100,
    weightsTotal,
    ecosystems: scoredRows,
    unsupported,
    remediations: rankRemediations(allRemediations),
  };
}
