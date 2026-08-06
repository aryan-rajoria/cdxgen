import { strict as assert } from "node:assert";

import { describe, it } from "poku";

import {
  MAX_SBOM_DOCUMENT_BYTES,
  parseSbomDocument,
  tagSbomComponents,
} from "./sbomDocument.js";

describe("parseSbomDocument()", () => {
  it("reads components, dependencies and the root ref from CycloneDX", () => {
    const parsed = parseSbomDocument(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        metadata: { component: { "bom-ref": "root-ref", name: "dist" } },
        components: [{ name: "bundled", "bom-ref": "bundled-ref" }],
        dependencies: [{ ref: "root-ref", dependsOn: ["bundled-ref"] }],
      }),
      { source: "wheel" },
    );
    assert.strictEqual(parsed.format, "cyclonedx-1.6");
    assert.strictEqual(parsed.rootRef, "root-ref");
    assert.strictEqual(parsed.components.length, 1);
    assert.deepStrictEqual(parsed.dependencies[0].dependsOn, ["bundled-ref"]);
  });

  it("reads packages out of SPDX 2.x JSON", () => {
    const parsed = parseSbomDocument(
      JSON.stringify({
        spdxVersion: "SPDX-2.3",
        packages: [
          {
            name: "libfoo",
            SPDXID: "SPDXRef-libfoo",
            versionInfo: "1.2.3",
            externalRefs: [
              {
                referenceType: "purl",
                referenceLocator: "pkg:generic/libfoo@1.2.3",
              },
            ],
          },
        ],
      }),
      { source: "sboms/libfoo.spdx.json" },
    );
    assert.strictEqual(parsed.format, "spdx-SPDX-2.3");
    assert.strictEqual(parsed.components[0].purl, "pkg:generic/libfoo@1.2.3");
    assert.strictEqual(
      parsed.components[0]["bom-ref"],
      "pkg:generic/libfoo@1.2.3",
    );
  });

  it("rejects a document that is not JSON, not an SBOM, or empty", () => {
    assert.strictEqual(parseSbomDocument("not json", {}), null);
    assert.strictEqual(parseSbomDocument("", {}), null);
    assert.strictEqual(parseSbomDocument(JSON.stringify({ a: 1 }), {}), null);
    // CycloneDX without a specVersion is unusable, however well-formed.
    assert.strictEqual(
      parseSbomDocument(
        JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "x" }] }),
        {},
      ),
      null,
    );
  });

  it("refuses a document over the size bound instead of parsing it", () => {
    const oversized = `{"bomFormat":"CycloneDX","specVersion":"1.6","note":"${"x".repeat(
      MAX_SBOM_DOCUMENT_BYTES,
    )}"}`;
    assert.strictEqual(parseSbomDocument(oversized, { source: "big" }), null);
  });
});

describe("tagSbomComponents()", () => {
  it("appends provenance properties and skips valueless ones", () => {
    const components = [{ name: "a" }, null, { name: "b", properties: [] }];
    tagSbomComponents(components, [
      { name: "cdx:tea:source", value: "https://example/bom.json" },
      { name: "cdx:tea:collection", value: undefined },
    ]);
    assert.deepStrictEqual(components[0].properties, [
      { name: "cdx:tea:source", value: "https://example/bom.json" },
    ]);
    assert.strictEqual(components[2].properties.length, 1);
  });
});
