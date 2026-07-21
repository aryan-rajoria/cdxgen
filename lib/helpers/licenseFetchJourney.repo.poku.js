import process from "node:process";

import { assert, describe, it } from "poku";

import {
  getCratesMetadata,
  getNpmMetadata,
  getNugetMetadata,
  getPyMetadata,
  getRubyGemsMetadata,
} from "./utils.js";

// End-to-end "fetch license" integration tests that hit the real public
// registries for every ecosystem cdxgen enriches. Unlike the unit tests in
// utils.poku.js (which stub createHttpClient and therefore never exercise the
// undici transport), these run the full journey through the shared httpClient.
//
// This guards against transport-level regressions that no mock can catch. For
// example, the migration from got to undici (#4241) dropped transparent
// response decompression, so NuGet's gzip-only registration5-gz-semver2
// endpoint returned raw gzip bytes, JSON.parse threw, getNugetMetadata
// swallowed the error, and every .NET component silently lost its license
// (#4289). A mocked test cannot see that; a real fetch does.
//
// To stay usable offline, genuine transport failures (DNS/connection/timeout)
// are treated as a skip rather than a failure. A successful fetch that yields
// no license is always a hard failure — that is exactly the regression shape.

// undici RequestError codes (and our HTTPError) that indicate the registry was
// simply unreachable, as opposed to reachable-but-returning-unusable data.
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_NON_2XX_3XX_RESPONSE",
]);

function isNetworkError(err) {
  if (!err) {
    return false;
  }
  if (err.name === "AbortError" || NETWORK_ERROR_CODES.has(err.code)) {
    return true;
  }
  return NETWORK_ERROR_CODES.has(err.cause?.code);
}

// A license may land as a SPDX id string ("MIT"), an expression
// ("MIT OR Apache-2.0") or an array of ids (["MIT"]). Any non-empty form counts.
function hasLicense(pkg) {
  const license = pkg?.license;
  if (!license) {
    return false;
  }
  if (Array.isArray(license)) {
    return license.length > 0;
  }
  return String(license).trim().length > 0;
}

// Run the fetcher; on a real network outage, skip so offline runs stay green.
// Otherwise return the enriched package for hard assertions.
async function fetchOrSkip(label, fn) {
  try {
    return { pkg: await fn(), skipped: false };
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn(`Skipping ${label} license journey: registry unreachable`);
      return { pkg: undefined, skipped: true };
    }
    throw err;
  }
}

// Opt out of these networked checks in fully air-gapped CI if ever needed.
const SKIP = process.env.CDXGEN_SKIP_NETWORK_TESTS === "true";
const TIMEOUT = 240000;

describe("fetch license journey (live registries)", () => {
  it(
    "resolves a NuGet license through the gzip registration endpoint",
    async () => {
      if (SKIP) {
        return;
      }
      // Newtonsoft.Json 13.0.3 is MIT and served from the gzip-only
      // registration5-gz-semver2 endpoint — the exact shape of #4289.
      const { pkg, skipped } = await fetchOrSkip("NuGet", async () => {
        const { pkgList } = await getNugetMetadata(
          [
            {
              group: "",
              name: "Newtonsoft.Json",
              version: "13.0.3",
              "bom-ref": "pkg:nuget/Newtonsoft.Json@13.0.3",
            },
          ],
          [],
        );
        return pkgList[0];
      });
      if (skipped) {
        return;
      }
      assert.ok(
        hasLicense(pkg),
        `Expected a NuGet license for Newtonsoft.Json@13.0.3, got ${JSON.stringify(pkg?.license)}`,
      );
    },
    TIMEOUT,
  );

  it(
    "resolves an npm license from the registry",
    async () => {
      if (SKIP) {
        return;
      }
      const { pkg, skipped } = await fetchOrSkip("npm", async () => {
        const cdepList = await getNpmMetadata([
          { name: "lodash", version: "4.17.21" },
        ]);
        return cdepList[0];
      });
      if (skipped) {
        return;
      }
      assert.ok(
        hasLicense(pkg),
        `Expected an npm license for lodash@4.17.21, got ${JSON.stringify(pkg?.license)}`,
      );
    },
    TIMEOUT,
  );

  it(
    "resolves a PyPI license from the JSON API",
    async () => {
      if (SKIP) {
        return;
      }
      // getPyMetadata only enriches when fetchDepsInfo is true.
      const { pkg, skipped } = await fetchOrSkip("PyPI", async () => {
        const cdepList = await getPyMetadata(
          [{ group: "", name: "requests", version: "2.31.0" }],
          true,
        );
        return cdepList[0];
      });
      if (skipped) {
        return;
      }
      assert.ok(
        hasLicense(pkg),
        `Expected a PyPI license for requests@2.31.0, got ${JSON.stringify(pkg?.license)}`,
      );
    },
    TIMEOUT,
  );

  it(
    "resolves a crates.io license",
    async () => {
      if (SKIP) {
        return;
      }
      const { pkg, skipped } = await fetchOrSkip("crates.io", async () => {
        const cdepList = await getCratesMetadata([
          { name: "serde", version: "1.0.197" },
        ]);
        return cdepList[0];
      });
      if (skipped) {
        return;
      }
      assert.ok(
        hasLicense(pkg),
        `Expected a crates.io license for serde@1.0.197, got ${JSON.stringify(pkg?.license)}`,
      );
    },
    TIMEOUT,
  );

  it(
    "resolves a RubyGems license",
    async () => {
      if (SKIP) {
        return;
      }
      const { pkg, skipped } = await fetchOrSkip("RubyGems", async () => {
        const rdepList = await getRubyGemsMetadata([
          { name: "rack", version: "3.0.0" },
        ]);
        return rdepList[0];
      });
      if (skipped) {
        return;
      }
      assert.ok(
        hasLicense(pkg),
        `Expected a RubyGems license for rack@3.0.0, got ${JSON.stringify(pkg?.license)}`,
      );
    },
    TIMEOUT,
  );
});
