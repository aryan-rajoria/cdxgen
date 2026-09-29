import { join } from "node:path";

import { assert, it } from "poku";

import { sanitizeProjectConfig } from "./projectConfig.js";

const projectDir = join("/tmp", "project");

it("keeps path options that stay inside the project directory", () => {
  const { config, rejected } = sanitizeProjectConfig(
    { "license-policy": "policy.yaml", output: "out/bom.json" },
    projectDir,
  );
  assert.deepStrictEqual(rejected, []);
  assert.strictEqual(config.output, "out/bom.json");
  assert.strictEqual(config["license-policy"], "policy.yaml");
});

it("rejects path options that escape the project directory", () => {
  const { config, rejected } = sanitizeProjectConfig(
    { output: "/home/victim/.ssh/config" },
    projectDir,
  );
  assert.strictEqual(config.output, undefined);
  assert.deepStrictEqual(rejected, ["output=/home/victim/.ssh/config"]);
});

it("rejects traversal out of the project directory", () => {
  const { config, rejected } = sanitizeProjectConfig(
    { "evinse-output": "../../etc/cdxgen.json" },
    projectDir,
  );
  assert.strictEqual(config["evinse-output"], undefined);
  assert.strictEqual(rejected.length, 1);
});

it("rejects the camelCase spelling of a path option", () => {
  const { config, rejected } = sanitizeProjectConfig(
    { depsSlicesFile: "/tmp/elsewhere.json" },
    projectDir,
  );
  assert.strictEqual(config.depsSlicesFile, undefined);
  assert.strictEqual(rejected.length, 1);
});

it("announces options that redirect data or widen execution", () => {
  const { announced, config } = sanitizeProjectConfig(
    { "install-deps": true, serverUrl: "https://attacker.example" },
    projectDir,
  );
  assert.ok(announced.includes("install-deps"));
  assert.ok(announced.includes("serverUrl"));
  // Announced options stay usable; only path escapes are dropped.
  assert.strictEqual(config["install-deps"], true);
});

it("tolerates a missing or non-object config", () => {
  assert.deepStrictEqual(
    sanitizeProjectConfig(undefined, projectDir).config,
    {},
  );
  assert.deepStrictEqual(sanitizeProjectConfig("nope", projectDir).config, {});
});

it("keeps a project's own metadata properties, normalized", () => {
  const { config, reservedProperties } = sanitizeProjectConfig(
    {
      metadataProperties: { team: "payments", tag: ["pci", "eu"] },
      "metadata-property": ["cost=42"],
    },
    projectDir,
  );
  assert.deepStrictEqual(reservedProperties, []);
  assert.deepStrictEqual(config.metadataProperties, [
    { name: "team", value: "payments" },
    { name: "tag", value: "pci" },
    { name: "tag", value: "eu" },
  ]);
  assert.deepStrictEqual(config["metadata-property"], [
    { name: "cost", value: "42" },
  ]);
});

it("refuses metadata properties in the namespaces cdxgen reserves", () => {
  // A scanned tree must not pass its own claims off as cdxgen's findings
  const { config, reservedProperties } = sanitizeProjectConfig(
    {
      metadataProperties: {
        "cdx:bom:componentSrcFiles": "forged",
        team: "payments",
      },
      metadataProperty: ["internal:SrcFile=x"],
    },
    projectDir,
  );
  assert.deepStrictEqual(reservedProperties.sort(), [
    "cdx:bom:componentSrcFiles",
    "internal:SrcFile",
  ]);
  assert.deepStrictEqual(config.metadataProperties, [
    { name: "team", value: "payments" },
  ]);
  assert.strictEqual(config.metadataProperty, undefined);
});
