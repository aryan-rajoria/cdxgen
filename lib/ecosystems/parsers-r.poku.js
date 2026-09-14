import { assert, describe, it } from "poku";

import { parseRenvLock } from "./parsers-r.js";

describe("parseRenvLock", () => {
  it("parses packages with cran purls and provenance properties", () => {
    const { pkgList, parentComponent, rVersion, dependencies, rootInputs } =
      parseRenvLock("./test/data/renv-smoke/renv.lock");
    assert.strictEqual(rVersion, "4.4.1");
    assert.deepStrictEqual(parentComponent, {});

    assert.strictEqual(pkgList.length, 3);
    const dplyr = pkgList.find((p) => p.name === "dplyr");
    assert.strictEqual(dplyr.version, "1.1.4");
    assert.strictEqual(dplyr.purl, "pkg:cran/dplyr@1.1.4");
    assert.strictEqual(
      dplyr.properties.find((p) => p.name === "cdx:renv:source").value,
      "repository",
    );
    assert.strictEqual(
      dplyr.properties.find((p) => p.name === "cdx:renv:repository").value,
      "CRAN",
    );
    assert.strictEqual(
      dplyr.properties.find((p) => p.name === "cdx:renv:hash").value,
      "fedcba98",
    );

    // renv hashes describe DESCRIPTION content, not artifact bytes, so they
    // must not leak into the hashes array.
    assert.strictEqual(dplyr.hashes, undefined);

    for (const pkg of pkgList) {
      assert.ok(pkg.purl.startsWith("pkg:cran/"), pkg.purl);
      assert.strictEqual(pkg.scope, "required");
    }

    // Requirements rebuild the graph: dplyr requires rlang and tibble, while
    // the R runtime constraint is not an edge.
    const rlang = pkgList.find((p) => p.name === "rlang");
    const tibble = pkgList.find((p) => p.name === "tibble");
    const dplyrEdge = dependencies.find((d) => d.ref === dplyr["bom-ref"]);
    assert.deepStrictEqual(dplyrEdge.dependsOn, [
      rlang["bom-ref"],
      tibble["bom-ref"],
    ]);
    assert.ok(
      !JSON.stringify(dependencies).includes('"R"'),
      "the R runtime must not become an edge target",
    );
    // Only dplyr is required by nothing else.
    assert.deepStrictEqual(rootInputs, [dplyr["bom-ref"]]);
  });

  it("returns an empty result for malformed input", () => {
    const { pkgList } = parseRenvLock("./test/data/renv-smoke/missing.lock");
    assert.deepStrictEqual(pkgList, []);
  });
});
