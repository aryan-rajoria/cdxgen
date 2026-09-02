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

import {
  buildDocumentAnnotation,
  evidenceProperties,
} from "../annotationBuilder.js";
import { FORMULATION_RUN_ID_PROPERTY } from "./formulationEvidence.js";
import { overallAssessment } from "./report.js";

/**
 * Version of the introspection BOM surface. Matches the JSON report's
 * schemaVersion so the two stay comparable.
 *
 * @type {string}
 */
export const INTROSPECTION_SCHEMA_VERSION = "1.1";

/**
 * Namespace of every property and annotation entry this module emits.
 *
 * @type {string}
 */
export const INTROSPECTION_PROPERTY_PREFIX = "cdx:introspection";

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
export function introspectionMetadataProperties(reflection, scored) {
  const assessment = overallAssessment(scored);
  const properties = [
    {
      name: `${INTROSPECTION_PROPERTY_PREFIX}:schemaVersion`,
      value: INTROSPECTION_SCHEMA_VERSION,
    },
  ];
  if (assessment.tier) {
    properties.push({
      name: `${INTROSPECTION_PROPERTY_PREFIX}:tier`,
      value: assessment.tier,
    });
  }
  properties.push({
    name: `${INTROSPECTION_PROPERTY_PREFIX}:score`,
    value: String(scored?.overallScore ?? 100),
  });
  if (assessment.confidence) {
    properties.push({
      name: `${INTROSPECTION_PROPERTY_PREFIX}:confidence`,
      value: assessment.confidence,
    });
  }
  properties.push({
    name: `${INTROSPECTION_PROPERTY_PREFIX}:ledgerComplete`,
    value: String(reflection?.ledgerComplete !== false),
  });
  for (const row of sortedScoredRows(scored)) {
    properties.push({
      name: `${INTROSPECTION_PROPERTY_PREFIX}:ecosystem:${row.ecosystem}:tier`,
      value: `${row.tier}`,
    });
    properties.push({
      name: `${INTROSPECTION_PROPERTY_PREFIX}:ecosystem:${row.ecosystem}:score`,
      value: String(row.score),
    });
  }
  properties.push({
    name: `${INTROSPECTION_PROPERTY_PREFIX}:remediationCount`,
    value: String(actionableRemediations(scored).length),
  });
  return properties;
}

/**
 * The annotation describing the run as a whole. Its structured facts are the
 * metadata properties, so the summary is readable without the rest of the
 * document.
 *
 * @param {Object} bomJson CycloneDX BOM the annotation describes.
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @returns {Object|undefined} The summary annotation, or undefined without a cdxgen annotator.
 */
function summaryAnnotation(bomJson, reflection, scored) {
  const assessment = overallAssessment(scored);
  const remediationCount = (
    Array.isArray(scored?.remediations) ? scored.remediations : []
  ).length;
  // Annotation text is escaped as markdown before it reaches the BOM, so the
  // summary is phrased without brackets or pipes that would survive as
  // backslashes in the rendered document.
  const message =
    `Build introspection: overall tier ${assessment.tier ?? "ungraded"}, ` +
    `score ${scored?.overallScore ?? 100} of 100, ` +
    `confidence ${assessment.confidence ?? "not available"}. ` +
    `${remediationCount} remediation${remediationCount === 1 ? "" : "s"} ranked.`;
  return buildDocumentAnnotation({
    bomJson,
    message,
    properties: introspectionMetadataProperties(reflection, scored),
  });
}

/**
 * One annotation per non-blocked remediation, in ranked order. Blocked
 * entries are constraints of the environment rather than work the loop can
 * do, so they stay in the report files and out of the document. A remediation
 * that subsumes other rules names them, so nothing the run detected goes
 * unreported.
 *
 * @param {Object} bomJson CycloneDX BOM the annotations describe.
 * @param {Object} scored Scoring document from scoreReflection.
 * @returns {Object[]} Remediation annotations.
 */
