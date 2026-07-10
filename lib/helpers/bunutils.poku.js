import { strict as assert } from "node:assert";

import { describe, test } from "poku";

import { parseBunDescriptor, parseBunLock } from "./bunutils.js";

const FIXTURE = "./test/data/bun/bun.lock";

describe("parseBunDescriptor", async () => {
  await test("parses an unscoped descriptor", () => {
    assert.deepStrictEqual(parseBunDescriptor("left-pad@1.3.0"), {
      group: "",
      name: "left-pad",
      version: "1.3.0",
    });
  });

  await test("parses a scoped descriptor", () => {
    assert.deepStrictEqual(parseBunDescriptor("@babel/parser@7.29.7"), {
      group: "@babel",
      name: "parser",
      version: "7.29.7",
    });
  });

  await test("preserves git specifiers as the version", () => {
    const parsed = parseBunDescriptor(
      "foo@git+https://github.com/foo/bar#abcdef",
    );
    assert.deepStrictEqual(parsed.group, "");
    assert.deepStrictEqual(parsed.name, "foo");
    assert.deepStrictEqual(
      parsed.version,
      "git+https://github.com/foo/bar#abcdef",
    );
  });
});

describe("parseBunLock", async () => {
  await test("returns empty lists for a missing file", async () => {
    const { pkgList, dependenciesList } = await parseBunLock(
      "./test/data/bun/does-not-exist.lock",
    );
    assert.deepStrictEqual(pkgList.length, 0);
    assert.deepStrictEqual(dependenciesList.length, 0);
  });

  await test("parses the fixture lockfile", async () => {
    const { pkgList, dependenciesList } = await parseBunLock(FIXTURE);
    // 5 packages in the fixture.
    assert.deepStrictEqual(pkgList.length, 5);
    assert.deepStrictEqual(dependenciesList.length, 5);

    const byName = Object.fromEntries(pkgList.map((p) => [p.name, p]));

    // Scoped registry package: purl + bom-ref + integrity + distribution ref.
    const parser = byName.parser;
    assert.deepStrictEqual(parser.group, "@babel");
    assert.deepStrictEqual(parser.version, "7.29.7");
    assert.deepStrictEqual(parser.purl, "pkg:npm/%40babel/parser@7.29.7");
    assert.deepStrictEqual(parser["bom-ref"], "pkg:npm/@babel/parser@7.29.7");
    assert.ok(parser._integrity.startsWith("sha512-"));
    assert.ok(
      parser.externalReferences.some(
        (ref) =>
          ref.type === "distribution" &&
          ref.url ===
            "https://registry.npmjs.org/@babel/parser/-/parser-7.29.7.tgz",
      ),
    );
    // Has a binary declared in metadata.
    assert.ok(
      parser.properties.some(
        (prop) => prop.name === "cdx:npm:has_binary" && prop.value === "true",
      ),
    );

    // left-pad is a plain production dependency (no optional scope).
    assert.deepStrictEqual(byName["left-pad"].scope, undefined);

    // typescript is a devDependency: scoped optional + development property.
    const ts = byName.typescript;
    assert.deepStrictEqual(ts.scope, "optional");
    assert.ok(
      ts.properties.some((prop) => prop.name === "cdx:npm:package:development"),
    );

    // fsevents is an optionalDependency: optional scope + optional property + os.
    const fsevents = byName.fsevents;
    assert.deepStrictEqual(fsevents.scope, "optional");
    assert.ok(
      fsevents.properties.some(
        (prop) => prop.name === "cdx:npm:package:optional",
      ),
    );
    assert.ok(
      fsevents.properties.some(
        (prop) => prop.name === "cdx:npm:os" && prop.value === "darwin",
      ),
    );

    // Dependency graph: @babel/parser depends on @babel/types.
    const parserDeps = dependenciesList.find(
      (d) => d.ref === "pkg:npm/@babel/parser@7.29.7",
    );
    assert.deepStrictEqual(parserDeps.dependsOn, [
      "pkg:npm/@babel/types@7.29.7",
    ]);

    // Every component carries the SrcFile property and manifest-analysis
    // evidence pointing at the lockfile.
    for (const pkg of pkgList) {
      assert.ok(
        pkg.properties.some(
          (prop) => prop.name === "SrcFile" && prop.value === FIXTURE,
        ),
      );
      assert.deepStrictEqual(
        pkg.evidence.identity.methods[0].technique,
        "manifest-analysis",
      );
    }
  });

  await test("adds the root dependency entry when a parent component is given", async () => {
    const parentComponent = {
      name: "bun-fixture",
      version: "1.0.0",
      "bom-ref": "pkg:npm/bun-fixture@1.0.0",
    };
    const { dependenciesList } = await parseBunLock(FIXTURE, {
      parentComponent,
    });
    const rootDeps = dependenciesList.find(
      (d) => d.ref === "pkg:npm/bun-fixture@1.0.0",
    );
    assert.ok(rootDeps);
    // Root prod deps: left-pad, @babel/parser and the optional fsevents.
    assert.ok(rootDeps.dependsOn.includes("pkg:npm/left-pad@1.3.0"));
    assert.ok(rootDeps.dependsOn.includes("pkg:npm/@babel/parser@7.29.7"));
    assert.ok(rootDeps.dependsOn.includes("pkg:npm/fsevents@2.3.3"));
    // typescript is dev-only and must NOT be a production root dependency.
    assert.ok(!rootDeps.dependsOn.includes("pkg:npm/typescript@6.0.3"));
  });
});
