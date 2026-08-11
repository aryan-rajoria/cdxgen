#!/usr/bin/env node

/**
 * Benchmark: JS vs Rust validator on a large (~200k-component) BOM.
 *
 * Measures wall-clock time and peak RSS for both validators.
 * Run with a staged binary:
 *   CDXGEN_PLUGINS_DIR=/tmp/cdxgen-local-plugins node contrib/bench-validate.js
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

import { validateBom } from "../lib/validator/bomValidator.js";

const COMPONENT_COUNT = 10_000;
const benchDir = mkdtempSync(join(tmpdir(), "cdxgen-bench-"));
const bomPath = join(benchDir, "large-bom.json");

// Generate a large BOM
function generateLargeBom(count) {
  const components = [];
  const dependencies = [];
  for (let i = 0; i < count; i++) {
    components.push({
      type: "library",
      name: `package-${i}`,
      version: `1.${i}.0`,
      purl: `pkg:npm/package-${i}@1.${i}.0`,
      "bom-ref": `pkg:npm/package-${i}@1.${i}.0`,
      licenses: [{ license: { id: "MIT" } }],
      hashes: [{ alg: "SHA-256", content: "a".repeat(64) }],
    });
    dependencies.push({
      ref: `pkg:npm/package-${i}@1.${i}.0`,
      dependsOn: i > 0 ? [`pkg:npm/package-${i - 1}@1.${i - 1}.0`] : [],
    });
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:a6716839-395b-41f5-a30f-a58921a69b79",
    version: 1,
    metadata: {
      timestamp: "2024-01-01T00:00:00.000Z",
      tools: {
        components: [{ type: "application", name: "cdxgen", version: "13.0.0" }],
      },
      component: {
        type: "application",
        name: "bench-app",
        version: "1.0.0",
        purl: "pkg:generic/bench-app@1.0.0",
        "bom-ref": "pkg:generic/bench-app@1.0.0",
      },
    },
    components,
    dependencies,
  };
}

console.log(`Generating BOM with ${COMPONENT_COUNT} components...`);
const bom = generateLargeBom(COMPONENT_COUNT);
const bomStr = JSON.stringify(bom, null, 2);
writeFileSync(bomPath, bomStr);
const sizeMB = (bomStr.length / 1024 / 1024).toFixed(1);
console.log(`BOM size: ${sizeMB} MB (${bomPath})\n`);

// ---- JS validator benchmark ----
console.log("=== JS Validator ===");
const jsStart = process.hrtime.bigint();
const jsResult = await validateBom(bom);
const jsEnd = process.hrtime.bigint();
const jsMs = Number(jsEnd - jsStart) / 1_000_000;
const jsMemMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
console.log(`Result: ${jsResult ? "valid" : "invalid"}`);
console.log(`Wall clock: ${jsMs.toFixed(0)} ms`);
console.log(`Process RSS: ${jsMemMB} MB`);

// ---- Rust validator benchmark (standalone binary, fresh process) ----
console.log("\n=== Rust Validator (fresh process) ===");
const rustBinaryPath = process.env.CDXRS_CMD ||
  join(process.env.CDXGEN_PLUGINS_DIR || "/tmp/cdxgen-local-plugins", "cdxrs", `cdxrs-${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "amd64"}`);

try {
  const result = spawnSync(
    "/usr/bin/time",
    ["-l", rustBinaryPath, "validate", "--input", bomPath],
    { encoding: "utf-8", timeout: 120_000 },
  );
  const timeMatch = result.stderr?.match(/(\d+\.\d+)\s+real\s+(\d+\.\d+)\s+maxrss/);
  if (timeMatch) {
    console.log(`Wall clock: ${timeMatch[1]} s`);
    // maxrss is in KB on macOS
    const maxrssKB = parseFloat(timeMatch[2]) * 1024;
    console.log(`Peak RSS: ${(maxrssKB / 1024).toFixed(0)} MB`);
  } else {
    // Fallback: just time the spawn
    const freshStart = process.hrtime.bigint();
    const r = spawnSync(rustBinaryPath, ["validate", "--input", bomPath], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    const freshEnd = process.hrtime.bigint();
    console.log(`Wall clock: ${(Number(freshEnd - freshStart) / 1_000_000).toFixed(0)} ms`);
    console.log(`Exit: ${r.status}`);
    if (r.stdout) {
      try {
        const doc = JSON.parse(r.stdout);
        console.log(`Valid: ${doc.valid}`);
      } catch {}
    }
  }
} catch (e) {
  console.log(`Could not run standalone: ${e.message}`);
}

// Summary
console.log("\n=== Summary ===");
console.log(`BOM: ${COMPONENT_COUNT} components, ${sizeMB} MB`);
console.log(`JS:  ${jsMs.toFixed(0)} ms (wall), ${jsMemMB} MB (RSS)`);
