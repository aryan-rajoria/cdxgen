import process from "node:process";

import { assert, describe, it } from "poku";

import {
  INFERRED_ROOTS_PROPERTY,
  repairParentDependencyEdge,
} from "./parentEdge.js";

/**
 * Builds the shape produced by a leg that resolved everything from a lock file:
 * a complete transitive tree with no edge from the parent component.
 */
function rootlessBom() {
  return {
    metadata: { component: { "bom-ref": "pkg:pypi/app@1.0.0", name: "app" } },
    components: [
      { "bom-ref": "pkg:pypi/requests@2.28.0", name: "requests" },
      { "bom-ref": "pkg:pypi/idna@3.3", name: "idna" },
      { "bom-ref": "pkg:pypi/urllib3@1.26.13", name: "urllib3" },
    ],
    dependencies: [
      {
        ref: "pkg:pypi/requests@2.28.0",
        dependsOn: ["pkg:pypi/idna@3.3", "pkg:pypi/urllib3@1.26.13"],
      },
      { ref: "pkg:pypi/idna@3.3", dependsOn: [] },
      { ref: "pkg:pypi/urllib3@1.26.13", dependsOn: [] },
    ],
  };
}

function parentEntry(bom) {
  return bom.dependencies.find(
    (d) => d.ref === bom.metadata.component["bom-ref"],
  );
}

describe("repairParentDependencyEdge", () => {
  it("attaches the roots of the tree to a parent with no outgoing edge", () => {
    const bom = repairParentDependencyEdge(rootlessBom());
    assert.deepStrictEqual(parentEntry(bom), {
      ref: "pkg:pypi/app@1.0.0",
      dependsOn: ["pkg:pypi/requests@2.28.0"],
    });
    assert.strictEqual(bom.dependencies[0].ref, "pkg:pypi/app@1.0.0");
    assert.deepStrictEqual(
      bom.metadata.properties.filter((p) => p.name === INFERRED_ROOTS_PROPERTY),
      [{ name: INFERRED_ROOTS_PROPERTY, value: "1" }],
    );
  });

  it("fills an existing but empty parent entry in place", () => {
    const bom = rootlessBom();
    bom.dependencies.push({ ref: "pkg:pypi/app@1.0.0", dependsOn: [] });
    repairParentDependencyEdge(bom);
    assert.deepStrictEqual(parentEntry(bom).dependsOn, [
      "pkg:pypi/requests@2.28.0",
    ]);
    assert.strictEqual(
      bom.dependencies.filter((d) => d.ref === "pkg:pypi/app@1.0.0").length,
      1,
    );
  });

  it("sorts multiple roots and ignores refs that are already depended upon", () => {
    const bom = rootlessBom();
    bom.components.push({ "bom-ref": "pkg:pypi/flask@2.0.0", name: "flask" });
    bom.dependencies.push({ ref: "pkg:pypi/flask@2.0.0", dependsOn: [] });
    repairParentDependencyEdge(bom);
    assert.deepStrictEqual(parentEntry(bom).dependsOn, [
      "pkg:pypi/flask@2.0.0",
      "pkg:pypi/requests@2.28.0",
    ]);
  });

  it("leaves a parent that already declares its dependencies alone", () => {
    const bom = rootlessBom();
    bom.dependencies.push({
      ref: "pkg:pypi/app@1.0.0",
      dependsOn: ["pkg:pypi/idna@3.3"],
    });
    repairParentDependencyEdge(bom);
    assert.deepStrictEqual(parentEntry(bom).dependsOn, ["pkg:pypi/idna@3.3"]);
    assert.strictEqual(bom.metadata.properties, undefined);
  });

  it("leaves a flat inventory without any edges alone", () => {
    const bom = rootlessBom();
    for (const adep of bom.dependencies) {
      adep.dependsOn = [];
    }
    repairParentDependencyEdge(bom);
    assert.strictEqual(parentEntry(bom), undefined);
    assert.strictEqual(bom.metadata.properties, undefined);
  });

  it("skips a graph whose edges point at refs no component declares", () => {
    const bom = rootlessBom();
    bom.dependencies[0].dependsOn = ["pkg:pypi/ghost@1.0.0"];
    repairParentDependencyEdge(bom);
    assert.strictEqual(parentEntry(bom), undefined);
  });

  it("does not treat a provided crypto asset as a root", () => {
    const bom = {
      metadata: { component: { "bom-ref": "app@1.0.0" } },
      components: [
        { "bom-ref": "lib@1.0.0" },
        { "bom-ref": "sublib@1.0.0" },
        { "bom-ref": "crypto/algorithm@1" },
      ],
      dependencies: [
        {
          ref: "lib@1.0.0",
          dependsOn: ["sublib@1.0.0"],
          provides: ["crypto/algorithm@1"],
        },
        { ref: "sublib@1.0.0", dependsOn: [] },
        { ref: "crypto/algorithm@1", dependsOn: [] },
      ],
    };
    repairParentDependencyEdge(bom);
    assert.deepStrictEqual(parentEntry(bom).dependsOn, ["lib@1.0.0"]);
  });

  it("is a no-op without a parent component or dependencies", () => {
    const noParent = { dependencies: rootlessBom().dependencies };
    assert.deepStrictEqual(
      repairParentDependencyEdge(noParent).dependencies.length,
      3,
    );
    const noDeps = { metadata: { component: { "bom-ref": "app@1.0.0" } } };
    assert.deepStrictEqual(repairParentDependencyEdge(noDeps), noDeps);
    assert.strictEqual(repairParentDependencyEdge(undefined), undefined);
  });

  it("can be turned off with CDXGEN_PARENT_EDGE_REPAIR", () => {
    process.env.CDXGEN_PARENT_EDGE_REPAIR = "false";
    try {
      const bom = repairParentDependencyEdge(rootlessBom());
      assert.strictEqual(parentEntry(bom), undefined);
    } finally {
      delete process.env.CDXGEN_PARENT_EDGE_REPAIR;
    }
  });
});
