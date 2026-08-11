import { assert, describe, it } from "poku";

import { sortBomCollections } from "./sortBom.js";

/**
 * Two BOMs that differ only in the order of set-valued arrays must serialize
 * identically once sorted, and the arrays whose order carries meaning must be
 * left exactly as they were.
 */
describe("sortBomCollections", () => {
  it("orders component properties, hashes, licenses and external references", () => {
    const bom = {
      components: [
        {
          name: "a",
          properties: [
            { name: "internal:SrcFile", value: "b.json" },
            { name: "internal:SrcFile", value: "a.json" },
            { name: "cdx:npm:x", value: "1" },
          ],
          hashes: [
            { alg: "SHA-256", content: "ff" },
            { alg: "MD5", content: "aa" },
          ],
          licenses: [{ id: "MIT" }, { id: "Apache-2.0" }],
          externalReferences: [
            { type: "website", url: "https://z.example" },
            { type: "vcs", url: "https://a.example" },
          ],
        },
      ],
    };
    sortBomCollections(bom);
    const c = bom.components[0];
    assert.deepStrictEqual(
      c.properties.map((p) => `${p.name}=${p.value}`),
      ["cdx:npm:x=1", "internal:SrcFile=a.json", "internal:SrcFile=b.json"],
    );
    assert.deepStrictEqual(
      c.hashes.map((h) => h.alg),
      ["MD5", "SHA-256"],
    );
    assert.deepStrictEqual(
      c.licenses.map((l) => l.id),
      ["Apache-2.0", "MIT"],
    );
    assert.deepStrictEqual(
      c.externalReferences.map((e) => e.url),
      ["https://a.example", "https://z.example"],
    );
  });

  it("leaves the component and dependency array order untouched", () => {
    const bom = {
      components: [{ name: "z" }, { name: "a" }, { name: "m" }],
      dependencies: [
        { ref: "z", dependsOn: ["m", "a"] },
        { ref: "a", dependsOn: [] },
      ],
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(
      bom.components.map((c) => c.name),
      ["z", "a", "m"],
    );
    assert.deepStrictEqual(
      bom.dependencies.map((d) => d.ref),
      ["z", "a"],
    );
    // Only the dependsOn list inside each node is ordered.
    assert.deepStrictEqual(bom.dependencies[0].dependsOn, ["a", "m"]);
  });

  it("orders dependsOn and provides", () => {
    const bom = {
      dependencies: [
        {
          ref: "app",
          dependsOn: ["pkg:npm/b@1", "pkg:npm/a@1"],
          provides: ["pkg:npm/d@1", "pkg:npm/c@1"],
        },
      ],
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(bom.dependencies[0].dependsOn, [
      "pkg:npm/a@1",
      "pkg:npm/b@1",
    ]);
    assert.deepStrictEqual(bom.dependencies[0].provides, [
      "pkg:npm/c@1",
      "pkg:npm/d@1",
    ]);
  });

  it("recurses into nested components", () => {
    const bom = {
      components: [
        {
          name: "outer",
          components: [
            {
              name: "inner",
              properties: [
                { name: "b", value: "2" },
                { name: "a", value: "1" },
              ],
            },
          ],
        },
      ],
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(
      bom.components[0].components[0].properties.map((p) => p.name),
      ["a", "b"],
    );
  });

  it("orders metadata component internals, metadata properties and tools", () => {
    const bom = {
      metadata: {
        component: {
          name: "app",
          properties: [
            { name: "b", value: "2" },
            { name: "a", value: "1" },
          ],
        },
        properties: [
          { name: "cdx:z", value: "1" },
          { name: "cdx:a", value: "1" },
        ],
        tools: {
          components: [
            {
              name: "zzz",
              properties: [
                { name: "y", value: "1" },
                { name: "x", value: "1" },
              ],
            },
            { name: "aaa" },
          ],
        },
      },
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(
      bom.metadata.component.properties.map((p) => p.name),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      bom.metadata.properties.map((p) => p.name),
      ["cdx:a", "cdx:z"],
    );
    assert.deepStrictEqual(
      bom.metadata.tools.components.map((t) => t.name),
      ["aaa", "zzz"],
    );
    // A tool descriptor's own collections are ordered as well.
    assert.deepStrictEqual(
      bom.metadata.tools.components[1].properties.map((p) => p.name),
      ["x", "y"],
    );
  });

  it("orders evidence occurrences and the array form of evidence identity", () => {
    const bom = {
      components: [
        {
          name: "a",
          evidence: {
            identity: [{ field: "purl" }, { field: "name" }],
            occurrences: [{ location: "b.js" }, { location: "a.js" }],
          },
        },
        {
          name: "b",
          // The 1.5 object form has no ordering to fix and must survive intact.
          evidence: { identity: { field: "purl", confidence: 1 } },
        },
      ],
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(
      bom.components[0].evidence.identity.map((i) => i.field),
      ["name", "purl"],
    );
    assert.deepStrictEqual(
      bom.components[0].evidence.occurrences.map((o) => o.location),
      ["a.js", "b.js"],
    );
    assert.deepStrictEqual(bom.components[1].evidence.identity, {
      field: "purl",
      confidence: 1,
    });
  });

  it("orders service, vulnerability and annotation collections", () => {
    const bom = {
      services: [
        {
          name: "svc",
          properties: [
            { name: "b", value: "2" },
            { name: "a", value: "1" },
          ],
          endpoints: ["https://z.example", "https://a.example"],
        },
      ],
      vulnerabilities: [
        {
          id: "CVE-1",
          properties: [
            { name: "b", value: "2" },
            { name: "a", value: "1" },
          ],
        },
      ],
      annotations: [
        {
          "bom-ref": "ann-1",
          properties: [
            { name: "b", value: "2" },
            { name: "a", value: "1" },
          ],
        },
      ],
      externalReferences: [
        { type: "website", url: "https://z.example" },
        { type: "vcs", url: "https://a.example" },
      ],
    };
    sortBomCollections(bom);
    assert.deepStrictEqual(
      bom.services[0].properties.map((p) => p.name),
      ["a", "b"],
    );
    assert.deepStrictEqual(bom.services[0].endpoints, [
      "https://a.example",
      "https://z.example",
    ]);
    assert.deepStrictEqual(
      bom.vulnerabilities[0].properties.map((p) => p.name),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      bom.annotations[0].properties.map((p) => p.name),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      bom.externalReferences.map((e) => e.url),
      ["https://a.example", "https://z.example"],
    );
  });

  it("makes two BOMs that differ only in set ordering serialize identically", () => {
    const build = (reversed) => {
      const props = [
        { name: "internal:SrcFile", value: "a.json" },
        { name: "cdx:x", value: "1" },
        { name: "cdx:y", value: "2" },
      ];
      return {
        components: [
          {
            name: "a",
            properties: reversed ? [...props].reverse() : props,
            hashes: reversed
              ? [
                  { alg: "SHA-256", content: "ff" },
                  { alg: "MD5", content: "aa" },
                ]
              : [
                  { alg: "MD5", content: "aa" },
                  { alg: "SHA-256", content: "ff" },
                ],
          },
        ],
        dependencies: [
          { ref: "a", dependsOn: reversed ? ["y", "x"] : ["x", "y"] },
        ],
      };
    };
    const first = sortBomCollections(build(false));
    const second = sortBomCollections(build(true));
    assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  });

  it("tolerates absent, empty and malformed input", () => {
    assert.strictEqual(sortBomCollections(null), null);
    assert.strictEqual(sortBomCollections(undefined), undefined);
    assert.deepStrictEqual(sortBomCollections({}), {});
    const odd = {
      components: [null, { name: "a" }],
      dependencies: [{ ref: "a" }],
      services: [null, "not-an-object"],
      metadata: {},
    };
    // A malformed entry must not stop the rest of the BOM from being ordered.
    assert.deepStrictEqual(sortBomCollections(odd), odd);
  });
});
