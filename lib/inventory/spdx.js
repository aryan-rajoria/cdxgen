import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readEnvironmentVariable } from "../core/activity.js";
import { safeExistsSync } from "../core/fs.js";
// `dirNameStr` comes from the leaf module, not from utils.js: it is read here at
// module-evaluation time, and spdx.js <-> utils.js is a cycle, so importing it
// from utils.js would hit the temporal dead zone. See lib/helpers/paths.js.
import { dirNameStr } from "../core/paths.js";
import { urlHostMatches } from "../core/urls.js";
import { normalizeLicense, parseSpdxExpression } from "./licenseEnhancer.js";

const licenseMapping = JSON.parse(
  readFileSync(join(dirNameStr, "data", "lic-mapping.json"), "utf-8"),
);
/**
 * Parsed list of SPDX license identifiers loaded from `data/spdx-licenses.json`.
 *
 * @type {string[]}
 */
export const spdxLicenses = JSON.parse(
  readFileSync(join(dirNameStr, "data", "spdx-licenses.json"), "utf-8"),
);
const knownLicenses = JSON.parse(
  readFileSync(join(dirNameStr, "data", "known-licenses.json"), "utf-8"),
);
const MAX_LICENSE_ID_LENGTH = 100;

/**
 * Method to determine if a license is a valid SPDX license expression
 *
 * @param {string} license License string
 * @returns {boolean} true if the license is a valid SPDX license expression
 * @see https://spdx.dev/learn/handling-license-info/
 **/
