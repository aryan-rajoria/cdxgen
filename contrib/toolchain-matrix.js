#!/usr/bin/env node
/**
 * Toolchain version matrix for the build-introspection feature.
 *
 * For every declared (image, project) cell the runner starts a container from
 * a published cdxgen toolchain image, runs the branch's own
 * `bin/cdxgen.js --introspect` inside it against a read-only project mount,
 * extracts the introspection verdict, diffs it against the cell's coarse
 * expectation, and writes everything to a results directory. Container output
 * never reaches the terminal — the console gets one line per cell and a
 * closing tally, and `SUMMARY.md` in the results directory is the only file a
 * reader needs. Agents read the results directory afterwards; they do not
 * stream the live output.
 *
 * The harness mounts the working tree into the container, so every cell
 * measures the branch under test while the image varies the toolchain. The
 * project is mounted read-only in every cell: degradation comes from the
 * image choice, never from mutating a project.
 *
 * Usage:
 *   node contrib/toolchain-matrix.js --all
 *   node contrib/toolchain-matrix.js --group C
 *   node contrib/toolchain-matrix.js --cell python-poetry
 *   node contrib/toolchain-matrix.js --all --update-baseline
 *   node contrib/toolchain-matrix.js --compare <run-id>
 *
 * A cell whose result file already exists in the target run directory is
 * skipped unless --force, so an interrupted run continues instead of
 * restarting. Results live under results/ (git-ignored): artifacts, not
 * fixtures.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { SEVERITY_ORDER } from "../lib/core/severity.js";
import { TIER_LADDER } from "../lib/stages/postgen/introspection/score.js";
import { bomGraphFacts } from "../test/helpers/introspection-e2e.js";

const repoRoot = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const CELLS_FILE = join(repoRoot, "test", "matrix", "toolchain-matrix.yaml");
const BASELINE_FILE = join(repoRoot, "test", "matrix", "baseline.json");
const RESULTS_ROOT = join(repoRoot, "results", "toolchain-matrix");
const BRANCH_MOUNT = "cdxgen-branch";
const PROJECT_MOUNT = "project";
const OUT_MOUNT = "out";
const DEFAULT_MOUNT_PREFIX = "";
const DEFAULT_TIMEOUT_MINUTES = 20;
/** Failing cells that get a detail block in SUMMARY.md, so the document stays
 * readable whole however many cells failed. */
const MAX_FAILURE_DETAILS = 12;
/** Every id a report can rank: catalog entries and build-fidelity rules. */
const RANKABLE_IDS = new Set([
  ...Object.keys(
    JSON.parse(
      readFileSync(join(repoRoot, "data", "remediations.json"), "utf-8"),
    ),
  ),
  ...(
    YAML.parse(
      readFileSync(
        join(repoRoot, "data", "rules", "build-fidelity.yaml"),
        "utf-8",
      ),
    ) || []
  ).map((rule) => rule.id),
]);

/** Runtime that executes the branch inside the container, per image family.
 * Deno is invoked with a script path and one permission flag, never `-e`. */
const RUNTIME_INVOCATION = {
  node: { entrypoint: "node", prefix: [] },
  deno: { entrypoint: "deno", prefix: ["run", "-A"] },
  bun: { entrypoint: "bun", prefix: [] },
};

/**
 * Minimal argv parser: the matrix has four verbs and a handful of flags, so
 * yargs would weigh more than the whole script.
 *
 * @returns {Object} Parsed arguments.
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {
    all: false,
    cell: undefined,
    group: undefined,
    force: false,
    updateBaseline: false,
    compare: undefined,
    against: undefined,
    runId: undefined,
    list: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--update-baseline") {
      args.updateBaseline = true;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--cell") {
      args.cell = argv[++i];
    } else if (arg === "--group") {
      args.group = argv[++i];
    } else if (arg === "--compare") {
      args.compare = argv[++i];
    } else if (arg === "--against") {
      args.against = argv[++i];
    } else if (arg === "--run-id") {
      args.runId = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

/**
 * Load and validate the cell declarations.
 *
 * @returns {Object[]} Cells.
 */
function loadCells() {
  const doc = YAML.parse(readFileSync(CELLS_FILE, "utf-8"));
  const cells = Array.isArray(doc?.cells) ? doc.cells : [];
  if (!cells.length) {
    console.error(`No cells declared in ${CELLS_FILE}`);
    process.exit(2);
  }
  const seen = new Set();
  for (const cell of cells) {
    if (!cell.id || seen.has(cell.id)) {
      console.error(`Cell without a unique id: ${JSON.stringify(cell)}`);
      process.exit(2);
    }
    seen.add(cell.id);
    if (!cell.image || !cell.project) {
      console.error(`Cell ${cell.id} needs an image and a project`);
      process.exit(2);
    }
    for (const [field, value] of [
      ["tier", cell.expect?.tier],
      ...(cell.expect?.remediations || []).map((id) => ["remediations", id]),
      ...(cell.expect?.blockedRemediations || []).map((id) => [
        "blockedRemediations",
        id,
      ]),
    ]) {
      const known =
        field === "tier"
          ? TIER_LADDER.includes(value)
          : RANKABLE_IDS.has(value);
      if (value !== undefined && !known) {
        // A misspelt expectation cannot be met by any run, so it would read
        // as a product failure at the end of an hour of container time.
        console.error(
          `Cell ${cell.id} expects an unknown ${field} value: ${value}`,
        );
        process.exit(2);
      }
    }
    if (cell.runtime && !RUNTIME_INVOCATION[cell.runtime]) {
      console.error(
        `Cell ${cell.id} names unknown runtime ${cell.runtime} (known: ${Object.keys(RUNTIME_INVOCATION).join(", ")})`,
      );
      process.exit(2);
    }
  }
  return cells;
}

