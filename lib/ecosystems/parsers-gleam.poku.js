import { assert, describe, it } from "poku";

import { parseGleamProject } from "./parsers-gleam.js";

describe("parseGleamProject with lock", () => {
  it("parses parent, direct/transitive scope, and dev detection", () => {
    const { pkgList, dependencies, rootInputs, parentComponent } =
      parseGleamProject(
        "./test/data/gleam-smoke/gleam.toml",
        "./test/data/gleam-smoke/manifest.toml",
      );
    assert.strictEqual(parentComponent.name, "gleam-smoke");
    assert.strictEqual(parentComponent.version, "1.2.0");
    const targetProp = parentComponent.properties.find(
      (p) => p.name === "cdx:gleam:target",
    );
    assert.strictEqual(targetProp.value, "erlang");

    // Seven resolved packages from the lock.
    assert.strictEqual(pkgList.length, 7);

    const stdlib = pkgList.find((p) => p.name === "gleam_stdlib");
    assert.ok(stdlib);
    assert.strictEqual(stdlib.version, "1.0.3");
    // Gleam resolves through Hex, so the purl is pkg:hex/...
    assert.strictEqual(stdlib.purl, "pkg:hex/gleam_stdlib@1.0.3");
    assert.strictEqual(stdlib.scope, "required");
    const stdlibDep = stdlib.properties.find(
      (p) => p.name === "cdx:gleam:dependency",
    );
    assert.strictEqual(stdlibDep.value, "direct");

    // gleam_http is a direct prod dependency and requires gleam_stdlib.
    const http = pkgList.find((p) => p.name === "gleam_http");
    assert.strictEqual(http.scope, "required");
    assert.strictEqual(
      http.properties.find((p) => p.name === "cdx:gleam:dependency").value,
      "direct",
    );

    // thofer and gleam_json are transitive.
    const thofer = pkgList.find((p) => p.name === "thofer");
    assert.strictEqual(
      thofer.properties.find((p) => p.name === "cdx:gleam:dependency").value,
      "transitive",
    );
    // thofer is reached from both gleam_http (prod) and gleeunit (dev). A
    // package shared with the runtime tree stays required, or a
    // `--required-only` BOM would silently lose it.
    assert.strictEqual(thofer.scope, "required");
    assert.ok(!thofer.properties.some((p) => p.name === "cdx:gleam:scope"));

    // exception is reachable only from the dev dependency, so it is optional.
    const exception = pkgList.find((p) => p.name === "exception");
    assert.strictEqual(exception.scope, "optional");
    assert.strictEqual(
      exception.properties.find((p) => p.name === "cdx:gleam:scope").value,
      "development",
    );

    // gleeunit is a direct dev dependency → optional scope + development marker.
    const gleeunit = pkgList.find((p) => p.name === "gleeunit");
    assert.strictEqual(gleeunit.scope, "optional");
    assert.strictEqual(
      gleeunit.properties.find((p) => p.name === "cdx:gleam:scope").value,
      "development",
    );

    // Every emitted purl must use the registered hex type — never pkg:gleam/.
    for (const pkg of pkgList) {
      assert.ok(
        pkg.purl.startsWith("pkg:hex/"),
        `${pkg.name} must be hex, got ${pkg.purl}`,
      );
    }

    // The root inputs are exactly the direct dependencies.
    assert.ok(rootInputs.length === 4);

    // Dependency graph: gleam_http depends on gleam_stdlib.
    const httpEdge = dependencies.find((d) =>
      d.ref.includes("gleam_http@3.7.2"),
    );
    assert.ok(httpEdge);
    assert.ok(httpEdge.dependsOn.some((r) => r.includes("gleam_stdlib@1.0.3")));
  });
});

describe("parseGleamProject without lock", () => {
  it("falls back to declared dependencies with no resolved versions", () => {
    const { pkgList, dependencies } = parseGleamProject(
      "./test/data/gleam-smoke/gleam.toml",
    );
    // Three declared main dependencies.
    assert.strictEqual(pkgList.length, 3);
    const stdlib = pkgList.find((p) => p.name === "gleam_stdlib");
    assert.ok(stdlib);
    // No lock means no resolved version.
    assert.strictEqual(stdlib.version, undefined);
    assert.strictEqual(stdlib.purl, "pkg:hex/gleam_stdlib");
    assert.strictEqual(
      stdlib.properties.find((p) => p.name === "cdx:gleam:dependency").value,
      "direct",
    );
    assert.deepEqual(dependencies, []);
  });
});

describe("parseGleamProject error handling", () => {
  it("returns empty results for a missing manifest", () => {
    const { pkgList, parentComponent } = parseGleamProject(
      "./test/data/missing-gleam.toml",
    );
    assert.deepEqual(pkgList, []);
    assert.deepEqual(parentComponent, {});
  });
});
