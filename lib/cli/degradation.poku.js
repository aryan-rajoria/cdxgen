/**
 * Tests for the ecosystem degradation instrumentation: the remediation-id
 * catalog contract and the end-to-end emission of degradation events on real
 * CLI runs over degraded environments.
 *
 * The catalog test is pure source analysis and runs everywhere. The CLI
 * fixture tests spawn `node bin/cdxgen.js` as a subprocess, so they need the
 * node CLI.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assert, describe, it } from "poku";

import {
  LEDGER_EVENT_IMPACTS,
  LEDGER_EVENT_KINDS,
} from "../core/buildLedger.js";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const catalogPath = path.join(repoRoot, "data", "remediations.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdxgen-degradation-"));
process.on("exit", () => {
  fs.rmSync(testDir, { force: true, recursive: true });
});

/**
 * Collect the remediation ids referenced by the producers. Producers either
 * call `recordDegradation("…")` or set `remediationId: "…"` on a direct
 * recordLedgerEvent call; both forms use a quoted id literal.
 *
 * @returns {Set<string>} Referenced remediation ids.
 */
function referencedRemediationIds() {
  const referenced = new Set();
  const firstArgument =
    /record(?:Degradation|PolicyDegradationOnce)\(\s*["']([a-z0-9.-]+)["']/g;
  const quotedLiteral = /["']([a-z0-9.-]+)["']/g;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (
        entry.name.endsWith(".js") &&
        !entry.name.endsWith(".poku.js")
      ) {
        for (const line of fs.readFileSync(entryPath, "utf-8").split("\n")) {
          for (const match of line.matchAll(firstArgument)) {
            referenced.add(match[1]);
          }
          // The remediationId field also accepts a ternary of two ids, so
          // every quoted literal on a remediationId assignment line is
          // collected. Lines that merely read event.remediationId carry no
          // producer ids.
          if (/remediationId\s*[:=]/.test(line)) {
            for (const match of line.matchAll(quotedLiteral)) {
              referenced.add(match[1]);
            }
          }
        }
      }
    }
  };
  walk(path.join(repoRoot, "lib"));
  return referenced;
}

describe("remediation catalog", () => {
  it("carries the required fields with known vocabulary", () => {
    const knownKinds = new Set(Object.values(LEDGER_EVENT_KINDS));
    const knownImpacts = new Set(Object.values(LEDGER_EVENT_IMPACTS));
    assert.ok(Object.keys(catalog).length > 0, "catalog must not be empty");
    for (const [id, entry] of Object.entries(catalog)) {
      assert.match(
        id,
        /^[a-z0-9]+(\.[a-z0-9-]+)+$/,
        `id ${id} must be dot-separated lowercase tokens`,
      );
      assert.ok(
        typeof entry.ecosystem === "string" && entry.ecosystem.length > 0,
        `${id} must declare an ecosystem`,
      );
      assert.ok(
        knownKinds.has(entry.kind),
        `${id} declares unknown kind ${entry.kind}`,
      );
      assert.ok(
        knownImpacts.has(entry.impact),
        `${id} declares unknown impact ${entry.impact}`,
      );
      assert.ok(
        typeof entry.title === "string" && entry.title.length > 0,
        `${id} must declare a title`,
      );
    }
  });

  it("matches the set of ids referenced by producers exactly", () => {
    const referenced = referencedRemediationIds();
    const catalogIds = new Set(Object.keys(catalog));
    for (const id of referenced) {
      assert.ok(
        catalogIds.has(id),
        `id ${id} is referenced in lib/ but missing from data/remediations.json`,
      );
    }
    for (const id of catalogIds) {
      assert.ok(
        referenced.has(id),
        `catalog id ${id} is not referenced by any producer in lib/`,
      );
    }
  });
});

