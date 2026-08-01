import { assert, describe, it } from "poku";

import {
  createOccurrenceEvidence,
  formatOccurrenceEvidence,
  parseOccurrenceEvidenceLocation,
} from "./evidenceUtils.js";

describe("evidence utils", () => {
  it("creates occurrence evidence with structured line details", () => {
    assert.deepStrictEqual(
      createOccurrenceEvidence("src/index.js", {
        line: 14,
        offset: 3,
        symbol: "node:crypto.createHash",
      }),
      {
        location: "src/index.js",
        line: 14,
        offset: 3,
        symbol: "node:crypto.createHash",
      },
    );
  });

  it("parses hash-style line locations", () => {
    assert.deepStrictEqual(parseOccurrenceEvidenceLocation("src/index.js#27"), {
      location: "src/index.js",
      line: 27,
    });
  });

  it("parses colon-style line and offset locations", () => {
    assert.deepStrictEqual(
      parseOccurrenceEvidenceLocation("src/index.js:29:7"),
      {
        location: "src/index.js",
        line: 29,
        offset: 7,
      },
    );
  });

  it("formats structured occurrence evidence for display", () => {
    assert.strictEqual(
      formatOccurrenceEvidence({
        location: "src/index.js",
        line: 12,
        offset: 1,
      }),
      "src/index.js:12:1",
    );
  });
});

// Restored from the retired lib/helpers/core-misc-b.poku.js, which was
// deleted along with its module during the v13 layer reorganisation even though
// the functions under test only moved.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  addEvidenceForDotnet,
  attachIdentityTools,
  extractToolRefs,
} from "./evidenceUtils.js";

