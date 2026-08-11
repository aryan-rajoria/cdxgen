import process from "node:process";

import stringLocaleCompare from "@isaacs/string-locale-compare";
import esmock from "esmock";
import { assert, describe, it } from "poku";

// The debug-mode assertion in Inventory#add is gated on the debug module,
// which checks ARBORIST_DEBUG. The upstream test forces it on so the
// "adding external node to inventory" assertion fires.
process.env.ARBORIST_DEBUG = "1";
const Inventory = (await import("./lib/inventory.js")).default;
const localeCompare = stringLocaleCompare("en");

describe("Inventory", () => {
  it("supports basic operations", () => {
    const i = new Inventory();
    assert.strictEqual(i.primaryKey, "location");
    assert.deepStrictEqual(i.indexes, [
      "name",
      "license",
      "funding",
      "realpath",
      "packageName",
    ]);

    i.add({
      location: "x",
      name: "x",
      package: { licence: "MIT", funding: "foo" },
    });
    i.add({
      location: "y",
      name: "x",
      package: {
        licenses: [{ type: "ISC" }],
        funding: { url: "foo" },
      },
    });
    i.add({
      location: "z",
      name: "z",
      package: { license: { type: "MIT" }, funding: "bar" },
    });
    i.add({ location: "a", name: "a", package: {} });

    assert.deepStrictEqual(
      [...i.filter((node) => /[xy]/.test(node.name))],
      [i.get("x"), i.get("y")],
    );

    assert.deepStrictEqual(
      [...i.query("license")].sort((a, b) =>
        localeCompare(String(a), String(b)),
      ),
      ["ISC", "MIT", undefined],
    );
    assert.deepStrictEqual(
      [...i.query("license", "MIT")],
      [
        {
          location: "x",
          name: "x",
          package: { licence: "MIT", funding: "foo" },
        },
        {
          location: "z",
          name: "z",
          package: { license: { type: "MIT" }, funding: "bar" },
        },
      ],
    );
    assert.deepStrictEqual(i.query("license", "blerg"), new Set());
    assert.deepStrictEqual(
      [...i.query("name", "x")],
      [
        {
          location: "x",
          name: "x",
          package: { licence: "MIT", funding: "foo" },
        },
        {
          location: "y",
          name: "x",
          package: {
            licenses: [{ type: "ISC" }],
            funding: { url: "foo" },
          },
        },
      ],
    );
    assert.deepStrictEqual(
      [...i.query("funding")].sort((a, b) =>
        localeCompare(String(a), String(b)),
      ),
      ["bar", "foo", undefined],
    );
    assert.deepStrictEqual(
      [...i.query("funding", "foo")],
      [
        {
          location: "x",
          name: "x",
          package: { licence: "MIT", funding: "foo" },
        },
        {
          location: "y",
          name: "x",
          package: {
            licenses: [{ type: "ISC" }],
            funding: { url: "foo" },
          },
        },
      ],
    );

    const x = i.get("x");
    assert.deepStrictEqual(x, {
      location: "x",
      name: "x",
      package: { licence: "MIT", funding: "foo" },
    });
    i.add(x);
    assert.strictEqual(i.get("x"), x);
    i.add({
      location: "x",
      name: "a",
      package: { licences: [{ type: "ABC" }] },
    });
    assert.deepStrictEqual(i.get("x"), {
      location: "x",
      name: "a",
      package: { licences: [{ type: "ABC" }] },
    });
    assert.strictEqual(i.has(x), false);

    const a = i.get("a");
    assert.deepStrictEqual([...i.query("license", undefined)], [a]);

    assert.throws(() => i.set("a", "b"), {
      message: "direct set() not supported, use inventory.add(node)",
    });
    const y = i.get("y");
    i.delete({ location: "y" });
    assert.strictEqual(i.get("y"), y);
    i.delete(y);
    assert.strictEqual(i.has(y), false);
    assert.strictEqual(i.get("y"), undefined);

    const z = { location: "z" };
    i.add(z);
    assert.strictEqual(i.get("z"), z);
    z.package = { name: "z" };
    assert.doesNotThrow(() => i.delete(z));
    assert.strictEqual(i.get("z"), undefined);
    assert.strictEqual(i.has(z), false);

    assert.doesNotThrow(() =>
      i.add({
        location: "f",
        name: "f",
        package: {
          license: "MIT",
          funding: null,
        },
      }),
    );

    assert.doesNotThrow(() =>
      i.add({
        location: "l",
        name: "l",
        package: {
          license: null,
        },
      }),
    );

    const n = Object.assign(
      Object.create({
        location: "n",
        get packageName() {
          return this.package.name;
        },
        get package() {
          return this._pkg;
        },
      }),
      { _pkg: { name: "n" } },
    );
    i.add(n);
    assert.strictEqual(i.get("n"), n);
    assert.deepStrictEqual([...i.query("packageName", "n")], [n]);
  });

  it("rejects external nodes in debug mode", () => {
    const i = new Inventory();
    const root = { location: "", path: "rootpath" };
    i.add(root);
    assert.throws(
      () =>
        i.add({
          root: { path: "otherroot" },
          location: "adsf",
          path: "nodepath",
        }),
      {
        message: "adding external node to inventory",
        root: "rootpath",
        node: "nodepath",
        nodeRoot: "otherroot",
      },
    );
  });

  it("silently drops external nodes outside debug mode", async () => {
    // Outside debug mode the assertion is a no-op; the external node is
    // ignored rather than throwing. The upstream test mocks ../lib/debug.js
    // to a no-op; under ESM the equivalent is an esmock of the same path.
    const { default: NonDebugInventory } = await esmock("./lib/inventory.js", {
      "./lib/debug.js": () => {},
    });
    const i = new NonDebugInventory();
    const root = { location: "", path: "rootpath" };
    i.add(root);
    const other = {
      root: { path: "otherroot" },
      location: "adsf",
      path: "nodepath",
    };
    i.add(other);
    assert.strictEqual(i.has(other), false);
  });
});
