import { Buffer } from "node:buffer";
import {
  constants,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter as _delimiter, basename, dirname, join } from "node:path";

import { build } from "@cdxgen/cdx-purl";
import { globSync } from "glob";
import StreamZip from "node-stream-zip";
import {
  clean,
  coerce,
  compare,
  maxSatisfying,
  parse,
  satisfies,
} from "semver";
import { xml2js } from "xml-js";

import {
  cdxgenAgent,
  DEBUG_MODE,
  readEnvironmentVariable,
} from "../core/activity.js";
import {
  SEARCH_MAVEN_ORG,
  shouldFetchLicense,
  shouldFetchPackageMetadata,
} from "../core/env.js";
import {
  checksumFile,
  getAllFiles,
  multiChecksumFile,
  safeCopyFileSync,
  safeExistsSync,
  safeExtractArchive,
  safeRmSync,
} from "../core/fs.js";
import { thoughtLog } from "../core/logger.js";
import { isWin } from "../core/paths.js";
import { vendorAliases } from "../core/state.js";
import {
  collectJarNS,
  getPomPropertiesFromMavenDir,
  inferJarGroupFromManifest,
  parseJarManifest,
  parsePomXml,
  trimJarGroupSuffix,
} from "../inventory/deps.js";
import {
  prefetchEnabled,
  prefetchedResponse,
  prefetchJson,
} from "../inventory/fetchBatch.js";
import { applyPurl, encodeForPurl, pypiPurl } from "../inventory/purl.js";
import {
  findLicenseId,
  guessLicenseId,
  spdxLicenses,
} from "../inventory/spdx.js";
import { extractLicenseText, extractRepoUrl } from "../parsers/htmlExtract.js";
import {
  collectCargoRegistryProvenanceProperties,
  collectNpmRegistryProvenanceProperties,
  collectPypiRegistryProvenanceProperties,
} from "./registryProvenance.js";

// Metadata cache
export let metadata_cache = {};

// Speed up lookup namespaces for a given jar

// circuit breaker for search maven.org
let search_maven_org_errors = 0;
const MAX_SEARCH_MAVEN_ORG_ERRORS = 1;

// circuit breaker for get repo license
let get_repo_license_errors = 0;
const MAX_GET_REPO_LICENSE_ERRORS = 5;

/**
 * Internal helper to reset metadata_cache. Used by parseGoModData (still in
 * utils.js until batch 6) because ESM forbids reassigning an imported binding.
 * NOT re-exported through the utils.js barrel.
 */
export function _clearMetadataCache() {
  metadata_cache = {};
}

/**
 * Fetches license information for a list of Swift packages by querying the
 * GitHub repository license API for packages hosted on github.com.
 *
 * @param {Object[]} pkgList List of Swift package objects with optional repository.url fields
 * @returns {Promise<Object[]>} Resolved list of package objects, each augmented with a license field where available
 */
export async function getSwiftPackageMetadata(pkgList) {
  const cdepList = [];
  // Swift resolves licences purely through repository lookups, so its whole
  // network cost is one batched round.
  await prefetchRepoLicenses(
    pkgList
      .filter((p) => p.repository?.url?.includes("://github.com/"))
      .map((p) => p.repository.url),
  );
  for (const p of pkgList) {
    if (p.repository?.url) {
      if (p.repository.url.includes("://github.com/")) {
        try {
          p.license = await getRepoLicense(p.repository.url, undefined);
        } catch (_e) {
          console.error("error fetching repo license from", p.repository.url);
        }
      } else {
        if (DEBUG_MODE) {
          console.log(
            p.repository.url,
            "is currently not supported to fetch for licenses",
          );
        }
      }
    } else {
      if (DEBUG_MODE) {
        console.warn("no repository url found for", p.name);
      }
    }
    cdepList.push(p);
  }
  return cdepList;
}

/** Accept header pub.dev requires for its v2 API. */
const PUB_ACCEPT = "application/vnd.pub.v2+json";

/**
 * The registry path segment for a package: the name, scoped by its group when
 * it has one.
 *
 * Extracted so the batch prefetch and the request inside the loop cannot drift
 * apart — a prefetch that computed the URL even slightly differently would
 * silently fetch documents nobody reads and leave the loop making its own
 * serial requests.
 *
 * @param {Object} p Package object with `name` and optional `group`.
 * @returns {string} Registry key, e.g. `@babel/core` or `left-pad`.
 */
function npmRegistryKey(p) {
  if (p.group && p.group !== "") {
    const group = p.group.startsWith("@") ? p.group : `@${p.group}`;
    return `${group}/${p.name}`;
  }
  return p.name;
}

/**
 * Method to retrieve metadata for npm packages by querying npmjs
 *
 * @param {Array} pkgList Package list
 */
export async function getNpmMetadata(pkgList, registryUrl) {
  const NPM_URL =
    registryUrl ||
    readEnvironmentVariable("NPM_URL") ||
    "https://registry.npmjs.org/";
  const cdepList = [];
  // Every URL this loop needs is known up front, so they are fetched
  // concurrently before the loop rather than one at a time inside it. The
  // derivation below is unchanged and still reads `body`; only where `body`
  // comes from differs.
  const prefetched = await prefetchJson(
    prefetchEnabled()
      ? pkgList.map((p) => ({ url: NPM_URL + npmRegistryKey(p) }))
      : [],
  );
  // The licence fallback calls getRepoLicense with a URL that only exists once
  // the registry document has arrived, so it needs a second batched round. The
  // documents are already in hand here, which is why this can be done without a
  // second pass over the network for the registry itself.
  if (prefetched.size) {
    const repoUrls = [];
    for (const p of pkgList) {
      const entry = prefetched.get(NPM_URL + npmRegistryKey(p));
      if (!entry?.ok) {
        continue;
      }
      const body = entry.body;
      const versionLicense = body?.versions?.[p.version]?.license;
      if (!versionLicense && !body?.license && body?.repository?.url) {
        repoUrls.push(body.repository.url);
      }
    }
    await prefetchRepoLicenses(repoUrls);
  }
  for (const p of pkgList) {
    try {
      const key = npmRegistryKey(p);
      // Namespace the cache by registry so packages resolved from a
      // non-default registry (e.g. jsr's npm mirror at npm.jsr.io) do not
      // collide with identically-named packages on the default registry.
      const cacheKey = `${NPM_URL}${key}`;
      let body = {};
      if (metadata_cache[cacheKey]) {
        body = metadata_cache[cacheKey];
      } else {
        const url = NPM_URL + key;
        const res =
          prefetchedResponse(prefetched, url) ||
          (await cdxgenAgent.get(url, {
            responseType: "json",
          }));
        body = res.body;
        metadata_cache[cacheKey] = body;
      }
      p.description =
        body.versions?.[p.version]?.description || body.description;
      p.license =
        body.versions?.[p.version]?.license ||
        body.license ||
        (await getRepoLicense(body.repository?.url, undefined));
      if (body.repository?.url) {
        p.repository = { url: body.repository.url };
      }
      if (body.homepage) {
        p.homepage = { url: body.homepage };
      }
      // Capture the resolved tarball as a distribution external reference when
      // the component does not already carry one. This is the reliable source
      // of a download URL for registries (such as jsr's npm mirror) whose
      // tarball path is not deterministically constructible.
      const distTarball = body.versions?.[p.version]?.dist?.tarball;
      if (distTarball) {
        p.externalReferences = p.externalReferences || [];
        if (
          !p.externalReferences.some(
            (ref) => ref.type === "distribution" && ref.url === distTarball,
          )
        ) {
          p.externalReferences.push({
            type: "distribution",
            url: distTarball,
          });
        }
      }
      p.properties = p.properties || [];
      p.properties.push(
        ...collectNpmRegistryProvenanceProperties(body, p.version),
      );
      cdepList.push(p);
    } catch (_err) {
      cdepList.push(p);
      if (DEBUG_MODE) {
        console.error(p, "was not found on npm");
      }
    }
  }
  return cdepList;
}

/**
 * Method to locate local Gradle, Maven, or Coursier cache files for a given maven coordinate.
 *
 * @param {string} group Maven groupId
 * @param {string} name Maven artifactId
 * @param {string} version Package version
 * @returns {Object|null} Object containing jarPath, sha1, and pomPath, or null
 */
