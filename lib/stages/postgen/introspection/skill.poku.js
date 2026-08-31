/**
 * Tests for the sbom-fidelity-loop skill documentation: the frontmatter
 * triggers a model matches on, the embedded JSON examples, and the report
 * field references.
 *
 * Documentation that drifts from the schema is worse than none, so the JSON
 * blocks in the skill are validated two ways. Report-shaped blocks are
 * compared field-for-field against a report a real `bin/cdxgen.js` run just
 * wrote (the same degraded Maven shape the skill's worked example shows), and
 * the flags used in the skill's commands are checked against the CLI's own
 * help output. The history-file example is validated against its documented
 * shape directly, since the agent, not cdxgen, writes that file.
 *
 * This file spawns the node CLI directly, so it is held back from the Bun and
 * Deno suites (see contrib/alt-runtime-tests.js).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

import { renderIntrospectionConsole } from "./report.js";
import { scoreReflection, TIER_LADDER } from "./score.js";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const skillDir = join(repoRoot, ".agents", "skills", "sbom-fidelity-loop");

const SKILL_PATH = join(skillDir, "SKILL.md");
const SCHEMA_DOC_PATH = join(skillDir, "reference", "report-schema.md");
const ACTIONS_DOC_PATH = join(skillDir, "reference", "remediation-actions.md");

/** Trigger phrases the plan requires the frontmatter description to name. */
const REQUIRED_TRIGGERS = [
  "improving SBOM accuracy",
  "missing transitive dependencies",
  "build tool setup for SBOM generation",
  "cdxgen fidelity report",
  "--introspect",
];

/** The outcome vocabulary the history file's attempted entries may carry. */
const HISTORY_OUTCOMES = new Set(["verified", "no-change", "failed"]);

/**
 * Read a documentation file.
 *
 * @param {string} filePath Path of the file.
 * @returns {string} File content.
 */
function readDoc(filePath) {
  assert.ok(existsSync(filePath), `missing skill file: ${filePath}`);
  return readFileSync(filePath, "utf-8");
}

/**
 * Extract the YAML frontmatter object of a skill file. The skill files use
 * one-line `name` and `description` fields, so a line parse is sufficient.
 *
 * @param {string} content File content.
 * @returns {Object} Parsed frontmatter fields.
 */
function parseFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  assert.ok(match, "skill file has no YAML frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field) {
      fields[field[1]] = field[2];
    }
  }
  return fields;
}

/**
 * Extract fenced code blocks of the given languages from a document.
 *
 * @param {string} content Document content.
 * @param {string[]} languages Fence info strings to collect.
 * @returns {string[]} Block bodies in document order.
 */
function codeBlocks(content, languages) {
  const blocks = [];
  for (const match of content.matchAll(/```([a-z]*)\r?\n([\s\S]*?)```/g)) {
    if (languages.includes(match[1])) {
      blocks.push(match[2]);
    }
  }
  return blocks;
}

/**
 * Parse every fenced JSON block of a document.
 *
 * @param {string} filePath Document path, for assertion messages.
 * @param {string} content Document content.
 * @returns {Object[]} Parsed JSON documents.
 */
function jsonBlocks(filePath, content) {
  return codeBlocks(content, ["json"]).map((block, index) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      assert.ok(
        false,
        `${filePath} json block #${index + 1} does not parse: ${error.message}`,
      );
      return undefined;
    }
  });
}

/**
 * The key set of a value, or null for non-plain-object values.
 *
 * @param {Object} value Value to inspect.
 * @returns {string[]|null} Keys of a plain object, else null.
 */
function keysOf(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : null;
}

/**
 * Assert that every key an example object carries also exists on the real
 * object. Arrays are compared through their first elements when both sides
 * have one.
 *
 * @param {Object} example Example object from the documentation.
 * @param {Object} real Real object from a generated report.
 * @param {string} where Human-readable location for assertion messages.
 * @returns {void}
 */
