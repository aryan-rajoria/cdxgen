// Reads the tap snapshot files copied verbatim from upstream arborist into
// ./snapshots, so ported tests can assert against the committed upstream
// expectation rather than against their own output.
//
// tap serialises a value as a tree of `ClassName { "key": value }`,
// `Map { "key" => value }`, `Set { value }` and `Array [ value ]`, with the
// keys of objects and class instances sorted. `parseSnapshotValue` turns that
// text back into a canonical form, and `canonical` puts a live value into the
// same form, so the two can be compared with a deep equality check.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

const snapshotDir = join(dirname(fileURLToPath(import.meta.url)), "snapshots");

const CONTAINER = /^([A-Za-z_$][\w$]*)?\s*([{[])/;

class Cursor {
  constructor(text) {
    this.text = text;
    this.at = 0;
  }

  skipSpace() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at])) {
      this.at++;
    }
  }

  eat(token) {
    this.skipSpace();
    if (this.text.startsWith(token, this.at)) {
      this.at += token.length;
      return true;
    }
    return false;
  }

  expect(token) {
    if (!this.eat(token)) {
      throw new Error(
        `expected ${token} at ${this.at}: ${this.text.slice(this.at, this.at + 40)}`,
      );
    }
  }
}

function readString(cursor) {
  cursor.expect('"');
  let out = "";
  while (true) {
    const ch = cursor.text[cursor.at++];
    if (ch === undefined) {
      throw new Error("unterminated string in snapshot");
    }
    if (ch === '"') {
      return out;
    }
    if (ch === "\\") {
      const escaped = cursor.text[cursor.at++];
      out +=
        escaped === "n"
          ? "\n"
          : escaped === "t"
            ? "\t"
            : escaped === "r"
              ? "\r"
              : escaped;
      continue;
    }
    out += ch;
  }
}

function readScalar(cursor) {
  cursor.skipSpace();
  const rest = cursor.text.slice(cursor.at);
  const match =
    /^(true|false|null|undefined|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i.exec(rest);
  if (!match) {
    throw new Error(`unrecognised value at ${cursor.at}: ${rest.slice(0, 40)}`);
  }
  cursor.at += match[0].length;
  const raw = match[0];
  return raw === "true"
    ? true
    : raw === "false"
      ? false
      : raw === "null"
        ? null
        : raw === "undefined"
          ? undefined
          : Number(raw);
}

function readValue(cursor) {
  cursor.skipSpace();
  if (cursor.text[cursor.at] === '"') {
    return readString(cursor);
  }

  const container = CONTAINER.exec(cursor.text.slice(cursor.at));
  if (!container) {
    return readScalar(cursor);
  }

  const [matched, name, open] = container;
  cursor.at += matched.length;
  const close = open === "{" ? "}" : "]";
  const keyed = open === "{" && name !== "Set";
  const type = name ?? "Object";
  const entries = [];

  while (!cursor.eat(close)) {
    if (keyed) {
      const key = readString(cursor);
      // `:` separates the members of an object, `=>` those of a Map.
      if (!cursor.eat(":") && !cursor.eat("=>")) {
        throw new Error(`expected : or => after key ${key}`);
      }
      entries.push([key, readValue(cursor)]);
    } else {
      entries.push(readValue(cursor));
    }
    cursor.eat(",");
  }

  return { type, entries };
}

/** Parse one tap-serialised value into its canonical form. */
export function parseSnapshotValue(text) {
  const cursor = new Cursor(text);
  const value = readValue(cursor);
  cursor.skipSpace();
  if (cursor.at !== cursor.text.length) {
    throw new Error(`trailing snapshot content at ${cursor.at}`);
  }
  return value;
}

/**
 * Put a live value into the same canonical form tap's serialisation parses to.
 * Object and class-instance keys are sorted, matching tap; Map, Set and array
 * order is preserved.
 */
export function canonical(value, clean = (s) => s) {
  if (typeof value === "string") {
    return clean(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return { type: "Array", entries: value.map((v) => canonical(v, clean)) };
  }
  if (value instanceof Set) {
    return { type: "Set", entries: [...value].map((v) => canonical(v, clean)) };
  }
  if (value instanceof Map) {
    return {
      type: value.constructor.name,
      entries: [...value].map(([k, v]) => [clean(k), canonical(v, clean)]),
    };
  }
  const name = value.constructor?.name ?? "Object";
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => [key, canonical(value[key], clean)]);
  return { type: name, entries };
}

/**
 * Read one named expectation out of a copied upstream tap snapshot file.
 * `name` is the file's basename without extension; `key` is the full snapshot
 * key, for example "test/link.js TAP basic > link 1".
 */
export function readSnapshot(name, key) {
  const file = join(snapshotDir, `${name}.test.cjs`);
  const source = readFileSync(file, "utf8");
  const marker = `exports[\`${key}\`] = \``;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`no snapshot "${key}" in ${name}.test.cjs`);
  }

  let at = start + marker.length;
  let body = "";
  while (at < source.length) {
    const ch = source[at++];
    if (ch === "\\") {
      body += source[at++];
      continue;
    }
    if (ch === "`") {
      return body;
    }
    body += ch;
  }
  throw new Error(`unterminated snapshot "${key}" in ${name}.test.cjs`);
}

