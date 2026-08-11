import { resolve } from "node:path";

import { assert, describe, it } from "poku";

import calcDepFlags from "./lib/calc-dep-flags.js";
import Link from "./lib/link.js";
import Node from "./lib/node.js";
import { canonical, readSnapshotValue } from "./tap-snapshot.poku.js";

// The flags this module computes are five of the seven fields cdxgen reads off
// every node, so both the per-node expectations and the whole-tree snapshots
// from upstream are asserted.
//
// The fixture paths below are posix-style and absolute. Windows resolves those
// against the current drive and joins them with backslashes, so the snapshot
// comparison normalises both back to the form upstream recorded.
const toPosixPath = (s) =>
  typeof s === "string" ? s.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/") : s;
const printTree = (tree) => canonical(tree.toJSON(), toPosixPath);

function assertFlags(node, expected, label) {
  for (const [flag, want] of Object.entries(expected)) {
    assert.strictEqual(node[flag], want, `${label}.${flag}`);
  }
}

describe("calc-dep-flags", () => {
  it("computes dev, optional, peer and extraneous across a mixed tree", () => {
    const root = new Node({
      path: "/x",
      realpath: "/x",
      pkg: {
        dependencies: { prod: "" },
        devDependencies: { dev: "" },
        optionalDependencies: { optional: "" },
        peerDependencies: { peer: "", peeroptional: "" },
        peerDependenciesMeta: { peeroptional: { optional: true } },
      },
    });

    const child = (pkg) => new Node({ pkg, parent: root });

    const optional = child({
      name: "optional",
      version: "1.2.3",
      dependencies: { devoptional: "", missing: "" },
    });
    const devoptional = child({ name: "devoptional", version: "1.2.3" });
    const extraneous = child({ name: "extraneous" });
    const peer = child({
      name: "peer",
      version: "1.2.3",
      dependencies: { peerdep: "" },
    });
    const peerdep = child({ name: "peerdep", version: "1.2.3" });
    const prod = child({
      name: "prod",
      version: "1.2.3",
      dependencies: { proddep: "" },
      peerDependencies: { metapeer: "" },
    });
    const metapeer = child({
      name: "metapeer",
      version: "1.2.3",
      dependencies: { metapeerdep: "" },
    });
    const metapeerdep = child({ name: "metapeerdep", version: "1.2.3" });
    const proddep = child({
      name: "proddep",
      version: "1.2.3",
      dependencies: { proddep: "" },
    });
    const dev = child({
      name: "dev",
      version: "1.2.3",
      dependencies: { devdep: "" },
    });
    const devdep = child({
      name: "devdep",
      version: "1.2.3",
      dependencies: { proddep: "", linky: "", devoptional: "" },
      optionalDependencies: { devandoptional: "" },
    });
    const devandoptional = child({ name: "devandoptional", version: "1.2.3" });

    const linky = new Link({
      pkg: {
        name: "linky",
        version: "1.2.3",
        dependencies: { linklink: "" },
      },
      realpath: "/x/y/z",
      parent: devdep,
    });
    // A link dep depended upon by the target of a linked dep.
    const linkylinky = new Link({
      pkg: { name: "linklink", version: "1.2.3" },
      realpath: "/l/i/n/k/link",
      parent: linky.target,
    });

    const peeroptional = child({
      name: "peeroptional",
      version: "1.2.3",
      dependencies: { optional: "" },
    });

    calcDepFlags(root);

    const plain = {
      extraneous: false,
      dev: false,
      optional: false,
      devOptional: false,
      peer: false,
    };
    assertFlags(optional, { ...plain, optional: true }, "optional");
    assertFlags(devoptional, { ...plain, devOptional: true }, "devoptional");
    assert.strictEqual(extraneous.extraneous, true, "extraneous.extraneous");
    assertFlags(peer, { ...plain, peer: true }, "peer");
    assertFlags(peerdep, { ...plain, peer: true }, "peerdep");
    assertFlags(prod, plain, "prod");
    assertFlags(metapeer, { ...plain, peer: true }, "metapeer");
    assertFlags(metapeerdep, { ...plain, peer: true }, "metapeerdep");
    assertFlags(proddep, plain, "proddep");
    assertFlags(dev, { ...plain, dev: true }, "dev");
    assertFlags(devdep, { ...plain, dev: true }, "devdep");
    assertFlags(
      devandoptional,
      { ...plain, dev: true, optional: true },
      "devandoptional",
    );
    assertFlags(linky, { ...plain, dev: true }, "linky");
    assertFlags(linkylinky, { ...plain, dev: true }, "linkylinky");
    assertFlags(
      peeroptional,
      { ...plain, extraneous: true, optional: true, peer: true },
      "peeroptional",
    );

    assert.deepStrictEqual(
      printTree(root),
      readSnapshotValue(
        "calc-dep-flags",
        "test/calc-dep-flags.js TAP flag stuff > after 1",
      ),
    );
  });

  it("leaves already-set flags alone when reset is off", () => {
    const root = new Node({
      path: "/some/path",
      realpath: "/some/path",
      pkg: { dependencies: { foo: "" } },
    });
    const foo = new Node({
      parent: root,
      pkg: { name: "foo", version: "1.2.3" },
    });

    root.optional = false;
    root.dev = true;
    root.extraneous = false;

    calcDepFlags(root, false);

    assert.deepStrictEqual(
      printTree(root),
      readSnapshotValue(
        "calc-dep-flags",
        "test/calc-dep-flags.js TAP no reset > after 1",
      ),
    );
    assert.strictEqual(root.dev, true, "root.dev");
    assert.strictEqual(foo.dev, true, "foo.dev");
    assert.strictEqual(root.optional, false, "root.optional");
    assert.strictEqual(foo.optional, false, "foo.optional");
    assert.strictEqual(root.extraneous, false, "root.extraneous");
    assert.strictEqual(foo.extraneous, false, "foo.extraneous");
  });

  it("clears extraneous on the parents of a visited node", () => {
    const root = new Node({
      path: "/some/path",
      realpath: "/some/path",
      pkg: {
        dependencies: {
          baz: "file:node_modules/asdf/node_modules/baz",
          foo: "file:bar/foo",
        },
      },
    });
    const bar = new Node({ root, path: resolve(root.path, "bar") });
    const foo = new Node({
      root,
      path: resolve(bar.path, "foo"),
      pkg: { name: "foo", version: "1.2.3" },
    });
    const asdf = new Node({
      parent: root,
      pkg: { name: "asdf", version: "1.2.3" },
    });
    const baz = new Node({
      parent: asdf,
      pkg: { name: "baz", version: "1.2.3" },
    });
    const fooLink = new Link({
      name: "foo",
      target: foo,
      parent: root,
      realpath: foo.path,
    });
    const bazLink = new Link({
      name: "baz",
      target: baz,
      parent: root,
      realpath: baz.path,
    });

    calcDepFlags(root, true);

    for (const [label, node] of [
      ["root", root],
      ["asdf", asdf],
      ["bar", bar],
      ["baz", baz],
      ["foo", foo],
      ["fooLink", fooLink],
      ["bazLink", bazLink],
    ]) {
      assert.strictEqual(node.extraneous, false, `${label} is not extraneous`);
    }
  });

  it("keeps the most permissive flags when two links share a target", () => {
    const root = new Node({
      path: "/r",
      realpath: "/r",
      pkg: { name: "root", workspaces: ["app", "tools"] },
    });
    const app = new Node({
      path: "/r/app",
      realpath: "/r/app",
      root,
      pkg: { name: "app", version: "1.0.0", devDependencies: { tools: "*" } },
    });
    const tools = new Node({
      path: "/r/tools",
      realpath: "/r/tools",
      root,
      pkg: { name: "tools", version: "1.0.0" },
    });
    new Link({ name: "app", parent: root, realpath: "/r/app", target: app });
    new Link({
      name: "tools",
      parent: root,
      realpath: "/r/tools",
      target: tools,
    });
    new Link({
      name: "tools",
      parent: app,
      realpath: "/r/tools",
      target: tools,
    });
    root.workspaces = new Map([
      ["app", "/r/app"],
      ["tools", "/r/tools"],
    ]);

    calcDepFlags(root);

    assert.strictEqual(
      tools.dev,
      false,
      "tools is prod via the root workspace link",
    );
    assert.strictEqual(
      app.dev,
      false,
      "app is prod via the root workspace link",
    );
  });

  it("tolerates a link root with no target", () => {
    const root = new Link({
      path: "/some/path",
      realpath: "/some/path",
      pkg: { dependencies: { foo: "" } },
    });
    calcDepFlags(root);
    calcDepFlags(root, false);
  });
});