export function findLocalMvnArtifact(group, name, version) {
  if (!group || !name || !version) {
    return null;
  }

  // 1. Gradle cache
  const gradleUserHome = readEnvironmentVariable("GRADLE_USER_HOME");
  const gradleCacheDir =
    readEnvironmentVariable("GRADLE_CACHE_DIR") ||
    (gradleUserHome
      ? join(gradleUserHome, "caches", "modules-2", "files-2.1")
      : join(homedir(), ".gradle", "caches", "modules-2", "files-2.1"));

  if (existsSync(gradleCacheDir)) {
    const gradlePath = join(gradleCacheDir, group, name, version);
    if (existsSync(gradlePath)) {
      try {
        const subdirs = readdirSync(gradlePath);
        let jarPath = null;
        let sha1 = null;
        let pomPath = null;
        for (const subdir of subdirs) {
          const subdirPath = join(gradlePath, subdir);
          if (statSync(subdirPath).isDirectory()) {
            const files = readdirSync(subdirPath);
            for (const file of files) {
              if (
                file.endsWith(".jar") &&
                !file.endsWith("-sources.jar") &&
                !file.endsWith("-javadoc.jar")
              ) {
                jarPath = join(subdirPath, file);
                sha1 = subdir;
              } else if (file.endsWith(".pom")) {
                pomPath = join(subdirPath, file);
              }
            }
          }
        }
        if (jarPath || pomPath) {
          return { jarPath, sha1, pomPath };
        }
      } catch (_err) {
        // ignore
      }
    }
  }

  // 2. Maven local repo
  const mavenLocal = join(homedir(), ".m2", "repository");
  const groupPath = group.replace(/\./g, "/");
  const mavenPath = join(mavenLocal, groupPath, name, version);
  if (existsSync(mavenPath)) {
    const jarPath = join(mavenPath, `${name}-${version}.jar`);
    const pomPath = join(mavenPath, `${name}-${version}.pom`);
    let hasFiles = false;
    const result = {};
    if (existsSync(jarPath)) {
      result.jarPath = jarPath;
      hasFiles = true;
    }
    if (existsSync(pomPath)) {
      result.pomPath = pomPath;
      hasFiles = true;
    }
    if (hasFiles) {
      return result;
    }
  }

  // 3. Coursier cache (SBT)
  let cacheRoot = readEnvironmentVariable("COURSIER_CACHE");
  if (!cacheRoot) {
    if (process.platform === "darwin") {
      cacheRoot = join(homedir(), "Library", "Caches", "Coursier", "v1");
    } else if (process.platform === "win32") {
      const localAppData = readEnvironmentVariable("LOCALAPPDATA");
      if (localAppData) {
        cacheRoot = join(localAppData, "Coursier", "Cache", "v1");
      } else {
        cacheRoot = join(
          homedir(),
          "AppData",
          "Local",
          "Coursier",
          "Cache",
          "v1",
        );
      }
    } else {
      cacheRoot = join(homedir(), ".cache", "coursier", "v1");
    }
  }

  if (existsSync(cacheRoot)) {
    const pattern = `**/${groupPath}/${name}/${version}/*`;
    try {
      const matches = globSync(pattern, { cwd: cacheRoot });
      if (matches && matches.length > 0) {
        let jarPath = null;
        let pomPath = null;
        for (const m of matches) {
          const match = m.replace(/\\/g, "/");
          if (
            match.endsWith(".jar") &&
            !match.endsWith("-sources.jar") &&
            !match.endsWith("-javadoc.jar")
          ) {
            const localPath = join(cacheRoot, match);
            if (existsSync(localPath)) {
              jarPath = localPath;
            }
          } else if (match.endsWith(".pom")) {
            const localPath = join(cacheRoot, match);
            if (existsSync(localPath)) {
              pomPath = localPath;
            }
          }
        }
        if (jarPath || pomPath) {
          return { jarPath, pomPath };
        }
      }
    } catch (_err) {
      // ignore
    }
  }

  return null;
}

/**
 * Method to retrieve metadata for maven packages by querying maven central
 *
 * @param {Array} pkgList Package list
 * @param {Object} jarNSMapping Jar Namespace mapping object
 * @param {Boolean} force Force fetching of license
 *
 * @returns {Array} Updated package list
 */
export async function getMvnMetadata(
  pkgList,
  jarNSMapping = {},
  force = false,
) {
  const MAVEN_CENTRAL_URL =
    readEnvironmentVariable("MAVEN_CENTRAL_URL") ||
    "https://repo1.maven.org/maven2/";
  const ANDROID_MAVEN_URL =
    readEnvironmentVariable("ANDROID_MAVEN_URL") || "https://maven.google.com/";
  const cdepList = [];
  if (!pkgList?.length) {
    return pkgList;
  }
  if (DEBUG_MODE && shouldFetchLicense()) {
    console.log(`About to query maven for ${pkgList.length} packages`);
  }
  // Collect the direct POM URLs the loop is going to need and fetch them in
  // one batched round. Only the direct POMs are prefetched: parent POMs (walked
  // inside fetchPomXmlAsJson) depend on the direct POM's content and stay
  // serial. The conditions below mirror the loop's skip checks so the batch
  // does not request anything the loop would skip.
  const batchUrls = [];
  const seenPomUrls = new Set();
  for (const p of pkgList) {
    const group = p.group || "";
    if (
      !p.version ||
      (group && p.name && p.version && !shouldFetchLicense() && !force) ||
      (group && p.name && p.version && p.license)
    ) {
      continue;
    }
    if (!group || group === "") {
      continue;
    }
    const urlPrefix =
      group.indexOf("android") !== -1 ? ANDROID_MAVEN_URL : MAVEN_CENTRAL_URL;
    const pomUrl = composePomXmlUrl({
      urlPrefix,
      group,
      name: p.name,
      version: p.version,
    });
    if (!seenPomUrls.has(pomUrl)) {
      seenPomUrls.add(pomUrl);
      batchUrls.push({ url: pomUrl, responseType: "text" });
    }
  }
  const ownPomUrls = [];
  if (batchUrls.length) {
    const fetched = await prefetchJson(batchUrls);
    for (const [key, value] of fetched) {
      prefetchedPoms.set(key, value);
      ownPomUrls.push(key);
    }
  }
  try {
    return await enrichMvnPackages(pkgList, cdepList, jarNSMapping, force, {
      MAVEN_CENTRAL_URL,
      ANDROID_MAVEN_URL,
    });
  } finally {
    // Each body is read once, by the loop below. Holding them past that only
    // grows the process, which matters in server mode where one process serves
    // many scans. Only the documents this call fetched are dropped, so a scan
    // running alongside this one keeps its own.
    for (const pomUrl of ownPomUrls) {
      prefetchedPoms.delete(pomUrl);
    }
  }
}

/**
 * Enrich Maven packages from their POMs, reading any document already fetched
 * by {@link getMvnMetadata}'s batch round.
 *
 * @param {Array} pkgList Packages to enrich.
 * @param {Array} cdepList Accumulator for the enriched packages.
 * @param {Object} jarNSMapping Namespace and hash data from jar analysis.
 * @param {Boolean} force Whether to query even when metadata is present.
 * @param {{MAVEN_CENTRAL_URL: string, ANDROID_MAVEN_URL: string}} repos Repository
 *   base URLs resolved by the caller from the environment.
 * @returns {Promise<Array>} The enriched package list.
 */
async function enrichMvnPackages(
  pkgList,
  cdepList,
  jarNSMapping,
  force,
  { MAVEN_CENTRAL_URL, ANDROID_MAVEN_URL },
) {
  for (const p of pkgList) {
    // Reuse any namespace and hashes data from jarNSMapping
    if (jarNSMapping && p.purl && jarNSMapping[p.purl]) {
      if (jarNSMapping[p.purl].jarFile) {
        p.evidence = {
          identity: {
            field: "purl",
            confidence: 0.8,
            methods: [
              {
                technique: "binary-analysis",
                confidence: 0.8,
                value: jarNSMapping[p.purl].jarFile,
              },
            ],
          },
        };
      }
      if (jarNSMapping[p.purl].hashes && !p?.hashes?.length) {
        p.hashes = jarNSMapping[p.purl].hashes;
      }
      if (
        jarNSMapping[p.purl].namespaces &&
        jarNSMapping[p.purl].namespaces.length
      ) {
        if (!p.properties) {
          p.properties = [];
        }
        p.properties.push({
          name: "internal:Namespaces",
          value: jarNSMapping[p.purl].namespaces.join("\n"),
        });
      }
    }
    const localArtifact = findLocalMvnArtifact(p.group, p.name, p.version);
    if (localArtifact) {
      if (localArtifact.jarPath && (!p.hashes || p.hashes.length === 0)) {
        try {
          const hashValues = await multiChecksumFile(
            ["md5", "sha1", "sha256", "sha512"],
            localArtifact.jarPath,
          );
          p.hashes = [
            { alg: "MD5", content: hashValues["md5"] },
            { alg: "SHA-1", content: hashValues["sha1"] },
            { alg: "SHA-256", content: hashValues["sha256"] },
            { alg: "SHA-512", content: hashValues["sha512"] },
          ];
        } catch (_err) {
          if (localArtifact.sha1) {
            p.hashes = [{ alg: "SHA-1", content: localArtifact.sha1 }];
          }
        }
      }
      if (localArtifact.pomPath) {
        try {
          const xmlData = readFileSync(localArtifact.pomPath, "utf-8");
          const pomData = parsePomXml(xmlData);
          if (pomData) {
            if (!p.publisher && pomData.organization?.name?._) {
              p.publisher = pomData.organization.name._;
            }
            if (!p.description && pomData.description) {
              p.description = pomData.description
                .replace(/[ \t]+/g, " ")
                .replace(/^[ \t]+|[ \t]+$/gm, "")
                .replace(/\n\s*\n/g, "\n")
                .trim();
            }
            if (!p.repository && pomData.scm) {
              p.repository = { url: pomData.scm };
            }
            if (!p.license) {
              const parsedLicense = parseLicenseEntryOrArrayFromPomXml(
                pomData.licenses,
              );
              if (parsedLicense) {
                p.license = parsedLicense;
              } else {
                const licenseRegex = /<!--([\s\S]*?)-->[\s\n]*<project/m;
                const match = licenseRegex.exec(xmlData);
                if (match?.[1]) {
                  const commentLicense = findLicenseId(match[1].trim());
                  if (commentLicense) {
                    p.license = commentLicense;
                  }
                }
              }
            }
          }
        } catch (_err) {
          // ignore
        }
      }
    }
    const group = p.group || "";
    // If the package already has key metadata skip querying maven
    if (
      !p.version ||
      (group && p.name && p.version && !shouldFetchLicense() && !force) ||
      (group && p.name && p.version && p.license)
    ) {
      cdepList.push(p);
      continue;
    }
    let urlPrefix = MAVEN_CENTRAL_URL;
    // Ideally we should try one resolver after the other. But it increases the time taken
    if (group.indexOf("android") !== -1) {
      urlPrefix = ANDROID_MAVEN_URL;
    }
    // Querying maven requires a valid group name
    if (!group || group === "") {
      cdepList.push(p);
      continue;
    }
    const pomMetadata = {
      urlPrefix: urlPrefix,
      group: group,
      name: p.name,
      version: p.version,
    };
    try {
      if (DEBUG_MODE) {
        console.log(
          `Querying ${pomMetadata.urlPrefix} for '${group}/${p.name}@${p.version}' ${composePomXmlUrl(
            pomMetadata,
          )}`,
        );
      }
      const bodyJson = await fetchPomXmlAsJson(pomMetadata);
      if (bodyJson) {
        p.publisher = bodyJson?.organization?.name
          ? bodyJson?.organization.name._
          : "";
        p.description = bodyJson?.description
          ? bodyJson.description._.replace(/[ \t]+/g, " ")
              .replace(/^[ \t]+|[ \t]+$/gm, "")
              .replace(/\n\s*\n/g, "\n")
              .trim()
          : "";
        if (bodyJson?.scm?.url) {
          p.repository = { url: bodyJson.scm.url._ };
        }
        p.license =
          parseLicenseEntryOrArrayFromPomXml(bodyJson?.licenses?.license) ||
          (await extractLicenseCommentFromPomXml(pomMetadata)) ||
          (await getRepoLicense(p.repository?.url, undefined));
      }
    } catch (err) {
      if (DEBUG_MODE) {
        console.log(
          `An error occurred when trying to fetch metadata ${pomMetadata}`,
          err,
        );
      }
    } finally {
      cdepList.push(p);
    }
  }
  return cdepList;
}

