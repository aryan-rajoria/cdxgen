import { createHash } from "node:crypto";

import { assert, describe, it } from "poku";

import { validateBom } from "../validator/bomValidator.js";
import {
  buildBomNSData,
  HASH_PATTERN,
  listComponents,
  processHashes,
} from "./bomAssembly.js";
import { getNpmPackFilePaths, getProp } from "./bomTestHelpers.poku.js";

describe("bomAssembly", () => {
  describe("hash normalization", () => {
    const hashesFor = (pkg) => {
      const component = { hashes: [] };
      processHashes(pkg, component);
      return component.hashes ?? [];
    };

    it("converts a base64 integrity to hex", () => {
      const digest = createHash("sha512").update("hello").digest("base64");
      const [hash] = hashesFor({ _integrity: `sha512-${digest}` });
      assert.strictEqual(hash.alg, "SHA-512");
      assert.strictEqual(
        hash.content,
        createHash("sha512").update("hello").digest("hex"),
      );
    });

    it("keeps a hex digest as is", () => {
      const digest = createHash("sha1").update("hello").digest("hex");
      const [hash] = hashesFor({ _shasum: digest });
      assert.strictEqual(hash.content, digest);
    });

    it("drops a digest that decodes to the wrong length", () => {
      // A truncated npm integrity: it decodes, but to 63 bytes rather than 64.
      // Copying it through produced a BOM that failed schema validation.
      const truncated =
        "QIqJf7A1NVCjzCIdA1M6A+0ify9J50nDxzX7QgJ0006AAXMon0AhQI9bQ6tcG4IHHD5woAH+KUnLMaAz9x9A==";
      assert.deepStrictEqual(
        hashesFor({ _integrity: `sha512-${truncated}` }),
        [],
      );
    });

    it("drops a hex digest whose length contradicts its algorithm", () => {
      assert.deepStrictEqual(
        hashesFor({ hashes: [{ alg: "SHA-512", content: "a".repeat(64) }] }),
        [],
      );
    });

    it("emits only spec-valid content for mixed input", () => {
      const good = createHash("sha256").update("hello").digest("base64");
      const hashes = hashesFor({
        hashes: [
          { alg: "SHA-256", content: good },
          { alg: "SHA-512", content: "not a digest" },
        ],
      });
      assert.strictEqual(hashes.length, 1);
      for (const hash of hashes) {
        assert.ok(
          new RegExp(HASH_PATTERN).test(hash.content),
          `${hash.content} must satisfy the CycloneDX hash pattern`,
        );
      }
    });
  });

  describe("component creation", () => {
    it("keeps a purl a file component set for itself", () => {
      // `file` is a NON_PURL_TYPES member so no maven purl is derived for it,
      // but a collector that already resolved a generic purl is taken at its
      // word — this is how unpackaged executables and unidentified archives
      // stay joinable.
      const [component] = listComponents(
        { specVersion: 1.7 },
        undefined,
        [
          {
            name: "mystery.jar",
            type: "file",
            purl: "pkg:generic/mystery.jar#opt/app/mystery.jar",
            "bom-ref": "pkg:generic/mystery.jar#opt/app/mystery.jar",
          },
        ],
        "maven",
      );
      assert.strictEqual(
        component.purl,
        "pkg:generic/mystery.jar#opt/app/mystery.jar",
      );
      assert.strictEqual(
        component["bom-ref"],
        "pkg:generic/mystery.jar#opt/app/mystery.jar",
      );
    });

    it("derives no purl for a file component that brought none", () => {
      const [component] = listComponents(
        { specVersion: 1.7 },
        undefined,
        [{ group: "com.example", name: "thing", version: "1.0", type: "file" }],
        "maven",
      );
      assert.strictEqual(component.purl, undefined);
    });

    it("keeps readable OBOM bom-refs when no package purl type is available", () => {
      const components = listComponents(
        { specVersion: 1.7 },
        undefined,
        [
          {
            "bom-ref":
              "osquery:authorized_keys_snapshot:data:root@ssh-ed25519[key_file=/root/.ssh/authorized_keys]",
            name: "root",
            properties: [
              {
                name: "cdx:osquery:category",
                value: "authorized_keys_snapshot",
              },
            ],
            type: "data",
            version: "ssh-ed25519",
          },
        ],
        "",
      );
      assert.strictEqual(components.length, 1);
      assert.strictEqual(components[0].purl, undefined);
      assert.strictEqual(
        components[0]["bom-ref"],
        "osquery:authorized_keys_snapshot:data:root@ssh-ed25519[key_file=/root/.ssh/authorized_keys]",
      );
      assert.strictEqual(components[0].type, "data");
    });

    it("marks npm packages required when analyzer command evidence matches package bin metadata", () => {
      const components = listComponents(
        { specVersion: 1.7 },
        {
          "cdx:npm:bin/license-report": new Set([
            {
              fileName: "package.json",
              importedAs: "cdx:npm:bin/license-report",
              importedModules: ["license-report"],
            },
          ]),
        },
        [
          {
            name: "license-report",
            version: "6.5.0",
            scope: "optional",
            properties: [
              {
                name: "cdx:npm:bin",
                value: "license-report",
              },
            ],
          },
          {
            name: "left-pad",
            version: "1.3.0",
            scope: "optional",
            properties: [],
          },
        ],
        "npm",
      );

      const licenseReport = components.find(
        (component) => component.name === "license-report",
      );
      const leftPad = components.find(
        (component) => component.name === "left-pad",
      );
      assert.strictEqual(licenseReport.scope, "required");
      assert.strictEqual(leftPad.scope, "optional");
    });

    it("keeps npm package required when bin-command evidence exists alongside type-only imports", () => {
      const components = listComponents(
        { specVersion: 1.7 },
        {
          "cdx:npm:bin/license-report": new Set([
            {
              fileName: "package.json",
              importedAs: "cdx:npm:bin/license-report",
              importedModules: ["license-report"],
            },
          ]),
          "license-report": new Set([
            {
              importedAs: "license-report",
              importedModules: ["license-report"],
              isTypeOnly: true,
            },
          ]),
        },
        [
          {
            name: "license-report",
            version: "6.5.0",
            scope: "optional",
            properties: [
              {
                name: "cdx:npm:bin",
                value: "license-report",
              },
            ],
          },
        ],
        "npm",
      );

      const licenseReport = components.find(
        (component) => component.name === "license-report",
      );
      assert.strictEqual(licenseReport.scope, "required");
      assert.strictEqual(
        getProp(licenseReport, "cdx:npm:package:type-only"),
        undefined,
      );
    });
  });

  describe("distribution filters", () => {
    it("keeps npm types while excluding poku tests from npm pack output", () => {
      const packedPaths = getNpmPackFilePaths();

      assert.ok(
        packedPaths.some((path) => path.startsWith("types/")),
        "expected npm pack output to keep generated type definitions",
      );
      assert.ok(
        packedPaths.every((path) => !path.endsWith(".poku.js")),
        "expected npm pack output to exclude co-located poku tests",
      );
      assert.ok(
        packedPaths.every((path) => !path.startsWith("test/")),
        "expected npm pack output to exclude test fixtures",
      );
    });
  });

  describe("parent component overrides", () => {
    const detected = {
      "bom-ref": "application:myproject:1.0.0",
      name: "myproject",
      type: "application",
      version: "1.0.0",
    };
    const child = {
      "bom-ref": "pkg:generic/dep@1.0.0",
      name: "dep",
      purl: "pkg:generic/dep@1.0.0",
      type: "library",
      version: "1.0.0",
    };
    const context = () => ({
      parentComponent: { ...detected },
      dependencies: [
        { ref: detected["bom-ref"], dependsOn: [child["bom-ref"]] },
        { ref: child["bom-ref"], dependsOn: [] },
      ],
    });

    it("keeps the generator's own root when no override is given", () => {
      const { bomJson } = buildBomNSData(
        { specVersion: 1.7 },
        [child],
        "generic",
        context(),
      );
      assert.strictEqual(
        bomJson.metadata.component["bom-ref"],
        "application:myproject:1.0.0",
      );
      assert.deepStrictEqual(bomJson.dependencies, context().dependencies);
    });

    it("re-anchors the graph under a caller-supplied parent", () => {
      const { bomJson } = buildBomNSData(
        { specVersion: 1.7, projectName: "monorepo", projectVersion: "9.9.9" },
        [child],
        "generic",
        context(),
      );
      const rootRef = bomJson.metadata.component["bom-ref"];
      assert.strictEqual(rootRef, "pkg:application/monorepo@9.9.9");

      // The detected project is a real subproject, so it survives as a
      // component instead of the edges below it being orphaned.
      assert.ok(
        bomJson.components.some(
          (comp) => comp["bom-ref"] === "application:myproject:1.0.0",
        ),
      );
      assert.deepStrictEqual(
        bomJson.dependencies.find((dep) => dep.ref === rootRef),
        { ref: rootRef, dependsOn: ["application:myproject:1.0.0"] },
      );

      const known = new Set(bomJson.components.map((c) => c["bom-ref"]));
      known.add(rootRef);
      const dangling = bomJson.dependencies
        .flatMap((dep) => [dep.ref, ...dep.dependsOn])
        .filter((ref) => !known.has(ref));
      assert.deepStrictEqual(dangling, []);
    });

    it("leaves the caller's dependency array untouched", () => {
      const ctx = context();
      const before = JSON.parse(JSON.stringify(ctx.dependencies));
      buildBomNSData(
        { specVersion: 1.7, projectName: "monorepo", projectVersion: "9.9.9" },
        [child],
        "generic",
        ctx,
      );
      assert.deepStrictEqual(ctx.dependencies, before);
    });

    // Issue #4320: generators hand the detected parent over with transient
    // keys (`license`, `homepage`, `repository`, `evidence`, `_integrity`,
    // `qualifiers`) that only `metadata.component` used to be cleaned of.
    // Anchored as a regular component they fail schema validation.
    const licensedDetected = {
      ...detected,
      purl: "pkg:npm/myproject@1.0.0",
      "bom-ref": "pkg:npm/myproject@1.0.0",
      license: "Apache-2.0",
      homepage: { url: "https://example.com/myproject" },
      repository: { url: "git+https://github.com/example/myproject.git" },
      evidence: {
        identity: { field: "purl", confidence: 0.7, methods: [] },
      },
      _integrity:
        "sha512-mlYviEJVSQFSe2oNPPPUidoRv6Cb6iloaCLcdWOr7tPhBsfIw5TiS2o2WsXcXAUG9tTLO9cbLb5zcDzcVXc5w==",
      qualifiers: { arch: "x64" },
    };
    const licensedContext = () => ({
      parentComponent: { ...licensedDetected },
      dependencies: [
        {
          ref: licensedDetected["bom-ref"],
          dependsOn: [child["bom-ref"]],
        },
        { ref: child["bom-ref"], dependsOn: [] },
      ],
    });
    const overrideOptions = {
      specVersion: 1.6,
      projectName: "monorepo",
      projectVersion: "9.9.9",
    };

    it("cleans transient keys from the anchored subproject component", async () => {
      const { bomJson } = buildBomNSData(
        overrideOptions,
        [child],
        "npm",
        licensedContext(),
      );
      const anchored = bomJson.components.find(
        (comp) => comp["bom-ref"] === licensedDetected["bom-ref"],
      );
      assert.ok(anchored, "expected the detected parent to be anchored");
      for (const transientKey of [
        "license",
        "homepage",
        "repository",
        "evidence",
        "_integrity",
        "qualifiers",
      ]) {
        assert.strictEqual(
          anchored[transientKey],
          undefined,
          `anchored component must not carry '${transientKey}'`,
        );
      }
      assert.deepStrictEqual(anchored.licenses, [
        {
          license: {
            id: "Apache-2.0",
            url: "https://opensource.org/licenses/Apache-2.0",
          },
        },
      ]);
      assert.deepStrictEqual(
        (anchored.externalReferences || []).map((ref) => ref.type).sort(),
        ["vcs", "website"],
      );
      // The truncated fixture integrity decodes to 63 bytes, so it is
      // dropped rather than emitted as a corrupt digest.
      assert.strictEqual(anchored.hashes, undefined);
      assert.strictEqual(await validateBom(bomJson), true);
    });

    it("does not mutate the caller's detected parent object", () => {
      const ctx = licensedContext();
      const before = JSON.parse(JSON.stringify(ctx.parentComponent));
      buildBomNSData(overrideOptions, [child], "npm", ctx);
      assert.deepStrictEqual(ctx.parentComponent, before);
    });

    it("cleans the anchored component for an explicit options.parentComponent override", async () => {
      const explicitParent = {
        group: "",
        name: "shell",
        version: "3.2.1",
        type: "application",
        "bom-ref": "pkg:application/shell@3.2.1",
        purl: "pkg:application/shell@3.2.1",
      };
      const { bomJson } = buildBomNSData(
        { specVersion: 1.6, parentComponent: explicitParent },
        [child],
        "npm",
        licensedContext(),
      );
      assert.strictEqual(
        bomJson.metadata.component["bom-ref"],
        "pkg:application/shell@3.2.1",
      );
      const anchored = bomJson.components.find(
        (comp) => comp["bom-ref"] === licensedDetected["bom-ref"],
      );
      assert.ok(anchored, "expected the detected parent to be anchored");
      assert.strictEqual(anchored.license, undefined);
      assert.ok(anchored.licenses?.length);
      assert.strictEqual(await validateBom(bomJson), true);
    });

    // Issue #4326: workspace members nested under a detected parent carry the
    // same raw parser shape as the parent itself. Anchored without the
    // conversion `metadata.component` gets, they fail the strict Component
    // schema (`additionalProperties: false` on `homepage`/`repository`).
    const nestedDetected = {
      ...licensedDetected,
      components: [
        {
          group: "",
          name: "member",
          version: "1.2.3",
          purl: "pkg:cargo/member@1.2.3",
          "bom-ref": "pkg:cargo/member@1.2.3",
          type: "library",
          license: "MIT",
          homepage: { url: "https://example.com/member" },
          repository: { url: "https://github.com/example/member" },
          _integrity:
            "sha512-NDOSPBxcqSNHmT156HFVUjJJtSiofKkIJW+MIAXal6i3RWM8wC9l/dz+0vQUVX3btlAO3lfRs17rOHY2t9f9Gg==",
          properties: [
            { name: "internal:SrcFile", value: "crates/member/Cargo.toml" },
          ],
        },
      ],
    };
    const nestedContext = () => ({
      parentComponent: {
        ...nestedDetected,
        components: nestedDetected.components,
      },
      dependencies: [
        {
          ref: nestedDetected["bom-ref"],
          dependsOn: [nestedDetected.components[0]["bom-ref"]],
        },
      ],
    });

    it("converts nested workspace member components into schema-valid components", async () => {
      const { bomJson } = buildBomNSData(
        overrideOptions,
        [child],
        "npm",
        nestedContext(),
      );
      const anchored = bomJson.components.find(
        (comp) => comp["bom-ref"] === nestedDetected["bom-ref"],
      );
      assert.ok(anchored, "expected the detected parent to be anchored");
      const nested = anchored.components?.find(
        (comp) => comp["bom-ref"] === "pkg:cargo/member@1.2.3",
      );
      assert.ok(nested, "expected the nested member to survive anchoring");
      for (const transientKey of [
        "license",
        "homepage",
        "repository",
        "_integrity",
        "qualifiers",
      ]) {
        assert.strictEqual(
          nested[transientKey],
          undefined,
          `nested component must not carry '${transientKey}'`,
        );
      }
      assert.ok(
        nested.licenses?.some((license) => license.license?.id === "MIT"),
        "expected license converted into a licenses entry",
      );
      assert.deepStrictEqual(
        (nested.externalReferences || []).map((ref) => ref.type).sort(),
        ["vcs", "website"],
      );
      // The integrity transient is converted into a hex hashes[] entry, not
      // dropped.
      assert.deepStrictEqual(nested.hashes, [
        {
          alg: "SHA-512",
          content:
            "3433923c1c5ca92347993d79e87155523249b528a87ca908256f8c2005da97a8b745633cc02f65fddcfed2f414557ddbb6500ede57d1b35eeb387636b7d7fd1a",
        },
      ]);
      assert.strictEqual(await validateBom(bomJson), true);
    });

    it("does not mutate the caller's nested member components", () => {
      const ctx = nestedContext();
      const before = JSON.parse(JSON.stringify(ctx.parentComponent));
      buildBomNSData(overrideOptions, [child], "npm", ctx);
      assert.deepStrictEqual(ctx.parentComponent, before);
    });
  });
});
