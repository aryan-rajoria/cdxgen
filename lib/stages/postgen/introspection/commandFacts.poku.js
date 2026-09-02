/**
 * Tests for the command-facts collector: wrapper presence and executability,
 * Python manager detection including the ambiguous two-manager case, and the
 * npm client facts. The Windows wrapper facts are asserted with a forced
 * platform because the matrix is Linux containers only.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, describe, it } from "poku";

import { clearCommandFactsCache, collectCommandFacts } from "./commandFacts.js";

let scratchDir;

/**
 * Create a scratch project directory with the named files and optional
 * POSIX modes.
 *
 * @param {Record<string, number|string|object>} files File name to content, or a mode number alongside string content.
 * @returns {string} The directory created.
 */
function projectWith(files) {
  scratchDir = mkdtempSync(join(tmpdir(), "cdxgen-command-facts-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(scratchDir, name);
    if (typeof content === "number") {
      continue;
    }
    const body =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
    writeFileSync(filePath, body);
    const mode = files[`${name}:mode`];
    if (typeof mode === "number") {
      chmodSync(filePath, mode);
    }
  }
  return scratchDir;
}

afterEach(() => {
  clearCommandFactsCache();
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("collectCommandFacts()", () => {
  it("returns inert facts for a missing project root", () => {
    const facts = collectCommandFacts(join(tmpdir(), "cdxgen-facts-missing"));
    assert.deepEqual(facts.wrappers, {});
    assert.equal(facts.pythonManager, undefined);
    assert.deepEqual(facts.pythonManagerCandidates, []);
    assert.equal(facts.npmClient, "npm");
  });

  it("sees an executable wrapper and an inexecutable one", () => {
    const dir = projectWith({
      mvnw: "#!/bin/sh\n",
      "mvnw:mode": 0o755,
      gradlew: "#!/bin/sh\n",
      "gradlew:mode": 0o644,
    });
    const facts = collectCommandFacts(dir, { platform: "posix" });
    assert.equal(facts.wrappers.mvnw, true);
    assert.equal(facts.wrappers.mvnwInexecutable, undefined);
    assert.equal(facts.wrappers.gradlew, undefined);
    assert.equal(facts.wrappers.gradlewInexecutable, true);
  });

  it("sees the Windows wrapper batches under a forced platform", () => {
    const dir = projectWith({
      "mvnw.cmd": "@echo off\r\n",
      "gradlew.bat": "@echo off\r\n",
    });
    const facts = collectCommandFacts(dir, { platform: "windows" });
    assert.equal(facts.wrappers.mvnwCmd, true);
    assert.equal(facts.wrappers.gradlewBat, true);
    assert.equal(facts.platform, "windows");
  });

  it("sees an executable composer.phar as the composer wrapper", () => {
    const dir = projectWith({
      "composer.phar": "#!/usr/bin/env php\n",
      "composer.phar:mode": 0o755,
    });
    const facts = collectCommandFacts(dir, { platform: "posix" });
    assert.equal(facts.wrappers.composerPhar, true);
  });

  it("detects each Python manager by its lock file", () => {
    const uvDir = projectWith({ "uv.lock": "" });
    assert.equal(collectCommandFacts(uvDir).pythonManager, "uv");

    const pdmDir = projectWith({ "pdm.lock": "" });
    assert.equal(collectCommandFacts(pdmDir).pythonManager, "pdm");

    const pipenvDir = projectWith({ "Pipfile.lock": "{}" });
    assert.equal(collectCommandFacts(pipenvDir).pythonManager, "pipenv");
  });

  it("detects poetry only with the lock file and the [tool.poetry] section", () => {
    const confirmed = projectWith({
      "poetry.lock": "",
      "pyproject.toml": '[tool.poetry]\nname = "x"\n',
    });
    assert.equal(collectCommandFacts(confirmed).pythonManager, "poetry");

    const strayLock = projectWith({
      "poetry.lock": "",
      "pyproject.toml": '[project]\nname = "x"\n',
    });
    assert.equal(collectCommandFacts(strayLock).pythonManager, undefined);
    assert.deepEqual(
      collectCommandFacts(strayLock).pythonManagerCandidates,
      [],
    );
  });

  it("settles two competing managers by the declared build backend", () => {
    const settled = projectWith({
      "uv.lock": "",
      "poetry.lock": "",
      "pyproject.toml":
        '[tool.poetry]\n[build-system]\nrequires = ["poetry-core"]\nbuild-backend = "poetry.core.masonry.api"\n',
    });
    const facts = collectCommandFacts(settled);
    assert.equal(facts.pythonManager, "poetry");
    assert.deepEqual(facts.pythonManagerCandidates, ["poetry", "uv"]);
  });

  it("leaves two competing managers unresolved when no backend answers", () => {
    const open = projectWith({
      "uv.lock": "",
      "poetry.lock": "",
      "pyproject.toml": "[tool.poetry]\n",
    });
    const facts = collectCommandFacts(open);
    assert.equal(facts.pythonManager, undefined);
    assert.deepEqual(facts.pythonManagerCandidates, ["poetry", "uv"]);
  });

  it("reads the npm client from the packageManager field first", () => {
    const dir = projectWith({
      "package.json": { name: "x", packageManager: "pnpm@9.1.0" },
    });
    assert.equal(collectCommandFacts(dir).npmClient, "pnpm");
  });

  it("reads the npm client from the lock file present", () => {
    const yarnDir = projectWith({ "yarn.lock": "" });
    assert.equal(collectCommandFacts(yarnDir).npmClient, "yarn");
    const npmDir = projectWith({ "package-lock.json": "{}" });
    assert.equal(collectCommandFacts(npmDir).npmClient, "npm");
  });

  it("caches the facts per project root", () => {
    const dir = projectWith({ "uv.lock": "" });
    const first = collectCommandFacts(dir);
    rmSync(join(dir, "uv.lock"));
    const second = collectCommandFacts(dir);
    assert.deepEqual(first, second);
    assert.equal(second.pythonManager, "uv");
    clearCommandFactsCache();
    const third = collectCommandFacts(dir);
    assert.equal(third.pythonManager, undefined);
  });
});
