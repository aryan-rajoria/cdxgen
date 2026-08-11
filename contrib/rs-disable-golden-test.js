/**
 * Permanent safety net: a default run and a `CDXGEN_RS_DISABLE=all` run must
 * produce byte-identical SBOMs.
 *
 * Every Rust-backed step added during v13 must be a pure optimisation: same
 * output, faster. This is the job that enforces it, so it needs to stay in the
 * suite for the rest of v13.
 *
 * Two things this does deliberately, because the obvious shortcuts are both
 * wrong:
 *
 *  1. It runs each scenario **twice** — once with the Rust path enabled, once
 *     with `CDXGEN_RS_DISABLE=all` — and compares the two results against each
 *     other. Simply running the golden corpus with `CDXGEN_RS_DISABLE=all` and
 *     checking it still matches the committed goldens cannot detect a Rust path
 *     that alters output, because that is precisely the run in which the Rust
 *     path is switched off. Only the default-vs-disabled comparison sees it.
 *
 *  2. It compares the **serialized bytes** of the normalized BOMs, not
 *     `diffBoms`. `diffBoms` is a structural comparison over components,
 *     dependencies and `metadata.component`; it is blind to other top-level
 *     fields and will report `isEqual: true` for two BOMs that differ in, say,
 *     `specVersion`. That is fine for its own purpose but far too loose here.
 *
 * Usage:
 *   node contrib/rs-disable-golden-test.js
 */

import process from "node:process";

import {
  discoverScenarios,
  runScenario,
} from "./golden-runner.js";
import { serializeBom } from "./sbom-normalize.js";

/** Run one scenario with CDXGEN_RS_DISABLE set to `disable` (or unset). */
async function runWith(disable, project, scenario, manifest) {
  const previous = process.env.CDXGEN_RS_DISABLE;
  if (disable === undefined) {
    delete process.env.CDXGEN_RS_DISABLE;
  } else {
    process.env.CDXGEN_RS_DISABLE = disable;
  }
  try {
    const { normalized } = await runScenario(project, scenario, manifest);
    return serializeBom(normalized);
  } finally {
    if (previous === undefined) {
      delete process.env.CDXGEN_RS_DISABLE;
    } else {
      process.env.CDXGEN_RS_DISABLE = previous;
    }
  }
}

async function main() {
  console.log("=== CDXGEN_RS_DISABLE=all byte-identical test ===");
  console.log("Comparing default vs CDXGEN_RS_DISABLE=all for every scenario\n");

  // discoverScenarios() returns one entry per project; the scenarios live in
  // the manifest.
  const scenarios = discoverScenarios().flatMap(({ project, manifest }) =>
    (manifest.scenarios || []).map((scenario) => ({
      project,
      scenario,
      manifest,
    })),
  );
  let passed = 0;
  const failures = [];

  for (const { project, scenario, manifest } of scenarios) {
    const label = `${project}/${scenario.name}`;
    try {
      const enabled = await runWith(undefined, project, scenario, manifest);
      const disabled = await runWith("all", project, scenario, manifest);
      if (enabled === disabled) {
        passed += 1;
        console.log(`  ${label}: identical`);
      } else {
        failures.push({ label, enabled, disabled });
        console.log(`  ${label}: DIFFERS`);
      }
    } catch (err) {
      failures.push({ label, error: err.message });
      console.log(`  ${label}: ERROR ${err.message}`);
    }
  }

  console.log(
    `\n${passed} identical, ${failures.length} failed, ${scenarios.length} total`,
  );

  if (failures.length) {
    console.log("\n✗ CDXGEN_RS_DISABLE=all is NOT byte-identical.");
    console.log(
      "  A Rust-backed step is changing output. Every Rust path must be a pure",
    );
    console.log(
      "  optimisation and must honour CDXGEN_RS_DISABLE. Offending scenarios:",
    );
    for (const f of failures) {
      if (f.error) {
        console.log(`    - ${f.label}: errored (${f.error})`);
        continue;
      }
      // Show the first differing line to make the failure actionable.
      const a = f.enabled.split("\n");
      const b = f.disabled.split("\n");
      const i = a.findIndex((line, idx) => line !== b[idx]);
      console.log(`    - ${f.label}: first diff at line ${i + 1}`);
      console.log(`        rust: ${(a[i] ?? "<eof>").trim()}`);
      console.log(`        js  : ${(b[i] ?? "<eof>").trim()}`);
    }
    process.exit(1);
  }

  console.log("\n✓ CDXGEN_RS_DISABLE=all is byte-identical across all scenarios");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
