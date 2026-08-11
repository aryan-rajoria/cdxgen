import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { assert, it } from "poku";

import { getAllFiles, safeSpawnSync } from "../ecosystems/utils.js";
import { clearFileDiscoveryCache, setDirWalkCacheRoot } from "./fs.js";

it("safeSpawnSync() resets ANSI color state for host pip warnings", () => {
  const originalConsoleWarn = console.warn;
  const originalContainer = process.env.CDXGEN_IN_CONTAINER;
  const originalNoticeCache = globalThis.__cdxgenNoticeCache;
  const warnings = [];
  delete process.env.CDXGEN_IN_CONTAINER;
  delete globalThis.__cdxgenNoticeCache;
  console.warn = (message) => {
    warnings.push(message);
  };

  try {
    safeSpawnSync("pip-cdxgen-test", ["install"], {});
    assert.strictEqual(warnings.length, 1);
    assert.ok(
      warnings[0].startsWith(
        "\x1b[1;35mNotice: pip/uv install invoked without '--only-binary'.",
      ),
    );
    assert.ok(warnings[0].endsWith("\x1b[0m"));
    assert.ok(!warnings[0].endsWith("\x1b"));
  } finally {
    console.warn = originalConsoleWarn;
    if (originalContainer === undefined) {
      delete process.env.CDXGEN_IN_CONTAINER;
    } else {
      process.env.CDXGEN_IN_CONTAINER = originalContainer;
    }
    if (originalNoticeCache === undefined) {
      delete globalThis.__cdxgenNoticeCache;
    } else {
      globalThis.__cdxgenNoticeCache = originalNoticeCache;
    }
  }
});

it("handles noIgnore option and ignores docs removal", () => {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "cdxgen-no-ignore-test-"));
  const docsDir = path.join(tmpRoot, "docs");
  const nodeModulesDir = path.join(tmpRoot, "node_modules");
  const gitDir = path.join(tmpRoot, ".git");

  mkdirSync(docsDir, { recursive: true });
  mkdirSync(nodeModulesDir, { recursive: true });
  mkdirSync(gitDir, { recursive: true });

  const testFileDocs = path.join(docsDir, "test.txt");
  const testFileNodeModules = path.join(nodeModulesDir, "test.txt");
  const testFileGit = path.join(gitDir, "test.txt");
  const testFileRoot = path.join(tmpRoot, "test.txt");

  writeFileSync(testFileDocs, "docs content");
  writeFileSync(testFileNodeModules, "node_modules content");
  writeFileSync(testFileGit, "git content");
  writeFileSync(testFileRoot, "root content");

  try {
    // 1. By default, docs is NOT ignored anymore because the block was removed.
    // However, .git and node_modules are ignored by default.
    const defaultFiles = getAllFiles(tmpRoot, "**/*.txt");
    assert.ok(defaultFiles.includes(testFileRoot));
    assert.ok(defaultFiles.includes(testFileDocs));
    assert.ok(!defaultFiles.includes(testFileNodeModules));
    assert.ok(!defaultFiles.includes(testFileGit));

    // 2. With noIgnore: true, node_modules and .git are also NOT ignored.
    const allFiles = getAllFiles(tmpRoot, "**/*.txt", { noIgnore: true });
    assert.ok(allFiles.includes(testFileRoot));
    assert.ok(allFiles.includes(testFileDocs));
    assert.ok(allFiles.includes(testFileNodeModules));
    assert.ok(allFiles.includes(testFileGit));
  } finally {
    rmSync(tmpRoot, { force: true, recursive: true });
  }
});

it("safeSpawnSync() logs container python notices to stdout", () => {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalContainer = process.env.CDXGEN_IN_CONTAINER;
  const originalNoticeCache = globalThis.__cdxgenNoticeCache;
  const logs = [];
  const warnings = [];
  process.env.CDXGEN_IN_CONTAINER = "true";
  delete globalThis.__cdxgenNoticeCache;
  console.log = (message) => {
    logs.push(message);
  };
  console.warn = (message) => {
    warnings.push(message);
  };

  try {
    safeSpawnSync("python-cdxgen-test", ["-c", "pass"], {});
    safeSpawnSync("python-cdxgen-test", ["-c", "pass"], {});
    assert.strictEqual(logs.length + warnings.length, 1);
    assert.ok(
      [...logs, ...warnings].some((message) =>
        message.includes("Running python command without '-S' argument."),
      ),
    );
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    if (originalContainer === undefined) {
      delete process.env.CDXGEN_IN_CONTAINER;
    } else {
      process.env.CDXGEN_IN_CONTAINER = originalContainer;
    }
    if (originalNoticeCache === undefined) {
      delete globalThis.__cdxgenNoticeCache;
    } else {
      globalThis.__cdxgenNoticeCache = originalNoticeCache;
    }
  }
});

it("shares one directory walk only inside the registered cache root", () => {
  const cacheRoot = mkdtempSync(path.join(tmpdir(), "cdxgen-walk-cached-"));
  const uncachedRoot = mkdtempSync(path.join(tmpdir(), "cdxgen-walk-plain-"));
  try {
    for (const root of [cacheRoot, uncachedRoot]) {
      writeFileSync(path.join(root, "package.json"), "{}");
    }
    setDirWalkCacheRoot(cacheRoot);
    // Both roots are walked once, so each has an entry to serve or to miss.
    assert.deepStrictEqual(getAllFiles(cacheRoot, "**/package.json"), [
      path.join(cacheRoot, "package.json"),
    ]);
    assert.deepStrictEqual(getAllFiles(uncachedRoot, "**/package.json"), [
      path.join(uncachedRoot, "package.json"),
    ]);
    // A build tool writing a manifest part way through a scan is why caching is
    // confined: outside the root the new file has to be found.
    for (const root of [cacheRoot, uncachedRoot]) {
      mkdirSync(path.join(root, "nested"), { recursive: true });
      writeFileSync(path.join(root, "nested", "package.json"), "{}");
    }
    assert.strictEqual(
      getAllFiles(uncachedRoot, "**/package.json").length,
      2,
      "a path outside the cache root must reflect files written during the scan",
    );
    assert.strictEqual(
      getAllFiles(cacheRoot, "**/package.json").length,
      1,
      "a path inside the cache root is served from the walk taken earlier",
    );
    // Leaving the root behind releases the retained entries.
    setDirWalkCacheRoot(undefined);
    assert.strictEqual(getAllFiles(cacheRoot, "**/package.json").length, 2);
  } finally {
    setDirWalkCacheRoot(undefined);
    clearFileDiscoveryCache();
    rmSync(cacheRoot, { force: true, recursive: true });
    rmSync(uncachedRoot, { force: true, recursive: true });
  }
});
