import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, it } from "poku";

import {
  addEvidenceForDotnet,
  attachIdentityTools,
  extractToolRefs,
  getDefaultBomAuditCategories,
  hasAnyProjectType,
  isPackageManagerAllowed,
  isValidIriReference,
  PROJECT_TYPE_ALIASES,
  shouldRunPredictiveBomAudit,
} from "./utils.js";

// biome-ignore-start lint/style/useTemplate: This is a unit test
// biome-ignore-start lint/suspicious/noTemplateCurlyInString: This is a unit test
const testCases = [
  // --- Existing Test Cases (for context) ---
  ["", false],
  ["git@gitlab.com:behat-chrome/chrome-mink-driver.git", false],
  ["     git@gitlab.com:behat-chrome/chrome-mink-driver.git      ", false],
  ["${repository.url}", false],
  // bomLink - https://cyclonedx.org/capabilities/bomlink/
  ["urn:cdx:f08a6ccd-4dce-4759-bd84-c626675d60a7/1#componentA", true],
  // http uri - https://www.ietf.org/rfc/rfc7230.txt
  ["https://gitlab.com/behat-chrome/chrome-mink-driver.git      ", false], // Fails due to trailing space
  [
    "     https://gitlab.com/behat-chrome/chrome-mink-driver.git           ",
    false, // Fails due to leading space
  ],
  ["http://gitlab.com/behat-chrome/chrome-mink-driver.git", true],
  ["git+https://github.com/Alex-D/check-disk-space.git      ", false], // Fails due to trailing space
  ["UNKNOWN", false],
  ["http://", false],
  ["http", false],
  ["https", false],
  ["https://", false],
  ["http://www", true],
  ["http://www.", true],
  [
    "https://github.com/apache/maven-resolver/tree/      ${project.scm.tag}",
    false, // Fails due to space and ${}
  ],
  ["git@github.com:prometheus/client_java.git", false],
  // --- New Stress Test Cases ---
  // Potential ReDoS for percent-encoding regex: Long sequences of % followed by non-hex or short hex
  [`http://example.com/a%${"a%".repeat(50000)}`, false], // Many %a patterns
  [`http://example.com/a%${"ab%".repeat(50000)}`, false], // Many %ab patterns (invalid end)
  [`http://example.com/a%${"a".repeat(100000)}`, true], // Valid: %aa is a complete encoding followed by many literal 'a's in path
  [`http://example.com/${"%".repeat(100000)}`, false], // Very long sequence of just %
  // Edge cases around valid percent-encoding boundaries (pushing regex engine)
  [`http://example.com/path%${"20".repeat(30000)}%2`, false], // Valid %20s, ends with incomplete %
  [`http://example.com/path%${"20".repeat(30000)}a`, true], // Valid: %20 encoding followed by many chars and trailing literal 'a'
  // Potentially complex IRI that might be slow for validateIri (if not already robust)
  // Using a plausible but complex structure with lots of valid non-ASCII chars (requires UTF-8 support)
  // Note: Actual performance depends on the `validateIri` implementation.
  [
    "http://example.com/path/to/resource/with/lots/of/segments/and/long/-names/including/üñíçødé/characters/ sprinkled/in/" +
      "segment".repeat(2000) +
      "?query=param&other=valué#frågmënt",
    false,
  ], // Assuming validateIri and URL can handle it
  // Very long valid IRI (tests overall handling, potentially URL constructor)
  [
    "http://very.long.domain.name.example.com/very/long/path/component/that/just/keeps/going/on/and/on/forever/it/seems/" +
      "segment/".repeat(3000) +
      "end",
    true,
  ], // Assuming it's technically valid
  // IRI with complex query and fragment (tests boundaries)
  [
    "https://example.com/path?query=with%20lots%20of%20percent%20encoding%20but%20valid%20%C3%A9%C3%B1#fragment-with-unicode-çhars-üñíçødé",
    true, // Valid: %20 and %C3%A9%C3%B1 are correct encodings; RFC 3987 allows unicode in fragment
  ],
  // IRI that looks almost like a bomLink but isn't quite (tests scheme handling)
  ["urn:cdx:some-uuid/1#componentA/extra", true], // Might be valid IRI/URI, depends on urn:cdx spec, but structurally okay for IRI
  ["urn:cdx:some-uuid/1", true], // Valid urn without fragment
  // IRI with userinfo (less common, test robustness)
  ["http://user:p@ssw0rd@example.com/path", true], // Valid, but contains @
  ["http://user@example.com/path", true], // Valid with user only
  // IRI with IPv6 literal (tests authority parsing)
  ["http://[2001:db8::1]:8080/path", true], // Valid IPv6
  ["http://[2001:db8::1]/path", true], // Valid IPv6 without port
  // Potentially problematic characters in path/query/fragment (if not already covered)
  ["http://example.com/path with spaces", false], // Space not encoded
  ["http://example.com/path<with>brackets", false], // < > not typically allowed unencoded
  ['http://example.com/path"with"quotes', false], // " not typically allowed unencoded in URI/IRI ref
  // Test case sensitivity for scheme check (uses original `iri`)
  ["HTTP://example.com", true], // Scheme case (URL constructor should handle)
  ["HTTPS://EXAMPLE.COM/PATH", true],
  // Edge case: IRI that is just a scheme
  ["mailto:", false],
  ["https:", false],
  ["http:", false],
  // Re-test specific percent-encoding edge case mentioned in comments
  ["http://example.com/path%ab%cd%ef", true], // Valid percent encodings
  ["http://example.com/path%ab%cd%e", false], // Invalid: incomplete %e at end
  ["http://example.com/path%ab%cd%eg", false], // Invalid: %eg
  ["http://example.com/path%ab%cd%", false], // Invalid: trailing %
  ["http://example.com/path%ab%cd%0", false], // Invalid: %0
  ["http://example.com/path%ab%cd%0Z", false], // Invalid: %0Z ('Z' is not a hex digit)
  ["http://example.com/path%abc", true], // Valid: %ab is a complete encoding, 'c' is the next literal character
  ["http://example.com/path%abZ", true], // Valid %ab followed by a literal character
  // Test with extremely long, but valid, percent-encoded sequence (pushes validateIri/URL)
  // This string is valid UTF-8 percent-encoded 'A' repeated many times.
  // encodeURIComponent("A".repeat(10000)) produces a very long string of %41
  // Let's simulate a long valid percent-encoded part manually for a simpler test
  [`http://example.com/data/${"%41%42%43%44".repeat(10000)}`, true], // Repeats 'ABCD' encoded
  // UNC Paths (IRI references)
  // Standard UNC path (often treated as URIs like \\server\share\path -> file://server/share/path or \\server\share -> smb://server/share)
  // However, as IRI *references* starting with \\, they are generally invalid unless specifically scheme-less references
  // The IRI spec defines scheme-less references as relative. \\server is not a valid relative path segment.
  ["\\\\server\\share\\path\\file.txt", false], // Looks like UNC, invalid as IRI ref
  ["file://server/share/path/file.txt", true], // Correct URI form if that's the intent
  // UNC path with spaces (invalid as IRI ref, valid file URI)
  ["\\\\server name\\share name\\file name.txt", false],
  ["file://server%20name/share%20name/file%20name.txt", true],
  // UNC path with Unicode (invalid as IRI ref, valid file URI if percent-encoded)
  ["\\\\サーバー\\共有\\ファイル.txt", false], // Raw Unicode UNC - invalid IRI ref
  // Correct IRI for UNC-like path would need a scheme, e.g., file:
  [
    "file:///%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC/%E5%85%B1%E6%9C%89/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.txt",
    true,
  ], // file:///%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC/%E5%85%B1%E6%9C%89/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.txt (Japanese characters encoded)

  // Unicode Characters in various components (IRI references)
  // Path with Latin-1 Supplement characters (e.g., accented letters)
  ["https://example.com/café/résumé.html", true],
  ["https://example.com/path/%C3%A9%C3%A1%C3%BC", true], // Same path, pre-encoded
  // Path with Chinese characters
  ["https://example.com/路径/文件.html", true],
  // Path with Emoji (if supported by IRI spec and validator)
  ["https://example.com/search?q=cat&emoji=😺", false], // Emoji in query

  // Query and Fragment with Unicode
  ["https://example.com/search?q=café röst", false],
  ["https://example.com/search?q=café%20röst", true],
  ["https://example.com/page#se%C3%A7%C3%A3o-intro", true], // Encoded fragment

  // Bidirectional Text (Bidi) in IRI (from RFC 3987 Section 4.3)
  // Note: Actual bidi control characters (like U+200E, U+200F, U+202A..U+202E) should generally be avoided or percent-encoded.
  // Example Bidi IRI from RFC (Hebrew Alef, Lamed, Yod, Vav) - presented logically LTR as Alef-Lamed-Yod-Vav
  // Unicode code points: U+05D0 U+05DC U+05D9 U+05D5
  // UTF-8 Encoding: D7 90 D7 9C D7 99 D7 95
  // Percent Encoding: %D7%90%D7%9C%D7%99%D7%95
  // Assuming the logical string "http://example.com/الयो" represents the Hebrew characters.
  // However, constructing the *exact* bidi IRI string is complex in plain text.
  // Let's test with the percent-encoded version which is clearer.
  // This tests handling of valid UTF-8 sequences representing RTL characters.
  ["http://example.com/%D7%90%D7%9C%D7%99%D7%95", true], // Alef Lamed Yod Vav (Hebrew) encoded

  // Look-alike Characters (from RFC 3987 Section 7.5)
  // Full-width Latin characters (from RFC 3987 Section 7.5)
  // Full-width 'A' (U+FF21) vs. Latin 'A' (U+0041)
  // Full-width 'A' UTF-8: EF BC A1 -> Percent-encoded: %EF%BC%A1
  ["http://example.com/path/FULLWIDTH%EF%BC%A1", true], // Full-width 'A' in path
  // Testing if validator differentiates (it shouldn't inherently, both are valid IRI chars if allowed by scheme)
  ["http://example.com/path/LATIN_A", true], // Standard 'A'

  // Characters specifically excluded in older RFCs mentioned (RFC 3987 Section 7.2)
  // "<", ">", '"', space, "{", "}", "|", "\", "^", and "`"
  // These should generally be invalid *unless* percent-encoded within a valid IRI component context.
  ["https://example.com/path with space", false], // Invalid: unencoded space
  ["https://example.com/path%20with%20space", true], // Valid: encoded space
  ["https://example.com/path<invalid>", false], // Invalid: unencoded <
  ["https://example.com/path%3Cinvalid%3E", true], // Valid: encoded <>
  ['https://example.com/path"quoted"', false], // Invalid: unencoded "
  ["https://example.com/path%22quoted%22", true], // Valid: encoded "
  ["https://example.com/path{invalid}", false], // Invalid: unencoded {
  ["https://example.com/path%7Binvalid%7D", true], // Valid: encoded {}
  // Note: #, %, [, ] are NOT in the excluded list RFC 3987 mentions for conversion; % is crucial for encoding, # [] are for IPv6 literals.

  // Complex UTF-8 sequences (4-byte UTF-8 for supplementary planes)
  // Character: G clef (U+1D11E)
  // UTF-8 Encoding: F0 9D 84 9E -> Percent-encoded: %F0%9D%84%9E
  ["https://example.com/music/notation/%F0%9D%84%9E", true], // G clef in path

  // Extremely long UTF-8 sequence (valid but large)
  // Representing a string like "𝄞".repeat(5000) encoded
  // U+1D11E (G clef) -> UTF-8: F0 9D 84 9E -> Percent-encoded: %F0%9D%84%9E
  // Let's create a long valid percent-encoded string representing repeated 4-byte chars
  [`https://example.com/data/${"%F0%9D%84%9E".repeat(5000)}`, true], // Many G clefs encoded
];

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

