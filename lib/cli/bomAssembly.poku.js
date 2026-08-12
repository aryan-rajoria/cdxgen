import { assert, describe, it } from "poku";

import { buildBomNSData, listComponents } from "./bomAssembly.js";
import { getNpmPackFilePaths, getProp } from "./bomTestHelpers.poku.js";

describe("bomAssembly", () => {
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
  });
});
