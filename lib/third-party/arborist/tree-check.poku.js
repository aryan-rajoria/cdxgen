import { resolve } from "node:path";
import process from "node:process";

import esmock from "esmock";
import { assert, describe, it } from "poku";

// checkTree only replaces the identity export when the debug module is active,
// so the assertions below are only reachable with ARBORIST_DEBUG set.
process.env.ARBORIST_DEBUG = "1";
const treeCheck = (await import("./lib/tree-check.js")).default;
const { default: Node } = await import("./lib/node.js");
const { default: Link } = await import("./lib/link.js");
const { default: Edge } = await import("./lib/edge.js");

// Mirrors tap's `t.throws(fn, expected)` subset match: every key in `expected`
// is compared against the thrown error, with the `Array` constructor standing
// for "any array".
function assertThrowsMatching(fn, expected, label) {
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${label}: expected a throw`);
  for (const [key, want] of Object.entries(expected)) {
    if (want === Array) {
      assert.ok(Array.isArray(error[key]), `${label}: ${key} is an array`);
    } else {
      assert.deepStrictEqual(error[key], want, `${label}: ${key}`);
    }
  }
}

describe("tree-check", () => {
  it("returns the tree unchanged when everything is consistent", () => {
    const tree = new Node({
      path: "/some/path",
      pkg: {},
      children: [{ pkg: { name: "foo", version: "1.2.3" } }],
    });
    const link = new Link({
      parent: tree,
      name: "glorb",
      target: new Node({
        fsParent: tree,
        path: "/some/path/glorb",
        pkg: { name: "glorb", version: "1.2.3" },
      }),
    });
    link.parent = tree;

    assert.strictEqual(treeCheck(tree), tree);
    assert.strictEqual(treeCheck(link), link);
    assert.strictEqual(treeCheck(link.target), link.target);

    const nonTree = {};
    assert.strictEqual(treeCheck(nonTree), nonTree);
    nonTree.root = {};
    assert.strictEqual(treeCheck(nonTree), nonTree);
  });

  it("reports each way a tree can be inconsistent", () => {
    const tree = new Node({
      path: "/some/path",
      pkg: {},
      children: [
        { pkg: { name: "foo", version: "1.2.3" } },
        { pkg: { name: "disowned", version: "1.2.3" } },
      ],
    });
    new Link({
      parent: tree,
      name: "glorb",
      target: new Node({
        fsParent: tree,
        path: "/some/path/glorb",
        pkg: { name: "glorb", version: "1.2.3" },
      }),
    });
    const disowned = tree.children.get("disowned");
    disowned.parent = null;

    // Bypass Inventory#set so the node stays in the inventory without being
    // reachable from the root.
    Map.prototype.set.call(tree.inventory, "xyz", disowned);
    assert.strictEqual(
      treeCheck(tree, false),
      tree,
      "unreachable allowed when the check is opted out of",
    );
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "unreachable in inventory",
        node: resolve("/some/path/node_modules/disowned"),
        realpath: resolve("/some/path/node_modules/disowned"),
        location: "",
        name: "Error",
        log: Array,
      },
      "unreachable in inventory",
    );

    Map.prototype.delete.call(tree.inventory, "xyz");
    disowned.parent = tree;
    tree.inventory.delete(disowned);
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "not in inventory",
        node: resolve("/some/path/node_modules/disowned"),
        name: "Error",
        log: Array,
      },
      "not in inventory",
    );

    disowned.root = null;
    tree.children.set("wtf", disowned);
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "double root",
        node: resolve("/some/path/node_modules/disowned"),
        realpath: resolve("/some/path/node_modules/disowned"),
        tree: tree.path,
        name: "Error",
        log: Array,
      },
      "double root",
    );

    const otherTree = new Node({ name: "other", parent: disowned });
    tree.children.set("wtf", otherTree);
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "node from other root in tree",
        node: resolve("/some/path/node_modules/disowned/node_modules/other"),
        realpath: resolve(
          "/some/path/node_modules/disowned/node_modules/other",
        ),
        tree: tree.path,
        name: "Error",
        log: Array,
      },
      "node from other root in tree",
    );

    tree.children.delete("wtf");
    Map.prototype.set.call(otherTree.inventory, "othertree", disowned);
    // The node named by the error is otherTree itself, the non-root carrying
    // the inventory. Upstream spells this `disowned.path`, which passes there
    // only because tap's throws-matcher accepts a substring.
    assertThrowsMatching(
      () => treeCheck(otherTree),
      {
        message: "non-root has non-zero inventory",
        node: otherTree.path,
        tree: otherTree.path,
        inventory: [[disowned.path, disowned.location]],
        name: "Error",
        log: Array,
      },
      "non-root has non-zero inventory",
    );
    Map.prototype.delete.call(tree.inventory, "othertree");
  });

  it("returns the tree unchecked outside debug mode", async () => {
    const { default: nonDebugTreeCheck } = await esmock("./lib/tree-check.js", {
      "./lib/debug.js": () => {},
    });
    const tree = new Node({
      path: "/some/path",
      pkg: {},
      children: [
        { pkg: { name: "foo", version: "1.2.3" } },
        { pkg: { name: "disowned", version: "1.2.3" } },
      ],
    });
    const disowned = tree.children.get("disowned");
    disowned.parent = null;
    Map.prototype.set.call(tree.inventory, "xyz", disowned);
    assert.strictEqual(nonDebugTreeCheck(tree), tree);
  });

  it("rejects dev edges on a nested dep node", () => {
    const tree = new Node({
      path: "/some/path",
      pkg: {},
      children: [
        { pkg: { name: "foo", version: "1.2.3", devDependencies: { x: "" } } },
      ],
    });
    new Edge({
      type: "dev",
      name: "x",
      spec: "",
      from: tree.children.get("foo"),
    });
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "dev edges on non-top node",
        node: tree.children.get("foo").path,
        tree: tree.path,
        root: tree.root.path,
        via: tree.path,
        viaType: "children",
        devEdges: [["dev", "x", "", "MISSING"]],
        log: Array,
      },
      "dev edges on non-top node",
    );
  });

  it("rejects a node sharing the root path, then a mismatched realpath", () => {
    const root = new Node({
      path: "/path/to/root",
      pkg: { dependencies: { foo: "1" } },
    });
    const tree = new Node({
      parent: root,
      pkg: { name: "foo", version: "1.2.3" },
    });
    const child = new Node({
      parent: tree,
      pkg: { name: "not-root", version: "1.2.3" },
    });

    child.path = root.path;
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "node with same path as root",
        node: child.path,
        tree: tree.path,
        root: root.path,
        via: tree.path,
        viaType: "children",
        log: Array,
      },
      "node with same path as root",
    );

    child.path = `${root.path}/some/where/else`;
    assertThrowsMatching(
      () => treeCheck(tree),
      {
        message: "non-link with mismatched path/realpath",
        node: child.path,
        tree: tree.path,
        root: root.path,
        via: tree.path,
        viaType: "children",
        log: Array,
      },
      "non-link with mismatched path/realpath",
    );
  });
});
