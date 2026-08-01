import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run the boundary checker and return its JSON output.
 * Uses spawnSync so we can capture output even on non-zero exit.
 */
function runChecker(extraArgs = []) {
  const result = spawnSync(
    "node",
    ["contrib/check-boundaries.js", "--json", ...extraArgs],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stdout = result.stdout?.trim() || "";
  if (stdout) {
    try {
      return JSON.parse(stdout);
    } catch {
      // fall through to error
    }
  }
  throw new Error(
    `check-boundaries.js produced no JSON output.\nstderr: ${result.stderr}`,
  );
}

// ─── Invariants and budgets ──────────────────────────────────────────────────
//
// Cycles are an INVARIANT, not a budget: the count is asserted to be exactly
// zero and there is deliberately no allowance to raise it. A cycle budget above
// zero would be an allowlist, which is the thing this file exists to prevent.
//
// Barrel and layer violations are a RATCHET: the recorded number is a ceiling
// that may only move down. `<=` rather than `===` matters — with an equality
// assertion, repointing a single `utils.js` import fails the suite, which
// punishes exactly the work this is meant to encourage. Lower the ceiling in the
// same commit that lowers the count.

const MAX = {
  barrelViolations: 0, // achieved: all internal utils.js imports repointed to leaf modules
  layerViolations: 0, // achieved: stages reclassified to L3, cli to L4, audit/server to L5
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("workspace boundary enforcement", () => {
  it("has no file-level cycles (invariant, not a budget)", () => {
    const data = runChecker();
    assert.strictEqual(
      data.fileCycles.length,
      0,
      `Expected zero file-level cycles but found ${data.fileCycles.length}.\n` +
        data.fileCycles.map((c) => `  ${c.cycle.join(" → ")}`).join("\n"),
    );
  });

  it("has no package-level cycles (invariant, not a budget)", () => {
    const data = runChecker();
    assert.strictEqual(
      data.packageCycles.length,
      0,
      `Expected zero package-level cycles but found ${data.packageCycles.length}.\n` +
        data.packageCycles.map((c) => `  ${c.cycle.join(" → ")}`).join("\n"),
    );
  });

  it("barrel violations stay at or below the recorded ceiling (ratchet)", () => {
    const data = runChecker();
    assert.ok(
      data.barrelViolations.length <= MAX.barrelViolations,
      `Barrel violations rose to ${data.barrelViolations.length}, above the ceiling of ${MAX.barrelViolations}. New code must import siblings directly, never lib/helpers/utils.js.`,
    );
  });

  it("layer violations stay at or below the recorded ceiling (ratchet)", () => {
    const data = runChecker();
    assert.ok(
      data.layerViolations.length <= MAX.layerViolations,
      `Layer violations rose to ${data.layerViolations.length}, above the ceiling of ${MAX.layerViolations}. Imports must point strictly downward:\n` +
        data.layerViolations.map((v) => `  ${JSON.stringify(v)}`).join("\n"),
    );
  });

  it("checker rejects a synthetic cyclic fixture (proves detection works)", () => {
    // Create a temp directory with two files that import each other.
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cycle-test-"));
    writeFileSync(
      path.join(tmpDir, "a.js"),
      `import { b } from "./b.js";\nexport const a = 1;\n`,
    );
    writeFileSync(
      path.join(tmpDir, "b.js"),
      `import { a } from "./a.js";\nexport const b = 2;\n`,
    );

    const data = runChecker([`--scan-root=${tmpDir}`]);

    // The checker must find at least one cycle in this fixture.
    assert.ok(
      data.fileCycles.length > 0,
      "Checker failed to detect a synthetic 2-file cycle — the detector is not detecting.",
    );
  });

  it("checker rejects a synthetic 3-file cycle", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cycle-test-3-"));
    writeFileSync(
      path.join(tmpDir, "x.js"),
      `import { y } from "./y.js";\nexport const x = 1;\n`,
    );
    writeFileSync(
      path.join(tmpDir, "y.js"),
      `import { z } from "./z.js";\nexport const y = 2;\n`,
    );
    writeFileSync(
      path.join(tmpDir, "z.js"),
      `import { x } from "./x.js";\nexport const z = 3;\n`,
    );

    const data = runChecker([`--scan-root=${tmpDir}`]);

    assert.ok(
      data.fileCycles.length > 0,
      "Checker failed to detect a synthetic 3-file cycle.",
    );
  });

  it("checker detects cycles through dynamic import()", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cycle-dynamic-"));
    // Use a dynamic import() to create the back-edge — this is the
    // laundering technique the checker must catch.
    writeFileSync(
      path.join(tmpDir, "dyn-a.js"),
      `import { b } from "./dyn-b.js";\nexport const a = 1;\n`,
    );
    writeFileSync(
      path.join(tmpDir, "dyn-b.js"),
      `export const b = 2;\nawait import("./dyn-a.js");\n`,
    );

    const data = runChecker([`--scan-root=${tmpDir}`]);

    assert.ok(
      data.fileCycles.length > 0,
      "Checker failed to detect a cycle created through dynamic import().",
    );
  });

  it("every workspace package is private", () => {
    const packages = [
      "core",
      "helpers",
      "parsers",
      "managers",
      "stages",
      "cli",
      "evinser",
      "server",
      "validator",
      "audit",
      "third-party",
    ];

    for (const pkg of packages) {
      const pkgJson = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "packages", pkg, "package.json"),
          "utf-8",
        ),
      );
      assert.strictEqual(
        pkgJson.private,
        true,
        `packages/${pkg}/package.json must be private`,
      );
    }
  });

  it("every package test script targets a dir that actually has tests", () => {
    const packages = [
      "core",
      "helpers",
      "parsers",
      "managers",
      "stages",
      "cli",
      "evinser",
      "server",
      "validator",
      "audit",
    ];

    for (const pkg of packages) {
      const pkgJson = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "packages", pkg, "package.json"),
          "utf-8",
        ),
      );
      const script = pkgJson.scripts?.test;
      assert.ok(script, `packages/${pkg} must declare a test script`);

      const target = script.trim().split(/\s+/).pop();
      const targetDir = path.join(REPO_ROOT, target);
      assert.ok(
        existsSync(targetDir),
        `packages/${pkg} test script targets missing dir: ${target}`,
      );

      const found = spawnSync("find", [targetDir, "-name", "*.poku.js"], {
        encoding: "utf-8",
      })
        .stdout.split("\n")
        .filter(Boolean);
      assert.ok(
        found.length > 0,
        `packages/${pkg} test script targets ${target} which contains no .poku.js files — it would pass vacuously`,
      );
    }
  });

  it("only @cdxgen/cdxgen is publishable", () => {
    const rootPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    );
    assert.strictEqual(rootPkg.name, "@cdxgen/cdxgen");
    assert.notStrictEqual(rootPkg.private, true);
  });
});
