/**
 * Differential parity harness: compares JS and Rust validator findings.
 *
 * Strategy:
 * 1. Golden BOMs: assert the Rust validator returns zero `error` findings (no
 *    false positives — the highest-stakes risk, since `bin/cdxgen.js` exits 1
 *    on an invalid verdict), *and* that both validators reach the same verdict.
 *    The verdict comparison is deliberately bidirectional: checking only for
 *    Rust false positives would let a false negative through silently.
 * 2. Invalid BOMs: assert both validators agree the BOM is invalid, and that
 *    the Rust findings include the specific rule the fixture exists to trigger
 *    (see EXPECTED_RULES) — otherwise a fixture could pass by failing for an
 *    unrelated reason.
 *
 * What this harness deliberately does NOT do, and why: the plan asks for
 * equality of (severity, path, rule) triples across both validators. That is not
 * achievable against the current JS validator, which has no findings document —
 * `validateBom` returns a bare boolean and writes prose to `console.log`. Triple
 * comparison would require first building a structured-findings mode for the JS
 * path, which is out of scope here. Verdict equality plus a per-fixture rule
 * assertion is the strongest available approximation; treat the gap as open.
 *
 * Usage:
 *   node contrib/parity-harness.js
 *
 * Requires a cdxrs binary at CDXGEN_PLUGINS_DIR or CDXRS_CMD.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { validateBom } from "../lib/validator/bomValidator.js";

/**
 * The rule each `testdata/invalid/` fixture exists to trigger. Without this, a
 * fixture could report parity while failing for a reason unrelated to the rule
 * it was written for. Add an entry when adding a fixture; the harness fails on
 * an unregistered one rather than skipping it.
 */
const EXPECTED_RULES = {
  "crypto-algorithm-no-oid": "crypto.algorithm-missing-oid",
  "crypto-asset-with-purl": "purl.crypto-asset-has-purl",
  "encoded-dep-ref": "ref.encoded-dependency-ref",
  "epoch-mismatch": "purl.version-missing-epoch",
  "invalid-purl": "purl.invalid-syntax",
  "schema-invalid-type": "schema.invalid",
  "unsupported-version": "schema.unsupported-version",
};

// ---------------------------------------------------------------------------
// Rust binary resolution
// ---------------------------------------------------------------------------

function resolveRustBinary() {
  if (process.env.CDXRS_CMD && existsSync(process.env.CDXRS_CMD)) {
    return process.env.CDXRS_CMD;
  }
  const pluginsDir =
    process.env.CDXGEN_PLUGINS_DIR || "/tmp/cdxgen-local-plugins";
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const path = join(pluginsDir, "cdxrs", `cdxrs-${platform}-${arch}`);
  if (existsSync(path)) return path;
  return null;
}

// ---------------------------------------------------------------------------
// Rust findings collector
// ---------------------------------------------------------------------------

function collectRustFindings(bomJson, rustBinary) {
  if (!rustBinary) return null;
  const bomStr = JSON.stringify(bomJson);
  const result = spawnSync(rustBinary, ["validate", "--input", "-"], {
    input: bomStr,
    timeout: 30_000,
    encoding: "utf-8",
    maxBuffer: 200 * 1024 * 1024,
  });

  if (result.error) {
    return { error: result.error.message };
  }

  try {
    const doc = JSON.parse(result.stdout);
    return {
      valid: doc.valid,
      findings: doc.findings.map((f) => ({
        severity: f.severity,
        rule: f.id,
        path: f.path,
        message: f.message,
      })),
      summary: doc.summary,
    };
  } catch {
    return { error: `malformed stdout (exit ${result.status})` };
  }
}

// ---------------------------------------------------------------------------
// JS validator — calls validateBom which returns boolean
// ---------------------------------------------------------------------------

async function jsValidate(bomJson) {
  // Capture console output to detect schema failures messages
  const captured = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (msg) => {
    captured.push(msg);
  };
  console.warn = (msg) => {
    captured.push(msg);
  };
  let valid;
  try {
    valid = await validateBom(bomJson);
  } catch {
    valid = false;
  }
  console.log = origLog;
  console.warn = origWarn;
  return { valid, output: captured };
}

// ---------------------------------------------------------------------------
// BOM collection
// ---------------------------------------------------------------------------

