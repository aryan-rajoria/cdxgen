import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { assert, describe, it } from "poku";

import {
  isElmProjectFile,
  parseElmProject,
  parseLegacyElmProject,
} from "./parsers-elm.js";

const NO_CACHE = { readMetadata: () => null, listVersions: () => [] };

describe("parseElmProject — application", () => {
  it("pins exact versions and separates direct, indirect, and test scopes", () => {
    const { pkgList, parentComponent, rootInputs } = parseElmProject(
      "./test/data/elm-smoke/elm.json",
      NO_CACHE,
    );
    assert.strictEqual(parentComponent.type, "application");
    assert.strictEqual(parentComponent.name, "elm-smoke");
    assert.strictEqual(
      parentComponent.properties.find((p) => p.name === "cdx:elm:elmVersion")
        .value,
      "0.19.1",
    );

    assert.strictEqual(pkgList.length, 14);

    const http = pkgList.find((p) => p.name === "http");
    assert.strictEqual(http.group, "elm");
    assert.strictEqual(http.version, "1.0.0");
    assert.strictEqual(http.purl, "pkg:generic/elm/http@1.0.0");
    assert.strictEqual(http.scope, "required");
    assert.strictEqual(
      http.properties.find((p) => p.name === "cdx:purl:proposedType").value,
      "elm",
    );
    assert.strictEqual(
      http.properties.find((p) => p.name === "cdx:elm:dependency").value,
      "direct",
    );

    // Namespaced author names keep the author in the group and the purl.
    const decodePipeline = pkgList.find(
      (p) => p.name === "elm-json-decode-pipeline",
    );
    assert.strictEqual(decodePipeline.group, "NoRedInk");
    assert.strictEqual(
      decodePipeline.purl,
      "pkg:generic/NoRedInk/elm-json-decode-pipeline@1.0.0",
    );

    const parser = pkgList.find((p) => p.name === "parser");
    assert.strictEqual(
      parser.properties.find((p) => p.name === "cdx:elm:dependency").value,
      "indirect",
    );

    // Test dependencies are optional and carry their own origin labels.
    const test = pkgList.find((p) => p.name === "test");
    assert.strictEqual(test.scope, "optional");
    assert.strictEqual(
      test.properties.find((p) => p.name === "cdx:elm:dependency").value,
      "direct-test",
    );
    const random = pkgList.find((p) => p.name === "random");
    assert.strictEqual(random.scope, "optional");
    assert.strictEqual(
      random.properties.find((p) => p.name === "cdx:elm:dependency").value,
      "indirect-test",
    );

    // The root links the declared set: direct plus test-direct.
    assert.strictEqual(rootInputs.length, 11);
  });
});

describe("parseElmProject — package", () => {
  it("carries the package identity and keeps declared ranges without a cache", () => {
    const { pkgList, parentComponent, rootInputs } = parseElmProject(
      "./test/data/elm-package-smoke/elm.json",
      NO_CACHE,
    );
    assert.strictEqual(parentComponent.group, "elm");
    assert.strictEqual(parentComponent.name, "http");
    assert.strictEqual(parentComponent.version, "2.0.0");
    assert.strictEqual(parentComponent.license, "BSD-3-Clause");
    assert.strictEqual(parentComponent.description, "Make HTTP requests");
    assert.strictEqual(
      parentComponent.properties.find((p) => p.name === "cdx:elm:elmVersion")
        .value,
      "0.19.0 <= v < 0.20.0",
    );

    assert.strictEqual(pkgList.length, 4);
    const bytes = pkgList.find((p) => p.name === "bytes");
    assert.strictEqual(bytes.version, undefined);
    assert.strictEqual(bytes.purl, "pkg:generic/elm/bytes");
    assert.strictEqual(
      bytes.properties.find((p) => p.name === "cdx:elm:versionRange").value,
      "1.0.0 <= v < 2.0.0",
    );
    assert.strictEqual(rootInputs.length, 4);
  });

  it("resolves the newest cached version inside the declared range", () => {
    const cache = {
      readMetadata: () => ({
        license: "BSD-3-Clause",
        summary: "Elm bytes",
      }),
      listVersions: (name) => (name === "elm/bytes" ? ["1.0.0", "1.5.0"] : []),
    };
    const { pkgList } = parseElmProject(
      "./test/data/elm-package-smoke/elm.json",
      cache,
    );
    const bytes = pkgList.find((p) => p.name === "bytes");
    assert.strictEqual(bytes.version, "1.5.0");
    assert.strictEqual(bytes.license, "BSD-3-Clause");
    assert.strictEqual(bytes.description, "Elm bytes");
    // The declared constraint stays visible next to the resolved version.
    assert.strictEqual(
      bytes.properties.find((p) => p.name === "cdx:elm:versionRange").value,
      "1.0.0 <= v < 2.0.0",
    );
  });

  it("ignores cached versions outside the declared range", () => {
    const cache = {
      readMetadata: () => null,
      listVersions: (name) => (name === "elm/bytes" ? ["2.0.0"] : []),
    };
    const { pkgList } = parseElmProject(
      "./test/data/elm-package-smoke/elm.json",
      cache,
    );
    const bytes = pkgList.find((p) => p.name === "bytes");
    assert.strictEqual(bytes.version, undefined);
  });
});