/**
 * Expand the `repo://` scheme and the leading `~` of a project path.
 *
 * @param {string} project Project reference from the cell.
 * @param {string} mountPrefix Container path prefix for the mounts.
 * @returns {{hostPath: string|undefined, containerPath: string}} Host path to mount, or undefined for vendored fixtures, and the in-container scan path.
 */
function resolveProject(project, mountPrefix) {
  if (project.startsWith("repo://")) {
    const fixture = project.slice("repo://".length);
    return {
      hostPath: undefined,
      containerPath: `${mountPrefix}/${BRANCH_MOUNT}/test/repotests/${fixture}`,
    };
  }
  const hostPath = project.startsWith("~")
    ? join(homedir(), project.slice(1))
    : resolve(repoRoot, project);
  return { hostPath, containerPath: `${mountPrefix}/${PROJECT_MOUNT}` };
}

/**
 * Docker binary check.
 *
 * @returns {boolean} True when docker answers.
 */
function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "ok"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  return result.status === 0;
}

/**
 * True when the image already exists locally.
 *
 * @param {string} image Image reference.
 * @returns {boolean} True when present.
 */
function imagePresent(image) {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    { encoding: "utf-8", timeout: 30000 },
  );
  return result.status === 0 && `${result.stdout}`.trim().length > 0;
}

/**
 * Pull an image if it is not already local. Pull progress goes to the cell
 * log, never the console.
 *
 * @param {string} image Image reference.
 * @param {string} logPath Cell log file.
 * @param {string} [platform] Platform to pull for, when the cell pins one.
 * @returns {string|undefined} Failure reason, or undefined on success.
 */
function ensureImage(image, logPath, platform) {
  if (imagePresent(image)) {
    return undefined;
  }
  const result = spawnSync(
    "docker",
    ["pull", "--quiet", ...(platform ? ["--platform", platform] : []), image],
    {
      encoding: "utf-8",
      timeout: 1800000,
    },
  );
  writeFileSync(
    logPath,
    `$ docker pull --quiet ${image}\n${result.stdout || ""}${result.stderr || ""}`,
    { flag: "a" },
  );
  if (result.status !== 0) {
    return "image pull failed";
  }
  return undefined;
}

/**
 * Image digest for the result document.
 *
 * @param {string} image Image reference.
 * @returns {string} Digest or id.
 */
function imageDigest(image) {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{index .RepoDigests 0}}", image],
    { encoding: "utf-8", timeout: 30000 },
  );
  const digest = `${result.stdout}`.trim();
  if (result.status === 0 && digest) {
    return digest;
  }
  const id = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    { encoding: "utf-8", timeout: 30000 },
  );
  return `${id.stdout}`.trim();
}

/**
 * Build the docker invocation for one cell. The branch is mounted read-only
 * so the container measures this tree; the project and its mounts land under
 * the cell's mount prefix so images whose permission grants are path-scoped
 * (the secure image ships `/app/*` grants) keep working as shipped.
 *
 * A cell's `runtimeArgs` are passed to the runtime rather than to cdxgen —
 * the branch mount is read-only, so a runtime that materialises a dependency
 * directory beside the script needs to be told not to.
 *
 * An `entry: audit` cell re-scans a committed BOM with `cdx-audit
 * --direct-bom-audit --introspect` instead of generating one, which is the
 * foreign-BOM path: the verdict rests on the BOM alone, with no ledger.
 *
 * @param {Object} cell Cell declaration.
 * @param {string} cellDir Results directory of the cell.
 * @param {string} containerName Container name for cleanup on timeout.
 * @returns {{args: string[], scanPath: string}} Docker arguments and the in-container scan path.
 */
