/**
 * Tests for the BOM-side introspection surface (annotate.js) and the report
 * emission seam (emit.js). The annotate tests run over the committed fixture
 * reflections the report goldens use, so the BOM surface is asserted against
 * exactly the documents the reports render.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

import { setDryRunMode } from "../../../ecosystems/utils.js";
import {
  applyIntrospectionToBom,
  INTROSPECTION_PROPERTY_PREFIX,
  introspectionMetadataProperties,
} from "./annotate.js";
import {
  blockRemediationsForDryRun,
  emitIntrospectionReports,
  resolveIntrospectionReportPaths,
} from "./emit.js";
import { scoreReflection } from "./score.js";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const catalog = JSON.parse(
  readFileSync(join(repoRoot, "data", "remediations.json"), "utf-8"),
);

/**
 * Load a fixture reflection and score it the way the renderer goldens do.
 *
 * @param {string} name Fixture name.
 * @returns {{reflection: Object, scored: Object}} Fixture and its score.
 */
function loadFixture(name) {
  const reflection = JSON.parse(
    readFileSync(
      join(
        repoRoot,
        "test",
        "data",
        "introspection",
        `${name}.reflection.json`,
      ),
      "utf-8",
    ),
  );
  const scored = scoreReflection(reflection, catalog, {});
  return { reflection, scored };
}

/** A minimal BOM whose metadata carries a cdxgen annotator. */
function makeBom() {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:00000000-0000-0000-0000-000000000001",
    metadata: {
      timestamp: "2026-08-30T00:00:00Z",
      tools: {
        components: [
          { type: "application", name: "cdxgen", version: "13.0.1" },
        ],
      },
      properties: [],
    },
    components: [],
  };
}

describe("introspection metadata properties", () => {
  it("carries all eight property families for a degraded fixture", () => {
    const { reflection, scored } = loadFixture("degraded-jvm");
    const properties = introspectionMetadataProperties(reflection, scored);
    const names = properties.map((property) => property.name);
    assert.ok(names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:schemaVersion`));
    assert.ok(names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:tier`));
    assert.ok(names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:score`));
    assert.ok(names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:confidence`));
    assert.ok(
      names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:ledgerComplete`),
    );
    assert.ok(
      names.some((name) =>
        name.startsWith(`${INTROSPECTION_PROPERTY_PREFIX}:ecosystem:`),
      ),
    );
    assert.ok(
      names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:remediationCount`),
    );
    const tierRow = properties.find(
      (property) =>
        property.name ===
        `${INTROSPECTION_PROPERTY_PREFIX}:ecosystem:java:tier`,
    );
    assert.ok(tierRow, "the java fixture must carry a per-ecosystem tier");
    assert.equal(tierRow.value, "manifest");
  });

  it("reports the number of remediations the loop can act on", () => {
    const { reflection, scored } = loadFixture("degraded-jvm");
    const properties = introspectionMetadataProperties(reflection, scored);
    const countProperty = properties.find(
      (property) =>
        property.name === `${INTROSPECTION_PROPERTY_PREFIX}:remediationCount`,
    );
    const actionable = scored.remediations.filter(
      (entry) => entry.blocked !== true,
    ).length;
    assert.equal(Number(countProperty.value), actionable);
  });

  it("omits the overall tier and confidence when nothing was scored", () => {
    const { reflection, scored } = loadFixture("foreign-bom");
    const hasScoredRows = scored.ecosystems.length > 0;
    const properties = introspectionMetadataProperties(reflection, scored);
    const names = properties.map((property) => property.name);
    assert.equal(
      names.includes(`${INTROSPECTION_PROPERTY_PREFIX}:tier`),
      hasScoredRows,
    );
    // The ungraded shape: no scored row claims no verdict, even though the
    // scorer's neutral 100 stands.
    const ungraded = introspectionMetadataProperties(
      { ledgerComplete: true },
      { overallScore: 100, ecosystems: [], remediations: [] },
    );
    const ungradedNames = ungraded.map((property) => property.name);
    assert.ok(!ungradedNames.includes(`${INTROSPECTION_PROPERTY_PREFIX}:tier`));
    assert.ok(
      !ungradedNames.includes(`${INTROSPECTION_PROPERTY_PREFIX}:confidence`),
    );
    assert.ok(ungradedNames.includes(`${INTROSPECTION_PROPERTY_PREFIX}:score`));
  });
});