/**
 * Method to compose URL of pom.xml
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {String} fullUrl
 */
export function composePomXmlUrl({ urlPrefix, group, name, version }) {
  const groupPart = group.replace(/\./g, "/");
  return `${urlPrefix + groupPart}/${name}/${version}/${name}-${version}.pom`;
}

/**
 * Method to fetch pom.xml data and parse it to JSON
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Object|undefined}
 */
export async function fetchPomXmlAsJson({ urlPrefix, group, name, version }) {
  const pomXml = await fetchPomXml({ urlPrefix, group, name, version });
  if (!pomXml) {
    return undefined;
  }
  const options = {
    compact: true,
    spaces: 4,
    textKey: "_",
    attributesKey: "$",
    commentKey: "value",
  };
  const pomJson = xml2js(pomXml, options).project;
  if (pomJson?.parent) {
    const parentXml = await fetchPomXml({
      urlPrefix,
      group: pomJson.parent.groupId?._,
      name: pomJson.parent.artifactId?._,
      version: pomJson.parent.version?._,
    });
    if (!parentXml) {
      return undefined;
    }
    const parentJson = xml2js(parentXml, options).project;
    return { ...parentJson, ...pomJson };
  }
  return pomJson;
}

/**
 * Prefetched POM documents, populated by `getMvnMetadata` before its loop and
 * read by `fetchPomXml`. Module state rather than a parameter because
 * `fetchPomXml` is called from `fetchPomXmlAsJson` (direct + parent) and
 * `extractLicenseCommentFromPomXml`, and threading a map through all of them
 * would be a wide change for no gain.
 *
 * Only the *direct* POMs — the ones whose URLs are known before the loop — are
 * prefetched. The parent POM walk inside `fetchPomXmlAsJson` depends on
 * parsing the direct POM's content, so those URLs are not known up front and
 * remain serial.
 */
const prefetchedPoms = new Map();

/**
 * Method to fetch pom.xml data
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Promise<String>}
 */
export async function fetchPomXml({ urlPrefix, group, name, version }) {
  const fullUrl = composePomXmlUrl({ urlPrefix, group, name, version });
  // A direct POM may have been prefetched by getMvnMetadata's batch round.
  // Parent POMs (fetched from inside fetchPomXmlAsJson) are not prefetched
  // because their URL depends on the direct POM's content, so they fall
  // through to the serial request unchanged.
  try {
    const res =
      prefetchedResponse(prefetchedPoms, fullUrl) ||
      (await cdxgenAgent.get(fullUrl));
    return res.body;
  } catch (_err) {
    return undefined;
  }
}

/**
 * Method extract single or multiple license entries that might appear in pom.xml
 *
 * @param {Object|Array} license
 */
export function parseLicenseEntryOrArrayFromPomXml(license) {
  if (!license) return;
  if (Array.isArray(license)) {
    return license.map((l) => {
      return findLicenseId(l.name?._);
    });
  }
  if (Object.keys(license).length) {
    return [findLicenseId(license.name?._)];
  }
}

/**
 * Method to parse pom.xml in search of a comment containing license text
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Promise<String>} License ID
 */
export async function extractLicenseCommentFromPomXml({
  urlPrefix,
  group,
  name,
  version,
}) {
  const pom_xml = await fetchPomXml({ urlPrefix, group, name, version });
  const licenseRegex = /<!--([\s\S]*?)-->[\s\n]*<project/m;
  const match = licenseRegex.exec(pom_xml);
  if (match?.[1]) {
    return findLicenseId(match[1].trim());
  }
}

/**
 * Method to mimic pip version solver using node-semver
 *
 * @param {Array} versionsList List of version numbers available
 * @param {*} versionSpecifiers pip version specifier
 */
export function guessPypiMatchingVersion(versionsList, versionSpecifiers) {
  versionSpecifiers = versionSpecifiers.replace(/,/g, " ").split(";")[0];
  const comparator = (a, b) => {
    if (!a && !b) {
      return 0;
    }
    if (!a || !coerce(a, { loose: true })) {
      return -1;
    }
    let c = coerce(a, { loose: true }).compare(coerce(b, { loose: true }));
    // if coerced versions are "equal", compare them as strings
    if (c === 0) {
      c = a < b ? -1 : 1;
    }
    return -c;
  };
  // Iterate in the "reverse" order
  for (const rv of versionsList.sort(comparator)) {
    if (satisfies(coerce(rv, { loose: true }), versionSpecifiers, true)) {
      return rv;
    }
  }
  // Let's try to clean and have another go
  return maxSatisfying(versionsList, clean(versionSpecifiers, { loose: true }));
}

/**
 * The PyPI path for a package, or `undefined` when the package will not be
 * queried at all.
 *
 * Shared by the batch prefetch and the request inside the loop so the two
 * cannot construct different URLs. It deliberately reproduces the loop's skip
 * conditions — a URL built for a package the loop skips would be a request the
 * JS path never makes, which is both wasted work and a divergence.
 *
 * @param {Object} p Package object.
 * @returns {string|undefined} Path to append to PYPI_URL.
 */
function pyUrlAddition(p) {
  if (!p?.name) {
    return undefined;
  }
  // A URL as a name, or a package that already has both fields, is not queried.
  if (p.name.includes("https") || (p.license && p.version)) {
    return undefined;
  }
  // Extras (`requests[security]`) are not part of the PyPI path.
  const name = p.name.includes("[") ? p.name.split("[")[0] : p.name;
  return p.version?.trim().length
    ? `${name}/${p.version.trim()}/json`
    : `${name}/json`;
}

/**
 * Method to retrieve metadata for python packages by querying pypi
 *
 * @param {Array} pkgList Package list
 * @param {Boolean} fetchDepsInfo Fetch dependencies info from pypi
 */
