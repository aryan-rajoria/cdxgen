/**
 * The build-introspection fixture matrix, driven end to end through
 * `bin/cdxgen.js` on the current runtime.
 *
 * Three groups, each proving a different claim:
 *
 * - Group B: healthy projects must stay silent — zero entries in
 *   `remediation[]`. A report that nags about a healthy project gets the
 *   feature switched off, so these rows are the false-positive gate.
 * - Group C: at-ceiling rows score 100 with nothing to do; unsupported
 *   ecosystems surface only as coverage gaps and are never silently scored.
 * - Group A: one degraded-to-repaired transition per repairable fixture. The
 *   repair applies only the actions the report emitted, translated by the
 *   shared harness — hand-written repair setup would make the test lie.
 *
 * The file runs under node, deno and bun (the harness spawns the CLI through
 * whichever runtime executes it), and it imports no esmock. Degradation is
 * environment-only: fixtures are copied to scratch and never mutated in
 * place.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it, log } from "poku";

import {
  applyRemediationActions,
  bomGraphFacts,
  localJavaHomes,
  repoRoot,
  runIntrospectionScan,
  toolAnswers,
} from "../../../../test/helpers/introspection-e2e.js";
import { GRADLE_JAVA_CAPS } from "../../../inventory/jvmToolEnv.js";
import { compareVersions } from "../../../inventory/toolRequirements.js";

const fixtures = join(repoRoot, "test", "repotests");
const DEAD_MVN = join("/", "cdxgen-nonexistent", "mvn");

/**
 * Copy a fixture into a scratch directory so repairs never touch the
 * committed files.
 *
 * @param {string} name Fixture directory name.
 * @returns {string} Scratch copy path.
 */
function scratchFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), "cdxgen-e2e-"));
  const target = join(dir, "project");
  cpSync(join(fixtures, name), target, { recursive: true });
  return target;
}

describe("Group B — healthy projects must stay silent", () => {
  // fixture, -t, measured overall tier
  const rows = [
    ["go-smoke", "go", "resolved"],
    ["cargo-smoke", "rust", "lockfile"],
    ["poetry-smoke", "python", "lockfile"],
    ["pnpm-smoke", "js", "lockfile"],
    ["mix-smoke", "elixir", "resolved"],
    ["composer-smoke", "php", "resolved"],
    ["dotnet-eshop", "csharp", "resolved"],
    ["npm-smoke", "js", "lockfile"],
  ];
  for (const [fixture, projectType, tier] of rows) {
    it(`${fixture} ranks no remediation and keeps its measured tier`, async () => {
      const output = join(tmpdir(), `cdxgen-e2e-b-${fixture}.bom.json`);
      const run = await runIntrospectionScan({
        projectPath: join(fixtures, fixture),
        projectType,
        output,
      });
      assert.equal(
        run.status,
        0,
        `${fixture}: expected exit 0, got ${run.status}: ${run.stderr.slice(-600)}`,
      );
      assert.ok(run.report, `${fixture}: no report was written`);
      assert.deepEqual(
        run.report.remediation,
        [],
        `${fixture}: a healthy project was ranked remediations`,
      );
      assert.equal(run.report.overall.tier, tier);
      assert.equal(run.report.ledger.complete, true);
    });
  }
});

describe("Group C1 — at-ceiling rows score 100 with nothing to do", () => {
  const rows = [
    ["pubspec-smoke", "dart", "manifest"],
    ["introspect-helm-ceiling", "helm", "manifest"],
    ["introspect-clj-ceiling", "clojure", "manifest"],
  ];
  for (const [fixture, projectType, tier] of rows) {
    it(`${fixture} is at its ${tier} ceiling and stays silent`, async () => {
      const output = join(tmpdir(), `cdxgen-e2e-c1-${fixture}.bom.json`);
      const run = await runIntrospectionScan({
        projectPath: join(fixtures, fixture),
        projectType,
        output,
      });
      assert.equal(run.status, 0, run.stderr.slice(-600));
      assert.deepEqual(
        run.report.remediation,
        [],
        "an at-ceiling ecosystem was ranked remediations",
      );
      assert.equal(run.report.overall.score, 100);
      const row = run.report.ecosystems.find(
        (entry) => entry.state !== "unsupported",
      );
      assert.ok(row, "no ecosystem row was graded");
      assert.equal(row.state, "at-ceiling");
      assert.equal(row.tier, tier);
      assert.equal(row.score, 100);
    });
  }
});

