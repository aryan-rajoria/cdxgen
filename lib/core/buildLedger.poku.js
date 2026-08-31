import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { assert, describe, it } from "poku";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// The recorder resolves its environment and opens its sidecar once at module
// load, so the in-process module instance is imported after the enabled
// environment is in place; the env matrix itself is exercised through
// subprocess probes, which get a fresh module instance each.
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdxgen-buildledger-"));
const sidecarPath = path.join(testDir, "ledger.jsonl");
process.env.CDXGEN_INTROSPECT = "true";
process.env.CDXGEN_INTROSPECT_LEDGER = sidecarPath;
delete process.env.CDXGEN_INTROSPECT_MAX_EVENTS;

const buildLedgerHref = new URL("./buildLedger.js", import.meta.url).href;

const {
  LEDGER_ENABLED,
  LEDGER_EVENT_IMPACTS,
  LEDGER_EVENT_KINDS,
  closeLedger,
  getLedgerEvents,
  loadLedgerFile,
  recordLedgerEvent,
  resetLedgerEvents,
} = await import("./buildLedger.js");

process.on("exit", () => {
  fs.rmSync(testDir, { force: true, recursive: true });
});

function probeArgv(probePath) {
  if (globalThis.Deno) {
    return [
      "run",
      "-A",
      "--config",
      path.join(repoRoot, "deno.json"),
      probePath,
    ];
  }
  return [probePath];
}

/**
 * Run a fresh recorder instance in a subprocess and return its printed result.
 *
 * The child environment is built entirely from PROBE_* variables: the probe
 * deletes the parent's introspection variables before importing the module,
 * then applies the case's own values. Plain `env` deletions cannot be relied
 * on for this because Deno's child_process merges the parent environment
 * instead of honouring the option verbatim.
 *
 * @param {string} scenario Value handed to the probe as PROBE_SCENARIO.
 * @param {Object} [caseEnv] Case variables: `introspect`, `ledger`, `maxEvents`.
 * @returns {Object} Parsed result object printed by the probe.
 */
function runProbe(scenario, caseEnv = {}) {
  const probePath = path.join(testDir, `probe-${scenario}.mjs`);
  fs.writeFileSync(
    probePath,
    `import process from "node:process";
     for (const name of [
       "CDXGEN_INTROSPECT",
       "CDXGEN_INTROSPECT_LEDGER",
       "CDXGEN_INTROSPECT_MAX_EVENTS",
     ]) {
       delete process.env[name];
     }
     if (process.env.PROBE_INTROSPECT !== undefined) {
       process.env.CDXGEN_INTROSPECT = process.env.PROBE_INTROSPECT;
     }
     if (process.env.PROBE_LEDGER !== undefined) {
       process.env.CDXGEN_INTROSPECT_LEDGER = process.env.PROBE_LEDGER;
     }
     if (process.env.PROBE_MAX_EVENTS !== undefined) {
       process.env.CDXGEN_INTROSPECT_MAX_EVENTS = process.env.PROBE_MAX_EVENTS;
     }
     const { LEDGER_ENABLED, closeLedger, getLedgerEvents, recordLedgerEvent } =
       await import("${buildLedgerHref}");

     const scenario = process.env.PROBE_SCENARIO;
     const result = { scenario, ledgerEnabled: LEDGER_ENABLED };
     if (scenario === "single") {
       const stored = recordLedgerEvent("tool.resolved", {
         ecosystem: "java",
         tool: "maven",
         found: "3.9.9",
         source: "PATH",
       });
       result.returnedKind = stored ? stored.kind : null;
     } else if (scenario === "two-events") {
       recordLedgerEvent("tool.expected", {
         ecosystem: "java",
         tool: "maven",
         wanted: "3.9",
       });
       recordLedgerEvent("tool.missing", {
         ecosystem: "python",
         tool: "python3",
         wanted: "3.12",
       });
     } else if (scenario === "truncation") {
       for (let i = 1; i <= 20; i += 1) {
         recordLedgerEvent("tool.resolved", {
           ecosystem: "java",
           tool: "maven",
           detail: "event " + i,
         });
       }
     }
     result.events = getLedgerEvents();
     console.log(JSON.stringify(result));
     closeLedger();`,
  );
  const childEnv = { ...process.env, PROBE_SCENARIO: scenario };
  if (caseEnv.introspect !== undefined) {
    childEnv.PROBE_INTROSPECT = caseEnv.introspect;
  }
  if (caseEnv.ledger !== undefined) {
    childEnv.PROBE_LEDGER = caseEnv.ledger;
  }
  if (caseEnv.maxEvents !== undefined) {
    childEnv.PROBE_MAX_EVENTS = caseEnv.maxEvents;
  }
  const stdout = execFileSync(process.execPath, probeArgv(probePath), {
    env: childEnv,
  }).toString();
  return JSON.parse(stdout);
}

function readSidecarLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length)
    .map((line) => JSON.parse(line));
}

describe("buildLedger", () => {
  it("enables recording for the in-process module and keeps events out of the disabled path", () => {
    assert.strictEqual(LEDGER_ENABLED, true);
  });

  it("records every schema field in schema order and freezes snapshots", () => {
    resetLedgerEvents();
    const stored = recordLedgerEvent(LEDGER_EVENT_KINDS.FALLBACK_ENGAGED, {
      ecosystem: "java",
      tool: "maven",
      wanted: "3.9",
      found: undefined,
      source: "wrapper",
      path: "/tools/maven/bin/mvn",
      command: "mvn dependency:tree",
      exitCode: 1,
      detail: "Maven cannot resolve the dependency tree.",
      remediationId: "jvm.maven.missing",
      impact: LEDGER_EVENT_IMPACTS.TRANSITIVE_DEPS,
    });
    assert.ok(stored, "the stored event is returned");
    const snapshot = getLedgerEvents();
    assert.strictEqual(snapshot.length, 1);
    const event = snapshot[0];
    assert.deepEqual(Object.keys(event), [
      "kind",
      "ecosystem",
      "tool",
      "wanted",
      "source",
      "path",
      "command",
      "exitCode",
      "detail",
      "remediationId",
      "impact",
      "timestamp",
    ]);
    assert.strictEqual(event.kind, "fallback.engaged");
    assert.strictEqual(event.ecosystem, "java");
    assert.strictEqual(event.tool, "maven");
    assert.strictEqual(event.wanted, "3.9");
    assert.strictEqual(event.found, undefined);
    assert.strictEqual(event.source, "wrapper");
    assert.strictEqual(event.exitCode, 1);
    assert.strictEqual(event.remediationId, "jvm.maven.missing");
    assert.strictEqual(event.impact, "transitive-deps");
    assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
    assert.strictEqual(
      event.timestamp,
      new Date(event.timestamp).toISOString(),
    );
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(event));
    assert.throws(() => {
      snapshot[0].kind = "tool.resolved";
    });
    assert.throws(() => {
      snapshot.push({});
    });
  });

  it("freezes the kind and impact vocabularies", () => {
    assert.deepEqual(
      { ...LEDGER_EVENT_KINDS },
      {
        TOOL_EXPECTED: "tool.expected",
        TOOL_RESOLVED: "tool.resolved",
        TOOL_MISSING: "tool.missing",
        TOOL_MISMATCH: "tool.mismatch",
        COMMAND_ATTEMPTED: "command.attempted",
        COMMAND_FAILED: "command.failed",
        FALLBACK_ENGAGED: "fallback.engaged",
        EVIDENCE_DEGRADED: "evidence.degraded",
        LIFECYCLE_CLAIMED: "lifecycle.claimed",
      },
    );
    assert.deepEqual(
      { ...LEDGER_EVENT_IMPACTS },
      {
        TRANSITIVE_DEPS: "transitive-deps",
        VERSIONS: "versions",
        INTEGRITY: "integrity",
        LICENSES: "licenses",
        COMPONENTS: "components",
        NONE: "none",
      },
    );
    assert.ok(Object.isFrozen(LEDGER_EVENT_KINDS));
    assert.ok(Object.isFrozen(LEDGER_EVENT_IMPACTS));
  });

  it("drops unknown kinds and events without an ecosystem", () => {
    resetLedgerEvents();
    assert.strictEqual(
      recordLedgerEvent("totally.bogus", { ecosystem: "java" }),
      undefined,
    );
    assert.strictEqual(
      recordLedgerEvent(LEDGER_EVENT_KINDS.TOOL_RESOLVED, {}),
      undefined,
    );
    assert.strictEqual(
      recordLedgerEvent(LEDGER_EVENT_KINDS.TOOL_RESOLVED, {
        ecosystem: 42,
      }),
      undefined,
    );
    assert.strictEqual(getLedgerEvents().length, 0);
  });

  it("redacts sensitive assignments and credential shapes before storing", () => {
    resetLedgerEvents();
    recordLedgerEvent(LEDGER_EVENT_KINDS.COMMAND_FAILED, {
      ecosystem: "java",
      command:
        "mvn deploy --token=abc123 -Dpassword=hunter2 -Dsettings=ok --retries=3 https://user:supersecret@registry.example/path?token=abc123",
      path: "/tmp/ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4/creds",
      detail: "Deploy failed with --token=abc123 in the arguments.",
    });
    const serialized = JSON.stringify(getLedgerEvents());
    const fileContent = fs.existsSync(sidecarPath)
      ? fs.readFileSync(sidecarPath, "utf8")
      : "";
    for (const secret of ["abc123", "hunter2", "supersecret"]) {
      assert.ok(!serialized.includes(secret), `${secret} must not be stored`);
      assert.ok(!fileContent.includes(secret), `${secret} must not be written`);
    }
    const [event] = getLedgerEvents();
    assert.strictEqual(
      event.command,
      "mvn deploy --token=[redacted] -Dpassword=[redacted] -Dsettings=ok --retries=3 https://registry.example/path",
    );
    assert.strictEqual(event.path, "/tmp/[redacted]/creds");
    assert.strictEqual(
      event.detail,
      "Deploy failed with --token=[redacted] in the arguments.",
    );
  });

  it("round-trips events through the sidecar including Windows paths", () => {
    resetLedgerEvents();
    recordLedgerEvent(LEDGER_EVENT_KINDS.COMMAND_ATTEMPTED, {
      ecosystem: "java",
      tool: "maven",
      command: "mvn -s C:\\Users\\dev\\settings.xml package",
      path: "C:\\Users\\dev\\project\\pom.xml",
      detail: "Maven resolves the dependency tree.",
    });
    const loaded = loadLedgerFile(sidecarPath);
    const event = loaded.find(
      (candidate) =>
        candidate.kind === "command.attempted" && candidate.tool === "maven",
    );
    assert.ok(event, "the event must survive the file round trip");
    assert.strictEqual(
      event.command,
      "mvn -s C:\\Users\\dev\\settings.xml package",
    );
    assert.strictEqual(event.path, "C:\\Users\\dev\\project\\pom.xml");
    assert.ok(Object.isFrozen(loaded));
    assert.ok(Object.isFrozen(event));
  });

  it("skips blank and malformed lines when loading a sidecar", () => {
    const brokenPath = path.join(testDir, "broken.jsonl");
    fs.writeFileSync(
      brokenPath,
      [
        "not json at all",
        '{"kind":"tool.resolved"',
        "",
        '{"kind":"tool.missing","ecosystem":"python","timestamp":"2026-01-01T00:00:00.000Z"}',
        "",
      ].join("\n"),
    );
    const loaded = loadLedgerFile(brokenPath);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].kind, "tool.missing");
    assert.strictEqual(
      loadLedgerFile(path.join(testDir, "absent.jsonl")).length,
      0,
    );
  });

  it("appends to the same sidecar from the main thread and a worker", async () => {
    resetLedgerEvents();
    const workerProbe = path.join(testDir, "worker.mjs");
    fs.writeFileSync(
      workerProbe,
      `import { closeLedger, recordLedgerEvent } from "${buildLedgerHref}";
       recordLedgerEvent("tool.resolved", {
         ecosystem: "java",
         tool: "worker-maven",
         found: "3.9.9",
       });
       closeLedger();`,
    );
    recordLedgerEvent(LEDGER_EVENT_KINDS.TOOL_RESOLVED, {
      ecosystem: "java",
      tool: "main-maven",
      found: "3.9.9",
    });
    await new Promise((resolveWorker, rejectWorker) => {
      const worker = new Worker(workerProbe);
      worker.on("exit", (code) => {
        if (code === 0) {
          resolveWorker();
        } else {
          rejectWorker(new Error(`worker exited with code ${code}`));
        }
      });
      worker.on("error", rejectWorker);
    });
    const raw = fs.readFileSync(sidecarPath, "utf8");
    assert.ok(!raw.includes("\0"), "appends must not punch holes");
    const loaded = loadLedgerFile(sidecarPath);
    const tools = loaded
      .filter((event) => event.kind === "tool.resolved")
      .map((event) => event.tool);
    assert.ok(
      tools.includes("main-maven"),
      "main-thread event must be in the file",
    );
    assert.ok(
      tools.includes("worker-maven"),
      "worker event must be in the file",
    );
  });

  it("stops persisting after closeLedger and tolerates repeated calls", () => {
    resetLedgerEvents();
    closeLedger();
    closeLedger();
    recordLedgerEvent(LEDGER_EVENT_KINDS.TOOL_RESOLVED, {
      ecosystem: "java",
      tool: "post-close-maven",
    });
    // Asserted by absence in the file rather than by line counts, so a
    // concurrent test appending to the shared sidecar cannot flip the result.
    assert.strictEqual(getLedgerEvents().length, 1);
    const content = fs.existsSync(sidecarPath)
      ? fs.readFileSync(sidecarPath, "utf8")
      : "";
    assert.ok(
      !content.includes("post-close-maven"),
      "no event may reach the sidecar after closeLedger",
    );
  });

  it("stays disabled unless opted in", () => {
    const disabled = runProbe("single");
    assert.strictEqual(disabled.ledgerEnabled, false);
    assert.strictEqual(disabled.returnedKind, null);
    assert.strictEqual(disabled.events.length, 0);

    const explicitOff = runProbe("single", { introspect: "0" });
    assert.strictEqual(explicitOff.ledgerEnabled, false);
    assert.strictEqual(explicitOff.events.length, 0);
  });

  it("enables recording through CDXGEN_INTROSPECT", () => {
    const result = runProbe("two-events", { introspect: "true" });
    assert.strictEqual(result.ledgerEnabled, true);
    assert.strictEqual(result.events.length, 2);
    const [expected, missing] = result.events;
    assert.strictEqual(expected.kind, "tool.expected");
    assert.strictEqual(expected.ecosystem, "java");
    assert.strictEqual(expected.wanted, "3.9");
    assert.strictEqual(missing.kind, "tool.missing");
    assert.strictEqual(missing.ecosystem, "python");
    assert.ok(!Number.isNaN(Date.parse(missing.timestamp)));
  });

  it("enables recording through CDXGEN_INTROSPECT_LEDGER alone and appends JSONL", () => {
    const probeSidecar = path.join(testDir, "probe-sidecar.jsonl");
    const result = runProbe("two-events", { ledger: probeSidecar });
    assert.strictEqual(result.ledgerEnabled, true);
    const lines = readSidecarLines(probeSidecar);
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].kind, "tool.expected");
    assert.strictEqual(lines[1].kind, "tool.missing");
  });

  it("caps the in-memory buffer and records one truncation marker while the sidecar stays complete", () => {
    const truncationSidecar = path.join(testDir, "truncation.jsonl");
    const result = runProbe("truncation", {
      introspect: "true",
      ledger: truncationSidecar,
      maxEvents: "10",
    });
    assert.strictEqual(result.ledgerEnabled, true);
    const events = result.events;
    assert.strictEqual(events.length, 10);
    assert.strictEqual(events[0].detail, "event 1");
    assert.strictEqual(events[4].detail, "event 5");
    assert.strictEqual(events[5].kind, "evidence.degraded");
    assert.strictEqual(events[5].ecosystem, "cdxgen");
    assert.ok(events[5].detail.includes("cap of 10"));
    // The marker occupies one tail slot, so the most recent events share the
    // remaining capacity: first half + marker + last (cap - half - 1).
    assert.strictEqual(events[6].detail, "event 17");
    assert.strictEqual(events[9].detail, "event 20");
    // The sidecar keeps the complete record: twenty events plus the marker.
    const lines = readSidecarLines(truncationSidecar);
    assert.strictEqual(lines.length, 21);
    assert.strictEqual(lines[10].kind, "evidence.degraded");
    assert.strictEqual(lines[20].detail, "event 20");
  });
});