/** Read a snapshot and parse it as a tap-serialised value. */
export function readSnapshotValue(name, key) {
  return parseSnapshotValue(readSnapshot(name, key));
}

describe("tap-snapshot reader", () => {
  it("parses objects, maps, sets and arrays", () => {
    const parsed = parseSnapshotValue(`
Node {
  "children": Map {
    "foo" => Node {
      "name": "foo",
      "version": "1.2.3",
    },
  },
  "edgesIn": Set {
    Edge {
      "name": "foo",
    },
  },
  "extra": Array [
    1,
    true,
    null,
  ],
}`);
    assert.deepStrictEqual(parsed, {
      type: "Node",
      entries: [
        [
          "children",
          {
            type: "Map",
            entries: [
              [
                "foo",
                {
                  type: "Node",
                  entries: [
                    ["name", "foo"],
                    ["version", "1.2.3"],
                  ],
                },
              ],
            ],
          },
        ],
        [
          "edgesIn",
          {
            type: "Set",
            entries: [{ type: "Edge", entries: [["name", "foo"]] }],
          },
        ],
        ["extra", { type: "Array", entries: [1, true, null] }],
      ],
    });
  });

  it("puts a live value into the form the parser produces", () => {
    class Node {
      constructor() {
        this.version = "1.2.3";
        this.name = "foo";
        this.missing = undefined;
      }
    }
    assert.deepStrictEqual(canonical(new Node()), {
      type: "Node",
      entries: [
        ["name", "foo"],
        ["version", "1.2.3"],
      ],
    });
    assert.deepStrictEqual(canonical(new Map([["a", 1]])), {
      type: "Map",
      entries: [["a", 1]],
    });
    assert.deepStrictEqual(canonical(new Set([1, 2])), {
      type: "Set",
      entries: [1, 2],
    });
  });

  it("applies the cleaner to strings and map keys", () => {
    const clean = (s) => s.split("/real/cwd").join("{CWD}");
    assert.deepStrictEqual(
      canonical(new Map([["/real/cwd/a", "/real/cwd/b"]]), clean),
      { type: "Map", entries: [["{CWD}/a", "{CWD}/b"]] },
    );
  });

  it("round-trips a snapshot copied from upstream", () => {
    const value = readSnapshotValue(
      "calc-dep-flags",
      "test/calc-dep-flags.js TAP no reset > after 1",
    );
    assert.strictEqual(value.type, "ArboristNode");
    assert.ok(value.entries.some(([key]) => key === "children"));
  });
});
