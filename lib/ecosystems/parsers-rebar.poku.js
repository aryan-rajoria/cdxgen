import { assert, describe, it } from "poku";

import { parseErlangTerms, parseRebarLock } from "./parsers-rebar.js";

describe("parseRebarLock", () => {
  it("parses hex packages with hashes and git dependencies with revisions", () => {
    const { pkgList } = parseRebarLock("./test/data/rebar-smoke/rebar.lock");
    assert.strictEqual(pkgList.length, 5);

    const cowboy = pkgList.find((p) => p.name === "cowboy");
    assert.strictEqual(cowboy.version, "2.10.0");
    assert.strictEqual(cowboy.purl, "pkg:hex/cowboy@2.10.0");
    assert.strictEqual(
      cowboy.properties.find((p) => p.name === "cdx:rebar:dependency").value,
      "direct",
    );
    // The digests live in a second top-level term, after the dependency list.
    assert.ok(
      cowboy.hashes?.length === 1 && cowboy.hashes[0].alg === "SHA-256",
      "hex pkg_hash must become a SHA-256 content hash",
    );
    assert.strictEqual(
      cowboy.hashes[0].content,
      "3afdccb7183cc6f143cb14d3cf51fa00e53db9ec80cdcd525482f5e99bc41d6a",
    );

    const cowlib = pkgList.find((p) => p.name === "cowlib");
    assert.strictEqual(
      cowlib.properties.find((p) => p.name === "cdx:rebar:dependency").value,
      "transitive",
    );

    // The application name and the hex package name can differ; the hex name
    // is what identifies the release, and the digest is keyed by either.
    const uuid = pkgList.find((p) => p.name === "uuid_erl");
    assert.strictEqual(uuid.purl, "pkg:hex/uuid_erl@2.0.7");
    assert.strictEqual(
      uuid.hashes[0].content,
      "1fd9079c544d521063897887a1c5b3302dca98f9bb06aadcdc6fb0663f256797",
    );

    const mylib = pkgList.find((p) => p.name === "mylib");
    assert.strictEqual(
      mylib.version,
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
    assert.ok(mylib.purl.startsWith("pkg:hex/mylib@"));
    assert.strictEqual(mylib.hashes, undefined);

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:hex/"), pkg.purl);
    }
  });

  it("reads both top-level terms of a lock", () => {
    const terms = parseErlangTerms(
      '% comment\n{"1.2.0", [{<<"a">>,{pkg,<<"a">>,<<"1.0">>},0}]}.\n' +
        '[{pkg_hash,[{<<"a">>, <<"ABCD">>}]}].',
    );
    assert.strictEqual(terms.length, 2);
    assert.strictEqual(terms[0][0], "1.2.0");
    assert.strictEqual(terms[0][1][0][0], "a");
    assert.strictEqual(terms[0][1][0][1][0], "pkg");
    assert.strictEqual(terms[1][0][0], "pkg_hash");
  });

  it("reads the legacy lock format, which wrote a bare dependency list", () => {
    const { pkgList } = parseRebarLock(
      "./test/data/rebar-smoke/legacy/rebar.lock",
    );
    assert.strictEqual(pkgList.length, 1);
    assert.strictEqual(pkgList[0].purl, "pkg:hex/goldrush@0.1.9");
  });

  it("returns no packages for unreadable input", () => {
    const { pkgList } = parseRebarLock("./test/data/rebar-smoke/missing.lock");
    assert.deepStrictEqual(pkgList, []);
  });
});