export async function getPyMetadata(pkgList, fetchDepsInfo) {
  if (!shouldFetchPackageMetadata() && !fetchDepsInfo) {
    return pkgList;
  }
  const PYPI_URL =
    readEnvironmentVariable("PYPI_URL") || "https://pypi.org/pypi/";
  const cdepList = [];
  // One batched round for the primary lookups. The `django-` retry below is not
  // prefetched: it only fires when the primary 404s, so batching it would issue
  // a request the serial path never makes for every package that resolves.
  const prefetched = await prefetchJson(
    prefetchEnabled()
      ? pkgList
          .map((p) => pyUrlAddition(p))
          .filter(Boolean)
          .map((addition) => ({ url: PYPI_URL + addition }))
      : [],
  );
  for (const p of pkgList) {
    if (!p?.name) {
      continue;
    }
    try {
      // If the package name has a url or already includes license and version skip it
      if (p.name.includes("https") || (p.license && p.version)) {
        cdepList.push(p);
        continue;
      }
      const origName = p.name;
      // Some packages support extra modules
      if (p.name.includes("[")) {
        p.name = p.name.split("[")[0];
      }
      let res;
      let url_addition;
      if (p.version?.trim().length) {
        url_addition = `${p.name}/${p.version.trim()}/json`;
      } else {
        url_addition = `${p.name}/json`;
      }
      try {
        res =
          prefetchedResponse(prefetched, PYPI_URL + url_addition) ||
          (await cdxgenAgent.get(`${PYPI_URL + url_addition}`, {
            responseType: "json",
          }));
      } catch (_err) {
        // retry by prefixing django- to the package name
        res = await cdxgenAgent.get(`${PYPI_URL}django-${url_addition}`, {
          responseType: "json",
        });
        p.name = `django-${p.name}`;
      }
      const body = res.body;
      if (body.info.author && body.info.author.trim() !== "") {
        if (body.info.author_email && body.info.author_email.trim() !== "") {
          p.author = `${body.info.author.trim()} <${body.info.author_email.trim()}>`;
        } else {
          p.author = body.info.author.trim();
        }
      } else if (
        body.info.author_email &&
        body.info.author_email.trim() !== ""
      ) {
        p.author = body.info.author_email.trim();
      }
      if (
        p.name !== body.info?.name &&
        p.name.toLowerCase() === body.info?.name.toLowerCase()
      ) {
        p.name = body.info.name;
      }
      p.description = body.info.summary;
      p.license = [];
      if (body.info.classifiers) {
        for (const c of body.info.classifiers) {
          if (c.startsWith("License :: ")) {
            const licenseName = c.split("::").slice(-1)[0].trim();
            const licenseId = findLicenseId(licenseName);
            if (licenseId && !p.license.includes(licenseId)) {
              p.license.push(licenseId);
            }
          }
        }
      }
      if (body.info.license) {
        const licenseId = findLicenseId(body.info.license);
        if (licenseId && !p.license.includes(licenseId)) {
          p.license.push(licenseId);
        }
      }
      if (body.info.license_expression) {
        const licenseId = findLicenseId(body.info.license_expression);
        if (licenseId && !p.license.includes(licenseId)) {
          p.license.push(licenseId);
        }
      }
      if (body.info.home_page) {
        if (body.info.home_page.includes("git")) {
          p.repository = { url: body.info.home_page };
        } else {
          p.homepage = { url: body.info.home_page };
        }
      }
      // Use the latest version if none specified
      if (!p.version?.trim().length) {
        let versionSpecifiers;
        if (p.properties?.length) {
          for (const pprop of p.properties) {
            if (pprop.name === "cdx:pypi:versionSpecifiers") {
              versionSpecifiers = pprop.value;
              break;
            }
          }
        } else if (
          p.version &&
          (p.version.includes("*") ||
            p.version.includes("<") ||
            p.version.includes(">") ||
            p.version.includes("!"))
        ) {
          versionSpecifiers = p.version;
        }
        if (versionSpecifiers) {
          p.version = guessPypiMatchingVersion(
            Object.keys(body.releases || {}),
            versionSpecifiers,
          );
          // Indicate the confidence with our guess
          p.evidence = {
            identity: {
              field: "version",
              confidence: 0.6,
              methods: [
                {
                  technique: "manifest-analysis",
                  confidence: 0.6,
                  value: `Version specifiers: ${versionSpecifiers}`,
                },
              ],
            },
          };
        }
        // If we have reached here, it means we have not solved the version
        // So assume latest
        if (!p.version) {
          p.version = body.info.version;
          // Indicate the low confidence
          p.evidence = {
            identity: {
              field: "version",
              confidence: 0.5,
              methods: [
                {
                  technique: "source-code-analysis",
                  confidence: 0.5,
                  value: `PyPI package: ${p.name}`,
                },
              ],
            },
          };
        }
      } else if (p.version !== body.info.version) {
        if (!p.properties) {
          p.properties = [];
        }
        p.properties.push({
          name: "cdx:pypi:latest_version",
          value: body.info.version,
        });
        p.properties.push({
          name: "cdx:pypi:resolved_from",
          value: origName,
        });
      }
      const releaseEntries = body.releases?.[p.version]?.length
        ? body.releases[p.version]
        : Array.isArray(body.urls)
          ? body.urls
          : [];
      mergeExternalReferences(
        p,
        collectPypiReleaseExternalReferences(releaseEntries),
      );
      if (releaseEntries.length) {
        const digest = releaseEntries[0].digests;
        if (digest["sha256"]) {
          p._integrity = `sha256-${digest["sha256"]}`;
        } else if (digest["md5"]) {
          p._integrity = `md5-${digest["md5"]}`;
        }
      }
      const purlString = build({
        type: "pypi",
        namespace: "" || null,
        name: p.name.toLowerCase(),
        version: p.version || null,
      });
      p.properties = p.properties || [];
      p.properties.push(
        ...collectPypiRegistryProvenanceProperties(body, p.version),
      );
      p.purl = purlString;
      p["bom-ref"] = decodeURIComponent(purlString);
      cdepList.push(p);
    } catch (_err) {
      if (DEBUG_MODE) {
        console.error(p.name, "is not found on PyPI.");
        console.log(
          "If this package is available from PyPI or a registry, its name might be different from the module name. Raise a ticket at https://github.com/cdxgen/cdxgen/issues so that this can be added to the mapping file pypi-pkg-aliases.json",
        );
        console.log(
          "Alternatively, if this is a package that gets installed directly in your environment and offers a python binding, then track such packages manually.",
        );
      }
      if (!p.version) {
        if (DEBUG_MODE) {
          console.log(
            `Assuming the version as latest for the package ${p.name}`,
          );
        }
        p.version = "latest";
        // Indicate the low confidence
        p.evidence = {
          identity: {
            field: "version",
            confidence: 0,
            methods: [
              {
                technique: "source-code-analysis",
                confidence: 0,
                value: `Module ${p.name}`,
              },
            ],
          },
        };
      }
      const purlString = build({
        type: "pypi",
        namespace: "" || null,
        name: p.name.toLowerCase(),
        version: p.version || null,
      });
      p.purl = purlString;
      p["bom-ref"] = decodeURIComponent(purlString);
      cdepList.push(p);
    }
  }
  return cdepList;
}

/**
 * Method to parse bdist_wheel metadata (dist-info/METADATA)
 *
 * @param {string} mDataFile bdist_wheel metadata file
 * @param {string} rawMetadata Raw metadata
 *
 */
export function parseBdistMetadata(mDataFile, rawMetadata = undefined) {
  const mData = rawMetadata || readFileSync(mDataFile, { encoding: "utf-8" });
  const pkg = {
    name: "",
    version: "",
    description: "",
    author: "",
    licenses: [],
    externalReferences: [],
    properties: [],
  };
  if (mDataFile) {
    pkg.properties.push({ name: "internal:SrcFile", value: mDataFile });
  }
  const lines = mData.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let isBody = false;
  for (const line of lines) {
    if (line.trim() === "") {
      isBody = true;
      continue;
    }
    if (isBody) break;
    const firstColon = line.indexOf(":");
    if (firstColon === -1) continue;
    const key = line.substring(0, firstColon).trim().toLowerCase();
    const value = line.substring(firstColon + 1).trim();
    switch (key) {
      case "name":
        pkg.name = value;
        break;
      case "version":
        pkg.version = value;
        break;
      case "summary":
        pkg.description = value;
        break;
      case "author":
      case "maintainer":
        pkg.publisher = value;
        pkg.author = value;
        break;
      case "license-expression":
        pkg.licenses.push({
          expression: value,
        });
        break;
      case "license":
        if (value !== "UNKNOWN" && pkg.licenses.length === 0) {
          pkg.licenses.push({
            license: {
              name: value,
            },
          });
        }
        break;
      case "home-page":
        pkg.homepage = {
          url: value,
        };
        pkg.externalReferences.push({
          type: "website",
          url: value,
        });
        break;
      case "project-url": {
        const commaIndex = value.indexOf(",");
        if (commaIndex > -1) {
          const label = value.substring(0, commaIndex).trim();
          const url = value.substring(commaIndex + 1).trim();
          const lowerLabel = label.toLowerCase();
          let type = "website";
          if (
            ["source", "source code", "repository", "git"].includes(lowerLabel)
          ) {
            type = "vcs";
            pkg.repository = {
              url: url,
            };
          } else if (
            ["tracker", "bug tracker", "issue tracker", "issues"].includes(
              lowerLabel,
            )
          ) {
            type = "issue-tracker";
          } else if (["changelog", "changes", "history"].includes(lowerLabel)) {
            type = "release-notes";
          } else if (["documentation", "docs"].includes(lowerLabel)) {
            type = "documentation";
          } else if (["funding", "sponsor", "donation"].includes(lowerLabel)) {
            type = "other";
          }
          pkg.externalReferences.push({
            type: type,
            url: url,
            comment: label,
          });
        }
        break;
      }
      case "keywords":
        if (value) {
          pkg.keywords = value.split(",").map((k) => k.trim());
        }
        break;
      case "requires-python":
        pkg.properties.push({
          name: "cdx:python:requires_python",
          value: value,
        });
        break;
    }
  }
  if (mDataFile) {
    pkg.evidence = {
      identity: {
        field: "purl",
        confidence: 0.5,
        methods: [
          {
            technique: "manifest-analysis",
            confidence: 0.5,
            value: mDataFile,
          },
        ],
      },
    };
  }
  applyPurl(pkg, pypiPurl(pkg.name, pkg.version));
  return [pkg];
}

export function createExternalReferenceKey(reference) {
  return JSON.stringify([
    reference.type,
    reference.url,
    reference.comment || "",
  ]);
}

export function mergeExternalReferences(component, references) {
  if (!references?.length) {
    return;
  }
  const existingReferences = component.externalReferences || [];
  const seen = new Set(
    existingReferences.map((reference) =>
      createExternalReferenceKey(reference),
    ),
  );
  for (const reference of references) {
    const dedupeKey = createExternalReferenceKey(reference);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    existingReferences.push(reference);
  }
  if (existingReferences.length) {
    component.externalReferences = existingReferences;
  }
}

function collectPypiReleaseExternalReferences(releaseEntries) {
  const externalReferences = [];
  for (const releaseEntry of releaseEntries || []) {
    if (typeof releaseEntry?.url !== "string" || !releaseEntry.url.trim()) {
      continue;
    }
    externalReferences.push({
      type: "distribution",
      url: releaseEntry.url.trim(),
      comment: releaseEntry.filename || releaseEntry.packagetype,
    });
  }
  return externalReferences;
}

/**
 * Method to construct a GitHub API url for the given repo metadata
 * @param {Object} repoMetadata Repo metadata with group and name
 * @return {String|undefined} github api url (or undefined - if not enough data)
 */
