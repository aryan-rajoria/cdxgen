import { globSync, readFileSync } from "node:fs";

import { assert, describe, it } from "poku";

const DOCUMENTATION = "docs/CUSTOM_PROPERTIES.md";

function emittedProperties() {
  const properties = new Map();
  const files = globSync("lib/**/*.js").filter(
    (file) => !file.includes(".poku.") && !file.includes("third-party"),
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["`](cdx:[A-Za-z0-9_:.-]+)["`]/g)) {
      const property = match[1];
      if (property.endsWith(":")) {
        continue;
      }
      if (!properties.has(property)) {
        properties.set(property, file);
      }
    }
  }
  return properties;
}

describe("custom property documentation", () => {
  it("documents every cdx: property lib/ emits", () => {
    const documentation = readFileSync(DOCUMENTATION, "utf8");
    const undocumented = [];
    for (const [property, file] of emittedProperties()) {
      if (documentation.includes(property)) {
        continue;
      }
      undocumented.push(`${property} (first seen in ${file})`);
    }
    assert.deepEqual(
      undocumented,
      [],
      `Undocumented custom properties:\n${undocumented.join("\n")}\nAdd them to ${DOCUMENTATION}.`,
    );
  });
});