describe("introspection annotations", () => {
  it("attaches one summary plus one annotation per actionable remediation", () => {
    const bomJson = makeBom();
    const { reflection, scored } = loadFixture("degraded-jvm");
    const result = applyIntrospectionToBom(bomJson, reflection, scored);
    const annotations = result.annotations.filter((annotation) =>
      annotation.text.includes(INTROSPECTION_PROPERTY_PREFIX),
    );
    const actionable = scored.remediations.filter(
      (entry) => entry.blocked !== true,
    ).length;
    assert.equal(annotations.length, actionable + 1);
    const summary = annotations[0];
    assert.ok(summary.text.includes("Build introspection: overall"));
    assert.deepEqual(summary.subjects, [bomJson.serialNumber]);
    assert.equal(summary.annotator.component.name, "cdxgen");
    assert.equal(summary.timestamp, bomJson.metadata.timestamp);
  });

  it("renders remediation facts as property rows in the annotation text", () => {
    const bomJson = makeBom();
    const { scored } = loadFixture("degraded-jvm");
    const result = applyIntrospectionToBom(
      bomJson,
      { ...scored.ecosystems[0], scoring: scored },
      scored,
    );
    const remediationAnnotations = result.annotations.filter((annotation) =>
      annotation.text.includes(
        `${INTROSPECTION_PROPERTY_PREFIX}:remediationId`,
      ),
    );
    assert.ok(remediationAnnotations.length > 0);
    const first = remediationAnnotations[0];
    for (const name of [
      `${INTROSPECTION_PROPERTY_PREFIX}:remediationId`,
      `${INTROSPECTION_PROPERTY_PREFIX}:ecosystem`,
      `${INTROSPECTION_PROPERTY_PREFIX}:currentTier`,
      `${INTROSPECTION_PROPERTY_PREFIX}:targetTier`,
      `${INTROSPECTION_PROPERTY_PREFIX}:expectedGain`,
      `${INTROSPECTION_PROPERTY_PREFIX}:confidence`,
    ]) {
      assert.ok(
        first.text.includes(name),
        `annotation text must carry ${name}`,
      );
    }
  });

  it("names the rules a remediation subsumes instead of annotating them", () => {
    const bomJson = makeBom();
    const { scored } = loadFixture("degraded-jvm");
    const subsuming = scored.remediations.find(
      (entry) => Array.isArray(entry.subsumes) && entry.subsumes.length,
    );
    const result = applyIntrospectionToBom(
      bomJson,
      { ecosystems: scored.ecosystems },
      scored,
    );
    const annotations = result.annotations;
    if (subsuming) {
      const subsumingAnnotation = annotations.find((annotation) =>
        annotation.text.includes(subsuming.remediationId),
      );
      assert.ok(subsumingAnnotation, "the subsuming entry is annotated");
      assert.ok(
        subsumingAnnotation.text.includes("evidence:subsumes"),
        "the annotation names the rules it subsumes",
      );
      for (const subsumed of subsuming.subsumes) {
        assert.ok(
          !annotations.some((annotation) =>
            annotation.text.includes(
              `cdx:introspection:remediationId | ${subsumed} |`,
            ),
          ),
          `subsumed rule ${subsumed} must not get its own annotation`,
        );
      }
    }
  });

  it("replaces a previous introspection state instead of duplicating it", () => {
    const bomJson = makeBom();
    const { reflection, scored } = loadFixture("degraded-jvm");
    applyIntrospectionToBom(bomJson, reflection, scored);
    const once = {
      properties: bomJson.metadata.properties.length,
      annotations: bomJson.annotations.length,
    };
    applyIntrospectionToBom(bomJson, reflection, scored);
    assert.equal(bomJson.metadata.properties.length, once.properties);
    assert.equal(bomJson.annotations.length, once.annotations);
    const introspectionProperties = bomJson.metadata.properties.filter(
      (property) => property.name.startsWith(INTROSPECTION_PROPERTY_PREFIX),
    ).length;
    assert.equal(introspectionProperties, once.properties);
  });

  it("keeps the BOM untouched by annotations when the guard is off", () => {
    const bomJson = makeBom();
    const { reflection, scored } = loadFixture("degraded-jvm");
    const result = applyIntrospectionToBom(bomJson, reflection, scored, {
      annotations: false,
    });
    assert.ok(
      result.metadata.properties.some((property) =>
        property.name.startsWith(INTROSPECTION_PROPERTY_PREFIX),
      ),
    );
    assert.equal(result.annotations, undefined);
  });

  it("skips annotations without a cdxgen annotator but still records the properties", () => {
    const bomJson = makeBom();
    bomJson.metadata.tools.components = [];
    const { reflection, scored } = loadFixture("degraded-jvm");
    const result = applyIntrospectionToBom(bomJson, reflection, scored);
    assert.ok(result.metadata.properties.length > 0);
    assert.equal(result.annotations, undefined);
  });
});

