import { assert, it } from "poku";

import versionFromTgz from "./lib/version-from-tgz.js";

it("version-from-tgz matches name and version", () => {
  assert.deepStrictEqual(versionFromTgz("asdf-foo", "asdf-foo-1.2.3.tgz"), {
    name: "asdf-foo",
    version: "1.2.3",
  });
  assert.deepStrictEqual(
    versionFromTgz("asdf-foo", "/path/to/asdf-foo-1.2.3.tgz"),
    { name: "asdf-foo", version: "1.2.3" },
  );
  assert.deepStrictEqual(
    versionFromTgz("asdf-foo", "https://x.y/p/a/t/h/asdf-foo-1.2.3.tgz"),
    { name: "asdf-foo", version: "1.2.3" },
  );
});

it("version-from-tgz decodes %2f and %2F scope separators", () => {
  assert.deepStrictEqual(
    versionFromTgz(
      "@asdf/foo",
      "https://x.y/p/a/t/h/@asdf%2ffoo/-/foo-1.2.3.tgz",
    ),
    { name: "@asdf/foo", version: "1.2.3" },
  );
  // When the manifest name does not match the tarball, the tarball wins.
  assert.deepStrictEqual(
    versionFromTgz("blorg", "https://x.y/p/a/t/h/@asdf%2ffoo/-/foo-1.2.3.tgz"),
    { name: "@asdf/foo", version: "1.2.3" },
  );
  assert.deepStrictEqual(
    versionFromTgz(
      "@asdf/foo",
      "https://x.y/p/a/t/h/@asdf%2Ffoo/-/foo-1.2.3.tgz",
    ),
    { name: "@asdf/foo", version: "1.2.3" },
  );
  assert.deepStrictEqual(
    versionFromTgz("blorg", "https://x.y/p/a/t/h/@asdf%2Ffoo/-/foo-1.2.3.tgz"),
    { name: "@asdf/foo", version: "1.2.3" },
  );
});

it("version-from-tgz handles unencoded scoped registry URLs", () => {
  assert.deepStrictEqual(
    versionFromTgz(
      "@asdf/foo",
      "https://x.y/p/a/t/h/@asdf/foo/-/foo-1.2.3.tgz",
    ),
    { name: "@asdf/foo", version: "1.2.3" },
  );
  assert.deepStrictEqual(
    versionFromTgz("blorg", "https://x.y/p/a/t/h/@asdf/foo/-/foo-1.2.3.tgz"),
    { name: "@asdf/foo", version: "1.2.3" },
  );
});

it("version-from-tgz resolves through intermediate path segments", () => {
  assert.deepStrictEqual(
    versionFromTgz(
      "x",
      "https://x.y/p/a/t/h/-/@foo/$bar/-/@asdf/foo/-/foo-1.2.3.tgz",
    ),
    { name: "@asdf/foo", version: "1.2.3" },
  );
});

it("version-from-tgz returns null when the tarball cannot be parsed", () => {
  // The last segment before the tarball must contain the package name; a bare
  // "/-/" prefix means there is no matching parent.
  assert.deepStrictEqual(
    versionFromTgz(
      "x",
      "https://x.y/p/a/t/h/-/@foo/$bar/-/@asdf/foo/foo-1.2.3.tgz",
    ),
    null,
  );
  assert.deepStrictEqual(
    versionFromTgz("x", "https://x.y/-/-/foo-1.2.3.tgz"),
    null,
  );
  // Non-tarball URLs are not parseable.
  assert.deepStrictEqual(
    versionFromTgz("x", "https://host.com/api/v1/tar.gz/master"),
    null,
  );
  assert.deepStrictEqual(versionFromTgz("x", "/path/to/x.tgz"), null);
  assert.deepStrictEqual(versionFromTgz("x", "/path/to/x-a3wasf.tgz"), null);
});
