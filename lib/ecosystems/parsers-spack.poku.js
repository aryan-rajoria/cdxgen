import { assert, describe, it } from "poku";

import { parseSpackLock } from "./parsers-spack.js";

describe("parseSpackLock", () => {
  it("parses concrete specs and the runtime dependency graph", () => {
    const { pkgList, dependencies, rootInputs } = parseSpackLock(
      "./test/data/spack-smoke/spack.lock",
    );
    assert.strictEqual(pkgList.length, 3);

    const zlib = pkgList.find((p) => p.name === "zlib");
    assert.strictEqual(zlib.version, "1.3.1");
    assert.strictEqual(zlib.purl, "pkg:generic/spack/zlib@1.3.1");
    // The DAG hash keeps two builds of one version apart.
    assert.strictEqual(
      zlib["bom-ref"],
      "pkg:generic/spack/zlib@1.3.1#pqxz3jkl7m2n4o5p6q7r8s9t0u1v2w3x",
    );
    assert.strictEqual(
      zlib.properties.find((p) => p.name === "cdx:purl:proposedType").value,
      "spack",
    );
    assert.strictEqual(
      zlib.properties.find((p) => p.name === "cdx:spack:hash").value,
      "pqxz3jkl7m2n4o5p6q7r8s9t0u1v2w3x",
    );
    assert.strictEqual(
      zlib.properties.find((p) => p.name === "cdx:spack:namespace").value,
      "builtin",
    );
    assert.strictEqual(
      zlib.properties.find((p) => p.name === "cdx:spack:arch").value,
      "linux-ubuntu22.04-x86_64_v3",
    );
    assert.strictEqual(
      zlib.properties.find((p) => p.name === "cdx:spack:compiler").value,
      "gcc@11.4.0",
    );

    // gmake is a build-only dependency of zlib and must not be linked.
    const zlibEdge = dependencies.find((d) => d.ref === zlib["bom-ref"]);
    const gccRuntime = pkgList.find((p) => p.name === "gcc-runtime");
    assert.deepStrictEqual(zlibEdge.dependsOn, [gccRuntime["bom-ref"]]);

    // The environment names its own roots rather than them being inferred.
    assert.deepStrictEqual(rootInputs, [zlib["bom-ref"]]);

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:generic/spack/"), pkg.purl);
    }
  });

  it("returns an empty result for unreadable input", () => {
    const { pkgList, rootInputs } = parseSpackLock(
      "./test/data/spack-smoke/missing.lock",
    );
    assert.deepStrictEqual(pkgList, []);
    assert.deepStrictEqual(rootInputs, []);
  });
});
