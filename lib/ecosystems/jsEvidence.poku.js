import { assert, describe, it } from "poku";

import { addEvidenceForImports } from "./jsEvidence.js";

const importOf = (importedAs, fileName, extra = {}) =>
  new Set([
    {
      fileName,
      lineNumber: 1,
      importedAs,
      importedModules: [importedAs],
      ...extra,
    },
  ]);

const propValue = (pkg, name) =>
  (pkg?.properties || []).find((property) => property.name === name)?.value;

describe("addEvidenceForImports()", () => {
  // #4336: a missing import is not evidence that a package is optional.
  it("promotes imported packages and leaves the rest at their manifest scope", async () => {
    const pkgList = [
      { group: "", name: "debug", properties: [] },
      { group: "", name: "left-pad", properties: [] },
      {
        group: "@scope",
        name: "runtime-plugin",
        properties: [],
      },
      {
        group: "",
        name: "peer-only",
        properties: [{ name: "cdx:npm:package:peer", value: "true" }],
      },
      {
        group: "",
        name: "is-number",
        scope: "optional",
        properties: [{ name: "cdx:npm:package:development", value: "true" }],
      },
      {
        group: "",
        name: "picocolors",
        scope: "optional",
        properties: [{ name: "cdx:npm:package:development", value: "true" }],
      },
    ];
    await addEvidenceForImports(
      pkgList,
      {
        debug: importOf("debug", "index.js"),
        "is-number": importOf("is-number", "index.js"),
      },
      {},
      false,
    );
    const scopeOf = Object.fromEntries(
      pkgList.map((pkg) => [pkg.name, pkg.scope]),
    );

    assert.strictEqual(scopeOf.debug, "required");
    assert.strictEqual(scopeOf["is-number"], "required");
    assert.strictEqual(scopeOf["left-pad"], undefined);
    assert.strictEqual(scopeOf["runtime-plugin"], undefined);
    assert.strictEqual(scopeOf["peer-only"], undefined);
    assert.strictEqual(scopeOf.picocolors, "optional");
    assert.strictEqual(
      pkgList.find((pkg) => pkg.name === "is-number").evidence.occurrences[0]
        .location,
      "index.js",
    );
  });

  it("scopes a package imported only for its types as excluded", async () => {
    const pkgList = [
      { group: "", name: "is-odd", properties: [] },
      { group: "", name: "is-even", properties: [] },
    ];
    await addEvidenceForImports(
      pkgList,
      {
        "is-odd": importOf("is-odd", "src/index.ts", { isTypeOnly: true }),
        "is-even": importOf("is-even", "src/index.ts"),
      },
      {},
      false,
    );
    const [isOdd, isEven] = pkgList;

    assert.strictEqual(isOdd.scope, "excluded");
    assert.strictEqual(propValue(isOdd, "cdx:npm:package:type-only"), "true");
    assert.strictEqual(isOdd.evidence.occurrences[0].location, "src/index.ts");
    assert.strictEqual(isEven.scope, "required");
    assert.strictEqual(
      propValue(isEven, "cdx:npm:package:type-only"),
      undefined,
    );
  });

  it("keeps a type-only import required when its bin command is used", async () => {
    const pkgList = [
      {
        group: "",
        name: "license-report",
        scope: "optional",
        properties: [{ name: "cdx:npm:bin", value: "license-report" }],
      },
    ];
    await addEvidenceForImports(
      pkgList,
      {
        "license-report": importOf("license-report", "src/report.ts", {
          isTypeOnly: true,
        }),
        "cdx:npm:bin/license-report": importOf(
          "cdx:npm:bin/license-report",
          "package.json",
        ),
      },
      {},
      false,
    );

    assert.strictEqual(pkgList[0].scope, "required");
    assert.strictEqual(
      propValue(pkgList[0], "cdx:npm:package:type-only"),
      undefined,
    );
  });
});
