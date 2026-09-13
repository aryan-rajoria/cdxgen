import { assert, describe, it } from "poku";

import { parseOpamLockedFile } from "./parsers-opam.js";

describe("parseOpamLockedFile", () => {
  it("parses pinned dependencies and sanitises pin URLs", () => {
    const { pkgList, pins } = parseOpamLockedFile(
      "./test/data/opam-smoke/example.opam.locked",
    );
    assert.strictEqual(pkgList.length, 6);

    const dune = pkgList.find((p) => p.name === "dune");
    assert.strictEqual(dune.version, "3.16.0");
    assert.strictEqual(dune.purl, "pkg:opam/dune@3.16.0");

    const confLibssl = pkgList.find((p) => p.name === "conf-libssl");
    assert.strictEqual(confLibssl.version, "4");

    // A pin-depends entry names `<package>.<version>` while the matching
    // depends entry carries the bare name, so the suffix must be split off
    // for the two to line up.
    assert.strictEqual(pins.length, 1);
    assert.strictEqual(pins[0].name, "mylib");
    const mylib = pkgList.find((p) => p.name === "mylib");
    assert.ok(mylib, "the pinned package must be inventoried");
    assert.strictEqual(
      mylib.properties.find((p) => p.name === "cdx:opam:pinned").value,
      "true",
    );
    assert.strictEqual(
      mylib.properties.find((p) => p.name === "cdx:opam:pinSource").value,
      "git+https://github.com/example/mylib.git",
    );

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:opam/"), pkg.purl);
    }
  });

  it("falls back to a plain .opam manifest without pinned versions", () => {
    const { pkgList, pins } = parseOpamLockedFile(
      "./test/data/opam-smoke/plain/example.opam",
    );
    assert.deepStrictEqual(pins, []);
    assert.strictEqual(pkgList.length, 2);
    // Constraint-only entries are inventoried without a version.
    const dune = pkgList.find((p) => p.name === "dune");
    assert.strictEqual(dune.version, undefined);
    assert.strictEqual(dune.purl, "pkg:opam/dune");
  });

  it("returns no packages for unreadable input", () => {
    const { pkgList } = parseOpamLockedFile("./test/data/opam-smoke/missing");
    assert.deepStrictEqual(pkgList, []);
  });
});
