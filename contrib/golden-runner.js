/**
 * Golden SBOM test runner.
 *
 * Discovers scenarios under `repotests/`, runs `createBom` for each, installs
 * the cassette replay layer for offline coverage, normalizes the output, and
 * compares against committed golden files.
 *
 * Usage:
 *   pnpm run test:golden             # compare (fail on mismatch)
 *   UPDATE_GOLDEN=1 pnpm run test:golden  # regenerate + print summary
 *
 * Scenario manifest format (`repotests/<project>/golden.manifest.json`):
 *
 * ```json
 * {
 *   "description": "human-readable note",
 *   "fixture": ".",               // relative path to fixture dir (default ".")
 *   "scenarios": [
 *     {
 *       "name": "default",        // encodes the flags
 *       "projectType": ["npm"],   // cdxgen project type(s)
 *       "options": {},            // additional createBom options
 *       "network": false          // needs a cassette (default false)
 *     }
 *   ]
 * }
 * ```
 *
 * Golden files live at `repotests/<project>/expected/<scenario>.json`.
 * Cassettes live at `repotests/_cassettes/<project>_<scenario>.json`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { normalizeBom, serializeBom } from "./sbom-normalize.js";
import { diffBoms } from "./sbom-diff.js";
import { startCassette, CassetteMissError } from "./cassette.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REPOTESTS_DIR = path.join(REPO_ROOT, "repotests");
const CASSETTES_DIR = path.join(REPOTESTS_DIR, "_cassettes");

// Pin CocoaPods full-scan off. The justification is determinism, not
// convenience: `pod spec` adds a `SrcFile` property whose value is a local
// filesystem path, so a golden generated on a machine with CocoaPods installed
// would never match one generated without it. Pinning makes the lockfile the
// sole input.
//
// This is not hiding a crash. `buildObjectForCocoaPod` used to throw when `pod`
// was absent (`.stdout.trim()` on an empty spawn result); that is fixed at the
// source in lib/ecosystems/utils.js, and the scenario now scans cleanly with
// COCOA_FULL_SCAN=true on a machine with no `pod` binary.
process.env.COCOA_FULL_SCAN = process.env.COCOA_FULL_SCAN || "false";

// Neutralize every ambient package cache before cdxgen is loaded.
//
// Several enrichers read the developer's local caches and add data that is not
// derivable from the fixture: `findLocalMvnArtifact` hashes jars found in
// `~/.m2/repository` and the Gradle cache, and `enrichGemsFromLocalCache` globs
// `GEM_HOME/**/specifications/**/*.gemspec` for licenses and required-version
// properties. Whether that data appears depends on which artifacts happen to be
// on the machine, so goldens recorded on a warm cache can never match a cold CI
// runner — exactly the failure seen in run 30415853843, where maven-smoke and
// ruby-smoke carried hashes the runner could not reproduce.
//
// Pointing every cache at one empty scratch directory makes the fixture the sole
// input, so the same bytes come out on a warm laptop and a cold runner alike.
// `homedir()` is resolved from HOME on POSIX and USERPROFILE on Windows, so both
// are set. The cost is that hash/licence enrichment from local caches is not
// covered by the golden corpus; covering it would require vendoring real
// artifacts into a fixture, which is tracked separately.
const GOLDEN_SCRATCH_HOME = mkdtempSync(path.join(tmpdir(), "cdxgen-golden-home-"));
for (const cacheVar of [
  "HOME",
  "USERPROFILE",
  "GEM_HOME",
  "CDXGEN_GEM_HOME",
  "GEM_PATH",
  "BUNDLE_PATH",
  "GRADLE_USER_HOME",
  "GRADLE_CACHE_DIR",
  "MAVEN_CACHE_DIR",
]) {
  process.env[cacheVar] = GOLDEN_SCRATCH_HOME;
}

/**
 * Dynamically import createBom lazily so the runner can report discovery
 * errors before loading the full cdxgen module graph.
 */
async function getCreateBom() {
  const mod = await import(path.join(REPO_ROOT, "lib", "cli", "index.js"));
  return mod.createBom;
}

/**
 * Discover all golden scenario manifests under repotests/.
 * @returns {{ project: string, manifestPath: string, manifest: Object }[]}
 */
export function discoverScenarios() {
  const found = [];
  if (!existsSync(REPOTESTS_DIR)) {
    return found;
  }
  for (const entry of readdirSync(REPOTESTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) {
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
    found.push({ project: entry.name, manifestPath, manifest });
  }
  return found;
}

/**
 * Run a single scenario and return the normalized BOM.
 *
 * @param {string} project Project directory name.
 * @param {Object} scenario Scenario definition from the manifest.
 * @param {Object} manifest Full manifest object.
 * @returns {Promise<{ normalized: Object, cassetteHits: number, cassetteMisses: number }>}
 */
export async function runScenario(project, scenario, manifest) {
  const createBom = await getCreateBom();
  const fixtureRel = manifest.fixture || ".";
  const fixtureDir = path.join(REPOTESTS_DIR, project, fixtureRel);

  const cassetteName = scenario.cassette || `${project}_${scenario.name}.json`;
  const cassettePath = path.join(CASSETTES_DIR, cassetteName);
  const useCassette = scenario.network === true;

  // In record mode (UPDATE_GOLDEN=1 with a network scenario), use record.
  // Otherwise replay.
  const recordMode =
    process.env.UPDATE_GOLDEN === "1" &&
    useCassette &&
    process.env.CDXGEN_CASSETTE_MODE !== "replay";

  let cassetteController = null;
  let cassetteHits = 0;
  let cassetteMisses = 0;

  if (useCassette) {
    const mode = recordMode ? "record" : "replay";
    cassetteController = startCassette(mode, cassettePath);
  }

  try {
    const options = {
      projectType: scenario.projectType || [],
      multiProject: false,
      installDeps: false,
      outputFormat: "json",
      specVersion: "1.7",
      ...scenario.options,
    };

    const result = await createBom(fixtureDir, options);
    const bom = result?.bomJson || result;
    if (!bom || typeof bom !== "object") {
      throw new Error(`createBom returned no BOM object for ${project}/${scenario.name}`);
    }

    const normalized = normalizeBom(bom, {
      projectRoot: fixtureDir,
    });

    cassetteHits = cassetteController?.hitCount || 0;
    cassetteMisses = cassetteController?.missCount || 0;

    // In record mode, stop flushes the cassette.
    if (cassetteController) {
      cassetteController.stop();
    }

    return { normalized, cassetteHits, cassetteMisses };
  } finally {
    if (cassetteController) {
      // Ensure stop is called even on error (stop is idempotent — it just
      // clears the interceptor).
      try {
        cassetteController.stop();
      } catch {
        // already stopped
      }
    }
  }
}

/**
 * Get the expected golden file path for a scenario.
 */
export function goldenFilePath(project, scenarioName) {
  return path.join(REPOTESTS_DIR, project, "expected", `${scenarioName}.json`);
}

/**
 * Read a golden file. Returns null if it doesn't exist yet.
 */
export function readGolden(project, scenarioName) {
  const p = goldenFilePath(project, scenarioName);
  if (!existsSync(p)) {
    return null;
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

/**
 * Write a golden file (creating the directory if needed).
 */
export function writeGolden(project, scenarioName, normalized) {
  const p = goldenFilePath(project, scenarioName);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, serializeBom(normalized));
}

/**
 * Run all golden scenarios and report results.
 *
 * @returns {Promise<{ passed: number, failed: number, updated: number, total: number, results: Object[] }>}
 */
export async function runAll() {
  const updateMode = process.env.UPDATE_GOLDEN === "1";
  const scenarios = discoverScenarios();

  if (scenarios.length === 0) {
    console.error("FATAL: no golden scenarios found under repotests/. The runner must find non-zero scenarios.");
    return {
      passed: 0,
      failed: 1,
      updated: 0,
      total: 0,
      results: [],
    };
  }

  const createBom = await getCreateBom();
  let total = 0;
  let passed = 0;
  let failed = 0;
  let updated = 0;
  const results = [];

  for (const { project, manifest } of scenarios) {
    for (const scenario of manifest.scenarios || []) {
      total++;
      const label = `${project}/${scenario.name}`;
      const result = {
        project,
        scenario: scenario.name,
        label,
        status: "pending",
        summary: "",
        details: [],
      };

      try {
        const { normalized, cassetteHits, cassetteMisses } = await runScenario(
          project,
          scenario,
          manifest,
        );

        if (updateMode) {
          const existing = readGolden(project, scenario.name);
          if (existing) {
            const { summary, details } = diffBoms(normalized, existing);
            result.summary = summary;
            result.details = details;
          }
          writeGolden(project, scenario.name, normalized);
          updated++;
          result.status = "updated";
          if (cassetteHits > 0) {
            result.details.push(`cassette: ${cassetteHits} hits`);
          }
        } else {
          const expected = readGolden(project, scenario.name);
          if (!expected) {
            result.status = "fail";
            result.summary = `no golden file at expected/${scenario.name}.json (run UPDATE_GOLDEN=1 pnpm run test:golden)`;
            failed++;
          } else {
            const { isEqual, summary, details } = diffBoms(normalized, expected);
            if (isEqual) {
              passed++;
              result.status = "pass";
              result.summary = "identical";
              if (cassetteHits > 0) {
                result.details.push(`cassette: ${cassetteHits} hits`);
              }
            } else {
              failed++;
              result.status = "fail";
              result.summary = summary;
              result.details = details;
              if (cassetteHits > 0) {
                result.details.push(`cassette: ${cassetteHits} hits`);
              }
            }
          }
        }
      } catch (err) {
        failed++;
        result.status = "error";
        result.summary = err instanceof CassetteMissError ? err.message : err.message;
        if (err.stack && process.env.CDXGEN_DEBUG_MODE) {
          result.details.push(err.stack);
        }
      }

      results.push(result);
    }
  }

  return { passed, failed, updated, total, results };
}

/**
 * Main entry point for the CLI: `node contrib/golden-runner.js`
 */
export async function main() {
  console.log("=== Golden SBOM test runner ===\n");

  const { passed, failed, updated, total, results } = await runAll();

  for (const r of results) {
    const icon =
      r.status === "pass" ? "PASS" : r.status === "updated" ? "UPD" : r.status === "fail" ? "FAIL" : "ERR";
    console.log(`[${icon}] ${r.label}: ${r.summary}`);
    if (r.details.length > 0 && r.status !== "pass") {
      for (const d of r.details) {
        console.log(`        ${d}`);
      }
    }
  }

  console.log(
    `\n${passed} passed, ${failed} failed, ${updated} updated, ${total} total`,
  );

  if (updated > 0) {
    console.log("\n=== Regeneration summary ===");
    for (const r of results.filter((r) => r.status === "updated")) {
      console.log(`  ${r.label}: ${r.summary}`);
      for (const d of r.details) {
        console.log(`    ${d}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run main() only when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
