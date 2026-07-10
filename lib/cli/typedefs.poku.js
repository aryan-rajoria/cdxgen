import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

import { describe, it } from "poku";

// Guards the `pnpm gen-types` output (the published `types/` tree) so that a
// TypeScript compiler upgrade cannot silently regress the generated
// declarations. This was motivated by the TypeScript 7.0 (native) upgrade:
// TS 7 is stricter about declaration emit (e.g. TS4094 on anonymous exported
// classes with private fields) and, on error, simply skips emitting the
// affected `.d.ts` instead of failing loudly. These tests assert that a
// declaration exists for every compiled source file, mirroring the source
// layout, and that the public API entrypoint keeps its exports.

const repoRoot = process.cwd();
const typesRoot = join(repoRoot, "types");

// Mirror the tsconfig.json `include`/`exclude` used by gen-types: all `.js`
// under lib/ and bin/, excluding poku test files.
const SOURCE_ROOTS = ["lib", "bin"];

function listJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listJsFiles(fullPath));
    } else if (entry.endsWith(".js") && !entry.endsWith(".poku.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectSources() {
  const sources = [];
  for (const root of SOURCE_ROOTS) {
    sources.push(...listJsFiles(join(repoRoot, root)));
  }
  return sources;
}

describe("generated type declarations (gen-types output)", () => {
  it("emits a .d.ts for every compiled source file (no silently dropped declarations)", () => {
    const sources = collectSources();
    assert.ok(
      sources.length > 100,
      `expected to find the cdxgen sources, only found ${sources.length}`,
    );

    const missing = [];
    for (const source of sources) {
      const rel = relative(repoRoot, source).replace(/\.js$/, ".d.ts");
      const declPath = join(typesRoot, rel);
      let declStat;
      try {
        declStat = statSync(declPath);
      } catch {
        missing.push(rel);
        continue;
      }
      if (declStat.size === 0) {
        missing.push(`${rel} (empty)`);
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `Missing/empty generated declarations. Run \`pnpm gen-types\` and commit the result.\n${missing.join("\n")}`,
    );
  });

  it("keeps the public API entrypoint declaration and its core exports", () => {
    const entry = join(typesRoot, "lib", "cli", "index.d.ts");
    const contents = readFileSync(entry, "utf8");
    assert.ok(contents.length > 0, "public entrypoint declaration is empty");

    // A representative sample of the public API that consumers import. If the
    // declaration emitter ever drops these, downstream typings break.
    for (const symbol of [
      "createBom",
      "createJavaBom",
      "createNodejsBom",
      "createPythonBom",
      "submitBom",
    ]) {
      assert.ok(
        new RegExp(`\\b${symbol}\\b`).test(contents),
        `public entrypoint no longer declares "${symbol}"`,
      );
    }
  });
});
