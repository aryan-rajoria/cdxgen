import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import esmock from "esmock";
import { assert, it, skip } from "poku";

import { isWin } from "../managers/docker.js";
import {
  collectDotnetInfo,
  collectGccInfo,
  collectGoInfo,
  collectJavaInfo,
  collectNodeInfo,
  collectPythonInfo,
  collectRustInfo,
  collectSwiftInfo,
  getBranch,
  getNvmToolDirectory,
  getOrInstallNvmTool,
  getOriginUrl,
  isNvmAvailable,
  isSdkmanAvailable,
  isSdkmanToolAvailable,
  listFiles,
} from "./envcontext.js";

skip("Skipping envcontext tests due to old logic");

const isDarwin = process.platform === "darwin";

it("git tests", () => {
  assert.ok(getBranch());
  assert.ok(getOriginUrl());
  const files = listFiles();
  assert.ok(files.length > 10);
});

it("tools tests", () => {
  assert.ok(collectDotnetInfo());
  assert.ok(collectPythonInfo());
  assert.ok(collectNodeInfo());
  assert.ok(collectGccInfo());
  assert.ok(collectRustInfo());
  if (!isWin) {
    assert.ok(collectSwiftInfo());
    assert.ok(collectJavaInfo());
  }
  if (!isDarwin) {
    assert.ok(collectGoInfo());
  }
});

it("sdkman tests", () => {
  if (process.env?.SDKMAN_VERSION) {
    assert.deepStrictEqual(isSdkmanAvailable(), true);
    assert.deepStrictEqual(isSdkmanToolAvailable("java", "23.0.2-tem"), true);
    // Version identifiers are directory names; absent versions must report
    // unavailable without touching the network.
    assert.deepStrictEqual(
      isSdkmanToolAvailable("maven", "0.0.0-not-installed"),
      false,
    );
  }
});

it("installSdkmanTool rejects unsafe version tokens before spawning", async () => {
  const spawnCalls = [];
  const { installSdkmanTool: installWithMock } = await esmock(
    "./envcontext.js",
    {},
    {
      "../core/fs.js": {
        MAX_BUFFER: 104857600,
        getTmpDir: () => tmpdir(),
        safeExistsSync: () => false,
        safeSpawnSync: (...args) => {
          spawnCalls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    },
  );
  for (const unsafeVersion of [
    "3.9.9;rm -rf",
    "$(whoami)",
    "9.9\nrm",
    "3.9.9`id`",
    "",
  ]) {
    assert.deepStrictEqual(
      installWithMock("maven", unsafeVersion),
      false,
      `${unsafeVersion} must be rejected`,
    );
  }
  assert.ok(
    spawnCalls.length === 0,
    "no shell command may run for unsafe version tokens",
  );
});

it("installSdkmanTool passes validated versions to sdk install", async () => {
  const spawnCalls = [];
  const candidatesDir = mkdtempSync(join(tmpdir(), "cdxgen-sdkman-test-"));
  const previousCandidatesDir = process.env.SDKMAN_CANDIDATES_DIR;
  process.env.SDKMAN_CANDIDATES_DIR = candidatesDir;
  try {
    const { installSdkmanTool: installWithMock } = await esmock(
      "./envcontext.js",
      {},
      {
        "../core/fs.js": {
          MAX_BUFFER: 104857600,
          getTmpDir: () => tmpdir(),
          safeExistsSync: () => false,
          safeSpawnSync: (...args) => {
            spawnCalls.push(args);
            return { status: 0, stdout: "", stderr: "" };
          },
        },
      },
    );
    if (!isWin) {
      assert.deepStrictEqual(installWithMock("maven", "3.9.9"), true);
      const shellCommand = `${spawnCalls[0][1].join(" ")}`;
      assert.ok(
        shellCommand.includes("sdk install maven 3.9.9"),
        `expected sdk install invocation, got: ${shellCommand}`,
      );
    }
  } finally {
    if (previousCandidatesDir === undefined) {
      delete process.env.SDKMAN_CANDIDATES_DIR;
    } else {
      process.env.SDKMAN_CANDIDATES_DIR = previousCandidatesDir;
    }
  }
});

it("nvm tests", () => {
  if (process.env?.NVM_DIR) {
    if (isNvmAvailable()) {
      // try to remove nodejs 14 before testing below
      const _removeNode14 = spawnSync(
        process.env.SHELL || "bash",
        ["-i", "-c", `"nvm uninstall 14"`],
        {
          encoding: "utf-8",
          shell: process.env.SHELL || true,
        },
      );

      // expected to be run in CircleCi, where node version is 22.8.0
      // as defined in our Dockerfile
      assert.ok(typeof getNvmToolDirectory(22) === "string");
      assert.deepStrictEqual(getNvmToolDirectory(14), false);

      // now we install nvm tool for a specific verison
      assert.ok(getOrInstallNvmTool(14));
      assert.ok(typeof getNvmToolDirectory(14) === "string");
    } else {
      // if this test is failing it would be due to an error in isNvmAvailable()
      assert.deepStrictEqual(getNvmToolDirectory(22), undefined);
      assert.deepStrictEqual(getOrInstallNvmTool(14), false);
    }
  }
});
