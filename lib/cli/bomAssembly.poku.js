import { assert, describe, it } from "poku";

import { listComponents } from "./bomAssembly.js";
import { getNpmPackFilePaths, getProp } from "./bomTestHelpers.poku.js";

describe("bomAssembly", () => {
  describe("component creation", () => {
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
});