function dockerArgsFor(cell, cellDir, containerName) {
  const mountPrefix = cell.mountPrefix || DEFAULT_MOUNT_PREFIX;
  const { hostPath, containerPath } = resolveProject(cell.project, mountPrefix);
  const runtime = RUNTIME_INVOCATION[cell.runtime || "node"];
  const branchPath = `${mountPrefix}/${BRANCH_MOUNT}`;
  const outPath = `${mountPrefix}/${OUT_MOUNT}`;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    ...(hostPath
      ? ["-v", `${resolve(repoRoot, hostPath)}:${containerPath}:ro`]
      : []),
    "-v",
    `${repoRoot}:${mountPrefix}/${BRANCH_MOUNT}:ro`,
    "-v",
    `${cellDir}:${outPath}`,
    ...(cell.platform ? ["--platform", cell.platform] : []),
    ...(cell.network ? ["--network", cell.network] : []),
    ...Object.entries(cell.env || {}).flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`,
    ]),
    "--entrypoint",
    runtime.entrypoint,
    cell.image,
    ...runtime.prefix,
    ...(cell.runtimeArgs || []),
    ...(cell.entry === "audit"
      ? [
          `${branchPath}/bin/audit.js`,
          "--bom",
          `${containerPath}/${cell.bomFile || "bom.json"}`,
          "--direct-bom-audit",
          "--introspect",
          "--report",
          "json",
          "--report-file",
          `${outPath}/audit-report.json`,
        ]
      : [
          `${branchPath}/bin/cdxgen.js`,
          ...(cell.type ? ["-t", cell.type] : []),
          "--no-install-deps",
          "--introspect",
          "-o",
          `${outPath}/bom.json`,
          "--introspect-json",
          `${outPath}/introspection.json`,
          "--introspect-report",
          `${outPath}/introspection.md`,
          ...(cell.extraArgs || []),
          containerPath,
        ]),
  ];
  return { args, scanPath: containerPath };
}

/**
 * Evaluate a cell's coarse expectation against the extracted verdict.
 *
 * @param {Object} verdict Extracted report verdict.
 * @param {Object} expect Cell expectation.
 * @param {Object} [report] Parsed introspection JSON report, for expectations
 *   that read the remediation entries' evidence blocks.
 * @param {string} [rawReports] The raw text of both written reports, for
 *   expectations that assert on file bytes rather than parsed fields.
 * @returns {Object[]} One {field, expected, got} entry per unmet expectation.
 */
function evaluateExpectation(verdict, expect, report, rawReports = "") {
  const deltas = [];
  if (expect.tier !== undefined && verdict.tier !== expect.tier) {
    deltas.push({
      field: "tier",
      expected: expect.tier,
      got: verdict.tier,
    });
  }
  if (Array.isArray(expect.remediations)) {
    const got = [...verdict.remediationIds].sort();
    const wanted = [...expect.remediations].sort();
    if (
      got.length !== wanted.length ||
      got.some((id, index) => id !== wanted[index])
    ) {
      deltas.push({
        field: "remediations",
        expected: wanted.join(", ") || "(none)",
        got: got.join(", ") || "(none)",
      });
    }
  }
  if (
    expect.minComponents !== undefined &&
    verdict.componentCount < expect.minComponents
  ) {
    deltas.push({
      field: "minComponents",
      expected: `>= ${expect.minComponents}`,
      got: verdict.componentCount,
    });
  }
  if (
    expect.remediationsBlocked === "all" &&
    verdict.remediationCount > 0 &&
    !verdict.blockedAll
  ) {
    deltas.push({
      field: "remediationsBlocked",
      expected: "all blocked",
      got: `${verdict.unblockedCount} unblocked`,
    });
  }
  if (
    expect.remediationsBlocked === "none" &&
    verdict.blockedCount > 0
  ) {
    deltas.push({
      field: "remediationsBlocked",
      expected: "none blocked",
      got: `${verdict.blockedCount} blocked`,
    });
  }
  for (const remediationId of expect.blockedRemediations || []) {
    if (!verdict.remediationIds.includes(remediationId)) {
      deltas.push({
        field: "blockedRemediations",
        expected: `${remediationId} ranked and blocked`,
        got: "not ranked",
      });
    } else if (!verdict.blockedIds.includes(remediationId)) {
      deltas.push({
        field: "blockedRemediations",
        expected: `${remediationId} blocked`,
        got: "ranked unblocked",
      });
    }
  }
  if (
    expect.ledgerComplete !== undefined &&
    verdict.ledgerComplete !== expect.ledgerComplete
  ) {
    deltas.push({
      field: "ledgerComplete",
      expected: expect.ledgerComplete,
      got: verdict.ledgerComplete,
    });
  }
  if (expect.evidencePresent !== undefined) {
    const present = verdict.evidencePresent;
    if (present !== expect.evidencePresent) {
      deltas.push({
        field: "evidencePresent",
        expected: expect.evidencePresent,
        got: present,
      });
    }
  }
  if (
    expect.evidenceNonZeroExit !== undefined &&
    verdict.evidenceNonZeroExit !== expect.evidenceNonZeroExit
  ) {
    deltas.push({
      field: "evidenceNonZeroExit",
      expected: expect.evidenceNonZeroExit,
      got: verdict.evidenceNonZeroExit,
    });
  }
  if (expect.evidenceContains !== undefined) {
    if (!verdict.evidenceExcerptText.includes(expect.evidenceContains)) {
      deltas.push({
        field: "evidenceContains",
        expected: `excerpt contains ${JSON.stringify(expect.evidenceContains)}`,
        got: verdict.evidencePresent
          ? "the excerpt does not contain it"
          : "no evidence block",
      });
    }
  }
  for (const absent of expect.absentStrings || []) {
    if (rawReports.includes(absent)) {
      deltas.push({
        field: "absentStrings",
        expected: `${JSON.stringify(absent)} appears in neither report`,
        got: `${JSON.stringify(absent)} appears in a report`,
      });
    }
  }
  if (expect.noPlaceholders === true && verdict.placeholderActions > 0) {
    deltas.push({
      field: "noPlaceholders",
      expected: "no unresolved placeholder in any action",
      got: `${verdict.placeholderActions} action(s) still carry "{{"`,
    });
  }
  if (expect.versionFrom !== undefined) {
    if (!verdict.versionFromValues.includes(expect.versionFrom)) {
      deltas.push({
        field: "versionFrom",
        expected: `an action resolved with versionFrom ${expect.versionFrom}`,
        got: verdict.versionFromValues.length
          ? verdict.versionFromValues.join(", ")
          : "no action carried a versionFrom",
      });
    }
  }
  if (expect.shapedBy !== undefined) {
    const shapedByValues = [
      ...new Set(
        verdict.allActions.map((action) => action?.shapedBy).filter(Boolean),
      ),
    ].sort();
    if (!shapedByValues.includes(expect.shapedBy)) {
      deltas.push({
        field: "shapedBy",
        expected: `an action carries shapedBy ${expect.shapedBy}`,
        got: shapedByValues.length
          ? shapedByValues.join(", ")
          : "no action carries a shapedBy",
      });
    }
  }
  if (expect.maxConfidence !== undefined) {
    const cap = SEVERITY_ORDER[expect.maxConfidence];
    const rank = SEVERITY_ORDER[verdict.confidence ?? "low"];
    if (
      typeof cap !== "number" ||
      typeof rank !== "number" ||
      rank > cap
    ) {
      deltas.push({
        field: "maxConfidence",
        expected: `overall confidence no stronger than ${expect.maxConfidence}`,
        got: verdict.confidence ?? "none",
      });
    }
  }
  return deltas;
}

/**
 * Extract the report facts the expectations and the summary speak about.
 *
 * @param {Object|undefined} report Parsed introspection JSON report.
 * @param {Object|undefined} bom Parsed BOM.
 * @returns {Object|undefined} Verdict, or undefined when no report was written.
 */
function extractVerdict(report, bom) {
  if (!report) {
    return undefined;
  }
  const remediations = Array.isArray(report.remediation)
    ? report.remediation
    : [];
  const evidenceBlocks = remediations
    .map((entry) => entry?.evidence)
    .filter((evidence) => evidence && typeof evidence === "object");
  const graph = bomGraphFacts(bom);
  return {
    tier: report.overall?.tier ?? null,
    score: report.overall?.score ?? null,
    confidence: report.overall?.confidence ?? null,
    remediationIds: remediations.map((entry) => entry.remediationId).sort(),
    remediationCount: remediations.length,
    evidencePresent:
      remediations.length > 0 &&
      remediations[0]?.evidence !== undefined &&
      typeof remediations[0].evidence.outputExcerpt === "string" &&
      remediations[0].evidence.outputExcerpt.length > 0,
    evidenceNonZeroExit: evidenceBlocks.some(
      (evidence) =>
        typeof evidence.exitCode === "number" && evidence.exitCode !== 0,
    ),
    evidenceExcerptText: evidenceBlocks
      .map((evidence) => `${evidence.outputExcerpt || ""}`)
      .join("\n"),
    blockedIds: remediations
      .filter((entry) => entry.blocked === true)
      .map((entry) => entry.remediationId)
      .sort(),
    blockedCount: remediations.filter((entry) => entry.blocked === true)
      .length,
    unblockedCount: remediations.filter((entry) => entry.blocked !== true)
      .length,
    blockedAll:
      remediations.length > 0 &&
      remediations.every((entry) => entry.blocked === true),
    componentCount: graph.components,
    dependencyEdgeCount: graph.dependencyEdges,
    ledgerComplete: report.ledger?.complete ?? null,
    coverageGaps: (Array.isArray(report.coverageGaps)
      ? report.coverageGaps
      : []
    ).map((gap) => gap.ecosystem),
    // The top remediation's action version facts: how many commands still
    // carry an unresolved placeholder, and which provenance bands answered.
    placeholderActions: topActionList(remediations).filter((action) =>
      `${action?.command || ""}${action?.windows || ""}`.includes("{{"),
    ).length,
    versionFromValues: [
      ...new Set(
        topActionList(remediations)
          .map((action) => action?.versionFrom)
          .filter(Boolean),
      ),
    ].sort(),
    // Every action of every entry, because a rule finding (which carries no
    // actions) can outrank the repair the cell is about.
    allActions: remediations.flatMap((entry) =>
      Array.isArray(entry?.actions) ? entry.actions : [],
    ),
  };
}

/**
 * The top-ranked remediation's actions, when one exists.
 *
 * @param {Object[]} remediations Ranked remediation entries.
 * @returns {Object[]} Actions of the first entry.
 */
function topActionList(remediations) {
  const entry = remediations[0];
  return Array.isArray(entry?.actions) ? entry.actions : [];
}

/**
 * Diff a measured verdict against the recorded baseline entry for the cell.
 *
 * @param {Object} verdict Measured verdict.
 * @param {Object|undefined} baselineEntry Baseline record, when present.
 * @returns {string[]} Human-readable one-line deltas.
 */
function baselineDeltas(verdict, baselineEntry) {
  if (!baselineEntry) {
    return [];
  }
  const deltas = [];
  if (verdict.tier !== baselineEntry.tier) {
    deltas.push(
      `tier ${baselineEntry.tier ?? "(null)"} -> ${verdict.tier ?? "(null)"}`,
    );
  }
  const gotIds = verdict.remediationIds.join(",");
  const baseIds = [...(baselineEntry.remediationIds || [])].sort().join(",");
  if (gotIds !== baseIds) {
    deltas.push(`remediations [${baseIds}] -> [${gotIds}]`);
  }
  return deltas;
}

/**
 * Load the baseline when it exists.
 *
 * @returns {Object} Baseline document, or an empty one.
 */
function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) {
    return { cells: {} };
  }
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, "utf-8"));
  } catch {
    return { cells: {} };
  }
}

/**
 * Run one cell and write its result document.
 *
 * @param {Object} cell Cell declaration.
 * @param {string} runDir Run results directory.
 * @param {Object} baseline Baseline document.
 * @returns {Promise<Object>} Result document.
 */
async function runCell(cell, runDir, baseline) {
  const cellDir = join(runDir, "cells", cell.id);
  mkdirSync(cellDir, { recursive: true });
  const logPath = join(cellDir, "cdxgen.log");
  const startedAt = new Date().toISOString();
  const containerName = `cdxgen-matrix-${basename(runDir)}-${cell.id}`
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .slice(0, 120);

  const result = {
    id: cell.id,
    group: cell.group,
    image: cell.image,
    platform: cell.platform || "default",
    project: cell.project,
    type: cell.type || "(auto-detect)",
    note: cell.note,
    startedAt,
  };

  const { hostPath } = resolveProject(cell.project, cell.mountPrefix || "");
  if (hostPath && !existsSync(hostPath)) {
    result.status = cell.needsFixture ? "fail" : "skip";
    result.reason = `project not found: ${hostPath}`;
    writeResult(join(cellDir, "result.json"), result);
    return result;
  }

  const missing = ensureImage(cell.image, logPath, cell.platform);
  if (missing) {
    result.status = "skip";
    result.reason = missing;
    writeResult(join(cellDir, "result.json"), result);
    return result;
  }
  result.digest = imageDigest(cell.image);

  const { args } = dockerArgsFor(cell, cellDir, containerName);
  if (process.env.CDXGEN_MATRIX_PRINT_CMD) {
    console.error(`$ docker ${args.join(" ")}`);
  }
  const timeoutMs = (cell.timeoutMinutes || DEFAULT_TIMEOUT_MINUTES) * 60000;
  const run = spawnSync("docker", args, {
    encoding: "utf-8",
    timeout: timeoutMs,
  });
  writeFileSync(
    logPath,
    `$ docker ${args.join(" ")}\n${run.stdout || ""}${run.stderr || ""}`,
    { flag: "a" },
  );
  if (run.error?.code === "ETIMEDOUT" || run.signal === "SIGTERM") {
    spawnSync("docker", ["rm", "-f", containerName], { timeout: 60000 });
    result.status = "fail";
    result.reason = `timed out after ${cell.timeoutMinutes || DEFAULT_TIMEOUT_MINUTES} minutes`;
    result.durationSec = Math.round((Date.now() - Date.parse(startedAt)) / 1000);
    writeResult(join(cellDir, "result.json"), result);
    return result;
  }
  result.exitCode = run.status;
  result.durationSec = Math.round(
    (Date.now() - Date.parse(startedAt)) / 1000,
  );

  const report = existsSync(join(cellDir, "introspection.json"))
    ? JSON.parse(readFileSync(join(cellDir, "introspection.json"), "utf-8"))
    : undefined;
  // An audit cell embeds the verdict inside the audit report instead of
  // writing a standalone one, and grades the committed BOM rather than a
  // freshly generated one, so both inputs come from where the cell scanned.
  const auditReport =
    cell.entry === "audit" && existsSync(join(cellDir, "audit-report.json"))
      ? JSON.parse(readFileSync(join(cellDir, "audit-report.json"), "utf-8"))
      : undefined;
  const reportForVerdict =
    cell.entry === "audit"
      ? auditReport?.results?.find((result) => result?.introspection)
          ?.introspection
      : report;
  const bomPath =
    cell.entry === "audit" && cell.project?.startsWith("repo://")
      ? join(
          repoRoot,
          "test",
          "repotests",
          cell.project.slice("repo://".length),
          cell.bomFile || "bom.json",
        )
      : join(cellDir, "bom.json");
  const bom = existsSync(bomPath)
    ? JSON.parse(readFileSync(bomPath, "utf-8"))
    : undefined;
  result.verdict = extractVerdict(reportForVerdict, bom);
  if (!result.verdict) {
    result.status = "fail";
    result.reason =
      run.status === 0
        ? "cdxgen exited 0 but wrote no introspection report"
        : `cdxgen exited ${run.status}`;
  } else {
    // The raw bytes of both reports back the absentStrings expectation: a
    // secret must survive in neither the parsed fields nor a rendered one.
    const rawReports = [
      join(cellDir, "introspection.json"),
      join(cellDir, "introspection.md"),
      join(cellDir, "audit-report.json"),
    ]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf-8"))
      .join("\n");
    result.deltas = evaluateExpectation(
      result.verdict,
      cell.expect || {},
      report,
      rawReports,
    );
    result.baselineDeltas = baselineDeltas(
      result.verdict,
      baseline.cells?.[cell.id],
    );
    result.status = result.deltas.length ? "fail" : "pass";
  }
  result.expectation = cell.expect;
  writeResult(join(cellDir, "result.json"), result);
  return result;
}

/**
 * Write a result document with a stable key order.
 *
 * @param {string} path Destination.
 * @param {Object} result Result document.
 * @returns {void}
 */
function writeResult(path, result) {
  const ordered = {
    id: result.id,
    group: result.group,
    status: result.status,
    image: result.image,
    digest: result.digest,
    platform: result.platform,
    project: result.project,
    type: result.type,
    exitCode: result.exitCode,
    durationSec: result.durationSec,
    reason: result.reason,
    verdict: result.verdict,
    expectation: result.expectation,
    deltas: result.deltas,
    baselineDeltas: result.baselineDeltas,
    note: result.note,
    startedAt: result.startedAt,
  };
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

/**
 * Every cell result the run directory holds, in declaration order, with cells
 * the matrix no longer declares kept at the end so a renamed cell's evidence
 * stays visible.
 *
 * @param {string} runDir Run results directory.
 * @param {Object[]} cells Declared cells.
 * @returns {Object[]} Result documents.
 */
function collectRunResults(runDir, cells) {
  const cellsDir = join(runDir, "cells");
  if (!existsSync(cellsDir)) {
    return [];
  }
  const byId = new Map();
  for (const entry of readdirSync(cellsDir).sort()) {
    const resultPath = join(cellsDir, entry, "result.json");
    if (existsSync(resultPath)) {
      byId.set(entry, JSON.parse(readFileSync(resultPath, "utf-8")));
    }
  }
  const ordered = [];
  for (const cell of cells) {
    if (byId.has(cell.id)) {
      ordered.push(byId.get(cell.id));
      byId.delete(cell.id);
    }
  }
  return [...ordered, ...byId.values()];
}

/**
 * Format the one-line-per-cell console output.
 *
 * @param {Object} result Cell result.
 * @returns {string} Console line.
 */
function consoleLine(result) {
  const status = result.status.toUpperCase().padEnd(5);
  const seconds = result.durationSec ? `${result.durationSec}s` : "";
  if (result.status === "skip") {
    return `${status} ${result.id.padEnd(24)} ${result.reason}`;
  }
  const verdict = result.verdict;
  if (!verdict) {
    return `${status} ${result.id.padEnd(24)} ${result.reason || ""} ${seconds}`;
  }
  const facts = `tier=${verdict.tier} rem=${verdict.remediationCount} comps=${verdict.componentCount} ${seconds}`;
  if (result.status === "pass") {
    return `${status} ${result.id.padEnd(24)} ${facts}`;
  }
  const first = result.deltas?.[0];
  const detail = first
    ? `${first.field}: expected ${first.expected}, got ${first.got}`
    : (result.reason || "");
  return `${status} ${result.id.padEnd(24)} ${detail} ${seconds}`;
}

/**
 * Render the run's SUMMARY.md. Everything bulky lives in sibling files; this
 * document answers "how did the run go, and what broke" on its own, in one
 * table row per cell plus a capped set of failure details.
 *
 * @param {string} runId Run identifier.
 * @param {Object[]} results Cell results.
 * @param {Object} meta Run metadata.
 * @returns {string} Markdown text.
 */
function renderSummary(runId, results, meta) {
  const lines = [];
  const counted = { pass: 0, fail: 0, skip: 0 };
  for (const result of results) {
    counted[result.status] = (counted[result.status] || 0) + 1;
  }
  lines.push(`# Toolchain matrix — ${runId}`);
  lines.push("");
  lines.push(
    `- ${meta.finishedAt} — cdxgen ${meta.cdxgenVersion}, host ${meta.hostPlatform}, ${counted.pass} pass / ${counted.fail} fail / ${counted.skip} skip of ${results.length} cells`,
  );
  lines.push(
    "- Read `cells/<id>/result.json` for a cell's verdict and expectation; open `cells/<id>/cdxgen.log` only when a failure needs the container output.",
  );
  if (meta.reused) {
    lines.push(
      `- ${meta.reused} cell(s) were measured by an earlier invocation of this run and reused; see their result.json timestamps.`,
    );
  }
  lines.push("");
  lines.push("| cell | group | image | tier (exp -> got) | rem | comps | status | s |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const result of results) {
    const image = result.image.replace("ghcr.io/cdxgen/cdxgen", "…");
    if (!result.verdict) {
      lines.push(
        `| ${result.id} | ${result.group} | ${image} | — | — | — | ${result.status}${result.reason ? `: ${result.reason}` : ""} | ${result.durationSec || ""} |`,
      );
      continue;
    }
    const expectedTier = result.expectation?.tier;
    const tier = expectedTier
      ? `${expectedTier} -> ${result.verdict.tier}`
      : `${result.verdict.tier}`;
    lines.push(
      `| ${result.id} | ${result.group} | ${image} | ${tier} | ${result.verdict.remediationCount} | ${result.verdict.componentCount} | ${result.status} | ${result.durationSec || ""} |`,
    );
  }
  const failures = results.filter((result) => result.status === "fail");
  if (failures.length) {
    lines.push("");
    lines.push("## Failures");
    // The table above already names every failing cell, so the detailed
    // blocks are what the document caps: the reader of this file is an agent
    // whose context a hundred diffs would consume, and result.json holds the
    // rest.
    for (const result of failures.slice(0, MAX_FAILURE_DETAILS)) {
      lines.push("");
      lines.push(`### ${result.id} (${result.image})`);
      for (const delta of result.deltas || []) {
        lines.push(`- expected ${delta.field} ${delta.expected}`);
        lines.push(`- got ${delta.field} ${delta.got}`);
      }
      if (result.reason) {
        lines.push(`- ${result.reason}`);
      }
      lines.push(
        `- details: cells/${result.id}/result.json; log: cells/${result.id}/cdxgen.log`,
      );
    }
  }
  if (failures.length > MAX_FAILURE_DETAILS) {
    lines.push("");
    lines.push(
      `- ${failures.length - MAX_FAILURE_DETAILS} further failing cell(s) are listed in the table above; read their cells/<id>/result.json.`,
    );
  }
  const baselineChanged = results.filter(
    (result) => (result.baselineDeltas || []).length > 0,
  );
  if (baselineChanged.length) {
    lines.push("");
    lines.push("## Baseline deltas (recorded -> measured)");
    for (const result of baselineChanged) {
      lines.push(`- ${result.id}: ${result.baselineDeltas.join("; ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * List run directories, oldest first.
 *
 * @returns {string[]} Run ids.
 */
function listRuns() {
  if (!existsSync(RESULTS_ROOT)) {
    return [];
  }
  return readdirSync(RESULTS_ROOT).sort();
}

/**
 * Read a run's summary document.
 *
 * @param {string} runId Run id.
 * @returns {Object|undefined} Parsed summary.json.
 */
function readSummary(runId) {
  const path = join(RESULTS_ROOT, runId, "summary.json");
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Print the verdict delta between two runs — the query the maintainer runs
 * most often, and the version-drift signal this deliverable exists to
 * produce.
 *
 * @param {string} runId Run to examine.
 * @param {string|undefined} againstId Run to compare with; defaults to the previous run.
 * @returns {void}
 */
function compareRuns(runId, againstId) {
  const runs = listRuns();
  if (!againstId) {
    const index = runs.indexOf(runId);
    againstId = index > 0 ? runs[index - 1] : runs[runs.length - 1];
  }
  if (againstId === runId) {
    console.error("No other run to compare against.");
    process.exit(2);
  }
  const current = readSummary(runId);
  const previous = readSummary(againstId);
  if (!current || !previous) {
    console.error(`Both runs need a summary.json: ${runId}, ${againstId}`);
    process.exit(2);
  }
  const prevByCell = new Map(previous.cells.map((cell) => [cell.id, cell]));
  let changed = 0;
  console.log(`comparing ${againstId} -> ${runId}`);
  for (const cell of current.cells) {
    const before = prevByCell.get(cell.id);
    if (!before) {
      console.log(`NEW    ${cell.id}: ${cell.status} (${cell.image})`);
      changed++;
      continue;
    }
    const diffs = [];
    if (before.status !== cell.status) {
      diffs.push(`status ${before.status} -> ${cell.status}`);
    }
    if (before.verdict?.tier !== cell.verdict?.tier) {
      diffs.push(`tier ${before.verdict?.tier} -> ${cell.verdict?.tier}`);
    }
    const beforeIds = (before.verdict?.remediationIds || []).join(",");
    const afterIds = (cell.verdict?.remediationIds || []).join(",");
    if (beforeIds !== afterIds) {
      diffs.push(`remediations [${beforeIds}] -> [${afterIds}]`);
    }
    if (
      before.verdict?.componentCount !== undefined &&
      cell.verdict?.componentCount !== undefined &&
      before.verdict.componentCount !== cell.verdict.componentCount
    ) {
      diffs.push(
        `components ${before.verdict.componentCount} -> ${cell.verdict.componentCount}`,
      );
    }
    if (diffs.length) {
      console.log(`DELTA  ${cell.id}: ${diffs.join("; ")}`);
      changed++;
    }
  }
  for (const [id] of prevByCell) {
    if (!current.cells.some((cell) => cell.id === id)) {
      console.log(`GONE   ${id}`);
      changed++;
    }
  }
  console.log(
    `${changed} cell(s) changed between ${againstId} and ${runId}`,
  );
}

/**
 * Merge a run's measured verdicts into the baseline file so future runs have
 * something to diff against on a fresh machine.
 *
 * @param {string|undefined} runId Run to record; defaults to the latest.
 * @returns {void}
 */
function updateBaseline(runId) {
  const runs = listRuns();
  const target = runId || runs[runs.length - 1];
  const cellDirRoot = target && join(RESULTS_ROOT, target, "cells");
  if (!cellDirRoot || !existsSync(cellDirRoot)) {
    console.error(`No cells directory found for run ${target || "(latest)"}`);
    process.exit(2);
  }
  const baseline = loadBaseline();
  baseline.updated = new Date().toISOString();
  baseline.sourceRun = target;
  baseline.cells = baseline.cells || {};
  let recorded = 0;
  for (const entry of readdirSync(cellDirRoot).sort()) {
    const resultPath = join(cellDirRoot, entry, "result.json");
    if (!existsSync(resultPath)) {
      continue;
    }
    const result = JSON.parse(readFileSync(resultPath, "utf-8"));
    if (result.verdict) {
      baseline.cells[result.id] = {
        tier: result.verdict.tier,
        remediationIds: result.verdict.remediationIds,
        componentCount: result.verdict.componentCount,
        score: result.verdict.score,
      };
      recorded++;
    }
  }
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
  console.log(
    `baseline updated from ${target}: ${recorded} cell(s) recorded, ${Object.keys(baseline.cells).length} total`,
  );
}

/**
 * Main entry: filter cells, run them serially, write the results directory.
 *
 * @returns {Promise<void>} Nothing.
 */
async function main() {
  const args = parseArgs();
  if (args.compare) {
    compareRuns(args.compare, args.against);
    return;
  }
  if (args.updateBaseline && !args.all && !args.cell && !args.group) {
    updateBaseline(args.runId);
    return;
  }
  const cells = loadCells();
  if (args.list) {
    for (const cell of cells) {
      console.log(`${cell.group}  ${cell.id.padEnd(24)} ${cell.image}`);
    }
    return;
  }
  let selected = cells;
  if (args.cell) {
    selected = cells.filter((cell) => cell.id === args.cell);
    if (!selected.length) {
      console.error(`No cell named ${args.cell}; try --list`);
      process.exit(2);
    }
  } else if (args.group) {
    selected = cells.filter(
      (cell) => `${cell.group}`.toUpperCase() === args.group.toUpperCase(),
    );
    if (!selected.length) {
      console.error(`No cells in group ${args.group}; try --list`);
      process.exit(2);
    }
  } else if (!args.all) {
    console.error(
      "Choose --cell <id>, --group <A|B|C|D>, or --all. Group A alone takes 40-90 minutes of container runs; agents must not run --all.",
    );
    process.exit(2);
  }

  const runId = args.runId || new Date().toISOString().replace(/:/g, "-");
  const runDir = join(RESULTS_ROOT, runId);
  // A dry run prints the invocations and starts no container, so it answers
  // on a machine with no docker at all.
  if (args.dryRun) {
    for (const cell of selected) {
      const { args: dockerArgs } = dockerArgsFor(
        cell,
        join(runDir, "cells", cell.id),
        `cdxgen-matrix-dry-${cell.id}`,
      );
      console.log(`DRY   ${cell.id.padEnd(24)} docker ${dockerArgs.join(" ")}`);
    }
    return;
  }

  if (!dockerAvailable()) {
    console.error("docker does not answer; the matrix runs cells in containers.");
    process.exit(2);
  }
  mkdirSync(runDir, { recursive: true });
  const baseline = loadBaseline();

  const results = [];
  for (const cell of selected) {
    const existing = join(runDir, "cells", cell.id, "result.json");
    if (existsSync(existing) && !args.force) {
      const cached = JSON.parse(readFileSync(existing, "utf-8"));
      results.push({ ...cached, cached: true });
      console.log(
        `DONE  ${cell.id.padEnd(24)} reused existing result (use --force to re-run)`,
      );
      continue;
    }
    const result = await runCell(cell, runDir, baseline, false);
    results.push(result);
    console.log(consoleLine(result));
  }

  const finishedAt = new Date().toISOString();
  const cdxgenVersion = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf-8"),
  ).version;
  // The summary covers the run directory, not this invocation: a resumed run
  // is assembled from several invocations, and a report naming only the last
  // of them would erase the cells that produced it.
  const reported = collectRunResults(runDir, cells);
  const summary = {
    runId,
    startedAt: reported[0]?.startedAt,
    finishedAt,
    cdxgenVersion,
    hostPlatform: `${process.platform}-${process.arch}`,
    cells: reported,
  };
  const measured = results.filter((result) => !result.cached).length;
  writeFileSync(
    join(runDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const summaryMd = renderSummary(runId, reported, {
    finishedAt,
    cdxgenVersion,
    hostPlatform: summary.hostPlatform,
    reused: reported.length - measured || undefined,
  });
  writeFileSync(join(runDir, "SUMMARY.md"), summaryMd);

  const counted = { pass: 0, fail: 0, skip: 0 };
  for (const result of reported) {
    counted[result.status] = (counted[result.status] || 0) + 1;
  }
  console.log(
    `${counted.pass} pass, ${counted.fail} fail, ${counted.skip} skip -> ${runDir.replace(repoRoot, ".")}`,
  );
  if (args.updateBaseline) {
    updateBaseline(runId);
  }
  // A run that measured nothing — every cell skipped for a missing image or a
  // missing project — is a failed run: it carries no evidence at all.
  if (counted.fail > 0 || counted.pass === 0) {
    process.exitCode = 1;
  }
}

main();