export function repoMetadataToGitHubApiUrl(repoMetadata) {
  if (repoMetadata) {
    const group = repoMetadata.group;
    const name = repoMetadata.name;
    // GITHUB_API_URL is what GitHub Actions itself sets, and it is what a
    // GitHub Enterprise user needs. It also makes this path testable without
    // reaching the real api.github.com, which is why the licence lookups had no
    // offline coverage before.
    const apiBase = (
      readEnvironmentVariable("GITHUB_API_URL") || "https://api.github.com"
    ).replace(/\/$/, "");
    let ghUrl = `${apiBase}/repos`;
    if (group && group !== "." && group !== "") {
      ghUrl = `${ghUrl}/${group.replace("github.com/", "")}`;
    }
    ghUrl = `${ghUrl}/${name}`;
    return ghUrl;
  }
  return undefined;
}

/**
 * Method to split GitHub url into its parts
 * @param {String} repoUrl Repository url
 * @return {[String]} parts from url
 */
export function getGithubUrlParts(repoUrl) {
  if (repoUrl.toLowerCase().endsWith(".git")) {
    repoUrl = repoUrl.slice(0, -4);
  }
  repoUrl.replace(/\/$/, "");
  return repoUrl.split("/");
}

/**
 * Method to construct GitHub api url from repo metadata or one of multiple formats of repo URLs
 * @param {String} repoUrl Repository url
 * @param {Object} repoMetadata Object containing group and package name strings
 * @return {String|undefined} github api url (or undefined - if not a GitHub repo)
 */
export function toGitHubApiUrl(repoUrl, repoMetadata) {
  if (repoMetadata) {
    return repoMetadataToGitHubApiUrl(repoMetadata);
  }
  const parts = getGithubUrlParts(repoUrl);
  if (parts.length < 5 || parts[2] !== "github.com") {
    return undefined; // Not a valid GitHub repo URL
  }
  return repoMetadataToGitHubApiUrl({
    group: parts[3],
    name: parts[4],
  });
}

/**
 * Method to retrieve repo license by querying github api
 *
 * @param {String} repoUrl Repository url
 * @param {Object} repoMetadata Object containing group and package name strings
 * @return {Promise<String>} SPDX license id
 */
/**
 * URLs for repository licence lookups, prefetched by {@link prefetchRepoLicenses}.
 *
 * Module state rather than a parameter because `getRepoLicense` is called from
 * eight places, several of them deep inside other metadata functions, and
 * threading a map through all of them would be a wide change for no gain. A
 * miss simply means the lookup issues its own request.
 */
let repoLicensePrefetch = new Map();

/**
 * Prefetch the GitHub licence endpoint for a list of repository URLs.
 *
 * The single biggest remaining serialisation: `getRepoLicense` is called once
 * per component from npm, Maven, Swift and Go, each call a full round trip to
 * api.github.com. Batching them also makes the authenticated concurrency
 * allowance worth having — with `GITHUB_TOKEN` set, cdxrs runs eight of these at
 * a time instead of one.
 *
 * @param {Array<string|undefined>} repoUrls Repository URLs (duplicates and
 *   empties are fine).
 * @returns {Promise<void>}
 */
export async function prefetchRepoLicenses(repoUrls) {
  if (!prefetchEnabled() || !Array.isArray(repoUrls)) {
    return;
  }
  const requests = [];
  const seen = new Set();
  for (const repoUrl of repoUrls) {
    if (!repoUrl) {
      continue;
    }
    const apiUrl = toGitHubApiUrl(repoUrl, undefined);
    if (!apiUrl) {
      continue;
    }
    const licenseUrl = `${apiUrl}/license`;
    if (seen.has(licenseUrl)) {
      continue;
    }
    seen.add(licenseUrl);
    requests.push({
      url: licenseUrl,
      // The realm keys the cache per repository, never on the token itself, so
      // an authenticated response cannot be served to an anonymous lookup.
      authRealm: readEnvironmentVariable("GITHUB_TOKEN")
        ? `github-auth:${apiUrl}`
        : undefined,
    });
  }
  if (!requests.length) {
    return;
  }
  const fetched = await prefetchJson(requests);
  for (const [key, value] of fetched) {
    repoLicensePrefetch.set(key, value);
  }
}

/**
 * Discard prefetched repository licences. Tests only.
 */
export function resetRepoLicensePrefetch() {
  repoLicensePrefetch = new Map();
}

export async function getRepoLicense(repoUrl, repoMetadata) {
  if (!repoUrl) {
    return undefined;
  }
  const apiUrl = toGitHubApiUrl(repoUrl, repoMetadata);
  // Perform github lookups
  if (apiUrl && get_repo_license_errors < MAX_GET_REPO_LICENSE_ERRORS) {
    const licenseUrl = `${apiUrl}/license`;
    const headers = {};
    if (readEnvironmentVariable("GITHUB_TOKEN")) {
      headers["Authorization"] =
        `Bearer ${readEnvironmentVariable("GITHUB_TOKEN")}`;
    }
    try {
      const res =
        prefetchedResponse(repoLicensePrefetch, licenseUrl) ||
        (await cdxgenAgent.get(licenseUrl, {
          responseType: "json",
          headers: headers,
        }));
      if (res?.body) {
        const license = res.body.license;
        let licenseId = license.spdx_id;
        const licObj = {
          url: res.body.html_url,
        };
        if (license.spdx_id === "NOASSERTION") {
          if (res.body.content) {
            const content = Buffer.from(res.body.content, "base64").toString(
              "ascii",
            );
            licenseId = guessLicenseId(content);
          }
          // If content match fails attempt to find by name
          if (!licenseId && license.name.toLowerCase() !== "other") {
            licenseId = findLicenseId(license.name);
            licObj["name"] = license.name;
          }
        }
        licObj["id"] = licenseId;
        if (licObj["id"] || licObj["name"]) {
          return licObj;
        }
      }
    } catch (err) {
      if (err?.message) {
        if (
          err.message.includes("rate limit exceeded") &&
          !readEnvironmentVariable("GITHUB_TOKEN")
        ) {
          console.log(
            "Rate limit exceeded for REST API of github.com. " +
              "Please ensure GITHUB_TOKEN is set as environment variable. " +
              "See: https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api",
          );
          get_repo_license_errors++;
        } else if (!err.message.includes("404")) {
          get_repo_license_errors++;
        }
      }
    }
  }
  return undefined;
}

/**
 * Method to get go pkg license from go.dev site.
 *
 * @param {Object} repoMetadata Repo metadata
 */
export async function getGoPkgLicense(repoMetadata) {
  const group = repoMetadata.group;
  const pkgUrl = `${getGoPkgUrl(repoMetadata)}?tab=licenses`;
  // Check the metadata cache first
  if (metadata_cache[pkgUrl]) {
    return metadata_cache[pkgUrl];
  }
  try {
    const res = await cdxgenAgent.get(pkgUrl);
    if (res?.body) {
      const licenses = extractLicenseText(res.body);
      const licenseIds = licenses.split(", ");
      const licList = [];
      for (const id of licenseIds) {
        if (id.trim().length) {
          const alicense = {};
          if (id.includes(" ")) {
            alicense.name = id
              .trim()
              .replace(/ {2}/g, "")
              .replace("\n", " ")
              .replace("\n", " OR ");
          } else {
            alicense.id = id.trim();
          }
          alicense["url"] = pkgUrl;
          licList.push(alicense);
        }
      }
      metadata_cache[pkgUrl] = licList;
      return licList;
    }
  } catch (_err) {
    return undefined;
  }
  if (group.indexOf("github.com") > -1) {
    return await getRepoLicense(undefined, repoMetadata);
  }
  return undefined;
}

/**
 * Method to get go pkg vcs url from go.dev site.
 *
 * @param {String} group Package group
 * @param {String} name Package name
 */
export async function getGoPkgVCSUrl(group, name) {
  const fullName = getGoPkgFullName(group, name);
  if (fullName.startsWith("github.com") || fullName.startsWith("gitlab.com")) {
    return `https://${fullName}`;
  }
  const pkgUrl = getGoPkgUrl({ fullName });
  if (metadata_cache[pkgUrl]) {
    return metadata_cache[pkgUrl];
  }
  try {
    const res = await cdxgenAgent.get(pkgUrl);
    if (res?.body) {
      const vcs = extractRepoUrl(res.body);
      metadata_cache[pkgUrl] = vcs;
      return vcs;
    }
  } catch (_err) {
    return undefined;
  }
  return undefined;
}

/**
 * Method to get go pkg url (go.dev site).
 *
 * @param {Object} pkgMetadata pkg metadata
 */
function getGoPkgUrl(pkgMetadata) {
  const pkgUrlPrefix =
    readEnvironmentVariable("GO_PKG_URL") || "https://pkg.go.dev/";
  const fullName =
    pkgMetadata.fullName ||
    getGoPkgFullName(pkgMetadata.group, pkgMetadata.name);
  return pkgUrlPrefix + fullName;
}

/**
 * Method to get go pkg full name.
 *
 * @param {String} group Package group
 * @param {String} name Package name
 */
function getGoPkgFullName(group, name) {
  return group && group !== "." && group !== name ? `${group}/${name}` : name;
}

/**
 * Method to retrieve metadata for rust packages by querying crates
 *
 * @param {Array} pkgList Package list
 */