describe("parseElmProject — enrichment from ELM_HOME", () => {
  it("reads license and summary from the compiler cache layout", () => {
    const home = mkdtempSync(join(tmpdir(), "elm-home-"));
    const previous = process.env.ELM_HOME;
    process.env.ELM_HOME = home;
    try {
      const pkgDir = join(home, "0.19.1", "packages", "elm", "http", "1.0.0");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "elm.json"),
        JSON.stringify({
          type: "package",
          name: "elm/http",
          summary: "Make HTTP requests",
          license: "BSD-3-Clause",
          version: "1.0.0",
        }),
      );
      const { pkgList } = parseElmProject("./test/data/elm-smoke/elm.json");
      const http = pkgList.find((p) => p.name === "http");
      assert.strictEqual(http.license, "BSD-3-Clause");
      assert.strictEqual(http.description, "Make HTTP requests");
    } finally {
      if (previous === undefined) {
        delete process.env.ELM_HOME;
      } else {
        process.env.ELM_HOME = previous;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("parseLegacyElmProject — 0.18", () => {
  it("prefers the exact-dependencies lock and marks undeclared packages indirect", () => {
    const { pkgList, parentComponent, rootInputs } = parseLegacyElmProject(
      "./test/data/elm-smoke-18/elm-package.json",
      "./test/data/elm-smoke-18/elm-stuff/exact-dependencies.json",
    );
    assert.strictEqual(parentComponent.name, "elm-smoke-18");
    assert.strictEqual(parentComponent.version, "1.0.0");
    assert.strictEqual(
      parentComponent.properties.find((p) => p.name === "cdx:elm:elmVersion")
        .value,
      "0.18.0 <= v < 0.19.0",
    );

    assert.strictEqual(pkgList.length, 4);
    const core = pkgList.find((p) => p.name === "core");
    assert.strictEqual(core.group, "elm-lang");
    assert.strictEqual(core.version, "5.1.1");
    assert.strictEqual(core.purl, "pkg:generic/elm-lang/core@5.1.1");
    // The lock contains elm-lang/virtual-dom, which the manifest never
    // declared: it is transitive.
    const virtualDom = pkgList.find((p) => p.name === "virtual-dom");
    assert.strictEqual(
      virtualDom.properties.find((p) => p.name === "cdx:elm:dependency").value,
      "indirect",
    );
    assert.strictEqual(rootInputs.length, 3);
  });

  it("falls back to declared ranges without a lock", () => {
    const { pkgList, rootInputs } = parseLegacyElmProject(
      "./test/data/elm-smoke-18/elm-package.json",
      undefined,
    );
    assert.strictEqual(pkgList.length, 3);
    const core = pkgList.find((p) => p.name === "core");
    assert.strictEqual(core.version, undefined);
    assert.strictEqual(
      core.properties.find((p) => p.name === "cdx:elm:versionRange").value,
      "5.0.0 <= v < 6.0.0",
    );
    assert.strictEqual(rootInputs.length, 3);
  });
});

describe("isElmProjectFile", () => {
  it("recognises elm manifests and rejects unrelated JSON", () => {
    assert.strictEqual(
      isElmProjectFile("./test/data/elm-smoke/elm.json"),
      true,
    );
    assert.strictEqual(
      isElmProjectFile("./test/data/elm-package-smoke/elm.json"),
      true,
    );
    assert.strictEqual(isElmProjectFile("./package.json"), false);
  });
});

describe("malformed names", () => {
  it("emits the component without a namespace or cache lookup", () => {
    const cache = {
      readMetadata: () => {
        throw new Error("must not be called");
      },
      listVersions: () => {
        throw new Error("must not be called");
      },
    };
    const dir = mkdtempSync(join(tmpdir(), "elm-bad-"));
    try {
      const manifest = join(dir, "elm.json");
      writeFileSync(
        manifest,
        JSON.stringify({
          type: "application",
          "elm-version": "0.19.1",
          dependencies: {
            direct: { "../escape": "1.0.0", plain: "1.0.0" },
            indirect: {},
          },
          "test-dependencies": { direct: {}, indirect: {} },
        }),
      );
      const { pkgList } = parseElmProject(manifest, cache);
      const traversal = pkgList.find((p) => p.name === "../escape");
      assert.ok(traversal, "the component is still emitted");
      assert.strictEqual(traversal.group, undefined);
      // cdx-purl percent-encodes names that are not clean segments; the
      // traversal-shaped name never reaches a filesystem path either way.
      assert.strictEqual(traversal.purl, "pkg:generic/..%2Fescape@1.0.0");
      const plain = pkgList.find((p) => p.name === "plain");
      assert.strictEqual(plain.group, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
