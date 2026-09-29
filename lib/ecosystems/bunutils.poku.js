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
          (prop) => prop.name === "internal:SrcFile" && prop.value === FIXTURE,
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

// Generated with `bun install --lockfile-only` (bun 1.4.2). The root asks for
// the same packages @isaacs/cliui needs, but at older versions, so bun nests
// cliui's newer versions under its key one level above its own dependencies.
describe("parseBunLock: intermediate nesting", async () => {
  const NESTING_FIXTURE = "./test/data/bun/nesting/bun.lock";

  await test("resolves a dependency placed at an intermediate nesting level", async () => {
    const { pkgList, dependenciesList } = await parseBunLock(NESTING_FIXTURE);

    // wrap-ansi@8.1.0 sits at `@isaacs/cliui/wrap-ansi` and declares
    // string-width ^5.0.1 / strip-ansi ^7.0.1, which bun placed one level up
    // at `@isaacs/cliui/string-width` and `@isaacs/cliui/strip-ansi`. The
    // graph must link those versions, not the top-level 4.2.3 / 6.0.1.
    const wrap8 = dependenciesList.find(
      (d) => d.ref === "pkg:npm/wrap-ansi@8.1.0",
    );
    assert.ok(wrap8);
    assert.deepStrictEqual(wrap8.dependsOn, [
      "pkg:npm/ansi-styles@6.2.3",
      "pkg:npm/string-width@5.1.2",
      "pkg:npm/strip-ansi@7.2.0",
    ]);
    assert.ok(!wrap8.dependsOn.includes("pkg:npm/string-width@4.2.3"));
    assert.ok(!wrap8.dependsOn.includes("pkg:npm/strip-ansi@6.0.1"));

    // string-width@5.1.2 at `@isaacs/cliui/string-width` also resolves
    // strip-ansi at the intermediate level.
    const stringWidth5 = dependenciesList.find(
      (d) => d.ref === "pkg:npm/string-width@5.1.2",
    );
    assert.deepStrictEqual(stringWidth5.dependsOn, [
      "pkg:npm/eastasianwidth@0.2.0",
      "pkg:npm/emoji-regex@9.2.2",
      "pkg:npm/strip-ansi@7.2.0",
    ]);

    // Directly nested and top-level resolutions are unaffected: emoji-regex
    // ^9.2.2 exists at `@isaacs/cliui/string-width/emoji-regex`, and the
    // top-level wrap-ansi@7.0.0 keeps using the top-level versions.
    const stripAnsi7 = dependenciesList.find(
      (d) => d.ref === "pkg:npm/strip-ansi@7.2.0",
    );
    assert.deepStrictEqual(stripAnsi7.dependsOn, ["pkg:npm/ansi-regex@6.4.0"]);
    const wrap7 = dependenciesList.find(
      (d) => d.ref === "pkg:npm/wrap-ansi@7.0.0",
    );
    assert.deepStrictEqual(wrap7.dependsOn, [
      "pkg:npm/ansi-styles@4.3.0",
      "pkg:npm/string-width@4.2.3",
      "pkg:npm/strip-ansi@6.0.1",
    ]);

    // Everything in this fixture is a production dependency chain: the walk
    // through the intermediate levels must not orphan any nested package
    // into the development scope.
    for (const pkg of pkgList) {
      assert.deepStrictEqual(pkg.scope, undefined, pkg.purl);
    }
  });
});

// Generated with `bun install --lockfile-only` (bun 1.4.2). The workspace
// member pkg-a depends on strip-ansi 7.1.0 while the root pins 6.0.1, so bun
// nests the member's version under its package name (`pkg-a/strip-ansi`).
describe("parseBunLock: workspace members", async () => {
  const WORKSPACE_FIXTURE = "./test/data/bun/workspace/bun.lock";
  const parentComponent = {
    name: "cdxgen-bun-workspace-repro",
    version: "1.0.0",
    "bom-ref": "pkg:npm/cdxgen-bun-workspace-repro@1.0.0",
  };

  await test("keeps a member's production dependencies out of the development scope", async () => {
    const { pkgList, dependenciesList } = await parseBunLock(
      WORKSPACE_FIXTURE,
      { parentComponent },
    );

    const byVersion = Object.fromEntries(
      pkgList.filter((p) => p.name === "strip-ansi").map((p) => [p.version, p]),
    );

    // strip-ansi@7.1.0 ships via the pkg-a workspace member.
    const memberDep = byVersion["7.1.0"];
    assert.ok(memberDep);
    assert.deepStrictEqual(memberDep.scope, undefined);
    assert.ok(
      !memberDep.properties.some(
        (prop) => prop.name === "cdx:npm:package:development",
      ),
    );

    // Its own nested dependency ansi-regex@6.4.0 stays reachable as well.
    const nestedAnsiRegex = pkgList.find(
      (p) => p.name === "ansi-regex" && p.version === "6.4.0",
    );
    assert.deepStrictEqual(nestedAnsiRegex.scope, undefined);

    // The member's version resolves from its own key, not the top level.
    const memberDepEdges = dependenciesList.find(
      (d) => d.ref === "pkg:npm/strip-ansi@7.1.0",
    );
    assert.deepStrictEqual(memberDepEdges.dependsOn, [
      "pkg:npm/ansi-regex@6.4.0",
    ]);

    // The root keeps depending on its own pinned version, and the seeded
    // reachability walk must include the member's version too.
    const rootDeps = dependenciesList.find(
      (d) => d.ref === "pkg:npm/cdxgen-bun-workspace-repro@1.0.0",
    );
    assert.deepStrictEqual(rootDeps.dependsOn, [
      "pkg:npm/strip-ansi@6.0.1",
      "pkg:npm/strip-ansi@7.1.0",
    ]);
  });
});
