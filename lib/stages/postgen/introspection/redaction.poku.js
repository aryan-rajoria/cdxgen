/**
 * The redaction acceptance gate for evidence passthrough: a failing build
 * command whose environment and output carry planted credentials, scanned
 * through the real CLI, with both written reports asserted free of every
 * planted literal.
 *
 * Raw tool output reaches the reports for the first time through the
 * evidence block, so this file is the deliverable's acceptance test rather
 * than a unit test: the leak paths it guards are the ledger's excerpt
 * storage, the JSON renderer and the markdown renderer, exercised end to
 * end. It spawns the CLI through whichever runtime executes it, so it runs
 * under node, deno and bun.
 */
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it } from "poku";

import {
  repoRoot,
  runIntrospectionScan,
} from "../../../../test/helpers/introspection-e2e.js";

const fixtures = join(repoRoot, "test", "repotests");

/**
 * Write a stand-in maven command that fails while echoing planted
 * credentials: one from its own environment, one on a reconstructed command
 * line, and one inside a registry URL. This is the leak shape raw tool
 * output arrives in.
 *
 * @param {string} dir Destination directory.
 * @returns {string} Path of the stand-in command.
 */
function writeLeakingMavenStub(dir) {
  const isWindows = process.platform === "win32";
  const stubPath = join(dir, isWindows ? "leaking-mvn.cmd" : "leaking-mvn.sh");
  if (isWindows) {
    writeFileSync(
      stubPath,
      "@echo off\r\necho [ERROR] x-registry-token: %PLANT_TOKEN%\r\necho [ERROR] mvn deploy --password e2e-plant-hunter2\r\necho [ERROR] denied: https://e2eplant:e2eplantsecret@registry.e2e.invalid/v1/\r\nexit /b 1\r\n",
    );
  } else {
    writeFileSync(
      stubPath,
      `#!/bin/sh
echo "[ERROR] x-registry-token: $PLANT_TOKEN" >&2
echo "[ERROR] mvn deploy --password e2e-plant-hunter2" >&2
echo "[ERROR] denied: https://e2eplant:e2eplantsecret@registry.e2e.invalid/v1/" >&2
exit 1
`,
    );
    chmodSync(stubPath, 0o755);
  }
  return stubPath;
}

describe("evidence redaction — the acceptance gate", () => {
  const PLANT_TOKEN = "e2e-plant-9f2c7d41ab03";
  const PLANTED_SECRETS = [
    PLANT_TOKEN,
    "e2e-plant-hunter2",
    "e2eplant:e2eplantsecret",
  ];

  /**
   * Scan a scratch copy of the maven fixture with the leaking maven command,
   * writing both reports to named paths so their raw bytes are assertable.
   *
   * @param {Object} [extraEnv] Additional environment for the run.
   * @returns {Promise<Object>} Run facts, report paths and the cleanup function.
   */
  const run = async (extraEnv = {}) => {
    const scratch = mkdtempSync(join(tmpdir(), "cdxgen-redaction-"));
    const projectDir = join(scratch, "project");
    cpSync(join(fixtures, "maven-smoke"), projectDir, { recursive: true });
    const output = join(scratch, "bom.json");
    const reportJsonPath = join(scratch, "introspection.json");
    const reportMdPath = join(scratch, "introspection.md");
    const result = await runIntrospectionScan({
      projectPath: projectDir,
      projectType: "java",
      output,
      reportJsonPath,
      reportMdPath,
      env: {
        MVN_CMD: writeLeakingMavenStub(scratch),
        PLANT_TOKEN,
        ...extraEnv,
      },
    });
    return {
      result,
      reportJsonPath,
      reportMdPath,
      cleanup: () => rmSync(scratch, { recursive: true, force: true }),
    };
  };

  it("the degraded maven run carries an evidence block with the real failure", async () => {
    const { result, cleanup } = await run();
    try {
      assert.equal(result.status, 0, result.stderr.slice(-600));
      const candidate = result.report.remediation[0];
      assert.equal(candidate.remediationId, "jvm.maven.manifest-fallback");
      const evidence = candidate.evidence;
      assert.ok(evidence, "the ranked remediation carries no evidence");
      assert.match(evidence.failedCommand, /mvn/);
      assert.equal(evidence.exitCode, 1);
      assert.match(evidence.outputExcerpt, /\[ERROR\]/);
    } finally {
      cleanup();
    }
  });

  it("the planted secrets appear nowhere in either report", async () => {
    const { result, reportJsonPath, reportMdPath, cleanup } = await run();
    try {
      assert.ok(result.report, "no json report was written");
      const jsonText = readFileSync(reportJsonPath, "utf-8");
      const markdownText = readFileSync(reportMdPath, "utf-8");
      for (const secret of PLANTED_SECRETS) {
        assert.equal(
          jsonText.includes(secret),
          false,
          `the json report leaked ${secret}`,
        );
        assert.equal(
          markdownText.includes(secret),
          false,
          `the markdown report leaked ${secret}`,
        );
      }
      // The evidence survives the redaction: a missing excerpt degrades one
      // entry, an empty one would hide the failure.
      assert.match(
        result.report.remediation[0].evidence.outputExcerpt,
        /\[ERROR\]/,
      );
    } finally {
      cleanup();
    }
  });

  it("CDXGEN_INTROSPECT_NO_OUTPUT suppresses the excerpt entirely", async () => {
    const { result, cleanup } = await run({
      CDXGEN_INTROSPECT_NO_OUTPUT: "true",
    });
    try {
      assert.equal(result.status, 0, result.stderr.slice(-600));
      const evidence = result.report.remediation[0].evidence;
      assert.ok(evidence, "the evidence block itself is kept");
      assert.equal(
        evidence.outputExcerpt,
        undefined,
        "the excerpt must be absent when the run opted out",
      );
      assert.equal(evidence.exitCode, 1);
    } finally {
      cleanup();
    }
  });
});
