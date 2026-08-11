import { assert, describe, it } from "poku";

import PackageExtensions, {
  canonicalStringify,
  parseSelector,
  rangeMatches,
} from "./lib/package-extensions.js";

describe("PackageExtensions — normal behaviour", () => {
  it("treats an undefined root as absent", () => {
    const pe = new PackageExtensions(undefined);
    assert.strictEqual(pe.present, false);
    assert.deepStrictEqual(pe.selectors, []);
    assert.strictEqual(pe.hash, null);
  });

  it("parses a name-only selector that matches every version", () => {
    const pe = new PackageExtensions({
      foo: { dependencies: { bar: "1.0.0" } },
    });
    assert.strictEqual(pe.present, true);
    assert.strictEqual(pe.selectors.length, 1);
    assert.strictEqual(pe.wouldMatch("foo", "1.2.3"), true);
    assert.strictEqual(pe.wouldMatch("foo", "2.0.0"), true);
    assert.strictEqual(pe.wouldMatch("bar", "1.0.0"), false);
  });

  it("parses a versioned selector that only matches satisfying versions", () => {
    const pe = new PackageExtensions({
      "foo@^1.0.0": { dependencies: { bar: "1.0.0" } },
    });
    assert.strictEqual(pe.wouldMatch("foo", "1.2.3"), true);
    assert.strictEqual(pe.wouldMatch("foo", "2.0.0"), false);
    assert.strictEqual(rangeMatches("^1.0.0", "1.5.0"), true);
    assert.strictEqual(rangeMatches("^1.0.0", "2.0.0"), false);
    assert.strictEqual(rangeMatches(null, "anything"), true);
  });

  it("computes a stable canonical hash", () => {
    const pe = new PackageExtensions({
      b: { dependencies: { x: "1.0.0" } },
      a: { dependencies: { y: "2.0.0" } },
    });
    assert.ok(pe.hash);
    assert.ok(pe.hash.startsWith("sha512-"));
    // canonicalStringify sorts keys at every level, so key order does not matter
    assert.strictEqual(canonicalStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it("applies a matching extension and reports provenance", () => {
    const pe = new PackageExtensions({
      foo: { dependencies: { added: "1.0.0" } },
    });
    const result = pe.apply({ name: "foo", version: "1.0.0" });
    assert.ok(result);
    assert.strictEqual(result.pkg.dependencies.added, "1.0.0");
    assert.deepStrictEqual(result.applied, {
      selector: "foo",
      dependencies: ["added"],
    });
  });

  it("does not mutate the input manifest", () => {
    const pe = new PackageExtensions({
      foo: { dependencies: { added: "1.0.0" } },
    });
    const pkg = {
      name: "foo",
      version: "1.0.0",
      dependencies: { existing: "2.0.0" },
    };
    pe.apply(pkg);
    assert.deepStrictEqual(pkg.dependencies, { existing: "2.0.0" });
  });

  it("returns null when no selector matches", () => {
    const pe = new PackageExtensions({
      foo: { dependencies: { added: "1.0.0" } },
    });
    assert.strictEqual(pe.apply({ name: "bar", version: "1.0.0" }), null);
  });

  it("rejects a duplicate dependency name across normal fields", () => {
    const pe = new PackageExtensions({
      foo: { dependencies: { existing: "1.0.0" } },
    });
    assert.throws(
      () =>
        pe.apply({
          name: "foo",
          version: "1.0.0",
          dependencies: { existing: "2.0.0" },
        }),
      { code: "EEXTENSIONDUPDEP" },
    );
  });

  it("merges peerDependencies and peerDependenciesMeta", () => {
    const pe = new PackageExtensions({
      foo: {
        peerDependencies: { added: "1.0.0" },
        peerDependenciesMeta: { added: { optional: true } },
      },
    });
    const result = pe.apply({
      name: "foo",
      version: "1.0.0",
      peerDependencies: { existing: "2.0.0" },
      peerDependenciesMeta: { existing: { optional: false } },
    });
    assert.strictEqual(result.pkg.peerDependencies.added, "1.0.0");
    assert.strictEqual(result.pkg.peerDependencies.existing, "2.0.0");
    assert.strictEqual(result.pkg.peerDependenciesMeta.added.optional, true);
    assert.strictEqual(
      result.pkg.peerDependenciesMeta.existing.optional,
      false,
    );
  });

  it("rejects conflicting selectors that match the same candidate", () => {
    const pe = new PackageExtensions({
      "foo@1": { dependencies: { a: "1.0.0" } },
      "foo@^1.0.0": { dependencies: { b: "1.0.0" } },
    });
    assert.throws(() => pe.match("foo", "1.2.0"), {
      code: "EEXTENSIONCONFLICT",
    });
  });
});

describe("PackageExtensions — selector and validation errors", () => {
  it("rejects non-string selectors", () => {
    assert.throws(() => parseSelector(123), { code: "EEXTENSIONSELECTOR" });
    assert.throws(() => parseSelector(""), { code: "EEXTENSIONSELECTOR" });
  });

  it("rejects invalid package names", () => {
    assert.throws(() => parseSelector("not ! valid"), {
      code: "EEXTENSIONSELECTOR",
    });
  });

  it("rejects a blank range after the @ separator", () => {
    assert.throws(() => parseSelector("foo@"), { code: "EEXTENSIONSELECTOR" });
  });

  it("rejects a non-semver range (dist-tags, git, file, url)", () => {
    assert.throws(() => parseSelector("foo@latest"), {
      code: "EEXTENSIONSELECTOR",
    });
    assert.throws(() => parseSelector("foo@github:a/b"), {
      code: "EEXTENSIONSELECTOR",
    });
  });

  it("rejects a non-object root", () => {
    assert.throws(() => new PackageExtensions([]), { code: "EEXTENSIONROOT" });
    assert.throws(() => new PackageExtensions(null), {
      code: "EEXTENSIONROOT",
    });
  });

  it("rejects unsupported fields and non-object values", () => {
    assert.throws(
      () => new PackageExtensions({ foo: { scripts: { x: "y" } } }),
      { code: "EEXTENSIONFIELD" },
    );
    assert.throws(() => new PackageExtensions({ foo: "not an object" }), {
      code: "EEXTENSIONVALUE",
    });
  });

  it("rejects deletion sentinels in dependency fields", () => {
    assert.throws(
      () => new PackageExtensions({ foo: { dependencies: { bar: null } } }),
      { code: "EEXTENSIONDELETE" },
    );
    assert.throws(
      () => new PackageExtensions({ foo: { dependencies: { bar: false } } }),
      { code: "EEXTENSIONDELETE" },
    );
  });

  it("rejects a peerDependenciesMeta entry with no corresponding peer", () => {
    // The orphan-meta check fires during apply(), not construction, because it
    // depends on the post-merge peerDependencies state.
    const pe = new PackageExtensions({
      foo: {
        peerDependencies: {},
        peerDependenciesMeta: { orphan: { optional: true } },
      },
    });
    assert.throws(() => pe.apply({ name: "foo", version: "1.0.0" }), {
      code: "EEXTENSIONORPHANMETA",
    });
  });
});

// These three tests assert the CURRENT behaviour of the three defects identified
// in notes/arborist-10-extension-security-study.md. Each is a prototype-pollution
// or type-confusion vector. They are pinned so that an upstream fix surfaces as a
// deliberate test change rather than a silent pass.
describe("PackageExtensions — known-defect regression cover", () => {
  it("DEFECT: __proto__ as a dependency name replaces the result object's prototype", () => {
    // Object.entries iterates __proto__ when it is an own property (which it is
    // after JSON.parse), and the subsequent next[field]["__proto__"] = spec
    // assignment replaces the prototype of the dependencies object. JSON.stringify
    // hides it because it only serialises own enumerable properties, so the
    // pollution is observable only through the prototype chain.
    const pe = new PackageExtensions({
      "pe-target": {
        dependencies: JSON.parse('{"__proto__":{"polluted":true}}'),
      },
    });
    const result = pe.apply({ name: "pe-target", version: "1.0.0" });
    assert.ok(result);
    // The prototype of the dependencies object is the attacker-controlled object.
    assert.deepStrictEqual(Object.getPrototypeOf(result.pkg.dependencies), {
      polluted: true,
    });
    // The polluted key is reachable via inheritance.
    assert.strictEqual(result.pkg.dependencies.polluted, true);
    // But not as an own property, which is why it does not appear in the serialised
    // tree — the damage is to the prototype chain of an internal object.
    assert.deepStrictEqual(Object.keys(result.pkg.dependencies), []);
  });

  it("DEFECT: a dependency spec value is never type-checked", () => {
    // A spec that is a number, array, or object is stored verbatim. npm-package-arg
    // would reject most of these at resolution time, but the validation gap means
    // the extension object can carry values that later code does not expect.
    const pe = new PackageExtensions({
      "pe-target": { dependencies: { "new-dep": 12345 } },
    });
    const result = pe.apply({ name: "pe-target", version: "1.0.0" });
    assert.strictEqual(result.pkg.dependencies["new-dep"], 12345);
    assert.strictEqual(typeof result.pkg.dependencies["new-dep"], "number");
  });

  it("DEFECT: __proto__ bypasses the orphan-meta check because it uses `in`", () => {
    // The orphan-meta check is `!(name in next.peerDependencies)`. The `in`
    // operator walks the prototype chain, and "__proto__" is always `in` any
    // object because it resolves on Object.prototype. So an extension that adds
    // a peerDependenciesMeta entry for "__proto__" passes validation without a
    // corresponding peerDependency.
    const pe = new PackageExtensions({
      "pe-target": {
        peerDependencies: JSON.parse('{"__proto__":"1.0.0"}'),
        peerDependenciesMeta: JSON.parse('{"__proto__":{"optional":true}}'),
      },
    });
    // No throw: the orphan-meta validation is bypassed.
    const result = pe.apply({ name: "pe-target", version: "1.0.0" });
    assert.ok(result);
    assert.ok(result.applied.peerDependenciesMeta.includes("__proto__"));
  });
});