function assertKeysCovered(example, real, where) {
  const exampleKeys = keysOf(example);
  if (!exampleKeys) {
    return;
  }
  assert.ok(keysOf(real), `${where}: report section missing entirely`);
  for (const key of exampleKeys) {
    assert.ok(
      Object.hasOwn(real, key),
      `${where}: documented field "${key}" does not exist in the real report`,
    );
    if (
      Array.isArray(example[key]) &&
      example[key].length &&
      Array.isArray(real[key]) &&
      real[key].length
    ) {
      assertKeysCovered(example[key][0], real[key][0], `${where}.${key}[]`);
    } else if (keysOf(example[key]) && keysOf(real[key])) {
      assertKeysCovered(example[key], real[key], `${where}.${key}`);
    }
  }
}

/**
 * Write a small single-pom maven project fixture, the degraded shape the
 * skill's worked example describes.
 *
 * @param {string} dir Destination directory.
 * @returns {void}
 */
function writeMavenFixture(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pom.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>sbom-fidelity-skill-fixture</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.14.0</version>
    </dependency>
  </dependencies>
</project>
`,
  );
}

/**
 * Run the skill's loop command against a degraded maven fixture and return
 * the result with the report the run wrote.
 *
 * @returns {Object} Spawn result, the temp dir, the report paths and the parsed report.
 */
function runLoopCommand() {
  const tmpDir = mkdtempSync(join(osTmpdir(), "cdxgen-skill-test-"));
  const fixtureDir = join(tmpDir, "maven-fixture");
  writeMavenFixture(fixtureDir);
  const reportPath = join(tmpDir, "report.md");
  const jsonPath = join(tmpDir, "report.json");
  const env = { ...process.env };
  // An empty-string variable reads as an explicit opt-out, so the baseline is
  // a genuinely unset environment and the profile alone switches the feature
  // on, exactly as the skill's loop command does.
  delete env.CDXGEN_INTROSPECT;
  delete env.CDXGEN_INTROSPECT_LEDGER;
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "bin", "cdxgen.js"),
      "--profile",
      "introspect",
      "--introspect-fail-below",
      "70",
      "-t",
      "java",
      "--no-install-deps",
      "-o",
      join(tmpDir, "bom.json"),
      "--introspect-report",
      reportPath,
      "--introspect-json",
      jsonPath,
      fixtureDir,
    ],
    {
      env: {
        ...env,
        MVN_CMD: join("/", "cdxgen-nonexistent", "mvn"),
      },
      encoding: "utf-8",
    },
  );
  return {
    tmpDir,
    result,
    reportPath,
    jsonPath,
    report: existsSync(jsonPath)
      ? JSON.parse(readFileSync(jsonPath, "utf-8"))
      : undefined,
  };
}

const e2e = runLoopCommand();
process.on("exit", () => {
  rmSync(e2e.tmpDir, { recursive: true, force: true });
});

const skillDoc = readDoc(SKILL_PATH);
const schemaDoc = readDoc(SCHEMA_DOC_PATH);
const actionsDoc = readDoc(ACTIONS_DOC_PATH);

describe("skill frontmatter", () => {
  const frontmatter = parseFrontmatter(skillDoc);

  it("declares the skill name", () => {
    assert.strictEqual(frontmatter.name, "sbom-fidelity-loop");
  });

  it("names every trigger phrase the plan requires", () => {
    for (const trigger of REQUIRED_TRIGGERS) {
      assert.ok(
        frontmatter.description?.includes(trigger),
        `frontmatter description is missing the trigger "${trigger}"`,
      );
    }
  });

  it("links both reference files", () => {
    assert.ok(skillDoc.includes("reference/report-schema.md"));
    assert.ok(skillDoc.includes("reference/remediation-actions.md"));
  });
});

describe("skill commands use real CLI flags", () => {
  const help = spawnSync(
    process.execPath,
    [join(repoRoot, "bin", "cdxgen.js"), "--help"],
    { encoding: "utf-8" },
  );
  const helpText = `${help.stdout}\n${help.stderr}`;
  // Docker's own flags appear in container action prose; every other long
  // flag used in the skill's shell blocks must be one cdxgen accepts.
  const foreignFlags = new Set(["rm"]);
  const used = new Set();
  for (const content of [
    ...codeBlocks(skillDoc, ["sh", "text"]),
    ...codeBlocks(schemaDoc, ["sh", "bat", "text"]),
    ...codeBlocks(actionsDoc, ["sh", "bat", "text"]),
  ]) {
    for (const match of content.matchAll(/--([a-z][a-z0-9-]*)/g)) {
      if (!foreignFlags.has(match[1])) {
        used.add(match[1]);
      }
    }
  }

  it("uses only flags the CLI accepts", () => {
    assert.ok(used.size > 0, "no flags found in the skill's shell blocks");
    for (const flag of used) {
      const negated = flag.startsWith("no-") ? flag.slice(3) : flag;
      assert.ok(
        helpText.includes(`--${flag}`) || helpText.includes(`--${negated}`),
        `flag --${flag} used by the skill is not accepted by cdxgen`,
      );
    }
  });
});

describe("skill JSON examples against a real generated report", () => {
  it("the loop command on a degraded maven fixture exits 4 with reports written", () => {
    assert.strictEqual(
      e2e.result.status,
      4,
      `expected gate exit 4, got ${e2e.result.status}: ${e2e.result.stderr}`,
    );
    assert.ok(e2e.report, "the --introspect-json report was not written");
    assert.ok(
      existsSync(e2e.reportPath),
      "the --introspect-report markdown was not written",
    );
    assert.ok(
      e2e.result.stderr.includes(
        "is below the --introspect-fail-below threshold",
      ),
      "the gate message is missing from the run output",
    );
    assert.strictEqual(e2e.report.schemaVersion, "1.0");
    assert.strictEqual(e2e.report.ledger.complete, true);
    assert.deepEqual(e2e.report.gate, { threshold: 70, passed: false });
  });

  it("the report skeleton in report-schema.md matches the real report", () => {
    const skeleton = jsonBlocks(SCHEMA_DOC_PATH, schemaDoc).find(
      (block) => block.schemaVersion && block.overall,
    );
    assert.ok(skeleton, "report-schema.md has no report skeleton block");
    assertKeysCovered(skeleton, e2e.report, "report skeleton");
  });

  it("the ecosystem row example matches a real row", () => {
    const example = jsonBlocks(SCHEMA_DOC_PATH, schemaDoc).find(
      (block) => block.ecosystem && block.tools && block.tierReasons,
    );
    assert.ok(example, "report-schema.md has no ecosystem row example");
    const realRow = e2e.report.ecosystems?.[0];
    assert.ok(realRow, "the real report has no ecosystem rows");
    assertKeysCovered(example, realRow, "ecosystem row");
    assert.deepEqual(
      Object.keys(example.tools).sort(),
      Object.keys(realRow.tools).sort(),
    );
  });

  it("the remediation entry examples match the top-ranked real entry", () => {
    assert.ok(
      e2e.report.remediation?.length,
      "the real report ranked no remediations",
    );
    const realTop = e2e.report.remediation[0];
    assert.strictEqual(
      realTop.remediationId,
      "jvm.maven.manifest-fallback",
      "the fixture no longer reproduces the worked example's top remediation",
    );
    const examples = [
      ...jsonBlocks(SCHEMA_DOC_PATH, schemaDoc),
      ...jsonBlocks(ACTIONS_DOC_PATH, actionsDoc),
    ].filter((block) => block.remediationId);
    assert.ok(examples.length >= 2, "the remediation examples went missing");
    // Action shapes come from the catalog plus whatever this run produced:
    // a degraded maven run exercises install/build/rerun, while container
    // and env actions only appear in other ecosystems' entries.
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, "data", "remediations.json"), "utf-8"),
    );
    const realActionShapes = new Set(
      [
        ...e2e.report.remediation,
        ...Object.values(catalog).flatMap((entry) => entry.actions || []),
      ].map((action) => Object.keys(action).sort().join("+")),
    );
    for (const example of examples) {
      // Excerpts may trim actions, so only the entry's own keys are compared
      // here; the actions are validated by shape below.
      for (const key of Object.keys(example)) {
        assert.ok(
          Object.hasOwn(realTop, key),
          `remediation ${example.remediationId}: documented field "${key}" does not exist in the real report`,
        );
      }
      for (const action of example.actions || []) {
        const shape = Object.keys(action).sort().join("+");
        assert.ok(
          realActionShapes.has(shape),
          `documented action shape {${shape}} does not exist in the catalog or the real report's actions`,
        );
      }
    }
  });

  it("report fields named in SKILL.md prose exist in the real report", () => {
    const references = new Set();
    for (const match of skillDoc.matchAll(
      /(?<![/\w])report\.[a-zA-Z][a-zA-Z0-9.]*/g,
    )) {
      references.add(match[0]);
    }
    assert.ok(references.size > 0, "SKILL.md names no report fields");
    for (const reference of references) {
      let node = e2e.report;
      let resolved = true;
      for (const part of reference.split(".").slice(1)) {
        if (node && typeof node === "object" && Object.hasOwn(node, part)) {
          node = node[part];
        } else {
          resolved = false;
          break;
        }
      }
      assert.ok(
        resolved,
        `SKILL.md references "${reference}" but the real report lacks it`,
      );
    }
  });

  it("the history-file example matches the documented history shape", () => {
    const history = jsonBlocks(SKILL_PATH, skillDoc).find(
      (block) => block.iterations && block.attempted,
    );
    assert.ok(history, "SKILL.md has no history-file example");
    assert.strictEqual(history.schemaVersion, "1.0");
    for (const iteration of history.iterations) {
      for (const key of ["n", "score", "tier", "inputsFingerprint", "at"]) {
        assert.ok(
          Object.hasOwn(iteration, key),
          `history iteration entry lacks "${key}"`,
        );
      }
    }
    for (const attempt of history.attempted) {
      for (const key of [
        "remediationId",
        "at",
        "actions",
        "outcome",
        "detail",
      ]) {
        assert.ok(
          Object.hasOwn(attempt, key),
          `history attempted entry lacks "${key}"`,
        );
      }
      assert.ok(
        HISTORY_OUTCOMES.has(attempt.outcome),
        `history outcome "${attempt.outcome}" is not one of the documented outcomes`,
      );
    }
  });
});