export function isSpdxLicenseExpression(license) {
  if (!license) {
    return false;
  }
  // When enhancement is enabled (default), prefer the vendored parser: a valid
  // AST that is not a single bare license id is an expression.
  if (readEnvironmentVariable("CDXGEN_LICENSE_ENHANCE") !== "false") {
    const parsed = parseSpdxExpression(license);
    if (parsed.ast) {
      return parsed.ast.type !== "License" || parsed.ast.plus;
    }
    // The parser could not build an AST; fall back to an operator/paren
    // heuristic (intentionally stricter than the legacy path below: a bare
    // name with whitespace such as "BSD New" must not count as an expression
    // so it can normalize to a single id).
    return (
      /[(]/.test(license) ||
      /\b(AND|OR|WITH)\b/i.test(license) ||
      license.endsWith("+")
    );
  }
  // Legacy heuristic used only when license enhancement is disabled.
  return /[(\s]/.test(license) || license.endsWith("+");
}

/**
 * Convert the array of licenses to a CycloneDX 1.5 compliant license array.
 * This should return an array containing:
 * - one or more SPDX license if no expression is present
 * - the license of the expression if one expression is present
 * - a unified conditional 'OR' license expression if more than one expression is present
 *
 * @param {Array} licenses Array of licenses
 * @returns {Array} CycloneDX 1.5 compliant license array
 */
export function adjustLicenseInformation(licenses) {
  if (!licenses || !Array.isArray(licenses)) {
    return [];
  }

  const expressions = licenses.filter((f) => {
    return f.expression;
  });
  if (expressions.length >= 1) {
    if (expressions.length > 1) {
      return [
        {
          expression: expressions
            .map((e) => e.expression || "")
            .filter(Boolean)
            .join(" OR "),
        },
      ];
    }
    return [{ expression: expressions[0].expression }];
  }
  return licenses.map((l) => {
    if (typeof l.license === "object") {
      return l;
    }
    return { license: l };
  });
}

/**
 * Performs a lookup + validation of the license specified in the
 * package. If the license is a valid SPDX license ID, set the 'id'
 * and url of the license object, otherwise, set the 'name' of the license
 * object.
 */
export function getLicenses(pkg) {
  let license = pkg.license && (pkg.license.type || pkg.license);
  if (license) {
    if (!Array.isArray(license)) {
      license = [license];
    }
    return adjustLicenseInformation(
      license
        .filter((l) => l !== undefined)
        .map((l) => {
          let licenseContent = {};
          if (typeof l === "string" || l instanceof String) {
            if (
              spdxLicenses.some((v) => {
                return l === v;
              })
            ) {
              licenseContent.id = l;
              licenseContent.url = `https://opensource.org/licenses/${l}`;
            } else if (l.startsWith("http")) {
              const knownLicense = getKnownLicense(l, pkg);
              if (knownLicense) {
                licenseContent.id = knownLicense.id;
                licenseContent.name = knownLicense.name;
              }
              // We always need a name to avoid validation errors
              // Issue: #469
              if (!licenseContent.name && !licenseContent.id) {
                licenseContent.name = "CUSTOM";
              }
              licenseContent.url = l;
            } else if (isSpdxLicenseExpression(l)) {
              licenseContent.expression = l;
            } else {
              licenseContent.name = l;
            }
          } else if (Object.keys(l).length) {
            licenseContent = { ...l };
            if (
              licenseContent.type &&
              !licenseContent.id &&
              !licenseContent.name &&
              !licenseContent.expression
            ) {
              if (spdxLicenses.includes(licenseContent.type)) {
                licenseContent.id = licenseContent.type;
              } else if (isSpdxLicenseExpression(licenseContent.type)) {
                licenseContent.expression = licenseContent.type;
              } else {
                licenseContent.name = licenseContent.type;
              }
            }
            if (
              !licenseContent.id &&
              !licenseContent.name &&
              !licenseContent.expression &&
              licenseContent.url?.startsWith("http")
            ) {
              const knownLicense = getKnownLicense(licenseContent.url, pkg);
              if (knownLicense) {
                if (knownLicense.id) {
                  licenseContent.id = knownLicense.id;
                } else if (knownLicense.name) {
                  licenseContent.name = knownLicense.name;
                }
              }
            }
            if (
              !licenseContent.id &&
              !licenseContent.name &&
              !licenseContent.expression
            ) {
              licenseContent.name = "CUSTOM";
            }
            delete licenseContent.type;
          } else {
            return undefined;
          }
          const enableEnhance =
            readEnvironmentVariable("CDXGEN_LICENSE_ENHANCE") !== "false";
          const licenseRef =
            readEnvironmentVariable("CDXGEN_LICENSE_REF") === "true";
          if (enableEnhance) {
            licenseContent = normalizeLicense(licenseContent, {
              licenseRef,
              pkg,
              getKnownLicense,
            });
          }
          if (!licenseContent.id) {
            addLicenseText(pkg, l, licenseContent);
          }
          return licenseContent;
        }),
    );
  }
  const knownLicense = getKnownLicense(undefined, pkg);
  if (knownLicense) {
    return [{ license: knownLicense }];
  }
  return undefined;
}

/**
 * Method to retrieve known license by known-licenses.json
 *
 * @param {String} licenseUrl Repository url
 * @param {String} pkg Bom ref
 * @return {Object} Objetct with SPDX license id or license name
 */
export function getKnownLicense(licenseUrl, pkg) {
  if (urlHostMatches(licenseUrl, "opensource.org")) {
    const possibleId = licenseUrl
      .toLowerCase()
      .replace("https://", "http://")
      .replace("http://www.opensource.org/licenses/", "");
    for (const spdxLicense of spdxLicenses) {
      if (spdxLicense.toLowerCase() === possibleId) {
        return { id: spdxLicense };
      }
    }
  } else if (urlHostMatches(licenseUrl, "apache.org")) {
    const possibleId = licenseUrl
      .toLowerCase()
      .replace("https://", "http://")
      .replace("http://www.apache.org/licenses/license-", "apache-")
      .replace(".txt", "");
    for (const spdxLicense of spdxLicenses) {
      if (spdxLicense.toLowerCase() === possibleId) {
        return { id: spdxLicense };
      }
    }
  }
  for (const akLicGroup of knownLicenses) {
    if (
      akLicGroup.packageNamespace === "*" ||
      pkg.purl?.startsWith(akLicGroup.packageNamespace)
    ) {
      for (const akLic of akLicGroup.knownLicenses) {
        if (akLic.group && akLic.name) {
          if (akLic.group === "." && akLic.name === pkg.name) {
            return { id: akLic.license, name: akLic.licenseName };
          }
          if (
            pkg.group?.includes(akLic.group) &&
            (akLic.name === pkg.name || akLic.name === "*")
          ) {
            return { id: akLic.license, name: akLic.licenseName };
          }
        }
        if (akLic.urlIncludes && licenseUrl?.includes(akLic.urlIncludes)) {
          return { id: akLic.license, name: akLic.licenseName };
        }
        if (akLic.urlEndswith && licenseUrl?.endsWith(akLic.urlEndswith)) {
          return { id: akLic.license, name: akLic.licenseName };
        }
      }
    }
  }
  return undefined;
}

/**
 * Tries to find a file containing the license text based on commonly
 * used naming and content types. If a candidate file is found, add
 * the text to the license text object and stop.
 */
export function addLicenseText(pkg, l, licenseContent) {
  const licenseFilenames = [
    "LICENSE",
    "License",
    "license",
    "LICENCE",
    "Licence",
    "licence",
    "NOTICE",
    "Notice",
    "notice",
  ];
  const licenseContentTypes = {
    "text/plain": "",
    "text/txt": ".txt",
    "text/markdown": ".md",
    "text/xml": ".xml",
  };
  /* Loops over different name combinations starting from the license specified
       naming (e.g., 'LICENSE.Apache-2.0') and proceeding towards more generic names. */
  for (const licenseName of [`.${l}`, ""]) {
    for (const licenseFilename of licenseFilenames) {
      for (const [licenseContentType, fileExtension] of Object.entries(
        licenseContentTypes,
      )) {
        const licenseFilepath = `${pkg.realPath}/${licenseFilename}${licenseName}${fileExtension}`;
        if (safeExistsSync(licenseFilepath)) {
          licenseContent.text = readLicenseText(
            licenseFilepath,
            licenseContentType,
          );
          return;
        }
      }
    }
  }
}

/**
 * Read the file from the given path to the license text object and includes
 * content-type attribute, if not default. Returns the license text object.
 */
export function readLicenseText(licenseFilepath, licenseContentType) {
  const licenseText = readFileSync(licenseFilepath, "utf8");
  if (licenseText) {
    const licenseContentText = { content: licenseText };
    if (licenseContentType !== "text/plain") {
      licenseContentText["contentType"] = licenseContentType;
    }
    return licenseContentText;
  }
  return null;
}

/**
 * Method to find the spdx license id from name
 *
 * @param {string} name License full name
 */
export function findLicenseId(name) {
  if (!name) {
    return undefined;
  }
  for (const l of licenseMapping) {
    if (l.names.includes(name) || l.exp.toUpperCase() === name.toUpperCase()) {
      return l.exp;
    }
  }
  return name && (name.includes("\n") || name.length > MAX_LICENSE_ID_LENGTH)
    ? guessLicenseId(name)
    : name;
}

/**
 * Method to guess the spdx license id from license contents
 *
 * @param {string} content License file contents
 */
export function guessLicenseId(content) {
  content = content.replace(/\n/g, " ");
  for (const l of licenseMapping) {
    for (const j in l.names) {
      if (content.toUpperCase().indexOf(l.names[j].toUpperCase()) > -1) {
        return l.exp;
      }
    }
  }
  return undefined;
}