it("addEvidenceForDotnet() initializes evidence before adding occurrences", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "cdxgen-dotnet-evidence-"));
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(
      slicesFile,
      JSON.stringify({
        Dependencies: [
          {
            Module: "Example.dll",
            Path: "src/Program.cs",
            LineNumber: 42,
          },
        ],
      }),
    );
    const pkgList = addEvidenceForDotnet(
      [
        {
          name: "Example",
          purl: "pkg:nuget/Example@1.0.0",
          properties: [{ name: "PackageFiles", value: "Example.dll" }],
        },
      ],
      slicesFile,
    );
    assert.deepStrictEqual(pkgList[0].evidence?.occurrences, [
      {
        location: "src/Program.cs",
        line: 42,
      },
    ]);
    assert.strictEqual(pkgList[0].scope, "required");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("addEvidenceForDotnet() ignores unreadable dosai JSON", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "cdxgen-dotnet-bad-json-"));
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(slicesFile, "");
    const inputPkgList = [
      {
        name: "Example",
        purl: "pkg:nuget/Example@1.0.0",
        properties: [{ name: "PackageFiles", value: "Example.dll" }],
      },
    ];
    const pkgList = addEvidenceForDotnet(inputPkgList, slicesFile);

    assert.strictEqual(pkgList, inputPkgList);
    assert.strictEqual(pkgList[0].evidence, undefined);
    assert.strictEqual(pkgList[0].scope, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("addEvidenceForDotnet() consumes dosai v3 PackageReachability", () => {
  const tempDir = mkdtempSync(
    path.join(tmpdir(), "cdxgen-dotnet-reachability-"),
  );
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(
      slicesFile,
      JSON.stringify({
        CallGraph: {
          Edges: [
            {
              Id: "e1",
              FileName: "Controllers/EpisodesController.cs",
              LineNumber: 17,
              CalledMethodName: "System.Text.Json.JsonSerializer.Deserialize",
            },
          ],
          Nodes: [
            {
              Id: "n1",
              FileName: "System.Text.Json.dll",
              LineNumber: 0,
              ClassName: "JsonSerializer",
              Name: "Deserialize",
            },
          ],
        },
        PackageReachability: [
          {
            Purl: "pkg:nuget/System.Text.Json",
            EdgeIds: ["e1"],
            NodeIds: ["n1"],
            SourceLocations: [
              {
                Path: "Controllers/Parser.cs",
                FileName: "Parser.cs",
                LineNumber: 42,
                ColumnNumber: 13,
                Kind: "CallGraphEdge",
              },
              {
                Path: "System.Text.Json.dll",
                FileName: "System.Text.Json.dll",
                LineNumber: 1,
                Kind: "CallGraphNode",
              },
            ],
          },
        ],
      }),
    );
    const pkgList = addEvidenceForDotnet(
      [
        {
          name: "System.Text.Json",
          purl: "pkg:nuget/System.Text.Json@10.0.0",
          properties: [],
        },
      ],
      slicesFile,
    );

    assert.deepStrictEqual(pkgList[0].evidence?.occurrences, [
      {
        location: "Controllers/Parser.cs",
        line: 42,
      },
    ]);
    assert.ok(
      pkgList[0].evidence.identity.methods.some(
        (method) =>
          method.technique === "source-code-analysis" &&
          method.value === "Controllers/Parser.cs#42",
      ),
    );
    assert.ok(
      pkgList[0].properties.some(
        (property) =>
          property.name === "CalledMethods" &&
          property.value.includes(
            "System.Text.Json.JsonSerializer.Deserialize",
          ),
      ),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("addEvidenceForDotnet() keeps PackageReachability fallback evidence source-only", () => {
  const tempDir = mkdtempSync(
    path.join(tmpdir(), "cdxgen-dotnet-source-fallback-"),
  );
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(
      slicesFile,
      JSON.stringify({
        CallGraph: {
          Edges: [
            {
              Id: "e1",
              FileName: "System.Text.Json.dll",
              LineNumber: 12,
              CalledMethodName: "System.Text.Json.JsonSerializer.Deserialize",
              CallLocation: {
                FileName: "Program.fs",
                LineNumber: 8,
              },
            },
            {
              Id: "e2",
              FileName: "Controllers/EpisodesController.cs",
              LineNumber: 17,
              CalledMethodName: "System.Text.Json.JsonSerializer.Serialize",
            },
          ],
        },
        PackageReachability: [
          {
            Purl: "pkg:nuget/System.Text.Json",
            EdgeIds: ["e1", "e2"],
          },
        ],
      }),
    );
    const pkgList = addEvidenceForDotnet(
      [
        {
          name: "System.Text.Json",
          purl: "pkg:nuget/System.Text.Json@10.0.0",
          properties: [],
        },
      ],
      slicesFile,
    );

    assert.deepStrictEqual(pkgList[0].evidence?.occurrences, [
      {
        location: "Controllers/EpisodesController.cs",
        line: 17,
      },
      {
        location: "Program.fs",
        line: 8,
      },
    ]);
    assert.ok(!JSON.stringify(pkgList[0].evidence).includes(".dll"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("addEvidenceForDotnet() preserves additional identity entries", () => {
  const tempDir = mkdtempSync(
    path.join(tmpdir(), "cdxgen-dotnet-identity-array-"),
  );
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(
      slicesFile,
      JSON.stringify({
        Dependencies: [
          {
            Path: "Program.cs",
            FileName: "Program.cs",
            Name: "System.Text.Json",
            Purl: "pkg:nuget/System.Text.Json",
            LineNumber: 12,
          },
        ],
      }),
    );
    const pkgList = addEvidenceForDotnet(
      [
        {
          name: "System.Text.Json",
          purl: "pkg:nuget/System.Text.Json@10.0.0",
          evidence: {
            identity: [
              {
                field: "name",
                confidence: 0.8,
                methods: [
                  { technique: "filename", value: "packages.lock.json" },
                ],
              },
              {
                field: "purl",
                confidence: 1,
                methods: [
                  {
                    technique: "manifest-analysis",
                    value: "packages.lock.json",
                  },
                ],
              },
            ],
          },
          properties: [],
        },
      ],
      slicesFile,
    );

    assert.strictEqual(pkgList[0].evidence.identity.length, 2);
    assert.strictEqual(pkgList[0].evidence.identity[0].field, "name");
    assert.ok(
      pkgList[0].evidence.identity[1].methods.some(
        (method) =>
          method.technique === "source-code-analysis" &&
          method.value === "Program.cs#12",
      ),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("addEvidenceForDotnet() consumes dosai Dependencies with purls", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "cdxgen-dotnet-vb-deps-"));
  const slicesFile = path.join(tempDir, "dosai.json");
  try {
    writeFileSync(
      slicesFile,
      JSON.stringify({
        Dependencies: [
          {
            Path: "Program.vb",
            FileName: "Program.vb",
            Name: "Newtonsoft.Json",
            Purl: "pkg:nuget/Newtonsoft.Json@13.0.3",
            LineNumber: 4,
            ColumnNumber: 9,
          },
        ],
      }),
    );
    const pkgList = addEvidenceForDotnet(
      [
        {
          name: "Newtonsoft.Json",
          purl: "pkg:nuget/Newtonsoft.Json@13.0.3",
          properties: [],
        },
      ],
      slicesFile,
    );

    assert.deepStrictEqual(pkgList[0].evidence?.occurrences, [
      {
        location: "Program.vb",
        line: 4,
      },
    ]);
    assert.ok(
      pkgList[0].properties.some(
        (property) =>
          property.name === "ImportedModules" &&
          property.value.includes("Newtonsoft.Json"),
      ),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("extractToolRefs collects unique bom-refs from metadata.tools", () => {
  assert.deepStrictEqual(
    extractToolRefs(
      {
        components: [
          { name: "trivy", "bom-ref": "pkg:generic/trivy@0.1.0" },
          { name: "trivy", "bom-ref": "pkg:generic/trivy@0.1.0" },
          { name: "cdxgen" },
        ],
        services: [{ name: "blint", "bom-ref": "urn:tool:blint" }],
      },
      (tool) => tool.name !== "cdxgen",
    ),
    ["pkg:generic/trivy@0.1.0", "urn:tool:blint"],
  );
});

it("extractToolRefs derives and persists bom-refs for external tools", () => {
  const tools = {
    components: [
      {
        group: "aquasecurity",
        name: "trivy",
        version: "dev",
      },
    ],
  };
  assert.deepStrictEqual(extractToolRefs(tools), [
    "pkg:generic/aquasecurity/trivy@dev",
  ]);
  assert.strictEqual(
    tools.components[0]["bom-ref"],
    "pkg:generic/aquasecurity/trivy@dev",
  );
});

it("attachIdentityTools adds tool references to object and array identities", () => {
  const subjects = [
    {
      evidence: {
        identity: {
          field: "purl",
          tools: ["pkg:generic/existing-tool@1.0.0"],
        },
      },
    },
    {
      evidence: {
        identity: [
          { field: "purl" },
          { field: "hash", tools: ["urn:tool:hash"] },
        ],
      },
    },
  ];
  attachIdentityTools(subjects, [
    "pkg:generic/existing-tool@1.0.0",
    "pkg:generic/trivy@0.1.0",
  ]);
  assert.deepStrictEqual(subjects[0].evidence.identity.tools, [
    "pkg:generic/existing-tool@1.0.0",
    "pkg:generic/trivy@0.1.0",
  ]);
  assert.deepStrictEqual(subjects[1].evidence.identity[0].tools, [
    "pkg:generic/existing-tool@1.0.0",
    "pkg:generic/trivy@0.1.0",
  ]);
  assert.deepStrictEqual(subjects[1].evidence.identity[1].tools, [
    "urn:tool:hash",
    "pkg:generic/existing-tool@1.0.0",
    "pkg:generic/trivy@0.1.0",
  ]);
});