export async function getCratesMetadata(pkgList) {
  const CRATES_URL =
    readEnvironmentVariable("RUST_CRATES_URL") ||
    "https://crates.io/api/v1/crates/";
  const cdepList = [];
  // Two URLs per crate — the crate document and its owners — fetched for the
  // whole list at once. The `workspace` guard below is mirrored here so the
  // batch does not request anything the loop would have skipped.
  const prefetched = await prefetchJson(
    prefetchEnabled()
      ? pkgList
          .filter((p) => p?.name && p?.version && p.version !== "workspace")
          .flatMap((p) => [
            { url: CRATES_URL + p.name },
            { url: `${CRATES_URL + p.name}/owners` },
          ])
      : [],
  );
  for (const p of pkgList) {
    try {
      if (!p?.name || !p?.version || p.version === "workspace") {
        cdepList.push(p);
        continue;
      }
      if (DEBUG_MODE) {
        console.log(`Querying crates.io for ${p.name}@${p.version}`);
      }
      const crateUrl = CRATES_URL + p.name;
      const res =
        prefetchedResponse(prefetched, crateUrl) ||
        (await cdxgenAgent.get(crateUrl, {
          responseType: "json",
        }));
      let ownersRes;
      try {
        const ownersUrl = `${crateUrl}/owners`;
        ownersRes =
          prefetchedResponse(prefetched, ownersUrl) ||
          (await cdxgenAgent.get(ownersUrl, {
            responseType: "json",
          }));
      } catch (_err) {
        ownersRes = undefined;
      }
      let versionToUse = res?.body?.versions[0];
      if (p.version) {
        for (const aversion of res.body.versions) {
          if (aversion.num === p.version) {
            versionToUse = aversion;
            break;
          }
        }
      }
      const body = res.body.crate;
      p.description = body.description;
      if (versionToUse?.license) {
        p.license = versionToUse.license;
      }
      if (body.repository) {
        p.repository = { url: body.repository };
      }
      if (body.homepage && body.homepage !== body.repository) {
        p.homepage = { url: body.homepage };
      }
      // Use the latest version if none specified
      if (!p.version) {
        p.version = body.newest_version;
      }
      if (!p._integrity && versionToUse.checksum) {
        p._integrity = normalizeCargoIntegrity(versionToUse.checksum);
      }
      if (!p.properties) {
        p.properties = [];
      }
      p.properties.push({
        name: "cdx:cargo:crate_id",
        value: `${versionToUse.id}`,
      });
      if (versionToUse.rust_version) {
        p.properties.push({
          name: "cdx:cargo:rust_version",
          value: `${versionToUse.rust_version}`,
        });
      }
      p.properties.push({
        name: "cdx:cargo:latest_version",
        value: body.newest_version,
      });
      p.distribution = { url: `https://crates.io${versionToUse.dl_path}` };
      if (versionToUse.features && Object.keys(versionToUse.features).length) {
        p.properties.push({
          name: "cdx:cargo:features",
          value: JSON.stringify(versionToUse.features),
        });
      }
      p.properties = p.properties.concat(
        collectCargoRegistryProvenanceProperties(
          res?.body,
          versionToUse?.num || p.version,
          ownersRes?.body,
        ),
      );
      cdepList.push(p);
    } catch (_err) {
      cdepList.push(p);
    }
  }
  return cdepList;
}

/**
 * Method to retrieve metadata for dart packages by querying pub.dev
 *
 * @param {Array} pkgList Package list
 */
export async function getDartMetadata(pkgList) {
  const PUB_DEV_URL =
    readEnvironmentVariable("PUB_DEV_URL") || "https://pub.dev";
  const PUB_LICENSE_REGEX = /^license:/i;
  const OPTIONS = {
    responseType: "json",
    headers: {
      Accept: PUB_ACCEPT,
    },
  };

  const cdepList = [];
  // pub.dev needs the package document and its score document; both carry the
  // vendor Accept header, which is part of the cache key on the Rust side.
  const prefetched = await prefetchJson(
    prefetchEnabled()
      ? pkgList.flatMap((p) => {
          const base = `${PUB_DEV_URL}/api/packages/${p.name}/versions/${p.version}`;
          return [
            { url: base, accept: PUB_ACCEPT },
            { url: `${base}/score`, accept: PUB_ACCEPT },
          ];
        })
      : [],
  );
  for (const p of pkgList) {
    try {
      if (DEBUG_MODE) {
        console.log(`Querying ${PUB_DEV_URL} for ${p.name}`);
      }
      const PUB_PACKAGE_URL = `${PUB_DEV_URL}/api/packages/${p.name}/versions/${p.version}`;
      const PUB_PACKAGE_SCORE_URL = `${PUB_PACKAGE_URL}/score`;
      const res =
        prefetchedResponse(prefetched, PUB_PACKAGE_URL) ||
        (await cdxgenAgent.get(PUB_PACKAGE_URL, OPTIONS));
      if (res?.body) {
        const pubspec = res.body.pubspec;
        p.description = pubspec.description;
        if (pubspec.repository) {
          p.repository = { url: pubspec.repository };
        }
        if (pubspec.homepage) {
          p.homepage = { url: pubspec.homepage };
        }
        const score =
          prefetchedResponse(prefetched, PUB_PACKAGE_SCORE_URL) ||
          (await cdxgenAgent.get(PUB_PACKAGE_SCORE_URL, OPTIONS));
        if (score?.body) {
          const tags = score.body.tags;
          const license = tags.find((tag) => PUB_LICENSE_REGEX.test(tag));
          if (license) {
            p.license = spdxLicenses.find(
              (spdxLicense) =>
                spdxLicense.toLowerCase() ===
                license.replace(PUB_LICENSE_REGEX, "").toLowerCase(),
            );
          }
        }
        cdepList.push(p);
      }
    } catch (_err) {
      cdepList.push(p);
    }
  }
  return cdepList;
}

export function normalizeCargoIntegrity(integrity) {
  if (typeof integrity !== "string") {
    return undefined;
  }
  const normalizedIntegrity = integrity.trim().toLowerCase();
  const prefixedMatch = /^(sha256|sha384)-(?<digest>[a-f0-9]+)$/i.exec(
    normalizedIntegrity,
  );
  if (prefixedMatch?.groups?.digest) {
    const algorithm = prefixedMatch[1].toLowerCase();
    const digest = prefixedMatch.groups.digest;
    const expectedDigestLength = algorithm === "sha384" ? 96 : 64;
    if (digest.length === expectedDigestLength) {
      return `${algorithm}-${digest}`;
    }
    return undefined;
  }
  if (!/^[a-f0-9]+$/i.test(normalizedIntegrity)) {
    return undefined;
  }
  if (normalizedIntegrity.length === 64) {
    return `sha256-${normalizedIntegrity}`;
  }
  if (normalizedIntegrity.length === 96) {
    return `sha384-${normalizedIntegrity}`;
  }
  return undefined;
}

/**
 * Method to extract a war or ear file
 *
 * @param {string} jarFile Path to jar file
 * @param {string} tempDir Temporary directory to use for extraction
 * @param {object} jarNSMapping Jar class names mapping object
 *
 * @return pkgList Package list
 */
