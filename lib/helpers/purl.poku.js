import { assert, it } from "poku";

import {
  encodeForPurl,
  mapConanPkgRefToPurlStringAndNameAndVersion,
  purlFromUrlString,
} from "./utils.js";

it("conan package reference mapper to pURL", () => {
  const checkParseResult = (inputPkgRef, expectedPurl) => {
    const [purl, name, version] =
      mapConanPkgRefToPurlStringAndNameAndVersion(inputPkgRef);
    assert.deepStrictEqual(purl, expectedPurl);

    const expectedPurlPrefix = `pkg:conan/${name}@${version}`;
    assert.deepStrictEqual(
      purl.substring(0, expectedPurlPrefix.length),
      expectedPurlPrefix,
    );
  };

  checkParseResult("testpkg", "pkg:conan/testpkg@latest");

  checkParseResult("testpkg/1.2.3", "pkg:conan/testpkg@1.2.3");

  checkParseResult(
    "testpkg/1.2.3#recipe_revision",
    "pkg:conan/testpkg@1.2.3?rrev=recipe_revision",
  );

  checkParseResult(
    "testpkg/1.2.3@someuser/somechannel",
    "pkg:conan/testpkg@1.2.3?channel=somechannel&user=someuser",
  );

  checkParseResult(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision",
    "pkg:conan/testpkg@1.2.3?channel=somechannel&rrev=recipe_revision&user=someuser",
  );

  checkParseResult(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision:package_id#package_revision",
    "pkg:conan/testpkg@1.2.3" +
      "?channel=somechannel" +
      "&prev=package_revision" +
      "&rrev=recipe_revision" +
      "&user=someuser",
  );

  const expectParseError = (pkgRef) => {
    const result = mapConanPkgRefToPurlStringAndNameAndVersion(pkgRef);
    assert.deepStrictEqual(result[0], null);
    assert.deepStrictEqual(result[1], null);
    assert.deepStrictEqual(result[2], null);
  };

  expectParseError("testpkg/"); // empty version
  expectParseError("testpkg/1.2.3@"); // empty user
  expectParseError("testpkg/1.2.3@someuser"); // pkg ref is not allowed to stop here
  expectParseError("testpkg/1.2.3@someuser/"); // empty channel
  expectParseError("testpkg/1.2.3@someuser/somechannel#"); // empty recipe revision
  expectParseError("testpkg/1.2.3@someuser/somechannel#recipe_revision:"); // empty package id
  expectParseError(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision:package_id",
  ); // pkg ref is not allowed to stop here
  expectParseError(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision:package_id#",
  ); // empty package revision
  expectParseError("testpkg/1.2.3/unexpected"); // unexpected pkg ref segment separator
  expectParseError("testpkg/1.2.3@someuser/somechannel/unexpected"); // unexpected pkg ref segment separator
  expectParseError(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision/unexpected",
  ); // unexpected pkg ref segment separator
  expectParseError(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision:package_id/unexpected",
  ); // unexpected pkg ref segment separator
  expectParseError(
    "testpkg/1.2.3@someuser/somechannel#recipe_revision:package_id#package_revision/unexpected",
  ); // unexpected pkg ref segment separator
});

it("assigns default namespace for local swift paths (#2781)", () => {
  const purl = purlFromUrlString("swift", "/Users/arsh/project", "1.0.0");
  assert.equal(purl.namespace, "local");
  assert.equal(purl.name, "project");
  assert.equal(purl.version, "1.0.0");
});

it("assigns name for repoUrls with trailing slash", () => {
  const purl = purlFromUrlString(
    "swift",
    "https://github.com/cdxgen/sample/",
    "1.0.0",
  );
  assert.equal(purl.namespace, "github.com/cdxgen");
  assert.equal(purl.name, "sample");
  assert.equal(purl.version, "1.0.0");
});

it("assigns name for repoUrls without trailing slash", () => {
  const purl = purlFromUrlString(
    "swift",
    "https://github.com/cdxgen/sample",
    "1.0.0",
  );
  assert.equal(purl.namespace, "github.com/cdxgen");
  assert.equal(purl.name, "sample");
  assert.equal(purl.version, "1.0.0");
});

it("purl encode tests", () => {
  assert.deepStrictEqual(
    encodeForPurl("org.apache.commons"),
    "org.apache.commons",
  );
  assert.deepStrictEqual(encodeForPurl("@angular"), "%40angular");
  assert.deepStrictEqual(encodeForPurl("%40angular"), "%40angular");
});