describe("Group C2 — unsupported ecosystems are coverage gaps, never silent hundreds", () => {
  it("reports every unsupported marker as a gap with no score row and no remediation", async () => {
    const output = join(tmpdir(), "cdxgen-e2e-c2.bom.json");
    const run = await runIntrospectionScan({
      projectPath: join(fixtures, "introspect-unsupported-markers"),
      output,
    });
    assert.equal(run.status, 0, run.stderr.slice(-600));
    assert.deepEqual(
      run.report.remediation,
      [],
      "an unsupported ecosystem was ranked remediations",
    );
    assert.deepEqual(
      run.report.coverageGaps.map((gap) => gap.ecosystem).sort(),
      ["crystal", "elm", "nim", "perl", "r"],
    );
    assert.equal(run.report.overall.tier, null);
    assert.equal(run.report.overall.score, 100);
    for (const row of run.report.ecosystems) {
      assert.equal(row.state, "unsupported");
      assert.equal(row.tier, null);
    }
  });
});

describe("Group A — the degraded maven fixture repairs through the report's own actions", () => {
  // The repair executes the report's own build action, so the toolchain it
  // names has to exist and be able to resolve; without it the row proves
  // nothing about the feature and its absence is not a product defect.
  if (!toolAnswers("mvn")) {
    log("maven is not installed; the repair action cannot be executed here");
    return;
  }
  it("moves manifest to resolved and grows the SBOM", async () => {
    const projectDir = scratchFixture("maven-smoke");
    try {
      const degradedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "java",
        output: join(tmpdir(), "cdxgen-e2e-mvn-degraded.bom.json"),
        env: { MVN_CMD: DEAD_MVN },
      });
      assert.equal(degradedRun.status, 0, degradedRun.stderr.slice(-600));
      const degraded = degradedRun.report;
      assert.equal(degraded.overall.tier, "manifest");
      assert.ok(
        degraded.remediation.length > 0,
        "the degraded row ranked nothing",
      );
      const candidate = degraded.remediation[0];
      assert.equal(candidate.remediationId, "jvm.maven.manifest-fallback");
      assert.equal(candidate.blocked, false);
      assert.equal(candidate.impact, "transitive-deps");
      const degradedFacts = bomGraphFacts(degradedRun.bom);

      await applyRemediationActions(candidate, { projectDir, env: {} });

      const repairedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "java",
        output: join(tmpdir(), "cdxgen-e2e-mvn-repaired.bom.json"),
      });
      assert.equal(repairedRun.status, 0, repairedRun.stderr.slice(-600));
      const repaired = repairedRun.report;
      assert.equal(repaired.overall.tier, "resolved");
      assert.ok(
        repaired.overall.score > degraded.overall.score,
        "the score did not rise after the repair",
      );
      assert.ok(
        !repaired.remediation.some(
          (entry) => entry.remediationId === candidate.remediationId,
        ),
        "the key remediation survived the repair",
      );
      // The remediation claimed transitive-deps: the tier is a claim about
      // the SBOM, so check the SBOM.
      const repairedFacts = bomGraphFacts(repairedRun.bom);
      assert.ok(repairedFacts.components > degradedFacts.components);
      assert.ok(repairedFacts.dependencyNodes > degradedFacts.dependencyNodes);
      assert.ok(repairedFacts.dependencyEdges > degradedFacts.dependencyEdges);
      assert.equal(repaired.overall.tier, candidate.verify.expectTier);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("Group A — the manifest-only js fixture repairs through the report's own actions", () => {
  if (!toolAnswers("npm")) {
    log("npm is not installed; the repair action cannot be executed here");
    return;
  }
  it("moves absent to lockfile and grows the SBOM", async () => {
    const projectDir = scratchFixture("introspect-js-manifest");
    try {
      const degradedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "js",
        output: join(tmpdir(), "cdxgen-e2e-js-degraded.bom.json"),
      });
      assert.equal(degradedRun.status, 0, degradedRun.stderr.slice(-600));
      const degraded = degradedRun.report;
      assert.equal(degraded.overall.tier, "absent");
      const candidate = degraded.remediation[0];
      assert.ok(candidate, "the degraded row ranked nothing");
      assert.equal(candidate.remediationId, "js.no-node-modules");
      assert.equal(candidate.blocked, false);
      assert.equal(candidate.impact, "transitive-deps");
      const degradedFacts = bomGraphFacts(degradedRun.bom);

      await applyRemediationActions(candidate, { projectDir, env: {} });

      const repairedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "js",
        output: join(tmpdir(), "cdxgen-e2e-js-repaired.bom.json"),
      });
      assert.equal(repairedRun.status, 0, repairedRun.stderr.slice(-600));
      const repaired = repairedRun.report;
      assert.equal(repaired.overall.tier, "lockfile");
      assert.ok(repaired.overall.score > degraded.overall.score);
      assert.ok(
        !repaired.remediation.some(
          (entry) => entry.remediationId === candidate.remediationId,
        ),
      );
      const repairedFacts = bomGraphFacts(repairedRun.bom);
      assert.ok(repairedFacts.components > degradedFacts.components);
      assert.ok(repairedFacts.dependencyNodes > degradedFacts.dependencyNodes);
      assert.ok(repairedFacts.dependencyEdges > degradedFacts.dependencyEdges);
      // The entry's promise and the repair's outcome must agree: npm rows
      // ceiling at `lockfile`, and the installed tree reaches exactly that.
      assert.equal(candidate.verify.expectTier, "lockfile");
      assert.equal(repaired.overall.tier, candidate.verify.expectTier);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

/**
 * The newest Java major the local gradle can run, from the measured
 * Gradle/JDK compatibility table: a JDK the gradle refuses is any installed
 * major above it.
 *
 * @returns {number|undefined} The highest supported Java major, when the gradle version answered.
 */
function maxJavaForLocalGradle() {
  const probe = spawnSync("gradle", ["--version"], {
    encoding: "utf-8",
    timeout: 60000,
    shell: process.platform === "win32",
  });
  if (probe.status !== 0) {
    return undefined;
  }
  const match = /^Gradle (\d[\d.]*)/m.exec(`${probe.stdout}`);
  if (!match) {
    return undefined;
  }
  let maxJava;
  for (const [major, minimumGradle] of Object.entries(GRADLE_JAVA_CAPS)) {
    if (compareVersions(match[1], minimumGradle) >= 0) {
      maxJava = Number.parseInt(major, 10);
    }
  }
  return maxJava;
}

describe("Group D — commands are shaped for the project's own wrappers and managers", () => {
  /**
   * The executable a command line names, ignoring everything after it.
   *
   * @param {string|undefined} command Command line from a report action or the evidence block.
   * @returns {string} The executable's basename, or "" when absent.
   */
  function executableOf(command) {
    const first = `${command || ""}`.trim().split(/\s+/)[0] || "";
    return first.split(/[\\/]/).pop() || "";
  }

  // The fixture ships both wrapper spellings, so the row runs on every
  // platform and asserts the one that platform resolves to.
  const windows = process.platform === "win32";
  const wrapperFile = windows ? "mvnw.cmd" : "mvnw";

  it("the maven repair names the wrapper the run itself executed", async () => {
    const projectDir = scratchFixture("introspect-maven-wrapper");
    try {
      const run = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "java",
        output: join(tmpdir(), "cdxgen-e2e-mvnw.bom.json"),
      });
      assert.equal(run.status, 0, run.stderr.slice(-600));
      const report = run.report;
      const candidate = report.remediation.find(
        (entry) => entry.remediationId === "jvm.maven.manifest-fallback",
      );
      assert.ok(candidate, "the maven repair did not rank");
      const build = candidate.actions.find((action) => action.kind === "build");
      assert.equal(
        build.shapedBy,
        windows ? "wrapper:mvnw.cmd" : "wrapper:./mvnw",
      );
      assert.equal(executableOf(build.command), wrapperFile);
      // The cross-check that keeps shaping honest: the command the report
      // proposes names the same executable the run recorded having executed.
      // This fixture ships no CI config, so its formulation carries no
      // command to cross-check against — where a BOM does carry one (the
      // foreign path), formulationEvidence.poku.js asserts it instead, as a
      // declared hypothesis the report never renders as executed.
      const ran = executableOf(candidate.evidence?.failedCommand);
      assert.equal(
        ran,
        wrapperFile,
        "the run did not execute the project wrapper",
      );
      assert.equal(ran, executableOf(build.command));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("the uv repair locks with uv and never with poetry", async () => {
    const projectDir = scratchFixture("introspect-uv-lockfile");
    try {
      const run = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "python",
        output: join(tmpdir(), "cdxgen-e2e-uv.bom.json"),
      });
      assert.equal(run.status, 0, run.stderr.slice(-600));
      const report = run.report;
      const candidate = report.remediation.find((entry) =>
        entry.remediationId.startsWith("python.lockfile-unparseable"),
      );
      assert.ok(candidate, "the lockfile repair did not rank");
      assert.equal(candidate.remediationId, "python.lockfile-unparseable.uv");
      const build = candidate.actions.find((action) => action.kind === "build");
      assert.equal(build.command, "uv lock");
      assert.equal(build.shapedBy, "manager:uv");
      for (const action of candidate.actions) {
        assert.doesNotMatch(
          `${action.command || ""}`,
          /poetry/,
          "a uv project was handed a poetry command",
        );
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("Group A — the gradle fixture refuses a mismatched JDK and repairs through the report's own actions", () => {
  // The degradation lever is JAVA_HOME at a JDK the effective gradle refuses,
  // the same environment-only shape the matrix measures in the java8 and
  // default images. Which JDKs a gradle refuses is measured, not assumed:
  // the compatibility tables name what is supported, but an "unsupported"
  // JDK often still runs the build, so each candidate above the supported
  // majors is probed in the scratch copy before it is trusted. The repair
  // points JAVA_HOME at the JDK major the report's own install action names,
  // so the machine needs both a refusing and a suitable JDK; without them
  // the row proves nothing about the feature.
  const fixtureExpectedJava = "21";
  if (!toolAnswers("gradle")) {
    log("gradle is not installed; the fixture cannot run here");
    return;
  }
  const maxJava = maxJavaForLocalGradle();
  const homes = localJavaHomes();
  const goodHome = homes.find(
    (entry) => `${entry.major}` === fixtureExpectedJava,
  );
  const scratchProject = scratchFixture("introspect-gradle-manifest");
  const probe = (home) =>
    spawnSync("gradle", ["--no-daemon", "--console", "plain", "help"], {
      cwd: scratchProject,
      encoding: "utf-8",
      timeout: 120000,
      shell: process.platform === "win32",
      env: { ...process.env, JAVA_HOME: home },
    });
  const candidates = homes
    .filter((entry) => maxJava !== undefined && entry.major > maxJava)
    .sort((a, b) => b.major - a.major);
  const badHome = candidates.find((entry) => probe(entry.home).status !== 0);
  if (!maxJava || !badHome || !goodHome) {
    rmSync(scratchProject, { recursive: true, force: true });
    log(
      `no gradle/JDK skew pair here (gradle runs Java ${maxJava ?? "?"}, refused: ${badHome ? badHome.major : "none"}, wanted: ${goodHome ? goodHome.major : "none"})`,
    );
    return;
  }
  it("moves absent to resolved and grows the SBOM", async () => {
    const projectDir = scratchProject;
    // Both scans run with --install-deps: the gradle dependencies task is the
    // only component source for a wrapper-less project, so the repair has to
    // be observable under the arguments the loop would keep constant.
    const extraArgs = ["--install-deps"];
    // --no-daemon keeps the refusal deterministic: a daemon started by an
    // earlier compatible scan would otherwise be reused and resolve fine.
    const env = { JAVA_HOME: badHome.home, GRADLE_USE_DAEMON: "false" };
    try {
      const degradedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "gradle",
        output: join(tmpdir(), "cdxgen-e2e-gradle-degraded.bom.json"),
        env,
        extraArgs,
      });
      assert.equal(degradedRun.status, 0, degradedRun.stderr.slice(-600));
      const degraded = degradedRun.report;
      assert.equal(degraded.overall.tier, "absent");
      const row = degraded.ecosystems.find(
        (entry) => entry.ecosystem === "java",
      );
      assert.ok(row, "the java row is missing from the degraded report");
      assert.ok(
        row.tools.mismatched.some((entry) => entry.tool === "gradle"),
        "the version refusal was not reported as a tool mismatch",
      );
      const candidate = degraded.remediation[0];
      assert.ok(candidate, "the degraded row ranked nothing");
      assert.equal(candidate.remediationId, "jvm.gradle.invocation-failed");
      assert.equal(candidate.blocked, false);
      const degradedFacts = bomGraphFacts(degradedRun.bom);

      const applied = await applyRemediationActions(candidate, {
        projectDir,
        env,
      });
      assert.ok(
        applied.some(
          (record) =>
            record.action === "install:java" && record.executed === true,
        ),
        `the report's install action did not repair JAVA_HOME: ${JSON.stringify(applied)}`,
      );

      const repairedRun = await runIntrospectionScan({
        projectPath: projectDir,
        projectType: "gradle",
        output: join(tmpdir(), "cdxgen-e2e-gradle-repaired.bom.json"),
        env,
        extraArgs,
      });
      assert.equal(repairedRun.status, 0, repairedRun.stderr.slice(-600));
      const repaired = repairedRun.report;
      assert.ok(
        repaired.overall.score > degraded.overall.score,
        "the score did not rise after the repair",
      );
      assert.ok(
        !repaired.remediation.some(
          (entry) => entry.remediationId === candidate.remediationId,
        ),
        "the key remediation survived the repair",
      );
      const repairedFacts = bomGraphFacts(repairedRun.bom);
      assert.ok(repairedFacts.components > degradedFacts.components);
      assert.ok(repairedFacts.dependencyNodes > degradedFacts.dependencyNodes);
      assert.ok(repairedFacts.dependencyEdges > degradedFacts.dependencyEdges);
      // The entry's promise and the repair's outcome must agree: a gradle
      // build that resolves reaches `resolved`.
      assert.equal(candidate.verify.expectTier, "resolved");
      assert.equal(repaired.overall.tier, candidate.verify.expectTier);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
