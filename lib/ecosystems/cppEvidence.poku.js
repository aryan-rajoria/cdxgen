import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it } from "poku";

import { getCppModules } from "./cppEvidence.js";

const baseTempDir = mkdtempSync(join(tmpdir(), "cdxgen-cppevidence-poku-"));

process.on("exit", () => {
  rmSync(baseTempDir, { recursive: true, force: true });
});

/**
 * Write a usages slice naming the given include paths and return the project
 * directory holding it.
 *
 * @param {string} subDirName Directory name under the temp root.
 * @param {Array<string>} includePaths Values for the slice `fullName` field.
 * @returns {{projectDir: string, slicesFile: string}}
 */
const createUsagesSlice = (subDirName, includePaths) => {
  const projectDir = join(baseTempDir, subDirName);
  const slicesFile = join(projectDir, "usages.slices.json");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    slicesFile,
    JSON.stringify({
      objectSlices: includePaths.map((fullName) => ({
        fileName: "src/main.c",
        fullName,
        code: `#include <${fullName}>`,
        usages: [],
      })),
    }),
    { encoding: "utf-8" },
  );
  return { projectDir, slicesFile };
};

const modulesFor = (subDirName, includePaths) => {
  const { projectDir, slicesFile } = createUsagesSlice(
    subDirName,
    includePaths,
  );
  return getCppModules(projectDir, { usagesSlicesFile: slicesFile }, [], [])
    .pkgList;
};

describe("getCppModules purl construction", async () => {
  await it("carries an absolute include as a relative purl subpath", async () => {
    const pkgList = modulesFor("absolute-include", ["/usr/include/zlib.h"]);
    const zlib = pkgList.find((p) => p.name === "zlib");
    assert.ok(zlib, "expected a component for zlib.h");
    assert.strictEqual(zlib.purl, "pkg:generic/zlib#usr/include/zlib.h");
  });

  await it("carries a drive-rooted include as a relative purl subpath", async () => {
    const pkgList = modulesFor("drive-rooted-include", [
      "C:\\vcpkg\\installed\\include\\png.h",
    ]);
    const png = pkgList.find((p) => p.name === "png");
    assert.ok(png, "expected a component for png.h");
    assert.strictEqual(
      png.purl,
      "pkg:generic/png#vcpkg/installed/include/png.h",
    );
  });

  await it("keeps the directory of a relative include as the namespace", async () => {
    const pkgList = modulesFor("relative-include", ["vendor/lib/mylib.h"]);
    const mylib = pkgList.find((p) => p.name === "mylib");
    assert.ok(mylib, "expected a component for mylib.h");
    assert.strictEqual(
      mylib.purl,
      "pkg:generic/vendor/lib/mylib#vendor/lib/mylib.h",
    );
  });
});
