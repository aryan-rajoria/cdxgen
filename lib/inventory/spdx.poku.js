import { assert, it } from "poku";

import { findLicenseId, getLicenses } from "../ecosystems/utils.js";

it("finds license id from name", () => {
  assert.deepStrictEqual(
    findLicenseId("Apache License Version 2.0"),
    "Apache-2.0",
  );
  assert.deepStrictEqual(
    findLicenseId("GNU General Public License (GPL) version 2.0"),
    "GPL-2.0-only",
  );
});

/*
it("get repo license", async () => {
  let license = await getRepoLicense(
    "https://github.com/ShiftLeftSecurity/sast-scan",
    {
      group: "ShiftLeftSecurity",
      name: "sast-scan",
    },
  );
  assert.deepStrictEqual(license, {
    id: "Apache-2.0",
    url: "https://github.com/ShiftLeftSecurity/sast-scan/blob/master/LICENSE",
  });

  license = await getRepoLicense("https://github.com/cdxgen/cdxgen", {
    group: "cyclonedx",
    name: "cdxgen",
  });
  assert.deepStrictEqual(license, {
    id: "Apache-2.0",
    url: "https://github.com/cdxgen/cdxgen/blob/master/LICENSE",
  });

  license = await getRepoLicense("https://cloud.google.com/go", {
    group: "cloud.google.com",
    name: "go"
  });
  assert.deepStrictEqual(license, "Apache-2.0");

  license = await getRepoLicense(undefined, {
    group: "github.com/ugorji",
    name: "go"
  });
  assert.deepStrictEqual(license, {
    id: "MIT",
    url: "https://github.com/ugorji/go/blob/master/LICENSE"
  });
});

it("get go pkg license", async () => {
  let license = await getGoPkgLicense({
    group: "github.com/Azure/azure-amqp-common-go",
    name: "v2",
  });
  assert.deepStrictEqual(license, [
    {
      id: "MIT",
      url: "https://pkg.go.dev/github.com/Azure/azure-amqp-common-go/v2?tab=licenses",
    },
  ]);

  license = await getGoPkgLicense({
    group: "go.opencensus.io",
    name: "go.opencensus.io",
  });
  assert.deepStrictEqual(license, [
    {
      id: "Apache-2.0",
      url: "https://pkg.go.dev/go.opencensus.io?tab=licenses",
    },
  ]);

  license = await getGoPkgLicense({
    group: "github.com/DataDog",
    name: "zstd",
  });
  assert.deepStrictEqual(license, [
    {
      id: "BSD-3-Clause",
      url: "https://pkg.go.dev/github.com/DataDog/zstd?tab=licenses",
    },
  ]);
});
*/

it("get licenses", () => {
  let licenses = getLicenses({ license: "MIT" });
  assert.deepStrictEqual(licenses, [
    {
      license: {
        id: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
  ]);

  licenses = getLicenses({ license: ["MIT", "GPL-3.0-or-later"] });
  assert.deepStrictEqual(licenses, [
    {
      license: {
        id: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    {
      license: {
        id: "GPL-3.0-or-later",
        url: "https://opensource.org/licenses/GPL-3.0-or-later",
      },
    },
  ]);

  licenses = getLicenses({
    license: {
      id: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  });
  assert.deepStrictEqual(licenses, [
    {
      license: {
        id: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
  ]);

  licenses = getLicenses({
    license: [
      {
        type: "MIT",
        url: "https://github.com/harvesthq/chosen/blob/master/LICENSE.md",
      },
    ],
  });
  assert.deepStrictEqual(licenses, [
    {
      license: {
        id: "MIT",
        url: "https://github.com/harvesthq/chosen/blob/master/LICENSE.md",
      },
    },
  ]);

  licenses = getLicenses({
    license: "GPL-2.0+",
  });
  assert.deepStrictEqual(licenses, [
    {
      license: {
        id: "GPL-2.0-or-later",
        url: "https://opensource.org/licenses/GPL-2.0-or-later",
      },
    },
  ]);

  licenses = getLicenses({
    license: "(MIT or Apache-2.0)",
  });
  assert.deepStrictEqual(licenses, [
    {
      expression: "MIT OR Apache-2.0",
    },
  ]);

  // In case this is not a known license in the current build but it is a valid SPDX license expression
  licenses = getLicenses({
    license: "NOT-GPL-2.1+",
  });
  assert.deepStrictEqual(licenses, [
    {
      expression: "NOT-GPL-2.1+",
    },
  ]);

  licenses = getLicenses({
    license: "GPL-3.0-only WITH Classpath-exception-2.0",
  });
  assert.deepStrictEqual(licenses, [
    {
      expression: "GPL-3.0-only WITH Classpath-exception-2.0",
    },
  ]);

  // New cases for license enhancement
  assert.deepStrictEqual(getLicenses({ license: "Apache 2.0" }), [
    {
      license: {
        id: "Apache-2.0",
        url: "https://opensource.org/licenses/Apache-2.0",
      },
    },
  ]);

  assert.deepStrictEqual(getLicenses({ license: "GPL-3.0" }), [
    {
      license: {
        id: "GPL-3.0-only",
        url: "https://opensource.org/licenses/GPL-3.0-only",
      },
    },
  ]);

  assert.deepStrictEqual(getLicenses({ license: "BSD New" }), [
    {
      license: {
        id: "BSD-3-Clause",
        url: "https://opensource.org/licenses/BSD-3-Clause",
      },
    },
  ]);

  licenses = getLicenses({
    license: undefined,
  });
  assert.deepStrictEqual(licenses, undefined);
});