describe("recordDegradation", () => {
  it("resolves the kind from the catalog and requires the id to exist", () => {
    const probePath = path.join(testDir, "record-degradation-probe.mjs");
    const buildLedgerHref = pathToFileURL(
      path.join(repoRoot, "lib", "core", "buildLedger.js"),
    ).href;
    fs.writeFileSync(
      probePath,
      `import process from "node:process";
       process.env.CDXGEN_INTROSPECT_LEDGER = process.env.PROBE_LEDGER_PATH;
       const { closeLedger, recordDegradation } = await import(
         "${buildLedgerHref}"
       );
       const known = recordDegradation("jvm.maven.manifest-fallback", {
         ecosystem: "java",
         tool: "maven",
         impact: "transitive-deps",
         detail: "probe known id",
       });
       const overridden = recordDegradation("jvm.sbt.project-discovery", {
         ecosystem: "java",
         tool: "sbt",
         kind: "command.failed",
         impact: "components",
         detail: "probe override",
       });
       const unknown = recordDegradation("not.in.catalog", {
         ecosystem: "java",
         impact: "none",
       });
       const noEcosystem = recordDegradation("js.no-lockfile", {
         impact: "versions",
       });
       console.log(
         JSON.stringify({
           known: known && { kind: known.kind, remediationId: known.remediationId },
           overridden: overridden && overridden.kind,
           unknown,
           noEcosystem,
         }),
       );
       closeLedger();`,
    );
    const ledgerPath = path.join(testDir, "probe-ledger.jsonl");
    const stdout = execFileSync(process.execPath, [probePath], {
      env: {
        ...process.env,
        PROBE_LEDGER_PATH: ledgerPath,
        CDXGEN_INTROSPECT: "",
        CDXGEN_INTROSPECT_LEDGER: "",
      },
    }).toString();
    const result = JSON.parse(stdout.trim().split("\n").pop());
    assert.deepStrictEqual(result.known, {
      kind: "fallback.engaged",
      remediationId: "jvm.maven.manifest-fallback",
    });
    assert.strictEqual(result.overridden, "command.failed");
    assert.strictEqual(result.unknown, undefined);
    assert.strictEqual(result.noEcosystem, undefined);
    const sidecarLines = fs
      .readFileSync(ledgerPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.strictEqual(sidecarLines.length, 2);
    assert.strictEqual(
      sidecarLines[0].remediationId,
      "jvm.maven.manifest-fallback",
    );
    assert.strictEqual(
      sidecarLines[1].remediationId,
      "jvm.sbt.project-discovery",
    );
  });
});

/**
 * Write a small single-pom maven project fixture.
 *
 * @param {string} dir Destination directory.
 * @returns {void}
 */
function writeMavenFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "pom.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>d03-degradation-fixture</artifactId>
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
 * Write a small npm project fixture without a lockfile.
 *
 * @param {string} dir Destination directory.
 * @returns {void}
 */
function writeJsFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "d03-degradation-fixture", version: "1.0.0" }, null, 2)}\n`,
  );
}

/**
 * Run the cdxgen CLI over a fixture and return the process result plus the
 * events collected in the ledger sidecar, when one was requested.
 *
 * @param {string} fixtureDir Project directory to scan.
 * @param {string} projectType Project type argument.
 * @param {Object} [opts] `env` additions and whether the ledger is enabled.
 * @returns {{stdout: string, stderr: string, status: number, events: object[]}} CLI result and parsed sidecar events.
 */
function runCli(fixtureDir, projectType, opts = {}) {
  const sidecarPath = path.join(
    testDir,
    `sidecar-${path.basename(fixtureDir)}-${opts.tag ?? "run"}.jsonl`,
  );
  const env = {
    ...process.env,
    CDXGEN_INTROSPECT: "",
    CDXGEN_INTROSPECT_LEDGER: "",
    ...opts.env,
  };
  if (opts.enableLedger) {
    env.CDXGEN_INTROSPECT_LEDGER = sidecarPath;
  }
  const args = [
    path.join(repoRoot, "bin", "cdxgen.js"),
    "-t",
    projectType,
    "--no-install-deps",
    "-o",
    path.join(
      testDir,
      `bom-${path.basename(fixtureDir)}-${opts.tag ?? "run"}.json`,
    ),
    "-q",
    fixtureDir,
  ];
  const result = spawnSync(process.execPath, args, {
    env,
    encoding: "utf-8",
  });
  let events = [];
  if (opts.enableLedger && fs.existsSync(sidecarPath)) {
    events = fs
      .readFileSync(sidecarPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    events,
  };
}

describe("degradation events on real CLI runs", () => {
  it("records jvm.maven.manifest-fallback when maven is unavailable", () => {
    const fixtureDir = path.join(testDir, "maven-fixture");
    writeMavenFixture(fixtureDir);
    const enabled = runCli(fixtureDir, "java", {
      tag: "enabled",
      enableLedger: true,
      env: { MVN_CMD: path.join("/", "cdxgen-nonexistent", "mvn") },
    });
    assert.strictEqual(enabled.status, 0, `CLI run failed: ${enabled.stderr}`);
    const remediationIds = enabled.events
      .map((event) => event.remediationId)
      .filter(Boolean);
    assert.ok(
      remediationIds.includes("jvm.maven.manifest-fallback"),
      `expected jvm.maven.manifest-fallback, got ${JSON.stringify(remediationIds)}`,
    );
    const fallbackEvent = enabled.events.find(
      (event) => event.remediationId === "jvm.maven.manifest-fallback",
    );
    assert.ok(
      fallbackEvent,
      `manifest-fallback event missing; events: ${JSON.stringify(enabled.events)}`,
    );
    assert.strictEqual(fallbackEvent.ecosystem, "java", "ecosystem");
    assert.strictEqual(fallbackEvent.kind, "fallback.engaged", "kind");
    assert.strictEqual(fallbackEvent.impact, "transitive-deps", "impact");
  });

  it("records js.no-node-modules for lockfile-less js scans", () => {
    const fixtureDir = path.join(testDir, "js-fixture");
    writeJsFixture(fixtureDir);
    const enabled = runCli(fixtureDir, "js", {
      tag: "enabled",
      enableLedger: true,
    });
    assert.strictEqual(enabled.status, 0, `CLI run failed: ${enabled.stderr}`);
    const remediationIds = enabled.events
      .map((event) => event.remediationId)
      .filter(Boolean);
    assert.ok(
      remediationIds.includes("js.no-node-modules"),
      `expected js.no-node-modules, got ${JSON.stringify(remediationIds)}`,
    );
  });

  it("keeps stdout and stderr byte-identical when the ledger is enabled", () => {
    const mavenDir = path.join(testDir, "maven-fixture");
    writeMavenFixture(mavenDir);
    const mavenEnv = { MVN_CMD: path.join("/", "cdxgen-nonexistent", "mvn") };
    const mavenDisabled = runCli(mavenDir, "java", {
      tag: "byte-disabled",
      env: mavenEnv,
    });
    const mavenEnabled = runCli(mavenDir, "java", {
      tag: "byte-enabled",
      enableLedger: true,
      env: mavenEnv,
    });
    assert.strictEqual(mavenDisabled.stdout, mavenEnabled.stdout);
    assert.strictEqual(mavenDisabled.stderr, mavenEnabled.stderr);

    const jsDir = path.join(testDir, "js-fixture");
    writeJsFixture(jsDir);
    const jsDisabled = runCli(jsDir, "js", { tag: "byte-disabled" });
    const jsEnabled = runCli(jsDir, "js", {
      tag: "byte-enabled",
      enableLedger: true,
    });
    assert.strictEqual(jsDisabled.stdout, jsEnabled.stdout);
    assert.strictEqual(jsDisabled.stderr, jsEnabled.stderr);
  });
});
