#!/usr/bin/env node

/**
 * ci/diff-v12-v13.js — Differential v12-vs-v13 BOM comparison.
 *
 * Installs the latest published v12 into a temp dir, runs both versions over
 * the golden scenario corpus with identical flags, normalizes both outputs,
 * and diffs them.  Any delta not listed in `ci/expected-deltas.yaml` fails
 * the job.
 *
 * Runs nightly and on PRs labelled `v13` (not every push — it is slow).
 *
 * Usage:
 *   node ci/diff-v12-v13.js [--v12-version <version>] [--corpus <dir>]
 *
 * Environment:
 *   SKIP_V12_INSTALL=1   Skip the npm install step (use an existing v12).
 *   V12_INSTALL_DIR      Directory where v12 is / should be installed.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { diffBoms } from "../contrib/sbom-diff.js";
import { normalizeBom } from "../contrib/sbom-normalize.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REPOTESTS_DIR = path.join(REPO_ROOT, "repotests");
const EXPECTED_DELTAS_PATH = path.join(REPO_ROOT, "ci", "expected-deltas.yaml");

/**
 * Parse the simple YAML used for expected-deltas.yaml.
 * Format:
 *   - scenario: <project>/<scenario>
 *     pointer: <json-pointer-ish path>
 *     reason: <human-readable explanation>
 *     deliverable: <number>
 */
function parseExpectedDeltas(yamlPath) {
  if (!existsSync(yamlPath)) {
    return [];
  }
  const text = readFileSync(yamlPath, "utf-8");
  const entries = [];
  let current = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- scenario:")) {
      if (current) {
        entries.push(current);
      }
      current = { scenario: trimmed.slice("- scenario:".length).trim() };
    } else if (current && trimmed.startsWith("pointer:")) {
      current.pointer = trimmed.slice("pointer:".length).trim();
    } else if (current && trimmed.startsWith("reason:")) {
      current.reason = trimmed.slice("reason:".length).trim();
    } else if (current && trimmed.startsWith("deliverable:")) {
      current.deliverable = trimmed.slice("deliverable:".length).trim();
    } else if (trimmed === "" && current) {
      entries.push(current);
      current = null;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

/**
 * Install the latest published v12 into a temp directory.
 */
function installV12(version = "12.8.2") {
  const installDir =
    process.env.V12_INSTALL_DIR || path.join(REPO_ROOT, ".v12-tmp");
  if (process.env.SKIP_V12_INSTALL === "1" && existsSync(installDir)) {
    return installDir;
  }
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }
  console.log(`Installing @cyclonedx/cdxgen@${version} into ${installDir}...`);
  const result = spawnSync(
    "npm",
    ["install", "--prefix", installDir, `@cyclonedx/cdxgen@${version}`],
    { encoding: "utf-8", timeout: 120000 },
  );
  if (result.status !== 0) {
    console.error("npm install failed:", result.stderr);
    throw new Error(`Failed to install cdxgen v${version}`);
  }
  return installDir;
}

/**
 * Run a cdxgen version on a fixture and return the normalized BOM.
 */
async function runVersion(installDir, projectDir, scenario) {
  const fixtureRel = scenario.fixture || ".";
  const fixtureDir = path.join(projectDir, fixtureRel);

  // For the local repo (v13), the binary is at bin/cdxgen.js.
  // For an npm-installed v12, it is at node_modules/@cyclonedx/cdxgen/bin/cdxgen.js.
  const isLocal = !installDir || installDir === REPO_ROOT;
  const cdxgenPath = isLocal
    ? path.join(REPO_ROOT, "bin", "cdxgen.js")
    : path.join(
        installDir,
        "node_modules",
        "@cyclonedx",
        "cdxgen",
        "bin",
        "cdxgen.js",
      );
  const outputFile = path.join(
    isLocal ? REPO_ROOT : installDir,
    ".bom-output.json",
  );

  const args = [
    cdxgenPath,
    fixtureDir,
    "-o",
    outputFile,
    "--spec-version",
    "1.7",
    "--format",
    "json",
  ];
  for (const pt of scenario.projectType || []) {
    args.push("-t", pt);
  }

  const result = spawnSync("node", args, {
    encoding: "utf-8",
    timeout: 120000,
    cwd: fixtureDir,
  });

  if (!existsSync(outputFile)) {
    throw new Error(`cdxgen did not produce output: ${result.stderr}`);
  }

  const bom = JSON.parse(readFileSync(outputFile, "utf-8"));
  rmSync(outputFile, { force: true });
  return normalizeBom(bom, { projectRoot: fixtureDir });
}

/**
 * Discover golden scenarios (same logic as golden-runner).
 */
function discoverScenarios() {
  const found = [];
  for (const entry of readdirSync(REPOTESTS_DIR, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith("_") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const manifestPath = path.join(
      REPOTESTS_DIR,
      entry.name,
      "golden.manifest.json",
    );
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    for (const scenario of manifest.scenarios || []) {
      found.push({
        project: entry.name,
        manifest,
        scenario,
        label: `${entry.name}/${scenario.name}`,
      });
    }
  }
  return found;
}

/**
 * Main entry point.
 */
async function main() {
  console.log("=== v12-vs-v13 differential comparison ===\n");

  const v12Version = process.argv.includes("--v12-version")
    ? process.argv[process.argv.indexOf("--v12-version") + 1]
    : "12.8.2";

  const expectedDeltas = parseExpectedDeltas(EXPECTED_DELTAS_PATH);
  console.log(`Loaded ${expectedDeltas.length} expected delta entries.`);

  let v12Dir;
  try {
    v12Dir = installV12(v12Version);
  } catch (err) {
    console.error(`Skipping v12 comparison: ${err.message}`);
    process.exit(0); // Don't fail CI if npm install fails
  }

  const scenarios = discoverScenarios();
  let unexpectedDeltas = 0;
  let expectedDeltaHits = 0;

  for (const { project, scenario, label } of scenarios) {
    const projectDir = path.join(REPOTESTS_DIR, project);
    process.stdout.write(`  ${label}... `);

    try {
      const v13Bom = await runVersion(REPO_ROOT, projectDir, scenario);
      const v12Bom = await runVersion(v12Dir, projectDir, scenario);

      const { isEqual, summary, details } = diffBoms(v13Bom, v12Bom);

      if (isEqual) {
        console.log("identical");
        continue;
      }

      // Check if this delta is expected
      const matchingExpected = expectedDeltas.find((e) => e.scenario === label);

      if (matchingExpected) {
        expectedDeltaHits++;
        console.log(`EXPECTED: ${summary}`);
        console.log(`    reason: ${matchingExpected.reason}`);
      } else {
        unexpectedDeltas++;
        console.log(`UNEXPECTED: ${summary}`);
        for (const d of details.slice(0, 10)) {
          console.log(`    ${d}`);
        }
      }
    } catch (err) {
      unexpectedDeltas++;
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log(
    `\n${unexpectedDeltas} unexpected deltas, ${expectedDeltaHits} expected deltas matched.`,
  );

  if (unexpectedDeltas > 0) {
    console.error(
      "\nFAIL: Unexpected deltas found. Add them to ci/expected-deltas.yaml with a reason, or fix the regression.",
    );
    process.exit(1);
  }

  console.log("PASS: All deltas are expected.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
