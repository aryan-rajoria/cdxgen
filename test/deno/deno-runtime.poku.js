import { strict as assert } from "node:assert";
import { join } from "node:path";

import { describe, test } from "poku";

import { findJSImportsExports } from "../../lib/helpers/analyzer.js";
import {
  findDenoJson,
  parseDenoJsonFile,
  parseDenoLock,
  stripJsonc,
} from "../../lib/helpers/denoutils.js";
import {
  addEvidenceForImports,
  getRuntimeInformation,
  isDeno,
} from "../../lib/helpers/utils.js";

// These tests only make sense under the Deno runtime and are excluded from the
// default (Node) poku run by living outside the scanned lib/ and bin/ roots.
// Run them with `pnpm test:deno` (or `deno task test`), which invokes poku under
// Deno with the write/sys permissions the fixtures need.

const V5_PROJECT = "./test/data/deno-project";
const V5_FIXTURE = "./test/data/deno-project/deno.lock";

describe("cdxgen under the Deno runtime", () => {
  test("is actually running on Deno", () => {
    assert.ok(isDeno, "expected isDeno to be true under `deno run`");
    assert.ok(
      typeof globalThis.Deno !== "undefined",
      "expected the Deno global to be present",
    );
    const info = getRuntimeInformation();
    assert.strictEqual(info.runtime, "Deno");
    assert.ok(info.version, "expected a Deno version string");
  });

  test("reads deno.json / deno.jsonc under Deno", () => {
    assert.strictEqual(findDenoJson(V5_PROJECT), join(V5_PROJECT, "deno.json"));
    const config = parseDenoJsonFile(join(V5_PROJECT, "deno.json"));
    assert.strictEqual(config.name, "@demo/deno-app");
    // Comment/trailing-comma stripping must behave identically on Deno.
    assert.deepStrictEqual(JSON.parse(stripJsonc('{"a":1,}')), { a: 1 });
  });

  test("parses deno.lock into the same components under Deno", async () => {
    const parentComponent = { "bom-ref": "pkg:npm/@demo/deno-app@1.0.0" };
    const { pkgList, dependenciesList } = await parseDenoLock(V5_FIXTURE, {
      parentComponent,
    });
    // 12 jsr packages + 2 npm packages, matching the Node unit test.
    assert.strictEqual(pkgList.length, 14);

    // jsr packages map to the dep-scan-friendly `@jsr/<owner>__<name>` npm purl.
    const assertPkg = pkgList.find(
      (p) => p.group === "@jsr" && p.name === "std__assert",
    );
    assert.ok(assertPkg, "expected an @std/assert component under Deno");
    assert.strictEqual(assertPkg.purl, "pkg:npm/%40jsr/std__assert@1.0.19");

    // Every component (including leaf jsr packages) is wired into the graph.
    for (const p of pkgList) {
      assert.ok(
        dependenciesList.some((d) => d.ref === p["bom-ref"]),
        `component ${p["bom-ref"]} missing from the dependency graph`,
      );
    }
    const parentEntry = dependenciesList.find(
      (d) => d.ref === "pkg:npm/@demo/deno-app@1.0.0",
    );
    assert.ok(parentEntry, "expected the parent to be wired to its deps");
    assert.strictEqual(parentEntry.dependsOn.length, 4);
  });

  test("occurrence evidence resolves jsr and npm imports under Deno", async () => {
    const { pkgList } = await parseDenoLock(V5_FIXTURE, {
      parentComponent: { "bom-ref": "pkg:npm/@demo/deno-app@1.0.0" },
    });
    // The Babel analyzer must parse the TypeScript entrypoint under Deno.
    const { allImports, allExports } = await findJSImportsExports(
      V5_PROJECT,
      false,
    );
    await addEvidenceForImports(pkgList, allImports, allExports, false);
    const byName = Object.fromEntries(pkgList.map((p) => [p.name, p]));
    const occ = (n) =>
      (byName[n]?.evidence?.occurrences || []).map((o) => o.location);

    // jsr imports resolve via their original `@std/...` specifier.
    assert.ok(occ("std__assert").includes("main.ts"));
    assert.ok(occ("std__http").includes("main.ts"));
    // npm imports resolve by name.
    assert.ok(occ("chalk").includes("main.ts"));
    assert.ok(occ("lodash").includes("main.ts"));
    // Transitive-only jsr packages are not imported in source.
    assert.strictEqual(occ("std__internal").length, 0);

    // Lightweight call tracking works under Deno too: the chalk.green call site
    // (line 6) and the assert() call site (line 9) are recorded as occurrences
    // alongside the import lines.
    const occLines = (n) =>
      (byName[n]?.evidence?.occurrences || [])
        .map((o) => `${o.location}${o.line ? `#${o.line}` : ""}`)
        .sort();
    assert.deepStrictEqual(occLines("chalk"), ["main.ts#3", "main.ts#6"]);
    assert.deepStrictEqual(occLines("std__assert"), ["main.ts#1", "main.ts#9"]);
  });
});