function remediationAnnotations(bomJson, scored) {
  const tierByEcosystem = new Map(
    sortedScoredRows(scored).map((row) => [row.ecosystem, row.tier]),
  );
  const annotations = [];
  for (const entry of actionableRemediations(scored)) {
    const properties = [
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:remediationId`,
        value: `${entry.remediationId}`,
      },
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:ecosystem`,
        value: `${entry.ecosystem}`,
      },
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:currentTier`,
        value: `${tierByEcosystem.get(entry.ecosystem) || entry.targetTier}`,
      },
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:targetTier`,
        value: `${entry.targetTier}`,
      },
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:expectedGain`,
        value: Number(entry.expectedGain ?? 0).toFixed(2),
      },
      {
        name: `${INTROSPECTION_PROPERTY_PREFIX}:confidence`,
        value: `${entry.confidence}`,
      },
    ];
    const rules = Array.isArray(entry.verify?.rules) ? entry.verify.rules : [];
    if (rules.length) {
      properties.push({
        name: `${INTROSPECTION_PROPERTY_PREFIX}:verify:rules`,
        value: rules.join(","),
      });
    }
    const evidence = { source: entry.source };
    if (entry.impact) {
      evidence.impact = entry.impact;
    }
    if (entry.severity) {
      evidence.severity = entry.severity;
    }
    if (Number.isFinite(entry.evidenceCount)) {
      evidence.events = entry.evidenceCount;
    }
    if (Array.isArray(entry.subsumes) && entry.subsumes.length) {
      evidence.subsumes = entry.subsumes;
    }
    if (
      Array.isArray(entry.verify?.eventsCleared) &&
      entry.verify.eventsCleared.length
    ) {
      evidence.eventsCleared = entry.verify.eventsCleared;
    }
    properties.push(
      ...evidenceProperties(INTROSPECTION_PROPERTY_PREFIX, evidence),
    );
    const annotation = buildDocumentAnnotation({
      bomJson,
      message: `${entry.summary || entry.remediationId}`,
      properties,
    });
    if (annotation) {
      annotations.push(annotation);
    }
  }
  return annotations;
}

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
export function applyIntrospectionToBom(
  bomJson,
  reflection,
  scored,
  guards = {},
) {
  if (!bomJson?.metadata) {
    return bomJson;
  }
  const freshProperties = introspectionMetadataProperties(reflection, scored);
  const retainedProperties = (
    Array.isArray(bomJson.metadata.properties)
      ? bomJson.metadata.properties
      : []
  ).filter(
    (property) =>
      !`${property?.name || ""}`.startsWith(INTROSPECTION_PROPERTY_PREFIX),
  );
  bomJson.metadata.properties = [...retainedProperties, ...freshProperties];
  if (guards.annotations === false) {
    return bomJson;
  }
  const retainedAnnotations = (
    Array.isArray(bomJson.annotations) ? bomJson.annotations : []
  ).filter(
    (annotation) =>
      !`${annotation?.text || ""}`.includes(INTROSPECTION_PROPERTY_PREFIX),
  );
  const freshAnnotations = [
    summaryAnnotation(bomJson, reflection, scored),
    ...remediationAnnotations(bomJson, scored),
  ].filter(Boolean);
  if (freshAnnotations.length) {
    bomJson.annotations = [...retainedAnnotations, ...freshAnnotations];
  }
  return bomJson;
}

/** Scored rows in ecosystem order. */
function sortedScoredRows(scored) {
  return [...(Array.isArray(scored?.ecosystems) ? scored.ecosystems : [])]
    .filter((row) => row?.ecosystem)
    .sort((a, b) => `${a.ecosystem}`.localeCompare(`${b.ecosystem}`));
}

/** Remediations the loop can act on, in ranked order. */
function actionableRemediations(scored) {
  return (
    Array.isArray(scored?.remediations) ? scored.remediations : []
  ).filter((entry) => entry?.blocked !== true);
}

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
export function applyFormulationRunIdMarker(bomJson, runId) {
  if (!bomJson || !runId) {
    return bomJson;
  }
  for (const entry of Array.isArray(bomJson.formulation)
    ? bomJson.formulation
    : []) {
    for (const workflow of Array.isArray(entry?.workflows)
      ? entry.workflows
      : []) {
      const retained = (
        Array.isArray(workflow.properties) ? workflow.properties : []
      ).filter((property) => property?.name !== FORMULATION_RUN_ID_PROPERTY);
      workflow.properties = [
        ...retained,
        { name: FORMULATION_RUN_ID_PROPERTY, value: runId },
      ];
    }
  }
  return bomJson;
}

/**
 * Whether a BOM already carries an introspection verdict.
 *
 * Evidence collection re-processes a finished BOM through a fresh wrapper, so
 * the document itself is the only marker that survives between passes.
 *
 * @param {Object} bomJson CycloneDX BOM.
 * @returns {boolean} True when the BOM was already introspected.
 */
export function hasIntrospectionVerdict(bomJson) {
  return (bomJson?.metadata?.properties || []).some(
    (property) =>
      property?.name === `${INTROSPECTION_PROPERTY_PREFIX}:schemaVersion`,
  );
}
