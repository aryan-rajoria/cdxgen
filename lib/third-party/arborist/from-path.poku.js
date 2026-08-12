import { assert, it } from "poku";

import fromPath from "./lib/from-path.js";

// The upstream test routes through fixtures/utils.js#normalizePath so the
// expected values are platform-stable; the helper is two replaces, so it is
// inlined here rather than imported from the upstream fixtures tree.
const normalizePath = (p) =>
  (p ?? "").replace(/[A-Z]:/, "").replace(/\\/g, "/");
const fp = (node, edge) => normalizePath(fromPath(node, edge));

it("from-path uses realpath when there is no resolved spec", () => {
  assert.strictEqual(
    fp({
      realpath: "/some/path",
    }),
    "/some/path",
  );
});

it("from-path uses the target path for directory-type specs", () => {
  assert.strictEqual(
    fp({
      realpath: "/some/path/to/directory",
      resolved: "file:/dont/use/this",
    }),
    "/some/path/to/directory",
  );
});

it("from-path uses the dirname of resolved for file-type specs", () => {
  assert.strictEqual(
    fp({
      realpath: "/some/path/to/install/target",
      resolved: "file:/some/path/to/file.tgz",
    }),
    "/some/path/to",
  );
});

it("from-path uses realpath when the spec is neither dir nor file type", () => {
  assert.strictEqual(
    fp({
      realpath: "/some/path/to/install/target",
      resolved: "https://registry.com/package.tgz",
    }),
    "/some/path/to/install/target",
  );
});

it("from-path uses the root realpath for overridden edges", () => {
  assert.strictEqual(
    fp(
      {
        root: {
          realpath: "/some/root",
        },
      },
      {
        name: "foo",
        overrides: {
          name: "foo",
          value: "foo@2",
        },
      },
    ),
    "/some/root",
  );
});

it("from-path uses the sourceReference root realpath for overridden edges", () => {
  assert.strictEqual(
    fp(
      {
        sourceReference: {
          root: {
            realpath: "/some/root",
          },
        },
        realpath: "/some/red/herring",
      },
      {
        name: "foo",
        overrides: {
          name: "foo",
          value: "foo@2",
        },
      },
    ),
    "/some/root",
  );
});