export async function extractJarArchive(jarFile, tempDir, jarNSMapping = {}) {
  const pkgList = [];
  let jarFiles = [];
  const fname = basename(jarFile);
  let pomname;
  // If there is a pom file in the same directory, try to use it
  const manifestname = join(dirname(jarFile), "META-INF", "MANIFEST.MF");
  // Issue 439: Current implementation checks for existance of a .pom file, but .pom file is not used.
  // Instead code expects to find META-INF/MANIFEST.MF in the same folder as a .jar file.
  // For now check for presence of both .pom and MANIFEST.MF files.
  if (jarFile.endsWith(".jar")) {
    pomname = jarFile.replace(".jar", ".pom");
  }
  if (
    pomname &&
    safeExistsSync(pomname) &&
    manifestname &&
    safeExistsSync(manifestname)
  ) {
    tempDir = dirname(jarFile);
  } else if (
    !safeExistsSync(join(tempDir, fname)) &&
    safeExistsSync(jarFile) &&
    lstatSync(jarFile).isFile()
  ) {
    // Only copy if the file doesn't exist
    safeCopyFileSync(jarFile, join(tempDir, fname), constants.COPYFILE_FICLONE);
  }
  const env = {
    ...process.env,
  };
  // jar command usually would not be available in the PATH for windows
  if (isWin && env.JAVA_HOME) {
    env.PATH = `${env.PATH || env.Path}${_delimiter}${join(
      env.JAVA_HOME,
      "bin",
    )}`;
  }
  if (
    jarFile.endsWith(".war") ||
    jarFile.endsWith(".hpi") ||
    jarFile.endsWith(".jar")
  ) {
    if (safeExistsSync(join(tempDir, fname))) {
      try {
        const zip = new StreamZip.async({ file: join(tempDir, fname) });
        const extracted = await safeExtractArchive(
          join(tempDir, fname),
          tempDir,
          async () => {
            await zip.extract(null, tempDir);
          },
        );
        await zip.close();
        if (!extracted) {
          return pkgList;
        }
      } catch (e) {
        console.log(`Unable to extract ${join(tempDir, fname)}. Skipping.`, e);
        return pkgList;
      }
    }
    jarFiles = getAllFiles(join(tempDir, "WEB-INF", "lib"), "**/*.jar");
    if (jarFile.endsWith(".hpi")) {
      jarFiles.push(jarFile);
    }
    // Some jar files could also have more jar files inside BOOT-INF directory
    const jarFiles2 = getAllFiles(join(tempDir, "BOOT-INF", "lib"), "**/*.jar");
    if (jarFiles && jarFiles2.length) {
      jarFiles = jarFiles.concat(jarFiles2);
    }
    // Fallback. If our jar file didn't include any jar
    if (jarFile.endsWith(".jar") && !jarFiles.length) {
      jarFiles = [join(tempDir, fname)];
    }
  } else {
    jarFiles = [join(tempDir, fname)];
  }
  if (jarFiles?.length) {
    for (const jf of jarFiles) {
      // If the jar file doesn't exist at the point of use, skip it
      if (!safeExistsSync(jf)) {
        if (DEBUG_MODE) {
          console.log(jf, jarFile, "is not a readable file.");
        }
        continue;
      }
      pomname = jf.replace(".jar", ".pom");
      const jarname = basename(jf);
      // Ignore test jars
      if (
        jarname.endsWith("-tests.jar") ||
        jarname.endsWith("-test-sources.jar")
      ) {
        if (DEBUG_MODE) {
          console.log(`Skipping tests jar ${jarname}`);
        }
        continue;
      }
      const manifestDir = join(tempDir, "META-INF");
      const manifestFile = join(manifestDir, "MANIFEST.MF");
      const mavenDir = join(manifestDir, "maven");
      let jarResult = {
        status: 1,
      };
      if (safeExistsSync(pomname)) {
        jarResult = { status: 0 };
      } else {
        // Unzip natively
        try {
          const zip = new StreamZip.async({ file: jf });
          const extracted = await safeExtractArchive(jf, tempDir, async () => {
            await zip.extract(null, tempDir);
          });
          await zip.close();
          jarResult = { status: extracted ? 0 : 1 };
        } catch (_e) {
          if (DEBUG_MODE) {
            console.log(`Unable to extract ${jf}. Skipping.`);
          }
          jarResult = { status: 1 };
        }
      }
      if (jarResult.status === 0) {
        // When maven descriptor is available take group, name and version from pom.properties
        // META-INF/maven/${groupId}/${artifactId}/pom.properties
        // see https://maven.apache.org/shared/maven-archiver/index.html
        const pomProperties = getPomPropertiesFromMavenDir(mavenDir);
        let group = pomProperties["groupId"];
        let name = pomProperties["artifactId"];
        let version = pomProperties["version"];
        let confidence = 0.5;
        let technique = "manifest-analysis";
        if (
          (!group || !name || !version) &&
          SEARCH_MAVEN_ORG &&
          search_maven_org_errors < MAX_SEARCH_MAVEN_ORG_ERRORS
        ) {
          try {
            const sha = await checksumFile("sha1", jf);
            const searchurl = `https://central.sonatype.com/solrsearch/select?q=1:%22${sha}%22&rows=20&wt=json`;
            const res = await cdxgenAgent.get(searchurl, {
              responseType: "json",
              timeout: {
                lookup: 1000,
                connect: 5000,
                secureConnect: 5000,
                socket: 1000,
                send: 10000,
                response: 1000,
              },
            });
            const data = res?.body ? res.body["response"] : undefined;
            if (data && data["numFound"] === 1) {
              const jarInfo = data["docs"][0];
              group = jarInfo["g"];
              name = jarInfo["a"];
              version = jarInfo["v"];
              technique = "hash-comparison";
            }
          } catch (err) {
            if (err?.message && !err.message.includes("404")) {
              if (
                err.message.includes("Timeout") ||
                err.message.includes("429")
              ) {
                console.log(
                  "Maven search appears to be unavailable. Search will be skipped for all remaining packages.",
                );
              }
              search_maven_org_errors++;
            }
          }
        }
        let jarMetadata;
        if ((!group || !name || !version) && safeExistsSync(manifestFile)) {
          confidence = 0.3;
          jarMetadata = parseJarManifest(
            readFileSync(manifestFile, {
              encoding: "utf-8",
            }),
          );
          if (jarMetadata["Bundle-SymbolicName"]) {
            jarMetadata["Bundle-SymbolicName"] = jarMetadata[
              "Bundle-SymbolicName"
            ]
              .split(";")[0]
              .trim();
          }
          group = group || inferJarGroupFromManifest(jarMetadata);
          version =
            version ||
            jarMetadata["Bundle-Version"] ||
            jarMetadata["Implementation-Version"] ||
            jarMetadata["Specification-Version"];
          if (version?.includes(" ")) {
            version = version.split(" ")[0];
          }
          // Prefer jar filename to construct name and version
          const tmpA = jarname.split("-");
          let fileVersionCandidate;
          let nameCandidate;
          if (tmpA && tmpA.length > 1) {
            const lastPart = tmpA[tmpA.length - 1];
            // Bug #768. Check if we have any number before simplifying the name.
            if (/\d/.test(lastPart)) {
              fileVersionCandidate = lastPart.replace(".jar", "");
              nameCandidate = jarname.replace(`-${lastPart}`, "") || "";
              if (nameCandidate.includes(".")) {
                const gnArr = nameCandidate.split(".");
                if (gnArr?.length === 2 && gnArr[0] === gnArr[1]) {
                  nameCandidate = gnArr[1];
                }
              }
            }
          }
          if (
            fileVersionCandidate &&
            (!version ||
              version === "" ||
              (version.includes(fileVersionCandidate) &&
                version.length > fileVersionCandidate.length))
          ) {
            version = fileVersionCandidate;
            confidence = 0.3;
            technique = "filename";
          }
          if (!name || name === "") {
            name = nameCandidate;
          }
          if (
            !name?.length &&
            jarMetadata["Bundle-Name"] &&
            !jarMetadata["Bundle-Name"].includes(" ")
          ) {
            name = jarMetadata["Bundle-Name"];
          } else if (
            !name?.length &&
            jarMetadata["Implementation-Title"] &&
            !jarMetadata["Implementation-Title"].includes(" ")
          ) {
            name = jarMetadata["Implementation-Title"];
          }
          // Sometimes the group might already contain the name
          // Eg: group: org.checkerframework.checker.qual name: checker-qual
          group = trimJarGroupSuffix(group, name);
          // Patch the group string
          if (vendorAliases[name]) {
            group = vendorAliases[name];
          } else {
            for (const aprefix in vendorAliases) {
              if (name?.startsWith(aprefix) || name?.endsWith(`.${aprefix}`)) {
                group = vendorAliases[aprefix];
                if (name?.startsWith(`${group}.`)) {
                  name = name.replace(`${group}.`, "");
                }
                break;
              }
            }
          }
          // if group is empty use name as group
          group = group === "." ? name : group || name;
        }
        if (name) {
          if (!version) {
            confidence = 0;
          }
          const properties = [
            {
              name: "internal:SrcFile",
              value: jf,
            },
          ];
          const purl = build({
            type: "maven",
            namespace: group || null,
            name: name,
            version: version || null,
            qualifiers: { type: "jar" } || null,
          });
          let namespaceValues;
          let namespaceList;
          if (jarNSMapping?.[purl]?.namespaces) {
            namespaceList = jarNSMapping[purl].namespaces;
            namespaceValues = namespaceList.join("\n");
            properties.push({
              name: "internal:Namespaces",
              value: namespaceValues,
            });
          } else {
            const tmpJarNSMapping = await collectJarNS(jf);
            if (tmpJarNSMapping?.[jf]?.namespaces?.length) {
              namespaceList = tmpJarNSMapping[jf].namespaces;
              namespaceValues = namespaceList.join("\n");
              properties.push({
                name: "internal:Namespaces",
                value: namespaceValues,
              });
            }
          }
          // Are there any shaded classes
          if (
            namespaceValues?.includes(".shaded.") ||
            namespaceValues?.includes(".thirdparty.com.")
          ) {
            properties.push({
              name: "cdx:maven:shaded",
              value: "true",
            });
            confidence = 0;
            const unshadedNS = new Set();
            for (const ans of namespaceList) {
              let tmpns;
              if (ans.includes(".shaded.")) {
                tmpns = ans.split(".shaded.").pop();
              } else if (ans.includes(".thirdparty.")) {
                tmpns = ans.split(".thirdparty.").pop();
              }
              if (tmpns?.search("[.]") > 3) {
                unshadedNS.add(tmpns.split("$")[0]);
              }
            }
            if (unshadedNS.size) {
              properties.push({
                name: "cdx:maven:unshadedNamespaces",
                value: Array.from(unshadedNS).join("\n"),
              });
            }
          }
          const apkg = {
            group: group ? encodeForPurl(group) : "",
            name: name ? encodeForPurl(name) : "",
            version,
            purl,
            evidence: {
              identity: {
                field: "purl",
                confidence: confidence,
                methods: [
                  {
                    technique: technique,
                    confidence: confidence,
                    value: jarname,
                  },
                ],
              },
            },
            properties,
          };
          pkgList.push(apkg);
        } else {
          if (DEBUG_MODE) {
            console.log(`Ignored jar ${jarname}`, name, version);
          }
        }
      }
      try {
        if (safeExistsSync(join(tempDir, "META-INF"))) {
          // Clean up META-INF
          safeRmSync(join(tempDir, "META-INF"), {
            recursive: true,
            force: true,
          });
        }
      } catch (_err) {
        // ignore cleanup errors
      }
    } // for
  } // if
  let jarMissWarningShown = false;
  if (jarFiles.length !== pkgList.length) {
    if (pkgList.length) {
      console.log(
        `Obtained only ${pkgList.length} components from ${jarFiles.length} jars at ${tempDir}.`,
      );
    } else {
      console.log(
        `Unable to extract component information from ${jarFile}. The SBOM won't include this artifact.`,
      );
      if (!jarMissWarningShown) {
        thoughtLog(
          `Looks like we are going to miss some jars (${basename(jarFile)}) in our SBOM 😞.`,
        );
        jarMissWarningShown = true;
      }
    }
  }
  return pkgList;
}

