import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it } from "poku";

import { parseCaxaMetadata } from "./caxa.js";

/**
 * Write a metadata document to a scratch file and parse it.
 *
 * @param {object} document Metadata contents
 * @returns {Promise<object>} Parse result
 */
async function parseDocument(document) {
  const dir = mkdtempSync(join(tmpdir(), "caxa-"));
  try {
    const mfile = join(dir, "metadata.json");
    writeFileSync(mfile, JSON.stringify(document));
    return await parseCaxaMetadata(mfile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parseCaxaMetadata", () => {
  it("names the enclosing executable in the evidence of each component", async () => {
    const { components } = await parseDocument({
      parentComponent: { name: "cdxgen-linux-amd64", type: "application" },
      components: [{ name: "left-pad", purl: "pkg:npm/left-pad@1.3.0" }],
    });
    assert.deepStrictEqual(
      components[0].evidence.identity.methods.map((m) => m.technique),
      ["binary-analysis", "manifest-analysis"],
    );
    assert.strictEqual(
      components[0].evidence.identity.methods[0].value,
      "cdxgen-linux-amd64",
    );
  });

  it("parses a document with no parent component", async () => {
    // The caxa scan globs every `*metadata.json` under the path, so documents
    // that are not caxa builds at all reach this parser. One without a parent
    // has no executable to name and must still parse.
    const { components } = await parseDocument({
      components: [{ name: "left-pad", purl: "pkg:npm/left-pad@1.3.0" }],
    });
    assert.strictEqual(components.length, 1);
    assert.deepStrictEqual(
      components[0].evidence.identity.methods.map((m) => m.technique),
      ["manifest-analysis"],
    );
  });

  it("returns nothing for a document that carries no components", async () => {
    assert.deepStrictEqual(await parseDocument({ parentComponent: {} }), {});
  });
});
