/**
 * The profile vocabulary is enumerated by hand in four places: the yargs
 * `choices` in bin/cdxgen.js (the source of truth), the help dump in
 * docs/CLI.md, the key-parameter table in SKILL.md, and the profile list in
 * docs/LESSON30.md. Hand-maintained lists drift silently, so this suite parses
 * each site and asserts they all name the same set.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Extract the quoted values of a `choices: [...]` block starting at
 * `blockStart`.
 *
 * @param {string} source File content.
 * @param {number} blockStart Index of the `choices: [` opener.
 * @returns {string[]} Choice values in file order.
 */
function quotedChoiceValues(source, blockStart) {
  const opener = "choices: [".length + blockStart;
  const closer = source.indexOf("]", opener);
  assert.ok(closer > opener, "unterminated choices block");
  const values = [];
  for (const piece of source.slice(opener, closer).split(",")) {
    const trimmed = piece.trim().replaceAll('"', "");
    if (trimmed) {
      values.push(trimmed);
    }
  }
  return values;
}

/**
 * Parse the bin/cdxgen.js yargs choices — the source of truth.
 *
 * @returns {string[]} Profile names.
 */
function binProfiles() {
  const source = readFileSync(join(repoRoot, "bin", "cdxgen.js"), "utf8");
  const anchorIndex = source.indexOf('.option("profile"');
  assert.ok(anchorIndex >= 0, "bin/cdxgen.js profile option not found");
  const choicesIndex = source.indexOf("choices: [", anchorIndex);
  assert.ok(choicesIndex >= 0, "bin/cdxgen.js profile choices not found");
  return quotedChoiceValues(source, choicesIndex);
}

/**
 * Parse the choices line of the docs/CLI.md help dump, the one following the
 * `--profile` entry.
 *
 * @returns {string[]} Profile names.
 */
function cliDocProfiles() {
  const source = readFileSync(join(repoRoot, "docs", "CLI.md"), "utf8");
  const entryIndex = source.indexOf("      --profile ");
  assert.ok(entryIndex >= 0, "docs/CLI.md --profile entry not found");
  const choicesIndex = source.indexOf("[choices: ", entryIndex);
  assert.ok(choicesIndex >= 0, "docs/CLI.md profile choices line not found");
  // The dump renders the block as "[choices: ...]", one character before the
  // yargs form the helper expects.
  return quotedChoiceValues(source, choicesIndex + 1);
}

/**
 * Parse the Profiles row of the SKILL.md key-parameter table. Names are
 * backtick-quoted and comma-separated, and paired names are written with a
 * slash (`ml`/`machine-learning`).
 *
 * @returns {string[]} Profile names.
 */
function skillProfiles() {
  const source = readFileSync(join(repoRoot, "SKILL.md"), "utf8");
  const row = source
    .split("\n")
    .find(
      (line) => line.includes("**Profiles**") && line.includes("--profile"),
    );
  assert.ok(row, "SKILL.md Profiles row not found");
  const cell = row.split("--profile <name>`")[1] || "";
  // Every profile name sits inside backticks; paired names are written as
  // two adjacent spans separated by a slash.
  const names = [];
  const spans = cell.split("`");
  for (let index = 1; index < spans.length; index += 2) {
    for (const piece of spans[index].split("/")) {
      const name = piece.trim();
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Parse the bulleted profile list under the Profiles step of
 * docs/LESSON30.md.
 *
 * @returns {string[]} Profile names.
 */
function lessonProfiles() {
  const source = readFileSync(join(repoRoot, "docs", "LESSON30.md"), "utf8");
  const sectionStart = source.indexOf("## Step 5: Profiles");
  assert.ok(sectionStart >= 0, "LESSON30 Profiles step not found");
  const sectionEnd = source.indexOf("## Step", sectionStart + 1);
  const section = source.slice(
    sectionStart,
    sectionEnd > 0 ? sectionEnd : undefined,
  );
  const names = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("- `")) {
      continue;
    }
    const name = line.slice(3, line.indexOf("`", 3));
    if (name) {
      names.push(name);
    }
  }
  return names;
}

describe("profile documentation agreement", () => {
  it("docs/CLI.md and SKILL.md name exactly the bin/cdxgen.js profile choices", () => {
    const expected = binProfiles();
    assert.ok(expected.length > 1, "bin/cdxgen.js declares profiles");
    assert.deepEqual(
      cliDocProfiles().sort(),
      [...expected].sort(),
      "docs/CLI.md help dump drifts from bin/cdxgen.js profile choices",
    );
    assert.deepEqual(
      skillProfiles().sort(),
      [...expected].sort(),
      "SKILL.md profile table drifts from bin/cdxgen.js profile choices",
    );
  });

  it("docs/LESSON30.md names only real profiles, including the newest", () => {
    // The lesson curates the profiles a monorepo reaches for, so it agrees
    // as a subset: nothing it names may drift out of the choices, and the
    // latest profile must not be missing from it.
    const expected = new Set(binProfiles());
    const listed = lessonProfiles();
    const unknown = listed.filter((name) => !expected.has(name));
    assert.deepEqual(
      unknown,
      [],
      `docs/LESSON30.md names profiles that bin/cdxgen.js does not declare: ${unknown.join(", ")}`,
    );
    assert.ok(
      listed.includes(binProfiles()[binProfiles().length - 1]),
      "docs/LESSON30.md is missing the newest profile",
    );
  });

  it("the introspect profile is declared everywhere", () => {
    const expected = binProfiles();
    assert.ok(expected.includes("introspect"), "bin/cdxgen.js choices");
    assert.ok(cliDocProfiles().includes("introspect"), "docs/CLI.md");
    assert.ok(skillProfiles().includes("introspect"), "SKILL.md");
    assert.ok(lessonProfiles().includes("introspect"), "docs/LESSON30.md");
  });
});