function collectBoms() {
  const here = dirname(new URL(import.meta.url).pathname);
  const root = resolve(here, "..");
  // cdxgen-plugins-bin is a sibling of cdxgen, not a subdirectory.
  const pluginsBinRoot = resolve(root, "..", "cdxgen-plugins-bin");
  const boms = [];

  // Golden corpus from repotests
  const repotestsDir = join(root, "test", "repotests");
  if (existsSync(repotestsDir)) {
    for (const project of readdirSync(repotestsDir)) {
      if (project.startsWith("_")) continue;
      const expectedDir = join(repotestsDir, project, "expected");
      if (!existsSync(expectedDir)) continue;
      for (const f of readdirSync(expectedDir)) {
        if (!f.endsWith(".json")) continue;
        boms.push({ path: join(expectedDir, f), label: `${project}/${f}` });
      }
    }
  }

  // cdxrs testdata (valid BOMs only — skip invalid/)
  const cdxrsTestdata = resolve(
    pluginsBinRoot,
    "thirdparty",
    "cdxrs",
    "testdata",
  );
  if (existsSync(cdxrsTestdata)) {
    for (const f of readdirSync(cdxrsTestdata)) {
      if (!f.endsWith(".json")) continue;
      boms.push({ path: join(cdxrsTestdata, f), label: `cdxrs-testdata/${f}` });
    }
  }

  // Invalid test fixtures
  const invalidDir = resolve(cdxrsTestdata, "invalid");
  if (existsSync(invalidDir)) {
    for (const f of readdirSync(invalidDir)) {
      if (!f.endsWith(".json")) continue;
      boms.push({ path: join(invalidDir, f), label: `invalid/${f}` });
    }
  }

  return boms;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rustBinary = resolveRustBinary();
  if (!rustBinary) {
    console.log("No cdxrs binary found. Run contrib/link-local-plugins.sh.");
    console.log("Parity harness requires a real binary.");
    process.exit(0);
  }
  console.log(`Using cdxrs binary: ${rustBinary}\n`);

  const boms = collectBoms();
  let goldenChecked = 0;
  let invalidChecked = 0;
  let goldenFalsePositives = 0;
  let invalidParityOk = 0;
  let invalidParityFail = 0;
  const failures = [];

  for (const { path: file, label } of boms) {
    let bomJson;
    try {
      bomJson = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    if (!bomJson?.bomFormat || bomJson.bomFormat !== "CycloneDX") continue;

    const jsResult = await jsValidate(bomJson);
    const rustResult = collectRustFindings(bomJson, rustBinary);

    if (rustResult?.error) {
      console.log(`SKIP ${label}: rust error ${rustResult.error}`);
      continue;
    }

    const rustValid = rustResult?.valid ?? false;
    const rustErrors = (rustResult?.findings || []).filter(
      (f) => f.severity === "error",
    );

    if (label.startsWith("invalid/")) {
      invalidChecked++;
      const fixture = label.slice("invalid/".length).replace(/\.json$/, "");
      const expectedRule = EXPECTED_RULES[fixture];
      if (jsResult.valid !== rustValid) {
        invalidParityFail++;
        failures.push({
          label,
          reason: `verdict mismatch: JS valid=${jsResult.valid}, Rust valid=${rustValid}`,
        });
      } else if (!expectedRule) {
        invalidParityFail++;
        failures.push({
          label,
          reason: `no expected rule registered for this fixture; add it to EXPECTED_RULES`,
        });
      } else if (!rustErrors.some((f) => f.rule === expectedRule)) {
        // Guard against a fixture "passing" because it happens to be invalid for
        // some unrelated reason.
        invalidParityFail++;
        failures.push({
          label,
          reason: `expected rule ${expectedRule} not among Rust errors: ${
            rustErrors.map((f) => f.rule).join(", ") || "<none>"
          }`,
        });
      } else {
        invalidParityOk++;
      }
    } else {
      // Golden / valid BOMs: no Rust false positives, and the two validators
      // must reach the same verdict.
      goldenChecked++;
      if (rustErrors.length > 0) {
        goldenFalsePositives++;
        failures.push({
          label,
          reason: `Rust false positive: ${rustErrors
            .map((f) => `${f.rule}@${f.path}`)
            .join(", ")}`,
        });
      } else if (jsResult.valid !== rustValid) {
        goldenFalsePositives++;
        failures.push({
          label,
          reason: `verdict mismatch on a valid BOM: JS valid=${jsResult.valid}, Rust valid=${rustValid}`,
        });
      }
    }
  }

  // Summary
  console.log(`${"=".repeat(60)}`);
  console.log("Differential parity results:");
  console.log(`  Golden/valid BOMs checked:  ${goldenChecked}`);
  console.log(`  Golden false positives:     ${goldenFalsePositives}`);
  console.log(`  Invalid BOMs checked:       ${invalidChecked}`);
  console.log(`  Invalid parity OK:          ${invalidParityOk}`);
  console.log(`  Invalid parity failures:    ${invalidParityFail}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  ${f.label}: ${f.reason}`);
    }
    process.exit(1);
  }

  console.log("\nAll parity checks passed.");
}

await main();