async function getNugetUrl() {
  const req = "https://api.nuget.org/v3/index.json";
  const res = await cdxgenAgent.get(req, {
    responseType: "json",
  });
  const urls = res.body.resources;
  for (const resource of urls) {
    if (resource["@type"] === "RegistrationsBaseUrl/3.6.0") {
      return resource["@id"];
    }
  }
  return "https://api.nuget.org/v3/registration3/";
}

/**
 * Prefetched NuGet registration index documents, populated by
 * `getNugetMetadata`'s batch round. The index is the first request
 * `queryNuget` makes for each package; batching it removes the serial round
 * trip per package. The follow-up request to a specific registration page
 * (when the index does not inline items) depends on the index response and
 * stays serial.
 */
const prefetchedNugetIndex = new Map();

async function queryNuget(p, NUGET_URL) {
  function setLatestVersion(upper) {
    // Handle special case for versions with more than 3 parts
    if (upper.split(".").length > 3) {
      const tmpVersionArray = upper.split("-")[0].split(".");
      // Compromise for versions such as 1.2.3.0-alpha
      // How to find latest proper release version?
      if (
        upper.split("-").length > 1 &&
        Number(tmpVersionArray.slice(-1)) === 0
      ) {
        return upper;
      }
      if (upper.split("-").length > 1) {
        tmpVersionArray[tmpVersionArray.length - 1] = (
          Number(tmpVersionArray.slice(-1)) - 1
        ).toString();
      }
      return tmpVersionArray.join(".");
    }
    const tmpVersion = parse(upper);
    let version = `${tmpVersion.major}.${tmpVersion.minor}.${tmpVersion.patch}`;
    if (compare(version, upper) === 1) {
      if (tmpVersion.patch > 0) {
        version = `${tmpVersion.major}.${tmpVersion.minor}.${(tmpVersion.patch - 1).toString()}`;
      }
    }
    return version;
  }

  // Coerce only when missing patch/minor version
  function coerceUp(version) {
    return version.split(".").length < 3
      ? coerce(version, { loose: true }).version
      : version;
  }

  if (DEBUG_MODE) {
    console.log(`Querying nuget for ${p.name}`);
  }
  const np = JSON.parse(JSON.stringify(p));
  const body = [];
  const newBody = [];
  const indexUrl = `${NUGET_URL + np.name.toLowerCase()}/index.json`;
  let res =
    prefetchedResponse(prefetchedNugetIndex, indexUrl) ||
    (await cdxgenAgent.get(indexUrl, { responseType: "json" }));
  const items = res.body.items;
  if (!items?.[0]) {
    return [np, newBody, body];
  }
  if (items[0] && !items[0].items) {
    if (!p.version || p.version === "0.0.0" || p.version === "latest") {
      const upper = items[items.length - 1].upper;
      np.version = setLatestVersion(upper);
    }
    for (const item of items) {
      if (np.version) {
        const lower = compare(
          coerce(item.lower, { loose: true }),
          coerce(np.version, { loose: true }),
        );
        const upper = compare(
          coerce(item.upper, { loose: true }),
          coerce(np.version, { loose: true }),
        );
        if (lower !== 1 && upper !== -1) {
          res = await cdxgenAgent.get(item["@id"], { responseType: "json" });
          for (const i of res.body.items.reverse()) {
            if (
              i.catalogEntry &&
              i.catalogEntry.version === coerceUp(np.version)
            ) {
              newBody.push(i);
              return [np, newBody];
            }
          }
        }
      }
    }
  } else {
    if (!p.version || p.version === "0.0.0" || p.version === "latest") {
      const upper = items[items.length - 1].upper;
      np.version = setLatestVersion(upper);
    }
    if (np.version) {
      for (const item of items) {
        const lower = compare(
          coerce(item.lower, { loose: true }),
          coerce(np.version, { loose: true }),
        );
        const upper = compare(
          coerce(item.upper, { loose: true }),
          coerce(np.version, { loose: true }),
        );
        if (lower !== 1 && upper !== -1) {
          for (const i of item.items.reverse()) {
            if (
              i.catalogEntry &&
              i.catalogEntry.version === coerceUp(np.version)
            ) {
              newBody.push(i);
              return [np, newBody];
            }
          }
        }
      }
    }
  }
  return [np, newBody];
}

/**
 * Method to retrieve metadata for nuget packages
 *
 * @param {Array} pkgList Package list
 * @param {Array} dependencies Dependencies
 */
export async function getNugetMetadata(pkgList, dependencies = undefined) {
  const NUGET_URL =
    readEnvironmentVariable("NUGET_URL") || (await getNugetUrl());
  const cdepList = [];
  const depRepList = {};
  // Batch the per-package registration index requests. queryNuget's first
  // request for each package is the index; the follow-up to a specific
  // registration page depends on the index response and stays serial. Only
  // packages that would actually be queried (not in metadata_cache, no prior
  // error) are prefetched, matching the loop's skip conditions.
  const batchUrls = [];
  const seenNugetUrls = new Set();
  for (const p of pkgList) {
    // A cached entry — a body or a recorded error — means the loop will not
    // reach the network for this package, so the batch must not either.
    if (metadata_cache[`${p.name}|${p.version}`]) {
      continue;
    }
    const indexUrl = `${NUGET_URL + p.name.toLowerCase()}/index.json`;
    if (!seenNugetUrls.has(indexUrl)) {
      seenNugetUrls.add(indexUrl);
      batchUrls.push({ url: indexUrl });
    }
  }
  const ownIndexUrls = [];
  if (batchUrls.length) {
    const fetched = await prefetchJson(batchUrls);
    for (const [key, value] of fetched) {
      prefetchedNugetIndex.set(key, value);
      ownIndexUrls.push(key);
    }
  }
  try {
    for (const p of pkgList) {
      let cacheKey;
      try {
        // If there is a version, we can safely use the cache to retrieve the license
        // See: https://github.com/cdxgen/cdxgen/issues/352
        cacheKey = `${p.name}|${p.version}`;
        let body = metadata_cache[cacheKey];

        if (body?.error) {
          cdepList.push(p);
          continue;
        }
        if (!body) {
          let newBody = {};
          let np = {};
          [np, newBody] = await queryNuget(p, NUGET_URL);
          if (p.version !== np.version) {
            const oldRef = p["bom-ref"];
            p["bom-ref"] = decodeURIComponent(
              build({
                type: "nuget",
                namespace: "" || null,
                name: np.name,
                version: np.version || null,
              }),
            );
            depRepList[oldRef] = p["bom-ref"];
            p.version = np.version;
          }
          if (newBody && newBody.length > 0) {
            body = newBody[0];
          }
          if (body) {
            metadata_cache[cacheKey] = body;
            // Set the latest version in case it is missing
            if (!p.version && body.catalogEntry.version) {
              p.version = body.catalogEntry.version;
            }
            p.description = body.catalogEntry.description;
            if (body.catalogEntry.authors) {
              p.author = body.catalogEntry.authors.trim();
            }
            if (
              body.catalogEntry.licenseExpression &&
              body.catalogEntry.licenseExpression !== ""
            ) {
              p.license = findLicenseId(body.catalogEntry.licenseExpression);
            } else if (body.catalogEntry.licenseUrl) {
              p.license = findLicenseId(body.catalogEntry.licenseUrl);
              if (
                typeof p.license === "string" &&
                p.license.includes("://github.com/")
              ) {
                p.license =
                  (await getRepoLicense(p.license, undefined)) || p.license;
              }
            }
            // Capture the tags
            if (
              body.catalogEntry?.tags?.length &&
              Array.isArray(body.catalogEntry.tags)
            ) {
              p.tags = body.catalogEntry.tags.map((t) =>
                t.toLowerCase().replaceAll(" ", "-"),
              );
            }
            if (body.catalogEntry.projectUrl) {
              p.repository = { url: body.catalogEntry.projectUrl };
              p.homepage = {
                url: `https://www.nuget.org/packages/${p.name}/${p.version}/`,
              };
              if (
                (!p.license || typeof p.license === "string") &&
                typeof p.repository.url === "string" &&
                p.repository.url.includes("://github.com/")
              ) {
                // license couldn't be properly identified and is still a url,
                // therefore trying to resolve license via repository
                p.license =
                  (await getRepoLicense(p.repository.url, undefined)) ||
                  p.license;
              }
            }
            cdepList.push(p);
          }
        }
      } catch (err) {
        if (cacheKey) {
          metadata_cache[cacheKey] = { error: err.code };
        }
        cdepList.push(p);
      }
    }
  } finally {
    // Each index document is read once, by the loop above. Holding them past
    // that only grows the process, which matters in server mode where one
    // process serves many scans. Only the documents this call fetched are
    // dropped, so a scan running alongside this one keeps its own.
    for (const indexUrl of ownIndexUrls) {
      prefetchedNugetIndex.delete(indexUrl);
    }
  }
  const newDependencies = [].concat(dependencies);
  if (depRepList && newDependencies.length) {
    const changed = Object.keys(depRepList);
    // if (!parentComponent.version || parentComponent.version === "latest" || parentComponent.version === "0.0.0"){
    //   if (changed.includes(parentComponent["bom-ref"])) {
    //     parentComponent["bom-ref"] = depRepList[parentComponent["bom-ref"]["ref"]];
    //   }
    // }
    for (const d of newDependencies) {
      if (changed.length > 0 && changed.includes(d["ref"])) {
        d["ref"] = depRepList[d["ref"]];
      }
      for (const dd in d["dependsOn"]) {
        if (changed.includes(d["dependsOn"][dd])) {
          const replace = d["dependsOn"][dd];
          d["dependsOn"][dd] = depRepList[replace];
        }
      }
    }
  }
  return {
    pkgList: cdepList,
    dependencies: newDependencies,
  };
}
