import { assert, describe, it } from "poku";

import {
  isReservedMetadataPropertyName,
  parseMetadataProperties,
} from "./metadataProperties.js";

describe("parseMetadataProperties", () => {
  it("reads name=value strings from the command line", () => {
    assert.deepStrictEqual(
      parseMetadataProperties(["org.owner=security", "env=prod=eu"]),
      [
        { name: "org.owner", value: "security" },
        { name: "env", value: "prod=eu" },
      ],
    );
  });

  it("reads name/value objects from a config file", () => {
    assert.deepStrictEqual(
      parseMetadataProperties([
        { name: "org.owner", value: "security" },
        { name: "build.number", value: 42 },
        { name: "signed", value: false },
      ]),
      [
        { name: "org.owner", value: "security" },
        { name: "build.number", value: "42" },
        { name: "signed", value: "false" },
      ],
    );
  });

  it("reads a JSON document or a single name=value, as an environment variable arrives", () => {
    assert.deepStrictEqual(
      parseMetadataProperties('{"env":"prod","team":"appsec"}'),
      [
        { name: "env", value: "prod" },
        { name: "team", value: "appsec" },
      ],
    );
    assert.deepStrictEqual(parseMetadataProperties('["a=1"]'), [
      { name: "a", value: "1" },
    ]);
    assert.deepStrictEqual(parseMetadataProperties('"a=1"'), [
      { name: "a", value: "1" },
    ]);
    assert.deepStrictEqual(parseMetadataProperties("team=appsec"), [
      { name: "team", value: "appsec" },
    ]);
  });

  it("repeats a property once per value of a list", () => {
    assert.deepStrictEqual(parseMetadataProperties({ tag: ["pci", "eu"] }), [
      { name: "tag", value: "pci" },
      { name: "tag", value: "eu" },
    ]);
  });

  it("drops anything without a usable name and value", () => {
    assert.deepStrictEqual(
      parseMetadataProperties([
        "no-separator",
        "=value",
        "empty=",
        "",
        { name: "", value: "x" },
        { value: "x" },
        { name: "x" },
        { name: "nested", value: { a: 1 } },
        { name: { a: 1 }, value: "x" },
      ]),
      [],
    );
    assert.deepStrictEqual(
      parseMetadataProperties({ nested: { a: 1 }, list: [{ a: 1 }] }),
      [],
    );
    assert.deepStrictEqual(parseMetadataProperties("not json"), []);
    assert.deepStrictEqual(parseMetadataProperties("42"), []);
    assert.deepStrictEqual(parseMetadataProperties(undefined), []);
  });
});

describe("isReservedMetadataPropertyName", () => {
  it("reserves the namespaces cdxgen asserts itself", () => {
    assert.strictEqual(
      isReservedMetadataPropertyName("cdx:bom:componentSrcFiles"),
      true,
    );
    assert.strictEqual(
      isReservedMetadataPropertyName("internal:SrcFile"),
      true,
    );
    assert.strictEqual(isReservedMetadataPropertyName("acme:team"), false);
    assert.strictEqual(isReservedMetadataPropertyName("team"), false);
  });
});
