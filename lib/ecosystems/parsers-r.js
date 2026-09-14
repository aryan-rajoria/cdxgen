import { readFileSync } from "node:fs";

import { tryBuildPurl } from "../inventory/purl.js";

/**
 * R project parser for renv lock files.
 *
 * `renv.lock` records the R version, the repositories packages were resolved
 * from, and every package in the project library with its exact version, an
 * integrity hash, and the names of the packages it requires. The lock is a
 * JSON document, which makes it a reliable offline source of both the
 * resolved dependency set and the graph between packages.
 *
 * Packages are identified with the registered `cran` purl type
 * (`pkg:cran/<Package>@<Version>`). Requirement strings may carry version
 * constraints (`"R (>= 3.6)"`); only the leading package name is used, and
 * the R runtime itself is recorded as the parent's version rather than an
 * edge.
 */

/**
 * Parse an `renv.lock` file.
 *
 * @param {string} renvLockFile Path to `renv.lock`
 * @returns {{
 *   pkgList: object[],
 *   dependencies: object[],
 *   rootInputs: string[],
 *   parentComponent: object,
 *   rVersion: string|undefined
 * }}
 */
export function parseRenvLock(renvLockFile) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(renvLockFile, "utf-8"));
  } catch (error) {
    console.warn(`Failed to parse ${renvLockFile}: ${error.message}`);
    return emptyResult();
  }
  if (!lock || typeof lock !== "object" || !lock.Packages) {
    return emptyResult();
  }

  const rVersion =
    typeof lock.R?.Version === "string" && lock.R.Version
      ? lock.R.Version
      : undefined;

  const pkgList = [];
  const refByName = new Map();
  for (const record of Object.values(lock.Packages)) {
    if (!record?.Package || !record?.Version) {
      continue;
    }
    const purl = tryBuildPurl({
      type: "cran",
      name: record.Package,
      version: record.Version,
    });
    const properties = [{ name: "internal:SrcFile", value: renvLockFile }];
    if (typeof record.Source === "string" && record.Source) {
      properties.push({
        name: "cdx:renv:source",
        // Normalised to a category so repository flavours stay comparable.
        value: record.Source.toLowerCase(),
      });
    }
    if (typeof record.Repository === "string" && record.Repository) {
      properties.push({
        name: "cdx:renv:repository",
        value: record.Repository,
      });
    }
    if (typeof record.Hash === "string" && record.Hash) {
      // The renv hash covers the package DESCRIPTION, not the artifact bytes,
      // so it belongs in a property rather than the CycloneDX hashes array.
      properties.push({ name: "cdx:renv:hash", value: record.Hash });
    }
    const pkg = {
      name: record.Package,
      version: record.Version,
      type: "library",
      scope: "required",
      properties,
    };
    if (purl) {
      pkg.purl = purl;
      pkg["bom-ref"] = decodeURIComponent(purl);
    } else {
      pkg["bom-ref"] = `library:${record.Package}:${record.Version}`;
    }
    pkgList.push(pkg);
    refByName.set(record.Package, pkg["bom-ref"]);
  }

  // Requirements give the graph between packages; the R runtime ("R" with a
  // constraint) is skipped because it is not a lock entry.
  const dependencies = [];
  const requiredNames = new Set();
  for (const record of Object.values(lock.Packages)) {
    const ref = refByName.get(record?.Package);
    if (!ref) {
      continue;
    }
    const dependsOn = new Set();
    for (const requirement of Array.isArray(record.Requirements)
      ? record.Requirements
      : []) {
      if (typeof requirement !== "string" || !requirement) {
        continue;
      }
      const required = requirement.split(/\s+/u)[0];
      const targetRef = required ? refByName.get(required) : undefined;
      if (targetRef && targetRef !== ref) {
        dependsOn.add(targetRef);
        requiredNames.add(required);
      }
    }
    dependencies.push({ ref, dependsOn: [...dependsOn].sort() });
  }
  const rootInputs = pkgList
    .filter((pkg) => !requiredNames.has(pkg.name))
    .map((pkg) => pkg["bom-ref"]);

  return {
    pkgList,
    dependencies,
    rootInputs,
    parentComponent: {},
    rVersion,
  };
}

/**
 * Shared empty result for unreadable or malformed locks.
 *
 * @returns {{pkgList: object[], dependencies: object[], rootInputs: string[], parentComponent: object, rVersion: undefined}}
 */
function emptyResult() {
  return {
    pkgList: [],
    dependencies: [],
    rootInputs: [],
    parentComponent: {},
    rVersion: undefined,
  };
}
