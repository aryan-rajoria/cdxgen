import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test } from "poku";

import {
  buildDependentPurl,
  parseGitcloneScript,
  parseSubmoduleStatusLine,
  readFetchContentGitclone,
} from "./cmakeResolver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "test", "data", "cmake-cache");

describe("parseGitcloneScript", () => {
  test("extracts URL and GIT_TAG from the tinyjson gitclone script", () => {
    const text = readFileSync(
      join(FIXTURES, "fetchcontent", "tinyjson-populate-gitclone.cmake"),
      "utf-8",
    );
    const result = parseGitcloneScript(text);
    assert.strictEqual(
      result.url,
      "https://github.com/elementalcow/tinyjson.git",
    );
    assert.strictEqual(result.tag, "v3.11.3");
  });

  test("returns nulls for empty input", () => {
    assert.deepStrictEqual(parseGitcloneScript(""), {
      url: null,
      tag: null,
    });
  });
});

describe("parseSubmoduleStatusLine", () => {
  test("parses an uninitialised submodule (- prefix, no describe)", () => {
    const result = parseSubmoduleStatusLine(
      "-1a54956777ba672764db09a51960056ea042af7e third_party/benchmark",
    );
    assert.strictEqual(result.prefix, "-");
    assert.strictEqual(result.sha, "1a54956777ba672764db09a51960056ea042af7e");
    assert.strictEqual(result.path, "third_party/benchmark");
    assert.strictEqual(result.describe, null);
  });

  test("parses an initialised submodule with a describe tag", () => {
    const result = parseSubmoduleStatusLine(" abc123def path/to/sub (v1.2.3)");
    assert.strictEqual(result.prefix, " ");
    assert.strictEqual(result.sha, "abc123def");
    assert.strictEqual(result.describe, "v1.2.3");
  });

  test("parses a status line whose leading-space prefix was trimmed", () => {
    const result = parseSubmoduleStatusLine(
      "bf585a2789e30585b4e3ce6baf11ef2750b54677 third_party/benchmark (v1.5.2-14-gbf585a2)",
    );
    assert.strictEqual(result.prefix, " ");
    assert.strictEqual(result.sha, "bf585a2789e30585b4e3ce6baf11ef2750b54677");
    assert.strictEqual(result.describe, "v1.5.2-14-gbf585a2");
  });

  test("returns null for empty/invalid input", () => {
    assert.strictEqual(parseSubmoduleStatusLine(""), null);
    assert.strictEqual(parseSubmoduleStatusLine(null), null);
  });
});

describe("readFetchContentGitclone path safety", () => {
  test("refuses a dep name that would escape the build directory", () => {
    for (const depName of [
      "../evil",
      "..",
      "a/../../b",
      "a\\b",
      "sub/dir",
      "",
      null,
    ]) {
      assert.deepStrictEqual(readFetchContentGitclone("/tmp/build", depName), {
        url: null,
        tag: null,
      });
    }
  });
});

describe("buildDependentPurl", () => {
  test("builds a github purl for a github URL", () => {
    const purl = buildDependentPurl(
      "https://github.com/google/benchmark.git",
      "1a54956777ba672764db09a51960056ea042af7e",
    );
    assert.ok(purl);
    assert.ok(purl.startsWith("pkg:github/google/benchmark@"));
    assert.ok(!purl.includes("${"));
    assert.ok(!purl.includes("%24%7B"));
  });

  test("returns null for an unparseable URL", () => {
    assert.strictEqual(buildDependentPurl("not-a-url", "1"), null);
  });
});
