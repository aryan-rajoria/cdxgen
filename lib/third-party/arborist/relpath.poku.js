import { assert, it } from "poku";

import relpath from "./lib/relpath.js";

it("relpath produces a forward-slashed relative path", () => {
  assert.strictEqual(relpath("/a/b/c", "/a/b/c/d/e"), "d/e");
});

it("relpath rewrites backslashes as forward slashes", () => {
  // On win32 every separator node:path#relative emits is a backslash. On posix
  // a backslash can only reach the result inside a path segment, which is
  // enough to exercise the rewrite.
  assert.strictEqual(relpath("/a/b", "/a/b/c\\d"), "c/d");
});
