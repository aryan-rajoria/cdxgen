import { assert, describe, it } from "poku";

import CIMap from "./lib/case-insensitive-map.js";

describe("CIMap", () => {
  it("set values in ctor", () => {
    const cmap = new CIMap([
      ["a", "a"],
      [null, "null"],
      [{ a: 1 }, "a:1"],
      ["A", "A"],
    ]);
    assert.deepStrictEqual(
      [...cmap.entries()],
      [
        [null, "null"],
        [{ a: 1 }, "a:1"],
        ["A", "A"],
      ],
    );
    assert.equal(cmap.has("a"), true);
    assert.equal(cmap.has("A"), true);
    assert.equal(cmap.get("a"), "A");
    cmap.delete("a");
    assert.equal(cmap.has("a"), false);
    assert.equal(cmap.has("A"), false);
    assert.equal(cmap.get("A"), undefined);
  });

  it("set values after ctor", () => {
    const cmap = new CIMap();
    cmap.set("a", "a");
    assert.equal(cmap.has("a"), true);
    assert.equal(cmap.has("A"), true);
    cmap.set(null, "null");
    cmap.set({ a: 1 }, "a:1");
    cmap.set("A", "A");
    assert.deepStrictEqual(
      [...cmap.entries()],
      [
        [null, "null"],
        [{ a: 1 }, "a:1"],
        ["A", "A"],
      ],
    );
    cmap.delete("a");
    assert.equal(cmap.has("a"), false);
    assert.equal(cmap.has("A"), false);
    assert.equal(cmap.get("A"), undefined);
  });

  it("does not get confused with undefined or weird values", () => {
    const cmap = new CIMap();
    cmap.set(undefined, "this is not defined");
    cmap.set(Number.NaN, "this is not a number");
    cmap.set("NaN", "this is a string");
    cmap.set("nan", "this is a quieter string");

    cmap.delete("foo");
    cmap.delete("NAN");
    assert.deepStrictEqual(
      [...cmap.entries()],
      [
        [undefined, "this is not defined"],
        [Number.NaN, "this is not a number"],
      ],
    );
  });
});
