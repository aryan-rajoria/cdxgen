import { assert, describe, it } from "poku";

import { parseStackProject } from "./parsers-stack.js";

describe("parseStackProject", () => {
  it("parses hackage and repository extra-deps from the lock", () => {
    const { pkgList, parentComponent, rootInputs } = parseStackProject(
      "./test/data/stack-smoke/stack.yaml.lock",
      "./test/data/stack-smoke/stack.yaml",
    );
    assert.strictEqual(parentComponent.name, "stack-smoke");
    assert.strictEqual(
      parentComponent.properties.find((p) => p.name === "cdx:stack:snapshot")
        .value,
      "lts-22.28",
    );

    assert.strictEqual(pkgList.length, 2);

    // The hackage location string carries name, version and tarball digest.
    const missiles = pkgList.find((p) => p.name === "acme-missiles");
    assert.strictEqual(missiles.version, "0.3");
    assert.strictEqual(missiles.purl, "pkg:hackage/acme-missiles@0.3");
    assert.strictEqual(missiles.hashes[0].alg, "SHA-256");
    assert.strictEqual(
      missiles.hashes[0].content,
      "2ba66a092a32593880a87fb00f3213762d7bca65a687d45965778deb8694c5d1",
    );

    // A repository extra-dep is pinned by commit, not by a hackage release.
    const yesod = pkgList.find((p) => p.name === "yesod-auth-oauth2");
    assert.strictEqual(
      yesod.version,
      "4a97f1b0b3e21d9a5ba5f7a1a5e33bb4cd7d5a1e",
    );
    assert.strictEqual(
      yesod.properties.find((p) => p.name === "cdx:stack:repository").value,
      "https://github.com/thoughtbot/yesod-auth-oauth2.git",
    );
    assert.strictEqual(yesod.hashes, undefined);

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:hackage/"), pkg.purl);
      assert.strictEqual(
        pkg.properties.find((p) => p.name === "cdx:stack:dependency").value,
        "extra-dep",
      );
    }
    assert.deepStrictEqual(
      rootInputs,
      pkgList.map((p) => p["bom-ref"]),
    );
  });

  it("falls back to the snapshot recorded in the lock", () => {
    const { pkgList, parentComponent } = parseStackProject(
      "./test/data/stack-smoke/stack.yaml.lock",
      undefined,
    );
    assert.strictEqual(pkgList.length, 2);
    assert.strictEqual(
      parentComponent.properties.find((p) => p.name === "cdx:stack:snapshot")
        .value,
      "lts-22.28",
    );
  });

  it("returns no packages for unreadable input", () => {
    const { pkgList } = parseStackProject(
      "./test/data/stack-smoke/missing.yaml.lock",
    );
    assert.deepStrictEqual(pkgList, []);
  });
});
