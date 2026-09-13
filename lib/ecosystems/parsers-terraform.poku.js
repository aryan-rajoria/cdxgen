import { assert, describe, it } from "poku";

import { parseTerraformLockFile } from "./parsers-terraform.js";

describe("parseTerraformLockFile", () => {
  it("parses providers with generic purls, constraints, and zip digests", () => {
    const { pkgList } = parseTerraformLockFile(
      "./test/data/terraform-smoke/.terraform.lock.hcl",
    );
    assert.strictEqual(pkgList.length, 2);

    const aws = pkgList.find((p) => p.name === "aws");
    assert.strictEqual(aws.group, "registry.terraform.io/hashicorp");
    assert.strictEqual(aws.version, "5.80.0");
    assert.strictEqual(
      aws.purl,
      "pkg:generic/registry.terraform.io/hashicorp/aws@5.80.0",
    );
    assert.strictEqual(
      aws.properties.find((p) => p.name === "cdx:purl:proposedType").value,
      "terraform-provider",
    );
    assert.strictEqual(
      aws.properties.find((p) => p.name === "cdx:tf:constraints").value,
      ">= 5.0.0",
    );
    assert.strictEqual(
      aws.properties.find((p) => p.name === "cdx:tf:address").value,
      "registry.terraform.io/hashicorp/aws",
    );

    // A zh: digest is the SHA-256 of a published provider zip, so it is what
    // the hashes array can carry; the provider is published once per
    // platform, which is why a block yields more than one.
    assert.deepStrictEqual(
      aws.hashes,
      [
        "274f8d3e3a20b9604baa5e6ccc70c6a904a0973f3e6274b6ffef6d02a4d3c6b4",
        "8dcb9bd1a0ba1bbd0ec64a1ba5e0e2e0c2e4b8c9d0a1e6f3b2c5d8e9f0a1b2c3",
      ].map((content) => ({ alg: "SHA-256", content })),
    );

    // An h1: digest hashes the package contents rather than the archive, so
    // it is kept as a property instead of being labelled SHA-256.
    assert.strictEqual(
      aws.properties.find((p) => p.name === "cdx:tf:h1").value,
      "h1:JNWQeVmmv5FTRgQ4lFzptzk3PQBIJDYzI8+qNjsVgp0=",
    );

    const random = pkgList.find((p) => p.name === "random");
    assert.strictEqual(random.version, "3.6.3");
    // The fixture writes this block's first digest on the hashes bracket line.
    assert.deepStrictEqual(random.hashes, [
      {
        alg: "SHA-256",
        content:
          "1b12d1c5b7f83f80a76c38af2aa0ecdfcb8a10f8d6183e47a3f1e0ec074b30ec",
      },
    ]);
    assert.strictEqual(
      random.properties.find((p) => p.name === "cdx:tf:h1").value,
      "h1:xZcaobHj6bc4S7g4Em3p6iZr8thjpCgxoQmuZO8M4Ew=",
    );
  });

  it("returns no providers for unreadable input", () => {
    const { pkgList } = parseTerraformLockFile(
      "./test/data/terraform-smoke/missing.lock.hcl",
    );
    assert.deepStrictEqual(pkgList, []);
  });
});