describe("dry-run blocking", () => {
  it("marks every remediation blocked with the dry-run policy reason", () => {
    const { scored } = loadFixture("degraded-jvm");
    const before = scored.remediations.filter(
      (entry) => entry.blocked !== true,
    ).length;
    assert.ok(before > 0, "the fixture must start with actionable entries");
    blockRemediationsForDryRun(scored);
    for (const entry of scored.remediations) {
      assert.equal(entry.blocked, true);
      assert.ok(entry.blockedReason.includes("policy.dry-run"));
    }
  });

  it("leaves already-blocked reasons alone", () => {
    const { scored } = loadFixture("degraded-jvm");
    scored.remediations[0].blocked = true;
    scored.remediations[0].blockedReason = "existing constraint";
    blockRemediationsForDryRun(scored);
    assert.equal(scored.remediations[0].blockedReason, "existing constraint");
  });
});

describe("report emission", () => {
  const workDir = mkdtempSync(join(tmpdir(), "cdxgen-introspect-emit-"));

  it("defaults the report paths next to the BOM output", () => {
    const { reportPath, jsonPath } = resolveIntrospectionReportPaths({
      output: "dist/bom.json",
    });
    assert.equal(reportPath, "dist/bom.json.introspection.md");
    assert.equal(jsonPath, "dist/bom.json.introspection.json");
  });

  it("defaults to the working directory when the BOM goes to stdout", () => {
    const { reportPath, jsonPath } = resolveIntrospectionReportPaths({
      output: "-",
    });
    assert.equal(reportPath, "cdxgen-introspection.md");
    assert.equal(jsonPath, "cdxgen-introspection.json");
    const explicit = resolveIntrospectionReportPaths({});
    assert.equal(explicit.reportPath, "cdxgen-introspection.md");
  });

  it("honours explicit destinations, including the stderr marker", () => {
    const { reportPath, jsonPath } = resolveIntrospectionReportPaths({
      introspectReport: "-",
      introspectJson: "/tmp/loop.json",
    });
    assert.equal(reportPath, "-");
    assert.equal(jsonPath, "/tmp/loop.json");
  });

  it("writes both reports and returns the destinations reached", () => {
    const { reflection, scored } = loadFixture("degraded-jvm");
    const output = join(workDir, "nested", "bom.json");
    const delivery = emitIntrospectionReports(reflection, scored, { output });
    assert.equal(delivery.dryRun, false);
    assert.equal(delivery.reportTarget, `${output}.introspection.md`);
    assert.equal(delivery.jsonTarget, `${output}.introspection.json`);
    assert.ok(existsSync(delivery.reportTarget));
    assert.ok(existsSync(delivery.jsonTarget));
    const json = JSON.parse(readFileSync(delivery.jsonTarget, "utf-8"));
    assert.equal(json.schemaVersion, "1.1");
    assert.ok(
      readFileSync(delivery.reportTarget, "utf-8").includes(
        "# cdxgen build introspection",
      ),
    );
  });

  it("produces the report without writing anything under dry-run", () => {
    const { reflection, scored } = loadFixture("degraded-jvm");
    const output = join(workDir, "dry", "bom.json");
    setDryRunMode(true);
    try {
      const delivery = emitIntrospectionReports(reflection, scored, {
        output,
      });
      assert.equal(delivery.dryRun, true);
      assert.equal(delivery.reportTarget, undefined);
      assert.equal(delivery.jsonTarget, undefined);
      assert.ok(!existsSync(join(workDir, "dry")));
    } finally {
      setDryRunMode(false);
    }
  });

  it("sends a report marked '-' to the diagnostic stream instead of a file", () => {
    const { reflection, scored } = loadFixture("degraded-jvm");
    const delivery = emitIntrospectionReports(reflection, scored, {
      introspectReport: "-",
      introspectJson: join(workDir, "stream", "loop.json"),
    });
    assert.equal(delivery.reportTarget, "-");
    assert.ok(existsSync(delivery.jsonTarget));
  });
});
