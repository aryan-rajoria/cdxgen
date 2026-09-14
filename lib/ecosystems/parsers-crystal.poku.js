import { assert, describe, it } from "poku";

import { parseShardsProject } from "./parsers-crystal.js";

describe("parseShardsProject", () => {
  it("parses the resolved lock and separates development dependencies", () => {
    const { pkgList, parentComponent, rootInputs } = parseShardsProject(
      "./test/data/crystal-smoke/shard.yml",
      "./test/data/crystal-smoke/shard.lock",
    );
    assert.strictEqual(parentComponent.name, "shards-smoke");
    assert.strictEqual(parentComponent.version, "0.1.0");
    assert.strictEqual(
      parentComponent.properties.find(
        (p) => p.name === "cdx:crystal:languageVersion",
      ).value,
      ">= 1.10.0",
    );

    assert.strictEqual(pkgList.length, 3);

    const httpF = pkgList.find((p) => p.name === "http-f");
    assert.strictEqual(httpF.version, "1.0.1");
    assert.strictEqual(httpF.purl, "pkg:generic/http-f@1.0.1");
    assert.strictEqual(httpF.scope, "required");
    assert.strictEqual(
      httpF.properties.find((p) => p.name === "cdx:purl:proposedType").value,
      "crystal",
    );
    assert.strictEqual(
      httpF.properties.find((p) => p.name === "cdx:crystal:dependency").value,
      "direct",
    );

    // ameba is declared under development_dependencies.
    const ameba = pkgList.find((p) => p.name === "ameba");
    assert.strictEqual(ameba.scope, "optional");
    assert.strictEqual(
      ameba.properties.find((p) => p.name === "cdx:crystal:scope").value,
      "development",
    );

    // exception is transitive: in the lock but declared nowhere.
    const exception = pkgList.find((p) => p.name === "exception");
    assert.strictEqual(
      exception.properties.find((p) => p.name === "cdx:crystal:dependency")
        .value,
      "transitive",
    );

    // Root links the declared dependencies, direct and development.
    assert.strictEqual(rootInputs.length, 2);

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:generic/"), pkg.purl);
    }
  });

  it("falls back to declared dependencies without a lock", () => {
    const { pkgList, rootInputs } = parseShardsProject(
      "./test/data/crystal-smoke/shard.yml",
      undefined,
    );
    // Development dependencies survive the fallback, matching the lock path.
    assert.strictEqual(pkgList.length, 2);
    const httpF = pkgList.find((p) => p.name === "http-f");
    assert.strictEqual(httpF.version, undefined);
    const ameba = pkgList.find((p) => p.name === "ameba");
    assert.strictEqual(ameba.scope, "optional");
    assert.strictEqual(rootInputs.length, 2);
  });
});
