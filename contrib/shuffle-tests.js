/**
 * Seeded order-shuffle invariant test.
 *
 * For every committed golden file, shuffles every array that the normalizer
 * is supposed to sort (components, dependencies, dependsOn, licenses,
 * properties, externalReferences, hashes) using a seeded RNG, re-normalizes,
 * and asserts the result is byte-for-byte identical to the golden.
 *
 * This single test would have caught normalizer defects 2 (array-order
 * suffix assignment), 3 (non-total component sort key), and 6 (tool purl
 * version not normalized) on its own, because all three corrupt the golden
 * and the shuffled-then-normalized output *differently*.
 *
 * Run:  node contrib/shuffle-tests.js
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { normalizeBom, serializeBom } from "./sbom-normalize.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REPOTESTS_DIR = path.join(REPO_ROOT, "repotests");

let passed = 0;
let failed = 0;
const failures = [];

/**
 * Mulberry32 — a small, fast, deterministic PRNG. Given the same seed it
 * produces the same sequence on every platform and every Node version, so
 * a shuffle failure is always reproducible.
 */
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates shuffle using the provided RNG. */
function shuffleArray(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deep-clone then shuffle every order-sensitive array in a BOM. */
function shuffleBom(bom, seed) {
  const rng = mulberry32(seed);
  const clone = structuredClone(bom);

  const shuffleComponent = (c) => {
    if (!c || typeof c !== "object") return c;
    if (Array.isArray(c.licenses)) shuffleArray(c.licenses, rng);
    if (Array.isArray(c.properties)) shuffleArray(c.properties, rng);
    if (Array.isArray(c.externalReferences)) {
      shuffleArray(c.externalReferences, rng);
    }
    if (Array.isArray(c.hashes)) shuffleArray(c.hashes, rng);
    if (Array.isArray(c.components)) {
      shuffleArray(c.components, rng);
      c.components.forEach(shuffleComponent);
    }
    return c;
  };

  if (Array.isArray(clone.components)) {
    shuffleArray(clone.components, rng);
    clone.components.forEach(shuffleComponent);
  }
  if (Array.isArray(clone.dependencies)) {
    shuffleArray(clone.dependencies, rng);
    for (const d of clone.dependencies) {
      if (Array.isArray(d.dependsOn)) shuffleArray(d.dependsOn, rng);
    }
  }
  if (clone.metadata?.component) shuffleComponent(clone.metadata.component);
  if (Array.isArray(clone.metadata?.tools?.components)) {
    shuffleArray(clone.metadata.tools.components, rng);
    clone.metadata.tools.components.forEach(shuffleComponent);
  }
  if (Array.isArray(clone.metadata?.properties)) {
    shuffleArray(clone.metadata.properties, rng);
  }
  if (Array.isArray(clone.services)) shuffleArray(clone.services, rng);
  if (Array.isArray(clone.externalReferences)) {
    shuffleArray(clone.externalReferences, rng);
  }
  return clone;
}

/** Discover every golden file under repotests/ ... /expected/*.json. */
function discoverGoldens() {
  const found = [];
  if (!existsSync(REPOTESTS_DIR)) return found;
  for (const entry of readdirSync(REPOTESTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) {
      continue;
    }
    const expectedDir = path.join(REPOTESTS_DIR, entry.name, "expected");
    if (!existsSync(expectedDir)) continue;
    for (const f of readdirSync(expectedDir)) {
      if (f.endsWith(".json")) {
        found.push({
          project: entry.name,
          name: f,
          path: path.join(expectedDir, f),
        });
      }
    }
  }
  return found;
}

export async function main() {
  console.log("=== Seeded order-shuffle invariant tests ===\n");

  const goldens = discoverGoldens();
  if (goldens.length === 0) {
    console.error("FATAL: no golden files found under repotests/*/expected/.");
    process.exit(1);
  }

  // Multiple seeds to exercise different permutation patterns.
  const SEEDS = [1, 42, 999, 7, 31337];

  for (const { project, name, path: goldenPath } of goldens) {
    const label = `${project}/${name}`;
    const golden = JSON.parse(readFileSync(goldenPath, "utf-8"));
    const goldenStr = serializeBom(golden);

    for (const seed of SEEDS) {
      try {
        const shuffled = shuffleBom(golden, seed);
        const reNorm = normalizeBom(shuffled);
        const reNormStr = serializeBom(reNorm);
        assert.strictEqual(
          reNormStr,
          goldenStr,
          `shuffle with seed ${seed} changed the normalized output`,
        );
        passed++;
      } catch (err) {
        failed++;
        failures.push(`${label} [seed=${seed}]: ${err.message}`);
        console.log(`  [FAIL] ${label} [seed=${seed}]`);
      }
    }
    if (!failures.some((f) => f.startsWith(label))) {
      console.log(`  [PASS] ${label} (${SEEDS.length} seeds)`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

// Auto-run when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