describe("skill vocabulary matches the implementation", () => {
  it("the documented tier ladder equals TIER_LADDER in order", () => {
    const ladder =
      /`([a-z]+)`\s*>\s*`([a-z]+)`\s*>\s*`([a-z]+)`\s*>\s*`([a-z]+)`\s*>\s*`([a-z]+)`/.exec(
        schemaDoc,
      );
    assert.ok(ladder, "report-schema.md does not state the tier ladder");
    assert.deepEqual(
      ladder.slice(1),
      TIER_LADDER,
      "the documented tier ladder drifted from TIER_LADDER",
    );
  });

  it("the documented action kinds are exactly the catalog's kinds", () => {
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, "data", "remediations.json"), "utf-8"),
    );
    const catalogKinds = new Set();
    for (const entry of Object.values(catalog)) {
      for (const action of entry.actions || []) {
        catalogKinds.add(action.kind);
      }
    }
    const documented = [
      "install",
      "env",
      "build",
      "config",
      "container",
      "rerun",
    ].filter((kind) => actionsDoc.includes(`\`${kind}\``));
    assert.deepEqual(
      documented.sort(),
      [...catalogKinds].sort(),
      "the documented action kinds drifted from data/remediations.json",
    );
  });

  it("the documented console summary lines are the renderer's lines", () => {
    const reflection = JSON.parse(
      readFileSync(
        join(
          repoRoot,
          "test",
          "data",
          "introspection",
          "degraded-jvm.reflection.json",
        ),
        "utf-8",
      ),
    );
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, "data", "remediations.json"), "utf-8"),
    );
    const summary = renderIntrospectionConsole(
      scoreReflection(reflection, catalog, {}),
      { introspectReport: "r.md", introspectJson: "r.json" },
    );
    for (const documented of [
      "Build introspection: overall ",
      "remediation(s) ranked",
      "markdown report: r.md",
      "json report: r.json",
    ]) {
      assert.ok(
        summary.includes(documented),
        `renderer no longer produces "${documented}"`,
      );
    }
    const binSource = readFileSync(join(repoRoot, "bin", "cdxgen.js"), "utf-8");
    assert.ok(
      binSource.includes("is below the --introspect-fail-below threshold"),
      "bin/cdxgen.js no longer prints the documented gate message",
    );
  });
});
