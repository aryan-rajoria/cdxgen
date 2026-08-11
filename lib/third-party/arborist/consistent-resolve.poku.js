import { assert, describe, it } from "poku";

import consistentResolve from "./lib/consistent-resolve.js";

const normalizePath = (p) =>
  (p ?? "").replace(/[A-Z]:/, "").replace(/\\/g, "/");
const cr = (...args) => {
  const r = consistentResolve(...args);
  return r && normalizePath(r);
};

describe("consistent-resolve", () => {
  it("resolves files and directories to toPath when relative", () => {
    const tp = "/foo";
    const fp = "/foo/bar";
    assert.strictEqual(cr("/foo/bar/baz", fp, tp, true), "file:bar/baz");
    assert.strictEqual(cr("/foo/bar/baz", fp, tp), "file:/foo/bar/baz");

    assert.strictEqual(cr("./baz", fp, tp, true), "file:bar/baz");
    assert.strictEqual(cr("./baz", fp, tp), "file:/foo/bar/baz");

    assert.strictEqual(
      cr("/foo/bar/baz.tgz", fp, tp, true),
      "file:bar/baz.tgz",
    );
    assert.strictEqual(cr("/foo/bar/baz.tgz", fp, tp), "file:/foo/bar/baz.tgz");

    assert.strictEqual(cr("baz.tgz", fp, tp, true), "file:bar/baz.tgz");
    assert.strictEqual(cr("baz.tgz", fp, tp), "file:/foo/bar/baz.tgz");

    assert.strictEqual(cr("file:/foo/bar/baz", fp, tp, true), "file:bar/baz");
    assert.strictEqual(cr("file:/foo/bar/baz", fp, tp), "file:/foo/bar/baz");

    assert.strictEqual(cr("file:baz", fp, tp, true), "file:bar/baz");
    assert.strictEqual(cr("file:baz", fp, tp), "file:/foo/bar/baz");

    assert.strictEqual(
      cr("file:/foo/bar/baz.tgz", fp, tp, true),
      "file:bar/baz.tgz",
    );
    assert.strictEqual(
      cr("file:/foo/bar/baz.tgz", fp, tp),
      "file:/foo/bar/baz.tgz",
    );

    assert.strictEqual(cr("file:baz.tgz", fp, tp, true), "file:bar/baz.tgz");
    assert.strictEqual(cr("file:baz.tgz", fp, tp), "file:/foo/bar/baz.tgz");
  });

  it("makes files and directories consistent when toPath is not set", () => {
    const fp = "/foo/bar";
    for (const rel of [true, false]) {
      assert.strictEqual(
        cr("/foo/bar/baz", fp, null, rel),
        "file:/foo/bar/baz",
      );
      assert.strictEqual(cr("./baz", fp, null, rel), "file:/foo/bar/baz");
      assert.strictEqual(
        cr("/foo/bar/baz.tgz", fp, null, rel),
        "file:/foo/bar/baz.tgz",
      );
      assert.strictEqual(cr("baz.tgz", fp, null, rel), "file:/foo/bar/baz.tgz");
      assert.strictEqual(
        cr("file:/foo/bar/baz", fp, null, rel),
        "file:/foo/bar/baz",
      );
      assert.strictEqual(cr("file:baz", fp, null, rel), "file:/foo/bar/baz");
      assert.strictEqual(
        cr("file:/foo/bar/baz.tgz", fp, null, rel),
        "file:/foo/bar/baz.tgz",
      );
      assert.strictEqual(
        cr("file:baz.tgz", fp, null, rel),
        "file:/foo/bar/baz.tgz",
      );
    }
  });

  it("normalises hosted git info urls", () => {
    const expectSsh = "git+ssh://git@github.com/a/b.git";
    const expectHttps = "git+https://github.com/a/b.git";
    const expectAuth = "git+https://user:pass@github.com/a/b.git";
    assert.strictEqual(cr("a/b"), expectSsh);
    assert.strictEqual(cr("github:a/b"), expectSsh);
    assert.strictEqual(cr("git+https://github.com/a/b"), expectHttps);
    assert.strictEqual(cr("git://github.com/a/b"), expectSsh);
    assert.strictEqual(cr("git+ssh://git@github.com/a/b"), expectSsh);
    assert.strictEqual(cr("git+https://github.com/a/b.git"), expectHttps);
    assert.strictEqual(cr("git://github.com/a/b.git"), expectSsh);
    assert.strictEqual(cr("git+ssh://git@github.com/a/b.git"), expectSsh);
    assert.strictEqual(
      cr("git+https://user:pass@github.com/a/b.git"),
      expectAuth,
    );

    const hash = "#0000000000000000000000000000000000000000";
    assert.strictEqual(cr(`a/b${hash}`), expectSsh + hash);
    assert.strictEqual(cr(`github:a/b${hash}`), expectSsh + hash);
    assert.strictEqual(
      cr(`git+https://github.com/a/b${hash}`),
      expectHttps + hash,
    );
    assert.strictEqual(cr(`git://github.com/a/b${hash}`), expectSsh + hash);
    assert.strictEqual(
      cr(`git+ssh://git@github.com/a/b${hash}`),
      expectSsh + hash,
    );
    assert.strictEqual(
      cr(`git+https://github.com/a/b.git${hash}`),
      expectHttps + hash,
    );
    assert.strictEqual(cr(`git://github.com/a/b.git${hash}`), expectSsh + hash);
    assert.strictEqual(
      cr(`git+ssh://git@github.com/a/b.git${hash}`),
      expectSsh + hash,
    );
    assert.strictEqual(cr(`xyz@a/b${hash}`), expectSsh + hash);
    assert.strictEqual(cr(`xyz@github:a/b${hash}`), expectSsh + hash);
    assert.strictEqual(
      cr(`xyz@git+https://github.com/a/b${hash}`),
      expectHttps + hash,
    );
    assert.strictEqual(cr(`xyz@git://github.com/a/b${hash}`), expectSsh + hash);
    assert.strictEqual(
      cr(`xyz@git+ssh://git@github.com/a/b${hash}`),
      expectSsh + hash,
    );
    assert.strictEqual(
      cr(`xyz@git+https://github.com/a/b.git${hash}`),
      expectHttps + hash,
    );
    assert.strictEqual(
      cr(`xyz@git://github.com/a/b.git${hash}`),
      expectSsh + hash,
    );
    assert.strictEqual(
      cr(`xyz@git+ssh://git@github.com/a/b.git${hash}`),
      expectSsh + hash,
    );
  });

  it("returns the saveSpec for unhosted git", () => {
    const r =
      "git+https://x.com/y.git#0000000000000000000000000000000000000000";
    assert.strictEqual(cr(r), r);
    assert.strictEqual(cr(`xyz@${r}`), r);
  });

  it("returns remotes as-is", () => {
    const r = "http://x.com/y.tgz";
    assert.strictEqual(cr(r), r);
    assert.strictEqual(cr(`xyz@${r}`), r);
  });

  it("returns null for falsey resolved", () => {
    assert.strictEqual(cr(null), null);
    assert.strictEqual(cr(0), null);
    assert.strictEqual(cr(false), null);
    assert.strictEqual(cr(undefined), null);
  });

  it("returns the tag for a dist-tag", () => {
    assert.strictEqual(cr("foo@latest"), "latest");
  });

  it("returns the package name for a bare name", () => {
    assert.strictEqual(cr("foo"), "foo");
  });

  it("returns the invalid resolved as-is", () => {
    assert.strictEqual(cr("not ! a : v@lid t*A*g"), "not ! a : v@lid t*A*g");
  });
});
