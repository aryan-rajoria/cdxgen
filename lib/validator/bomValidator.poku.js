import { readFileSync as actualReadFileSync } from "node:fs";

import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

import { validateBom } from "./bomValidator.js";

const validCycloneDx20Bom = {
  specFormat: "CycloneDX",
  specVersion: "2.0",
  serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  version: 1,
  metadata: {
    component: {
      "bom-ref": "pkg:generic/demo@1.0.0",
      name: "demo",
      purl: "pkg:generic/demo@1.0.0",
      type: "application",
      version: "1.0.0",
    },
    tools: {
      components: [{ type: "application", name: "cdxgen", version: "12.4.0" }],
    },
  },
  components: [
    {
      "bom-ref": "pkg:npm/lodash@4.17.21",
      name: "lodash",
      purl: "pkg:npm/lodash@4.17.21",
      type: "library",
      version: "4.17.21",
    },
  ],
  dependencies: [
    {
      ref: "pkg:generic/demo@1.0.0",
      dependsOn: ["pkg:npm/lodash@4.17.21"],
    },
    { ref: "pkg:npm/lodash@4.17.21", dependsOn: [] },
  ],
};

describe("validateBom()", () => {
  it("validates CycloneDX 2.0-dev JSON against the bundled schema", () => {
    assert.strictEqual(validateBom(validCycloneDx20Bom), true);
  });

  it("returns a clear validation failure for unsupported spec versions", async () => {
    const readFileSyncStub = sinon.stub();
    const consoleLogStub = sinon.stub(console, "log");
    try {
      const { validateBom } = await esmock("./bomValidator.js", {
        "node:fs": {
          readFileSync: readFileSyncStub,
        },
      });

      assert.strictEqual(
        validateBom({ bomFormat: "CycloneDX", specVersion: "2.0.1" }),
        false,
      );
      sinon.assert.notCalled(readFileSyncStub);
      sinon.assert.calledWithMatch(
        consoleLogStub,
        "Unsupported CycloneDX specVersion '2.0.1'.",
      );
    } finally {
      consoleLogStub.restore();
    }
  });

  it("caches compiled CycloneDX schema validators by spec version", async () => {
    const readFileSyncStub = sinon
      .stub()
      .callsFake((...args) => actualReadFileSync(...args));
    const { validateBom } = await esmock("./bomValidator.js", {
      "node:fs": {
        readFileSync: readFileSyncStub,
      },
    });

    assert.strictEqual(validateBom(validCycloneDx20Bom), true);
    const readCountAfterFirstValidation = readFileSyncStub.callCount;
    assert.ok(readCountAfterFirstValidation > 0);

    assert.strictEqual(validateBom(validCycloneDx20Bom), true);
    assert.strictEqual(
      readFileSyncStub.callCount,
      readCountAfterFirstValidation,
    );
  });
});

describe("validateSpdx()", () => {
  it("lazy-loads the bundled SPDX export schema on first validation call", async () => {
    const readFileSyncStub = sinon
      .stub()
      .returns(
        '{"type":"object","properties":{"@context":{"const":"https://spdx.org/rdf/3.0.1/spdx-context.jsonld"},"@graph":{"type":"array"}}}',
      );
    const { validateSpdx } = await esmock("./bomValidator.js", {
      "node:fs": {
        readFileSync: readFileSyncStub,
      },
      "../ecosystems/utils.js": {
        DEBUG_MODE: false,
        dirNameStr: "/tmp",
        isPartialTree: sinon.stub().returns(false),
      },
      "../stages/postgen/spdxConverter.js": {
        SPDX_JSONLD_CONTEXT: "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        SPDX_SPEC_VERSION: "3.0.1",
      },
    });

    sinon.assert.notCalled(readFileSyncStub);
    assert.strictEqual(
      validateSpdx({
        "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        "@graph": [],
      }),
      false,
    );
    sinon.assert.calledOnce(readFileSyncStub);
  });

  it("caches the bundled SPDX export schema between validation calls", async () => {
    const readFileSyncStub = sinon
      .stub()
      .returns(
        '{"type":"object","properties":{"@context":{"const":"https://spdx.org/rdf/3.0.1/spdx-context.jsonld"},"@graph":{"type":"array"}}}',
      );
    const { validateSpdx } = await esmock("./bomValidator.js", {
      "node:fs": {
        readFileSync: readFileSyncStub,
      },
      "../ecosystems/utils.js": {
        DEBUG_MODE: false,
        dirNameStr: "/tmp",
        isPartialTree: sinon.stub().returns(false),
      },
      "../stages/postgen/spdxConverter.js": {
        SPDX_JSONLD_CONTEXT: "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        SPDX_SPEC_VERSION: "3.0.1",
      },
    });

    validateSpdx({
      "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
      "@graph": [],
    });
    validateSpdx({
      "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
      "@graph": [],
    });

    sinon.assert.calledOnce(readFileSyncStub);
  });
});

describe("uniqueItems enforcement", () => {
  const bomWith = (overrides) => ({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
    version: 1,
    metadata: {
      component: {
        "bom-ref": "root",
        name: "demo",
        purl: "pkg:generic/demo@1.0.0",
        type: "application",
        version: "1.0.0",
      },
    },
    components: [
      {
        "bom-ref": "pkg:npm/left-pad@1.3.0",
        name: "left-pad",
        purl: "pkg:npm/left-pad@1.3.0",
        type: "library",
        version: "1.3.0",
      },
    ],
    dependencies: [{ dependsOn: [], ref: "root" }],
    ...overrides,
  });
  const duplicated = (component) => [
    structuredClone(component),
    structuredClone(component),
  ];

  it("accepts a document whose arrays hold no repeats", () => {
    assert.equal(validateBom(bomWith({})), true);
  });

  it("rejects a repeated entry in components", () => {
    const bom = bomWith({});
    assert.equal(
      validateBom(bomWith({ components: duplicated(bom.components[0]) })),
      false,
    );
  });

  it("rejects a repeated entry in a nested components array", () => {
    const bom = bomWith({});
    const parent = {
      "bom-ref": "pkg:npm/parent@1.0.0",
      components: duplicated(bom.components[0]),
      name: "parent",
      purl: "pkg:npm/parent@1.0.0",
      type: "library",
      version: "1.0.0",
    };
    assert.equal(validateBom(bomWith({ components: [parent] })), false);
  });

  it("rejects a repeated reference in dependsOn", () => {
    assert.equal(
      validateBom(
        bomWith({
          dependencies: [
            {
              dependsOn: ["pkg:npm/left-pad@1.3.0", "pkg:npm/left-pad@1.3.0"],
              ref: "root",
            },
          ],
        }),
      ),
      false,
    );
  });

  it("distinguishes entries that differ only in a nested value", () => {
    const bom = bomWith({});
    const first = structuredClone(bom.components[0]);
    const second = structuredClone(bom.components[0]);
    first["bom-ref"] = "pkg:npm/left-pad@1.3.0#a";
    second["bom-ref"] = "pkg:npm/left-pad@1.3.0#b";
    first.properties = [{ name: "cdx:npm:kind", value: "a" }];
    second.properties = [{ name: "cdx:npm:kind", value: "b" }];
    assert.equal(validateBom(bomWith({ components: [first, second] })), true);
  });
});
