import { assert, describe, it } from "poku";

import gatherDepSet from "./lib/gather-dep-set.js";
import Node from "./lib/node.js";

// Tree shape (from upstream test):
//   tree (a, b, c)
//   +-- a (x, y)
//   +-- x (b)
//   +-- y (i)
//   +-- b (i, j)
//   +-- i (j, k)
//   +-- j (k)
//   +-- k ()
//   +-- c (r, s)
//   +-- r (s, t)
//   +-- s (t)
//   +-- t (missing)  <- unmet dependency
// gather from a includes b; gather from c does not; gather from b alone is empty.
const tree = new Node({
  path: "/path/to/tree",
  pkg: {
    dependencies: {
      a: "",
      b: "",
      c: "",
    },
  },
  children: [
    ["a", ["x", "y"]],
    ["x", ["b"]],
    ["y", ["i"]],
    ["b", ["i", "j"]],
    ["i", ["j", "k"]],
    ["j", ["k"]],
    ["k", []],
    ["c", ["r", "s"]],
    ["r", ["s", "t"]],
    ["s", ["t"]],
    ["t", ["missing"]],
  ].map(([name, deps]) => ({
    pkg: {
      name,
      version: "1.0.0",
      dependencies: deps.reduce((d, n) => {
        d[n] = "";
        return d;
      }, {}),
    },
  })),
});

const printSet = (set) =>
  [...set]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((n) => n.location);

const nodeA = tree.children.get("a");
const nodeB = tree.children.get("b");
const nodeC = tree.children.get("c");
const nodeX = tree.children.get("x");

const f = (edge) => edge.from !== tree && edge.to !== tree;

describe("gather-dep-set", () => {
  it("gathers the transitive set starting from a", () => {
    const setA = gatherDepSet(new Set([nodeA]), f);
    // Sourced from the upstream committed snapshot
    // (tap-snapshots/test/gather-dep-set.js.test.cjs, "set with a").
    assert.deepStrictEqual(printSet(setA), [
      "node_modules/a",
      "node_modules/b",
      "node_modules/i",
      "node_modules/j",
      "node_modules/k",
      "node_modules/x",
      "node_modules/y",
    ]);
    assert.strictEqual(setA.has(nodeB), true);
    assert.strictEqual(setA.has(nodeC), false);
    assert.strictEqual(setA.has(nodeX), true);
  });

  it("gathers the union starting from a and x", () => {
    const setAX = gatherDepSet(new Set([nodeA, nodeX]), f);
    assert.deepStrictEqual(printSet(setAX), [
      "node_modules/a",
      "node_modules/b",
      "node_modules/i",
      "node_modules/j",
      "node_modules/k",
      "node_modules/x",
      "node_modules/y",
    ]);
    assert.strictEqual(setAX.has(nodeB), true);
    assert.strictEqual(setAX.has(nodeC), false);
  });

  it("returns an empty set when gathering from b alone", () => {
    const setB = gatherDepSet(new Set([nodeB]), f);
    assert.strictEqual(setB.size, 0);
  });

  it("gathers the set starting from c only", () => {
    const setC = gatherDepSet(new Set([nodeC]), f);
    assert.deepStrictEqual(printSet(setC), [
      "node_modules/c",
      "node_modules/r",
      "node_modules/s",
      "node_modules/t",
    ]);
    assert.strictEqual(setC.has(nodeC), true);
    assert.strictEqual(setC.has(nodeA), false);
    assert.strictEqual(setC.has(nodeB), false);
    assert.strictEqual(setC.has(nodeX), false);
  });
});