it("hasAnyProjectType tests", () => {
  for (const language of ["vb", "vbnet", "visualbasic", "f#", "fs", "fsharp"]) {
    assert.ok(PROJECT_TYPE_ALIASES.csharp.includes(language));
  }

  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: [],
      excludeType: ["oci"],
    }),
    false,
  );
  assert.deepStrictEqual(hasAnyProjectType([], {}), true);
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["java"] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["java"], excludeType: [] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["csharp"] }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["csharp", "rust"] }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], { projectType: ["csharp", "rust"] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["csharp", "rust"],
      excludeType: [],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["csharp", "rust"],
      excludeType: ["rust"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["java", "docker"],
      excludeType: ["dotnet"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["docker"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: ["oci"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["rootfs"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: ["rootfs"],
      excludeType: undefined,
    }),
    true,
  );

  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: [],
      excludeType: ["rust"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: undefined,
      excludeType: ["csharp"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: ["csharp"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["universal"],
      excludeType: ["docker"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: ["csharp", "javascript"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["js", "docker"],
      excludeType: ["js", "docker"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: ["js"],
      excludeType: ["js"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["oci"],
      {
        projectType: [],
        excludeType: [],
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["oci", "docker"],
      {
        projectType: undefined,
        excludeType: undefined,
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: [],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: ["universal"],
      excludeType: ["js"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["universal"], {
      projectType: undefined,
      excludeType: ["github"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: undefined,
      excludeType: ["github"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["os"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "java"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "ear"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["docker", "oci", "container", "os"],
      {
        projectType: undefined,
        excludeType: ["github"],
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["ruby2.5.4"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["rb"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["ruby3.4.1", "ruby2.5.4"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "js"], {
      projectType: ["javascript"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: [],
      excludeType: ["asar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: undefined,
      excludeType: ["electron"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["electron"], {
      projectType: [],
      excludeType: ["asar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: [],
      excludeType: ["java"],
    }),
    true,
  );
});

it("shouldRunPredictiveBomAudit tests", () => {
  assert.strictEqual(shouldRunPredictiveBomAudit({}, "cdxgen"), true);
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["linux"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os", "darwin"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os", "js"] }, "cdxgen"),
    true,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: "os,linux" }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["hbom"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["hardware"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["js"] }, "obom"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["js"] }, "hbom"),
    false,
  );
});

it("getDefaultBomAuditCategories tests", () => {
  assert.strictEqual(getDefaultBomAuditCategories({}, "cdxgen"), undefined);
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["os"] }, "cdxgen"),
    "obom-runtime",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["linux"] }, "cdxgen"),
    "obom-runtime",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["os", "js"] }, "cdxgen"),
    undefined,
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["hbom"] }, "cdxgen"),
    "hbom-security,hbom-performance,hbom-compliance",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["hardware"] }, "cdxgen"),
    "hbom-security,hbom-performance,hbom-compliance",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories(
      { includeRuntime: true, projectType: ["hbom"] },
      "cdxgen",
    ),
    "hbom-security,hbom-performance,hbom-compliance,host-topology",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["js"] }, "obom"),
    "obom-runtime",
  );
  assert.strictEqual(
    getDefaultBomAuditCategories({ projectType: ["js"] }, "hbom"),
    "hbom-security,hbom-performance,hbom-compliance",
  );
});

it("isPackageManagerAllowed tests", () => {
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: ["python"],
    }),
    true,
  );
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: ["pip"],
    }),
    false,
  );
});

testCases.forEach(([url, expected], index) => {
  it(`should validate IRI reference for case ${index}`, () => {
    const result = isValidIriReference(url);
    assert.strictEqual(result, expected);
  });
});
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: This is a unit test
// biome-ignore-end lint/style/useTemplate: This is a unit test
