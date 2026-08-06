import { globSync, readFileSync } from "node:fs";

import { assert, describe, it } from "poku";

// Namespaces that predate this guard and are not yet described in
// docs/CUSTOM_PROPERTIES.md. The list only shrinks: a namespace added to the
// documentation should be removed from here, and a new one must never be added.
const UNDOCUMENTED_NAMESPACES = new Set([
  "audit",
  "dynamic",
  "file",
  "hbom",
  "hostview",
  "license",
  "nuget",
  "sbt",
  "trustinspector",
  "validate",
]);

function emittedNamespaces() {
  const namespaces = new Map();
  const files = globSync("lib/**/*.js").filter(
    (file) => !file.includes(".poku.") && !file.includes("third-party"),
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["`]cdx:([a-zA-Z0-9-]+):/g)) {
      if (!namespaces.has(match[1])) {
        namespaces.set(match[1], file);
      }
    }
  }
  return namespaces;
}

describe("custom property documentation", () => {
  it("describes every cdx: namespace lib/ emits", () => {
    const documentation = readFileSync("docs/CUSTOM_PROPERTIES.md", "utf8");
    const undocumented = [];
    for (const [namespace, file] of emittedNamespaces()) {
      if (documentation.includes(`cdx:${namespace}:`)) {
        continue;
      }
      if (UNDOCUMENTED_NAMESPACES.has(namespace)) {
        continue;
      }
      undocumented.push(`cdx:${namespace}:* (first seen in ${file})`);
    }
    assert.deepEqual(
      undocumented,
      [],
      `Undocumented custom property namespaces:\n${undocumented.join("\n")}\nAdd them to docs/CUSTOM_PROPERTIES.md.`,
    );
  });

  it("keeps the known-gap list free of namespaces that are now documented", () => {
    const documentation = readFileSync("docs/CUSTOM_PROPERTIES.md", "utf8");
    const stale = [...UNDOCUMENTED_NAMESPACES].filter((namespace) =>
      documentation.includes(`cdx:${namespace}:`),
    );
    assert.deepEqual(
      stale,
      [],
      `These namespaces are documented now; remove them from UNDOCUMENTED_NAMESPACES: ${stale.join(", ")}`,
    );
  });
});
