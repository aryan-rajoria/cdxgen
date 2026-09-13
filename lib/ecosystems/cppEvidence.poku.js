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

describe("getCppModules vcpkg manifest enrichment", () => {
  it("records the builtin baseline and per-port features", () => {
    const projectDir = join(baseTempDir, "vcpkg-baseline");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "vcpkg.json"),
      JSON.stringify({
        name: "vcpkg-baseline-smoke",
        version: "1.0.0",
        "builtin-baseline": "abc123def4567890abc123def4567890abc123d4",
        dependencies: ["fmt", { name: "curl", features: ["ssl", "http2"] }],
      }),
      { encoding: "utf-8" },
    );
    const result = getCppModules(projectDir, {}, [], []);
    assert.strictEqual(
      result.parentComponent.properties.find(
        (p) => p.name === "cdx:vcpkg:baseline",
      ).value,
      "abc123def4567890abc123def4567890abc123d4",
    );
    const curl = result.pkgList.find((p) => p.name === "curl");
    assert.ok(curl, "expected a component for curl");
    assert.strictEqual(
      curl.properties.find((p) => p.name === "cdx:vcpkg:declared").value,
      "true",
    );
    assert.strictEqual(
      curl.properties.find((p) => p.name === "cdx:vcpkg:features").value,
      "ssl,http2",
    );
    const fmt = result.pkgList.find((p) => p.name === "fmt");
    assert.ok(
      !fmt.properties.some((p) => p.name === "cdx:vcpkg:features"),
      "plain ports carry no features property",
    );
  });

  it("reads xmake-requires.lock as an additional evidence source", () => {
    const projectDir = join(baseTempDir, "xmake-lock");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "xmake-requires.lock"),
      [
        "{",
        '    __meta__ = { version = "1.0" },',
        '    ["linux|x86_64"] = {',
        '        ["zlib#31fecfc4"] = {',
        '            version = "1.3.1"',
        "        }",
        "    }",
        "}",
        "",
      ].join("\n"),
      { encoding: "utf-8" },
    );
    const result = getCppModules(projectDir, {}, [], []);
    const zlib = result.pkgList.find((p) => p.name === "zlib");
    assert.ok(zlib, "expected a component for zlib");
    assert.strictEqual(zlib.version, "1.3.1");
    assert.strictEqual(zlib.purl, "pkg:generic/xmake/zlib@1.3.1");
  });
});
