import path from "node:path";

import npa from "npm-package-arg";
import { assert, describe, it } from "poku";

import depValid from "./lib/dep-valid.js";

const emptyRequestor = {
  edgesOut: new Map(),
};

const makeNode = (overrides) => ({
  package: { version: "1.2.3" },
  get version() {
    return this.package.version;
  },
  ...overrides,
});

describe("dep-valid", () => {
  it("treats '*' as always satisfied", () => {
    assert.ok(depValid({}, "", null, emptyRequestor));
  });

  it("accepts a satisfied semver range", () => {
    assert.ok(
      depValid(
        makeNode({ package: { version: "1.2.3" } }),
        "1.x",
        null,
        emptyRequestor,
      ),
    );
  });

  it("accepts a range that is acceptable via the spec alias", () => {
    assert.ok(
      depValid(
        makeNode({ package: { version: "2.2.3" } }),
        "1.x",
        "2.x",
        emptyRequestor,
      ),
    );
  });

  it("requires links to point at their intended target", () => {
    assert.ok(
      depValid(
        { isLink: true, realpath: "/some/path" },
        npa("file:/some/path"),
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        { isLink: true, realpath: "/some/other/path" },
        "file:/some/path",
        null,
        emptyRequestor,
      ),
    );
    // A file:// spec must resolve to a Link node, not a plain node.
    assert.ok(
      !depValid(
        { realpath: "/some/path" },
        "file:/some/path",
        null,
        emptyRequestor,
      ),
    );
  });

  it("matches git urls with semver ranges, aliases, and remote tarballs", () => {
    assert.ok(
      depValid(
        makeNode({
          name: "foo",
          resolved: "git://host/repo#somebranch",
        }),
        "git://host/repo#semver:1.x",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      depValid(
        makeNode({ name: "foo", package: { name: "bar", version: "1.2.3" } }),
        "npm:bar@1.2.3",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      depValid(
        makeNode({
          resolved: "https://registry/abbrev-1.1.1.tgz",
          package: {},
        }),
        "https://registry/abbrev-1.1.1.tgz",
        null,
        emptyRequestor,
      ),
    );
  });

  it("matches and rejects git repos by saveSpec", () => {
    assert.ok(
      depValid(
        makeNode({ resolved: "git+ssh://git@github.com/foo/bar" }),
        "git+ssh://git@github.com/foo/bar.git",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        makeNode({ resolved: "git+ssh://git@github.com/foo/bar" }),
        "git+ssh://git@github.com/bar/foo.git",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        makeNode({}),
        "git+ssh://git@github.com/bar/foo.git",
        null,
        emptyRequestor,
      ),
    );
  });

  it("matches tarball files by resolved path", () => {
    const tgz = path.resolve("/path/to/tarball.tgz");
    assert.ok(depValid({ resolved: `file:${tgz}` }, tgz, null, emptyRequestor));
    assert.ok(
      !depValid(
        { resolved: "file:/path/to/other/tarball.tgz" },
        "/path/to/tarball.tgz",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid({ isLink: true }, "/path/to/tarball.tgz", null, emptyRequestor),
    );
    assert.ok(
      depValid(
        makeNode({
          package: { _requested: { saveSpec: "file:tarball.tgz" } },
        }),
        "./tarball.tgz",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(!depValid(makeNode({}), "./tarball.tgz", null, emptyRequestor));
  });

  it("requires a remote tarball for tagged registry versions", () => {
    assert.ok(
      depValid(
        { resolved: "https://registry.npmjs.org/foo/foo-1.2.3.tgz" },
        "latest",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        { resolved: "git+https://registry.npmjs.org/foo/foo-1.2.3.git" },
        "latest",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(!depValid({}, "latest", null, emptyRequestor));
  });

  it("records an unsupported dependency type error on the requestor", () => {
    const requestor = { errors: [], edgesOut: new Map() };
    const child = { name: "kid" };
    const request = { type: "not a type" };
    assert.ok(!depValid(child, request, null, requestor));
    assert.strictEqual(
      requestor.errors[0].message,
      "Unsupported dependency type",
    );
    assert.strictEqual(requestor.errors[0].dependency, "kid");
    assert.deepStrictEqual(requestor.errors[0].requested, {
      type: "not a type",
    });
  });

  it("records an invalid tag name error", () => {
    const requestor = { errors: [], edgesOut: new Map() };
    const child = { name: "kid" };
    const request = "!!@#$%!#@$!";
    assert.ok(!depValid(child, request, null, requestor));
    // npm-package-arg's message grew in later releases; match on the prefix
    // the upstream tap test matched against.
    assert.ok(
      requestor.errors[0].message.startsWith('Invalid tag name "!!@#$%!#@$!"'),
      `unexpected message: ${requestor.errors[0].message}`,
    );
    assert.strictEqual(requestor.errors[0].dependency, "kid");
    assert.strictEqual(requestor.errors[0].requested, "!!@#$%!#@$!");
  });

  it("records an invalid specifier error for a null request", () => {
    const requestor = { errors: [], edgesOut: new Map() };
    const child = { name: "kid" };
    assert.ok(!depValid(child, null, null, requestor));
    assert.strictEqual(
      requestor.errors[0].message,
      "Invalid dependency specifier",
    );
    assert.strictEqual(requestor.errors[0].requested, null);
    assert.strictEqual(requestor.errors[0].dependency, "kid");
  });

  it("treats Link nodes as invalid under installLinks", () => {
    const requestor = {
      errors: [],
      installLinks: true,
      edgesOut: new Map(),
    };
    const child = { isLink: true, isWorkspace: false, name: "kid" };
    const request = { type: "directory" };
    assert.ok(!depValid(child, request, null, requestor));
  });

  it("does not treat workspace Link nodes as invalid under installLinks", () => {
    const requestor = {
      errors: [],
      installLinks: true,
      edgesOut: new Map(),
    };
    const child = {
      isLink: true,
      isWorkspace: true,
      name: "kid",
      realpath: "/some/path",
    };
    const request = npa("file:/some/path");
    assert.ok(depValid(child, request, null, requestor));
  });

  it("matches and rejects git urls by full sha-1 and sha-256 hash", () => {
    const sha1 = "0d7bd85a85fa2571fa532d2fc842ed099b236ad2";
    const sha256 =
      "8e3a9b3579ab330238c06b761e7f1b5dc5b4ac6e5a96da4dd2fb3b7411009df8";
    assert.ok(
      depValid(
        makeNode({ name: "foo", resolved: `npm/repo#${sha1}` }),
        `npm/repo#${sha1}`,
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        makeNode({ name: "foo", resolved: `npm/repo#${sha1}` }),
        "npm/repo#1d7bd85a85fa2571fa532d2fc842ed099b236ad2",
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      depValid(
        makeNode({ name: "foo", resolved: `npm/repo#${sha256}` }),
        `npm/repo#${sha256}`,
        null,
        emptyRequestor,
      ),
    );
    assert.ok(
      !depValid(
        makeNode({ name: "foo", resolved: `npm/repo#${sha256}` }),
        "npm/repo#9e3a9b3579ab330238c06b761e7f1b5dc5b4ac6e5a96da4dd2fb3b7411009df8",
        null,
        emptyRequestor,
      ),
    );
  });

  it("detects git tag/branch changes via the lockfile committish", () => {
    const mkRequestor = (recorded) => ({
      errors: [],
      edgesOut: new Map(),
      realpath: path.resolve("/some/path"),
      location: "",
      root: {
        meta: { data: { packages: { "": recorded } } },
      },
    });
    const child = makeNode({
      name: "repo",
      resolved:
        "git+ssh://git@github.com/npm/repo.git#0d7bd85a85fa2571fa532d2fc842ed099b236ad2",
      package: { version: "1.0.0" },
    });

    assert.ok(
      depValid(
        child,
        "npm/repo#v1.0.0",
        null,
        mkRequestor({ dependencies: { repo: "npm/repo#v1.0.0" } }),
      ),
    );
    assert.ok(
      !depValid(
        child,
        "npm/repo#v2.0.0",
        null,
        mkRequestor({ dependencies: { repo: "npm/repo#v1.0.0" } }),
      ),
    );
    assert.ok(
      !depValid(
        child,
        "npm/repo#other",
        null,
        mkRequestor({ devDependencies: { repo: "npm/repo#main" } }),
      ),
    );
    assert.ok(
      !depValid(
        child,
        "npm/repo#v2.0.0",
        null,
        mkRequestor({ optionalDependencies: { repo: "npm/repo#v1.0.0" } }),
      ),
    );
    assert.ok(
      !depValid(
        child,
        "npm/repo#other",
        null,
        mkRequestor({ peerDependencies: { repo: "npm/repo#main" } }),
      ),
    );
    assert.ok(
      !depValid(
        child,
        "npm/repo#v2.0.0",
        null,
        mkRequestor({ dependencies: { repo: "npm/repo" } }),
      ),
    );
    assert.ok(
      depValid(
        child,
        "npm/repo#v2.0.0",
        null,
        mkRequestor({ dependencies: { repo: "^1.0.0" } }),
      ),
    );
    assert.ok(depValid(child, "npm/repo#v2.0.0", null, emptyRequestor));
    assert.ok(
      depValid(
        child,
        "npm/repo#v2.0.0",
        null,
        mkRequestor({ dependencies: { repo: "invalid spec with spaces" } }),
      ),
    );
  });
});
