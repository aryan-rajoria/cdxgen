import { assert, describe, it } from "poku";

import { parseJuliaProject } from "./parsers-julia.js";

describe("parseJuliaProject", () => {
  it("parses the manifest lock with purls, stdlibs, and the dependency graph", () => {
    const { pkgList, dependencies, parentComponent, rootInputs } =
      parseJuliaProject(
        "./test/data/julia-smoke/Project.toml",
        "./test/data/julia-smoke/Manifest.toml",
      );
    assert.strictEqual(parentComponent.name, "JuliaSmoke");
    assert.strictEqual(parentComponent.version, "0.2.0");
    const uuidProp = parentComponent.properties.find(
      (p) => p.name === "cdx:julia:uuid",
    );
    assert.strictEqual(uuidProp.value, "9f4a2b3c-1111-2222-3333-444455556666");

    // Manifest resolves ten entries including standard libraries.
    assert.strictEqual(pkgList.length, 10);

    // Git-sourced entries carry no registry version; the content hash is the
    // most precise version the manifest offers.
    const exampleGit = pkgList.find((p) => p.name === "ExampleGit");
    assert.ok(exampleGit);
    assert.strictEqual(
      exampleGit.version,
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    );
    assert.ok(
      !exampleGit.properties.some((p) => p.name === "cdx:julia:stdlib"),
      "a git-pinned package is not a standard library",
    );

    const json = pkgList.find((p) => p.name === "JSON");
    assert.ok(json);
    assert.strictEqual(json.version, "0.21.4");
    assert.strictEqual(
      json.purl,
      "pkg:julia/JSON@0.21.4?uuid=682c06a0-f37d-4e50-b270-096b1504d0d4",
    );
    assert.strictEqual(
      json.properties.find((p) => p.name === "cdx:julia:dependency").value,
      "direct",
    );

    // Standard libraries carry no version and are marked as such.
    const dates = pkgList.find((p) => p.name === "Dates");
    assert.ok(dates);
    assert.strictEqual(dates.version, undefined);
    assert.strictEqual(
      dates.properties.find((p) => p.name === "cdx:julia:stdlib").value,
      "true",
    );
    assert.ok(
      !json.properties.some((p) => p.name === "cdx:julia:stdlib"),
      "registry packages must not be flagged as stdlib",
    );

    // Parsers is transitive (only JSON is declared in Project.toml).
    const parsers = pkgList.find((p) => p.name === "Parsers");
    assert.strictEqual(
      parsers.properties.find((p) => p.name === "cdx:julia:dependency").value,
      "transitive",
    );

    // The root links only to the declared direct dependency.
    assert.deepStrictEqual(rootInputs, [json["bom-ref"]]);

    // JSON depends on Dates, Mmap, Parsers, and Unicode per the manifest.
    const jsonEdge = dependencies.find((d) => d.ref === json["bom-ref"]);
    assert.ok(jsonEdge);
    const jsonEdgeNames = jsonEdge.dependsOn.map(
      (ref) => ref.split("?")[0].replace("pkg:julia/", "").split("@")[0],
    );
    for (const expected of ["Dates", "Mmap", "Parsers", "Unicode"]) {
      assert.ok(jsonEdgeNames.includes(expected), `${expected} missing`);
    }

    // Every registry package keeps its uuid qualifier; stdlibs keep theirs too.
    for (const pkg of pkgList) {
      assert.ok(
        pkg.purl.startsWith("pkg:julia/") && pkg.purl.includes("uuid="),
        `${pkg.name} must carry a julia purl with uuid`,
      );
    }
  });

  it("falls back to declared dependencies without a manifest", () => {
    const { pkgList, rootInputs } = parseJuliaProject(
      "./test/data/julia-smoke/Project.toml",
      undefined,
    );
    assert.strictEqual(pkgList.length, 1);
    const json = pkgList[0];
    assert.strictEqual(json.name, "JSON");
    assert.strictEqual(json.version, undefined);
    assert.deepStrictEqual(rootInputs, [json["bom-ref"]]);
  });

  it("parses a manifest with no project file", () => {
    const { pkgList, parentComponent } = parseJuliaProject(
      undefined,
      "./test/data/julia-smoke/Manifest.toml",
    );
    assert.strictEqual(pkgList.length, 10);
    assert.deepStrictEqual(parentComponent, {});
  });
});
