import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Purl } from "@cdxgen/cdx-purl";
import { assert, describe, it } from "poku";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Directories holding committed CycloneDX documents that cdxgen itself
 * produces. Input fixtures under `test/data/` are deliberately excluded: many
 * of them are malformed on purpose, because they exist to prove cdxgen copes
 * with bad input.
 */
const GOLDEN_DIRS = ["test/repotests"];

/** Filenames under those trees that are cdxgen output rather than input. */
const OUTPUT_FILE = /^(default|.*expected.*)\.json$/i;

function collectGoldens(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectGoldens(p, acc);
    } else if (
      entry.name.endsWith(".json") &&
      (OUTPUT_FILE.test(entry.name) ||
        p.includes(`${path.sep}expected${path.sep}`))
    ) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * Walk every place a CycloneDX document may carry a purl and yield
 * `{ purl, where }`. `metadata.component` is included deliberately — the
 * `"purl": "swift-smoke"` regression reached a committed golden precisely
 * because that location was unchecked.
 */
function* eachPurl(doc, where = "") {
  if (!doc || typeof doc !== "object") {
    return;
  }
  if (Array.isArray(doc)) {
    for (let i = 0; i < doc.length; i++) {
      yield* eachPurl(doc[i], `${where}[${i}]`);
    }
    return;
  }
  if (typeof doc.purl === "string") {
    yield { purl: doc.purl, where: `${where}.purl` };
  }
  for (const [key, value] of Object.entries(doc)) {
    if (key !== "purl" && value && typeof value === "object") {
      yield* eachPurl(value, `${where}.${key}`);
    }
  }
}

describe("committed goldens contain only valid purls", () => {
  const goldens = GOLDEN_DIRS.flatMap((d) =>
    collectGoldens(path.join(REPO_ROOT, d)),
  );

  it("finds golden documents to check", () => {
    // Guards against the whole suite silently passing because the glob broke.
    assert.ok(
      goldens.length > 0,
      "no golden documents discovered — the collector is broken, not the goldens",
    );
  });

  for (const file of goldens) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel} has only parseable purls`, () => {
      let doc;
      try {
        doc = JSON.parse(readFileSync(file, "utf-8"));
      } catch (err) {
        assert.fail(`${rel} is not valid JSON: ${err.message}`);
        return;
      }
      if (!doc?.bomFormat && !doc?.components && !doc?.metadata) {
        return; // not a CycloneDX document
      }
      const invalid = [];
      for (const { purl, where } of eachPurl(doc)) {
        try {
          Purl.parse(purl);
        } catch (err) {
          invalid.push(
            `${where} = ${JSON.stringify(purl)} (${err.code || err.message})`,
          );
        }
      }
      assert.deepStrictEqual(
        invalid,
        [],
        `${rel} contains ${invalid.length} invalid purl(s):\n  ${invalid.join("\n  ")}\n` +
          "A component that has no constructible purl must omit the field entirely " +
          "(see applyPurl in lib/helpers/purl.js); a bare name is not a purl.",
      );
    });
  }
});

describe("golden purls are in canonical form", () => {
  it("re-encoding every golden purl is a no-op", () => {
    const goldens = GOLDEN_DIRS.flatMap((d) =>
      collectGoldens(path.join(REPO_ROOT, d)),
    );
    const noncanonical = [];
    for (const file of goldens) {
      let doc;
      try {
        doc = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        continue;
      }
      for (const { purl, where } of eachPurl(doc)) {
        let canonical;
        try {
          canonical = Purl.parse(purl).toString();
        } catch {
          continue; // already reported by the validity suite above
        }
        if (canonical !== purl) {
          noncanonical.push(
            `${path.relative(REPO_ROOT, file)}${where}: ${purl} -> ${canonical}`,
          );
        }
      }
    }
    assert.deepStrictEqual(
      noncanonical,
      [],
      `${noncanonical.length} golden purl(s) are not in cdx-purl canonical form:\n  ${noncanonical.join("\n  ")}`,
    );
  });
});

/** Yield every `bom-ref` in a document, including nested components. */
function* eachBomRef(doc, where = "") {
  if (!doc || typeof doc !== "object") {
    return;
  }
  if (Array.isArray(doc)) {
    for (let i = 0; i < doc.length; i++) {
      yield* eachBomRef(doc[i], `${where}[${i}]`);
    }
    return;
  }
  if (typeof doc["bom-ref"] === "string") {
    yield { ref: doc["bom-ref"], where };
  }
  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === "object") {
      yield* eachBomRef(value, `${where}.${key}`);
    }
  }
}

describe("committed goldens have unique bom-refs", () => {
  const goldens = GOLDEN_DIRS.flatMap((d) =>
    collectGoldens(path.join(REPO_ROOT, d)),
  );

  for (const file of goldens) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel} has no duplicate bom-ref`, () => {
      let doc;
      try {
        doc = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        return;
      }
      if (!doc?.bomFormat && !doc?.components && !doc?.metadata) {
        return;
      }
      // metadata.tools components legitimately repeat a ref that also appears
      // in the component list, so only the component tree is checked here.
      const seen = new Map();
      const duplicates = [];
      for (const { ref, where } of eachBomRef(doc.components, "components")) {
        if (seen.has(ref)) {
          duplicates.push(`${ref} (at ${seen.get(ref)} and ${where})`);
        } else {
          seen.set(ref, where);
        }
      }
      assert.deepStrictEqual(
        duplicates,
        [],
        `${rel} has ${duplicates.length} duplicate bom-ref(s):\n  ${duplicates.join("\n  ")}\n` +
          "bom-ref keys the dependency graph, so duplicates silently merge two " +
          "components' edges. Components with no purl must derive a unique ref " +
          "via fallbackBomRef in lib/helpers/purl.js.",
      );
    });
  }
});
