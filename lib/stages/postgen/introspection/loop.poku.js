/**
 * End-to-end tests that need more than one runtime or more than one CLI run:
 * the fidelity loop of `.agents/skills/sbom-fidelity-loop/SKILL.md` executed
 * mechanically over a real fixture, per-ecosystem isolation on a polyglot
 * tree, cross-runtime equality of the report's `overall` block, and the
 * restricted-permission proof that a denied probe degrades evidence instead
 * of lying about a missing tool.
 *
 * This file spawns node, deno and bun CLIs directly, so it is held back from
 * the Bun and Deno suites (see contrib/alt-runtime-tests.js).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it, log } from "poku";

import {
  bomGraphFacts,
  queueStep,
  repoRoot,
  resolveRuntimeBinary,
  runFidelityLoop,
  runIntrospectionScan,
  runtimeAvailable,
  toolAnswers,
} from "../../../../test/helpers/introspection-e2e.js";

const fixtures = join(repoRoot, "test", "repotests");
const DEAD_MVN = join("/", "cdxgen-nonexistent", "mvn");
const DEAD_URL = "http://127.0.0.1:9";
const LOOP_ARGS = [
  "--profile",
  "introspect",
  "--introspect-fail-below",
  "70",
  "-t",
  "java",
  "--no-install-deps",
];

/**
 * Copy a fixture into a scratch directory so repairs never touch the
 * committed files.
 *
 * @param {string} name Fixture directory name.
 * @returns {string} Scratch copy path.
 */
function scratchFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), "cdxgen-loop-"));
  const target = join(dir, "project");
  cpSync(join(fixtures, name), target, { recursive: true });
  return target;
}

