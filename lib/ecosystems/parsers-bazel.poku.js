import { assert, describe, it } from "poku";

import { parseModuleBazel, parseModuleBazelLock } from "./parsers-bazel.js";

describe("parseModuleBazel", () => {
  it("extracts the module name, BCR deps, and maven artifacts", () => {
    const { pkgList, parentComponent, rootInputs } = parseModuleBazel(
      "./test/data/bzlmod-smoke/MODULE.bazel",
    );
    assert.strictEqual(parentComponent.name, "bzlmod-smoke");
    assert.strictEqual(parentComponent.version, "1.0.0");

    // Three BCR modules + two Maven artifacts.
    assert.strictEqual(pkgList.length, 5);

    const rulesGo = pkgList.find((p) => p.name === "rules_go");
    assert.ok(rulesGo);
    // BCR modules use the registered bazel type — the only legitimate use.
    assert.strictEqual(
      rulesGo.purl,
      "pkg:bazel/rules_go@0.39.1?repository_url=https:%2F%2Fbcr.bazel.build",
    );
    assert.strictEqual(rulesGo.scope, "required");
    assert.strictEqual(rulesGo.version, "0.39.1");

    // repo_name alias is recorded as a property but the canonical name is used.
    const rulesJvm = pkgList.find((p) => p.name === "rules_jvm_external");
    assert.ok(rulesJvm);
    const repoNameProp = rulesJvm.properties.find(
      (p) => p.name === "cdx:bazel:repo_name",
    );
    assert.strictEqual(repoNameProp.value, "rules_jvm");

    // Maven coordinates carry a pkg:maven purl with a group namespace so
    // advisories match. Guava is declared as a coordinate string.
    const guava = pkgList.find((p) => p.name === "guava");
    assert.ok(guava);
    assert.strictEqual(
      guava.purl,
      "pkg:maven/com.google.guava/guava@32.1.1-jre",
    );
    // group and name are split the way every other Maven path in cdxgen
    // splits them, so a bzlmod-sourced artifact dedupes against the same
    // artifact found by the Maven or Gradle collectors.
    assert.strictEqual(guava.group, "com.google.guava");
    assert.strictEqual(guava.name, "guava");

    // slf4j is declared with separate group/artifact/version args.
    const slf4j = pkgList.find((p) => p.name === "slf4j-api");
    assert.ok(slf4j);
    assert.strictEqual(slf4j.purl, "pkg:maven/org.slf4j/slf4j-api@2.0.9");

    // No package may squat an unregistered type.
    for (const pkg of pkgList) {
      assert.ok(
        pkg.purl.startsWith("pkg:bazel/") || pkg.purl.startsWith("pkg:maven/"),
        `${pkg.name} has unexpected purl ${pkg.purl}`,
      );
    }
    assert.strictEqual(rootInputs.length, 5);
  });

  it("returns empty results for a missing file", () => {
    const { pkgList, parentComponent } = parseModuleBazel(
      "./test/data/missing-MODULE.bazel",
    );
    assert.deepEqual(pkgList, []);
    assert.deepEqual(parentComponent, {});
  });
});

describe("parseModuleBazelLock", () => {
  it("parses a legacy lock into BCR modules and a dependency graph", () => {
    const { pkgList, dependencies } = parseModuleBazelLock(
      "./test/data/bzlmod-smoke/MODULE.bazel.lock",
    );
    assert.strictEqual(pkgList.length, 3);
    const skylib = pkgList.find((p) => p.name === "bazel_skylib");
    assert.strictEqual(
      skylib.purl,
      "pkg:bazel/bazel_skylib@1.7.1?repository_url=https:%2F%2Fbcr.bazel.build",
    );

    // rules_go depends on bazel_skylib.
    const goEdge = dependencies.find((d) => d.ref.includes("rules_go@0.39.1"));
    assert.ok(goEdge);
    assert.ok(goEdge.dependsOn.some((r) => r.includes("bazel_skylib@1.7.1")));
  });

  it("parses a modern lock's maven generatedRepoSpecs", () => {
    const { pkgList } = parseModuleBazelLock(
      "./test/data/bzlmod-smoke/MODULE.bazel.lock.modern",
    );
    // Two maven artifacts; the http_file download is not a package ecosystem.
    assert.strictEqual(pkgList.length, 2);
    const guava = pkgList.find((p) => p.name === "guava");
    assert.strictEqual(
      guava.purl,
      "pkg:maven/com.google.guava/guava@32.1.1-jre",
    );
    const slf4j = pkgList.find((p) => p.name === "slf4j-api");
    assert.strictEqual(slf4j.purl, "pkg:maven/org.slf4j/slf4j-api@2.0.9");
  });

  it("returns empty results for a malformed lock", () => {
    const { pkgList, dependencies } = parseModuleBazelLock(
      "./test/data/zig-malformed.zon",
    );
    assert.deepEqual(pkgList, []);
    assert.deepEqual(dependencies, []);
  });
});