describe("the fidelity loop, executed mechanically", () => {
  it("repairs the degraded maven fixture and stops in success within 3 iterations", async () => {
    const projectDir = scratchFixture("maven-smoke");
    try {
      const loop = await runFidelityLoop({
        projectPath: projectDir,
        output: join(tmpdir(), "cdxgen-loop-maven.bom.json"),
        userArgs: LOOP_ARGS,
        env: { MVN_CMD: DEAD_MVN },
      });
      assert.equal(
        loop.stop,
        "success",
        `expected the loop to stop in success, got ${loop.stop}`,
      );
      assert.ok(
        loop.history.iterations.length <= 3,
        `the loop needed ${loop.history.iterations.length} iterations`,
      );
      const attempt = loop.history.attempted.find(
        (entry) => entry.remediationId === "jvm.maven.manifest-fallback",
      );
      assert.ok(attempt, "the loop never attempted the top-ranked remediation");
      // The skill judges a fix by the next report's verify clause, never by
      // the action's exit code, and records the answer in the history.
      assert.equal(attempt.outcome, "verified", attempt.detail);
      const first = loop.iterationReports[0];
      const last = loop.iterationReports[loop.iterationReports.length - 1];
      assert.equal(first.overall.tier, "manifest");
      assert.equal(last.overall.tier, "resolved");
      assert.ok(last.overall.score > first.overall.score);
      // The report gate must pass at the stop: the loop never lowers it.
      assert.deepEqual(last.gate, { threshold: 70, passed: true });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("stops without exhausting the budget when the remediation is unfixable in the sandbox", async () => {
    const projectDir = scratchFixture("maven-smoke");
    try {
      const loop = await runFidelityLoop({
        projectPath: projectDir,
        output: join(tmpdir(), "cdxgen-loop-stalled.bom.json"),
        userArgs: LOOP_ARGS,
        env: {
          MVN_CMD: DEAD_MVN,
          FETCH_LICENSE: "true",
          MAVEN_CENTRAL_URL: `${DEAD_URL}/maven2`,
        },
      });
      // Offline blocks the ranked ledger remediation; the remaining rule
      // entry is tried once and changes nothing, so the loop must stop in
      // stalled — the skill's stop for "the fix did not take effect".
      assert.equal(loop.stop, "stalled");
      assert.ok(
        loop.history.iterations.length <= 3,
        `the loop burned its budget: ${loop.history.iterations.length} iterations`,
      );
      const first = loop.iterationReports[0];
      assert.equal(
        first.remediation[0].blocked,
        true,
        "the offline run did not mark the ranked remediation blocked",
      );
      assert.ok(first.remediation[0].blockedReason);
      assert.ok(
        loop.history.attempted.length >= 1,
        "the loop attempted nothing",
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("Group D — one polyglot repo, per-ecosystem verdicts", () => {
  const polyglot = join(repoRoot, "test", "data", "introspection-polyglot");
  if (!toolAnswers("mvn")) {
    log(
      "maven is not installed; the polyglot java row would be degraded in both runs",
    );
    return;
  }
  it("degrades only the maven toolchain and moves only the java tier", async () => {
    const healthyRun = await runIntrospectionScan({
      projectPath: polyglot,
      output: join(tmpdir(), "cdxgen-grpd-healthy.bom.json"),
    });
    assert.equal(healthyRun.status, 0, healthyRun.stderr.slice(-600));
    const degradedRun = await runIntrospectionScan({
      projectPath: polyglot,
      output: join(tmpdir(), "cdxgen-grpd-degraded.bom.json"),
      env: { MVN_CMD: DEAD_MVN },
    });
    assert.equal(degradedRun.status, 0, degradedRun.stderr.slice(-600));
    const healthy = Object.fromEntries(
      healthyRun.report.ecosystems.map((row) => [row.ecosystem, row]),
    );
    const degraded = Object.fromEntries(
      degradedRun.report.ecosystems.map((row) => [row.ecosystem, row]),
    );
    assert.ok(healthy.java, "no java row was graded");
    assert.ok(degraded.java, "no java row was graded");
    assert.ok(
      degraded.java.score < healthy.java.score,
      "the java tier did not move under a dead maven",
    );
    for (const [ecosystem, row] of Object.entries(degraded)) {
      if (ecosystem === "java") {
        continue;
      }
      const baseline = healthy[ecosystem];
      assert.ok(
        baseline,
        `the degraded run grew a row ${ecosystem} the healthy run lacked`,
      );
      assert.equal(
        row.tier,
        baseline.tier,
        `${ecosystem} moved under a maven-only degradation`,
      );
      assert.equal(row.score, baseline.score);
    }
  });
});

describe("cross-runtime equality of the report's overall block", () => {
  const rows = [
    ["go-smoke", "go"],
    ["poetry-smoke", "python"],
    ["dotnet-eshop", "csharp"],
  ];
  for (const runtime of ["deno", "bun"]) {
    if (!runtimeAvailable(runtime)) {
      log(`${runtime} is not installed; the equality matrix cannot run here`);
      continue;
    }
    for (const [fixture, projectType] of rows) {
      it(`${fixture} reports the same overall block under node and ${runtime}`, async () => {
        const nodeRun = await runIntrospectionScan({
          projectPath: join(fixtures, fixture),
          projectType,
          output: join(tmpdir(), `cdxgen-eq-node-${fixture}.bom.json`),
        });
        const altRun = await runIntrospectionScan({
          projectPath: join(fixtures, fixture),
          projectType,
          output: join(tmpdir(), `cdxgen-eq-${runtime}-${fixture}.bom.json`),
          runtime,
        });
        assert.equal(altRun.status, 0, altRun.stderr.slice(-600));
        // runId, generatedAt and the BOM serial identify the run; the
        // verdict must not depend on the runtime.
        assert.deepEqual(altRun.report.overall, nodeRun.report.overall);
        assert.deepEqual(altRun.report.remediation, nodeRun.report.remediation);
        assert.deepEqual(
          altRun.report.coverageGaps,
          nodeRun.report.coverageGaps,
        );
        assert.equal(
          altRun.report.ecosystems
            .map((row) => `${row.ecosystem}:${row.tier}:${row.score}`)
            .join(","),
          nodeRun.report.ecosystems
            .map((row) => `${row.ecosystem}:${row.tier}:${row.score}`)
            .join(","),
        );
      });
    }
  }
});

describe("restricted Deno permissions degrade evidence instead of lying", () => {
  if (!runtimeAvailable("deno")) {
    log(
      "deno is not installed; the restricted-permission proof cannot run here",
    );
    return;
  }
  it("a denied probe records evidence.degraded, never tool.missing", async () => {
    const output = join(tmpdir(), "cdxgen-denied-probe.bom.json");
    const projectPath = join(fixtures, "go-smoke");
    const args = [
      resolveRuntimeBinary("deno"),
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      "--allow-sys",
      join(repoRoot, "bin", "cdxgen.js"),
      "--profile",
      "introspect",
      "-t",
      "go",
      "--no-install-deps",
      "-o",
      output,
      projectPath,
    ];
    // The profile alone switches introspection on. Setting
    // CDXGEN_INTROSPECT=true here would start recording before the CLI
    // bridges in its automatic sidecar, and the earliest events would never
    // reach the report.
    const result = await queueStep(() =>
      spawnSync(args[0], args.slice(1), {
        encoding: "utf-8",
        timeout: 600000,
        env: { ...process.env },
      }),
    );
    assert.equal(
      result.status,
      0,
      `the degraded scan itself must succeed: ${result.stderr.slice(-600)}`,
    );
    assert.ok(existsSync(output), "the BOM was not written");
    const report = JSON.parse(
      readFileSync(`${output}.introspection.json`, "utf-8"),
    );
    const serialized = JSON.stringify(report);
    assert.ok(
      !serialized.includes('"tool.missing"'),
      "the report claims a tool is missing under a permission denial",
    );
    const degradedProbe = (report.observations || []).find(
      (entry) => entry.kind === "evidence.degraded" && entry.tool === "go",
    );
    assert.ok(
      degradedProbe,
      "the denied go probe was not recorded as degraded evidence",
    );
    for (const row of report.ecosystems) {
      assert.deepEqual(row.tools.missing, []);
    }
    const facts = bomGraphFacts(JSON.parse(readFileSync(output, "utf-8")));
    assert.ok(facts.components > 0, "the scan produced no components");
  });
});
