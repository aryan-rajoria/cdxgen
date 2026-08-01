import { readFileSync } from "node:fs";
import { sep as _sep, basename, dirname, relative } from "node:path";

import { build, Purl } from "@cdxgen/cdx-purl";
import { parse as _load } from "yaml";

import { DEBUG_MODE } from "../core/activity.js";
import { shouldFetchLicense } from "../core/env.js";
import { safeExistsSync, safeSpawnSync } from "../core/fs.js";
import { thoughtLog } from "../core/logger.js";
import { mesonWrapDB } from "../core/state.js";
import { parseWorkflowFile } from "./ciParsers/githubActions.js";
import { getDartMetadata } from "./ecosystems.js";
import {
  applyPurl,
  mapConanPkgRefToPurlStringAndNameAndVersion,
  purlFromUrlString,
} from "./purl.js";
import { getLicenses } from "./spdx.js";

/**
 * Method to parse pubspec.lock files.
 *
 * @param pubLockData Contents of lock data
 * @param lockFile Filename for setting evidence
 *
 * @returns {Object}
 */
export async function parsePubLockData(pubLockData, lockFile) {
  if (!pubLockData) {
    return [];
  }
  let pkgList = [];
  const rootList = [];
  const data = _load(pubLockData);
  const packages = data.packages;
  for (const [packageName, packageData] of Object.entries(packages)) {
    const pkg = {
      name: packageName,
      version: packageData.version,
      properties: [],
    };
    // older dart versions don't have sha256
    if (packageData.description?.sha256) {
      pkg._integrity = `sha256-${packageData.description?.sha256}`;
    }
    if (
      packageData.description?.url &&
      packageData.description?.url !== "https://pub.dev"
    ) {
      pkg.properties.push({
        name: "cdx:pub:registry",
        value: packageData.description.url,
      });
    }
    const purlString = new Purl({
      type: "pub",
      namespace: "" || null,
      name: pkg.name,
      version: pkg.version || null,
    })
      .toString()
      .replace(/%2F/g, "/");
    pkg["bom-ref"] = decodeURIComponent(purlString);
    if (packageData.dependency === "direct main") {
      pkg.scope = "required";
      rootList.push(pkg);
    } else if (packageData.dependency === "transitive") {
      pkg.scope = "required";
    } else if (packageData.dependency === "direct dev") {
      pkg.scope = "optional";
    }
    if (lockFile) {
      pkg.properties.push({
        name: "SrcFile",
        value: lockFile,
      });
      pkg.evidence = {
        identity: {
          field: "purl",
          confidence: 1,
          methods: [
            {
              technique: "manifest-analysis",
              confidence: 1,
              value: lockFile,
            },
          ],
        },
      };
    }
    pkgList.push(pkg);
  }
  if (shouldFetchLicense()) {
    pkgList = await getDartMetadata(pkgList);
  }
  return { rootList, pkgList };
}

/**
 * Parses a Dart pub package's pubspec.yaml content and returns a list containing
 * a single component object with name, description, version, homepage, and purl.
 *
 * @param {string} pubYamlData Raw YAML string contents of a pubspec.yaml file
 * @returns {Object[]} List containing a single Dart package component object
 */
export function parsePubYamlData(pubYamlData) {
  const pkgList = [];
  let yamlObj;
  try {
    yamlObj = _load(pubYamlData);
  } catch (_err) {
    // continue regardless of error
  }
  if (!yamlObj) {
    return pkgList;
  }
  const pkg = {
    name: yamlObj.name,
    description: yamlObj.description,
    version: yamlObj.version,
    homepage: { url: yamlObj.homepage },
  };
  const purlString = new Purl({
    type: "pub",
    namespace: "" || null,
    name: pkg.name,
    version: pkg.version || null,
  })
    .toString()
    .replace(/%2F/g, "/");
  pkg.purl = purlString;
  pkg["bom-ref"] = decodeURIComponent(purlString);
  pkgList.push(pkg);
  return pkgList;
}

/**
 * Parses Helm chart YAML data (Chart.yaml or repository index.yaml) and returns
 * a list of Helm chart component objects including the chart itself and any
 * declared dependencies or index entries.
 *
 * @param {string} helmData Raw YAML string contents of a Helm Chart.yaml or index.yaml file
 * @returns {Object[]} List of Helm chart component objects with name, version, and optional homepage/repository
 */
export function parseHelmYamlData(helmData) {
  const pkgList = [];
  let yamlObj;
  try {
    yamlObj = _load(helmData);
  } catch (_err) {
    // continue regardless of error
  }
  if (!yamlObj) {
    return pkgList;
  }
  if (yamlObj.name && yamlObj.version) {
    const pkg = {
      name: yamlObj.name,
      description: yamlObj.description || "",
      version: yamlObj.version,
    };
    if (yamlObj.home) {
      pkg["homepage"] = { url: yamlObj.home };
    }
    pkgList.push(pkg);
  }
  if (yamlObj.dependencies) {
    for (const hd of yamlObj.dependencies) {
      const pkg = {
        name: hd.name,
        version: hd.version, // This could have * so not precise
      };
      if (hd.repository) {
        pkg["repository"] = { url: hd.repository };
      }
      pkgList.push(pkg);
    }
  }
  if (yamlObj.entries) {
    for (const he of Object.keys(yamlObj.entries)) {
      for (const key of Object.keys(yamlObj.entries[he])) {
        const hd = yamlObj.entries[he][key];
        if (hd.name && hd.version) {
          const pkg = {
            name: hd.name,
            version: hd.version,
            description: hd.description || "",
          };
          if (hd.sources && Array.isArray(hd.sources) && hd.sources.length) {
            pkg["repository"] = { url: hd.sources[0] };
            if (hd.home && hd.home !== hd.sources[0]) {
              pkg["homepage"] = { url: hd.home };
            }
          }
          if (hd.home && !pkg["homepage"]) {
            pkg["homepage"] = { url: hd.home };
          }
          if (hd.digest) {
            pkg._integrity = `sha256-${hd.digest}`;
          }

          pkgList.push(pkg);
        }
      }
    }
  }
  return pkgList;
}

/**
 * Recursively walks a parsed YAML/JSON object structure to find container image
 * references stored under common keys (image, repository, dockerImage, etc.) and
 * appends discovered image and service entries to pkgList while tracking seen
 * images in imgList to avoid duplicates.
 *
 * @param {Object|Array|string} keyValueObj The object, array, or string node to inspect
 * @param {Object[]} pkgList Accumulator array that receives {image} and {service} entries
 * @param {string[]} imgList Accumulator array of image name strings already seen
 * @returns {string[]} The updated imgList
 */
export function recurseImageNameLookup(keyValueObj, pkgList, imgList) {
  if (typeof keyValueObj === "string" || keyValueObj instanceof String) {
    return imgList;
  }
  if (Array.isArray(keyValueObj)) {
    for (const ele of keyValueObj) {
      if (typeof ele !== "string") {
        recurseImageNameLookup(ele, pkgList, imgList);
      }
    }
  } else if (Object.keys(keyValueObj).length) {
    let imageLike =
      keyValueObj.image ||
      keyValueObj.repository ||
      keyValueObj.dockerImage ||
      keyValueObj.mavenImage ||
      keyValueObj.gradleImage ||
      keyValueObj.packImage ||
      keyValueObj.koImage ||
      keyValueObj.kanikoImage;
    if (
      !imageLike &&
      keyValueObj.name &&
      typeof keyValueObj.name === "string" &&
      keyValueObj.name.includes("/")
    ) {
      imageLike = keyValueObj.name;
    }
    if (
      imageLike &&
      typeof imageLike === "string" &&
      !imgList.includes(imageLike)
    ) {
      if (imageLike.includes("VERSION")) {
        imageLike = imageLike
          .replace(":${VERSION:-", ":")
          .replace(":${VERSION:", ":")
          .replace(":%VERSION%", ":latest")
          .replace("}", "");
      }
      pkgList.push({ image: imageLike });
      pkgList.push({ service: keyValueObj.name || imageLike });
      imgList.push(imageLike);
    }
    for (const key of Object.keys(keyValueObj)) {
      // Skip unwanted blocks to improve performance
      if (["schema", "openAPIV3Schema", "names", "status"].includes(key)) {
        continue;
      }
      const valueObj = keyValueObj[key];
      if (!valueObj) {
        continue;
      }
      if (Object.keys(valueObj).length && typeof valueObj !== "string") {
        recurseImageNameLookup(valueObj, pkgList, imgList);
      }
      if (Array.isArray(valueObj)) {
        for (const ele of valueObj) {
          if (typeof ele !== "string") {
            recurseImageNameLookup(ele, pkgList, imgList);
          }
        }
      }
    }
  }
  return imgList;
}

function substituteBuildArgs(statement, buildArgs) {
  for (const argMatch of [
    ...statement.matchAll(/\${?([^:\/\\}]+)}?/g),
  ].reverse()) {
    const fullArgName = argMatch[0];
    const argName = argMatch[1];
    const argIndex = argMatch.index;
    if (buildArgs.has(argName)) {
      statement =
        statement.slice(0, argIndex) +
        buildArgs.get(argName) +
        statement.slice(argIndex + fullArgName.length);
    }
  }
  return statement;
}

/**
 * Parses the contents of a Dockerfile or Containerfile and returns a list of
 * base image objects referenced by FROM instructions, substituting ARG default
 * values where possible and skipping multi-stage build alias references.
 *
 * @param {string} fileContents Raw string contents of the Dockerfile/Containerfile
 * @returns {Object[]} Array of objects with an image property for each unique base image
 */
export function parseContainerFile(fileContents) {
  const buildArgs = new Map();
  const imagesSet = new Set();
  const buildStageNames = [];
  for (let line of fileContents.split("\n")) {
    line = line.trim();

    if (line.startsWith("#")) {
      continue; // skip commented out lines
    }

    if (line.startsWith("ARG")) {
      const argStatement = line.split("ARG ")[1].split("=");

      if (argStatement.length < 2) {
        continue; // skip ARG statements without default value
      }

      const argName = argStatement[0].trim();
      let argValue = argStatement[1].trim().replace(/['"]+/g, "");
      if (argValue.includes("$")) {
        argValue = substituteBuildArgs(argValue, buildArgs);
      }
      buildArgs.set(argName, argValue);
    }

    if (line.startsWith("FROM")) {
      // The alias could be called AS or as
      const fromStatement = line.split("FROM ")[1].split(/\s(as|AS)\s/);

      let imageStatement = fromStatement[0].trim();
      const buildStageName =
        fromStatement.length > 1
          ? fromStatement[fromStatement.length - 1].trim()
          : undefined;
      if (buildStageNames.includes(imageStatement)) {
        if (DEBUG_MODE) {
          console.log(
            `Skipping image ${imageStatement} which uses previously seen build stage name.`,
          );
        }
        continue;
      }
      if (imageStatement.includes("$")) {
        imageStatement = substituteBuildArgs(imageStatement, buildArgs);
        if (imageStatement.includes("$")) {
          if (DEBUG_MODE) {
            console.log(
              `Unable to substitute build arguments in '${line}' statement.`,
            );
          }
          continue;
        }
      }
      imagesSet.add(imageStatement);

      if (buildStageName) {
        buildStageNames.push(buildStageName);
      }
    }
  }

  return Array.from(imagesSet).map((i) => {
    return { image: i };
  });
}

/**
 * Parses a Bitbucket Pipelines YAML file and extracts all Docker image references
 * used as build environments and pipe references (docker:// pipes are normalized).
 *
 * @param {string} fileContents Raw string contents of the bitbucket-pipelines.yml file
 * @returns {Object[]} Array of objects with an image property for each referenced image or pipe
 */
export function parseBitbucketPipelinesFile(fileContents) {
  const imgList = [];

  let privateImageBlockFound = false;

  for (let line of fileContents.split("\n")) {
    line = line.trim();
    if (line.startsWith("#")) {
      continue; // skip commented out lines
    }

    // Assume this is a private build image object
    if (line.startsWith("name:") && privateImageBlockFound) {
      const imageName = line.split("name:").pop().trim();

      imgList.push({
        image: imageName,
      });

      privateImageBlockFound = false;
    }

    // Docker image usage
    if (line.startsWith("image:")) {
      const imageName = line.split("image:").pop().trim();

      /**
       * Assume this is a private build image object
       * See: https://support.atlassian.com/bitbucket-cloud/docs/use-docker-images-as-build-environments/#Using-private-build-images
       */
      if (imageName === "") {
        privateImageBlockFound = true;
        continue;
      }
      /**
       * Assume this is a public build image
       * See: https://support.atlassian.com/bitbucket-cloud/docs/use-docker-images-as-build-environments/#Using-public-build-images
       */

      imgList.push({
        image: imageName,
      });
    }

    // Pipe usage
    if (line.startsWith("- pipe:")) {
      let pipeName = line.split("- pipe:").pop().trim();

      if (pipeName.startsWith("docker://")) {
        pipeName = pipeName.replace("docker://", "");
      }

      imgList.push({
        image: pipeName,
      });
    }
  }

  return imgList;
}

/**
 * Parses container specification data such as Docker Compose files, Kubernetes
 * manifests, Tekton tasks, Skaffold configs, or Kustomize overlays (YAML, possibly
 * multi-document) and returns a list of image, service, and OCI spec entries.
 *
 * @param {string} dcData Raw YAML string contents of the container spec file
 * @returns {Object[]} Array of objects with image, service, or ociSpec properties
 */
export function parseContainerSpecData(dcData) {
  const pkgList = [];
  const imgList = [];
  if (!dcData.includes("image") && !dcData.includes("kind")) {
    return pkgList;
  }
  let dcDataList = [dcData];
  if (dcData.includes("---")) {
    dcDataList = dcData.split("---");
  }
  for (const dcData of dcDataList) {
    let yamlObj;
    try {
      yamlObj = _load(dcData);
    } catch (_err) {
      // ignore errors
    }
    if (!yamlObj) {
      continue;
    }
    if (yamlObj.services) {
      for (const serv of Object.keys(yamlObj.services)) {
        pkgList.push({
          service: serv,
        });
        const aservice = yamlObj.services[serv];
        // Track locally built images
        if (aservice.build) {
          if (Object.keys(aservice.build).length && aservice.build.dockerfile) {
            pkgList.push({
              ociSpec: aservice.build.dockerfile,
            });
          } else {
            if (aservice.build === "." || aservice.build === "./") {
              pkgList.push({
                ociSpec: "Dockerfile",
              });
            } else {
              pkgList.push({
                ociSpec: aservice.build,
              });
            }
          }
        } else if (aservice.image && !imgList.includes(aservice.image)) {
          let imgFullName = aservice.image;
          if (imgFullName.includes(":${VERSION:")) {
            imgFullName = imgFullName
              .replace(":${VERSION:-", ":")
              .replace(":${VERSION:", ":")
              .replace("}", "");
          }
          pkgList.push({
            image: imgFullName,
          });
          imgList.push(imgFullName);
        }
      }
    }
    // Tekton tasks and kustomize have spec. Skaffold has build
    const recurseBlock = yamlObj.spec || yamlObj.build || yamlObj.images;
    if (recurseBlock) {
      recurseImageNameLookup(recurseBlock, pkgList, imgList);
    }
  }
  return pkgList;
}

/**
 * Identifies the data flow direction of a Privado processing object based on its
 * sinkId value: "write" sinks map to "inbound", "read" sinks to "outbound", and
 * HTTP/gRPC sinks to "bi-directional".
 *
 * @param {Object} processingObj Privado processing object, expected to have a sinkId property
 * @returns {string} Flow direction string: "inbound", "outbound", "bi-directional", or "unknown"
 */
export function identifyFlow(processingObj) {
  let flow = "unknown";
  if (processingObj.sinkId) {
    const sinkId = processingObj.sinkId.toLowerCase();
    if (sinkId.endsWith("write")) {
      flow = "inbound";
    } else if (sinkId.endsWith("read")) {
      flow = "outbound";
    } else if (sinkId.includes("http") || sinkId.includes("grpc")) {
      flow = "bi-directional";
    }
  }
  return flow;
}

function convertProcessing(processing_list) {
  const data_list = [];
  for (const p of processing_list) {
    data_list.push({
      classification: p.sourceId || p.sinkId,
      flow: identifyFlow(p),
    });
  }
  return data_list;
}

/**
 * Parses a Privado data flow JSON file and returns a list of service objects
 * enriched with data classifications, endpoints, trust-boundary flag, violations,
 * and git metadata properties extracted from the scan result.
 *
 * @param {string} f Path to the Privado scan result JSON file
 * @returns {Object[]} List of service component objects suitable for a SaaSBOM
 */
export function parsePrivadoFile(f) {
  const pData = readFileSync(f, { encoding: "utf-8" });
  const servlist = [];
  if (!pData) {
    return servlist;
  }
  const jsonData = JSON.parse(pData);
  const aservice = {
    "x-trust-boundary": false,
    properties: [],
    data: [],
    endpoints: [],
  };
  if (jsonData.repoName) {
    aservice.name = jsonData.repoName;
    aservice.properties = [
      {
        name: "SrcFile",
        value: f,
      },
    ];
    // Capture git metadata info
    if (jsonData.gitMetadata) {
      aservice.version = jsonData.gitMetadata.commitId || "";
      aservice.properties.push({
        name: "privadoCoreVersion",
        value: jsonData.privadoCoreVersion || "",
      });
      aservice.properties.push({
        name: "privadoCLIVersion",
        value: jsonData.privadoCLIVersion || "",
      });
      aservice.properties.push({
        name: "localScanPath",
        value: jsonData.localScanPath || "",
      });
    }
    // Capture processing
    if (jsonData.processing?.length) {
      aservice.data = aservice.data.concat(
        convertProcessing(jsonData.processing),
      );
    }
    // Capture sink processing
    if (jsonData.sinkProcessing?.length) {
      aservice.data = aservice.data.concat(
        convertProcessing(jsonData.sinkProcessing),
      );
    }
    // Find endpoints
    if (jsonData.collections) {
      const endpoints = [];
      for (const c of jsonData.collections) {
        for (const occ of c.collections) {
          for (const e of occ.occurrences) {
            if (e.endPoint) {
              endpoints.push(e.endPoint);
            }
          }
        }
      }
      aservice.endpoints = endpoints;
    }
    // Capture violations
    if (jsonData.violations) {
      for (const v of jsonData.violations) {
        aservice.properties.push({
          name: "privado_violations",
          value: v.policyId,
        });
      }
    }
    // If there are third party libraries detected, then there are cross boundary calls happening
    if (jsonData.dataFlow?.third_parties?.length) {
      aservice["x-trust-boundary"] = true;
    }
    servlist.push(aservice);
  }
  return servlist;
}

/**
 * Parses an OpenAPI specification (JSON or YAML string) and returns a list
 * containing a single service object with name, version, endpoints, and
 * authentication flag derived from the spec's info, servers, paths, and
 * securitySchemes sections.
 *
 * @param {string} oaData Raw JSON or YAML string contents of an OpenAPI specification
 * @returns {Object[]} List containing a single service component object
 */
export function parseOpenapiSpecData(oaData) {
  const servlist = [];
  if (!oaData) {
    return servlist;
  }
  try {
    if (oaData.startsWith("openapi:")) {
      oaData = _load(oaData);
    } else {
      oaData = JSON.parse(oaData);
    }
  } catch (_e) {
    return servlist;
  }

  const name = oaData.info?.title
    ? oaData.info.title.replace(/ /g, "-")
    : "default-name";
  const version = oaData.info?.version ? oaData.info.version : "latest";
  const aservice = {
    "bom-ref": `urn:service:${name}:${version}`,
    name,
    description: oaData.description || "",
    version,
  };
  let serverName = [];
  if (oaData.servers?.length && oaData.servers[0].url) {
    serverName = oaData.servers[0].url;
    if (!serverName.startsWith("http") || !serverName.includes("//")) {
      serverName = `http://${serverName}`;
    }
  }
  if (oaData.paths) {
    const endpoints = [];
    for (const route of Object.keys(oaData.paths)) {
      let sep = "";
      if (!route.startsWith("/")) {
        sep = "/";
      }
      endpoints.push(`${serverName}${sep}${route}`);
    }
    aservice.endpoints = endpoints;
  }
  let authenticated = false;
  if (oaData.components?.securitySchemes) {
    authenticated = true;
  }
  aservice.authenticated = authenticated;
  servlist.push(aservice);
  return servlist;
}

/**
 * Parses Haskell Cabal freeze file content and extracts package name and version
 * pairs from constraint lines (lines containing " ==").
 *
 * @param {string} cabalData Raw string contents of a Cabal freeze file
 * @returns {Object[]} List of package objects with name and version fields
 */
export function parseCabalData(cabalData) {
  const pkgList = [];
  if (!cabalData) {
    return pkgList;
  }
  cabalData.split("\n").forEach((l) => {
    if (!l.includes(" ==")) {
      return;
    }
    l = l.replace("\r", "");
    if (l.includes(" ==")) {
      const tmpA = l.split(" ==");
      const name = tmpA[0]
        .replace("constraints: ", "")
        .replace("any.", "")
        .trim();
      const version = tmpA[1].replace(",", "").trim();
      if (name && version) {
        pkgList.push({
          name,
          version,
        });
      }
    }
  });
  return pkgList;
}

/**
 * Parses an Elixir mix.lock file and extracts Hex package name and version pairs
 * from lines containing ":hex".
 *
 * @param {string} mixData Raw string contents of a mix.lock file
 * @returns {Object[]} List of package objects with name and version fields
 */
export function parseMixLockData(mixData) {
  const pkgList = [];
  if (!mixData) {
    return pkgList;
  }
  mixData.split("\n").forEach((l) => {
    if (!l.includes(":hex")) {
      return;
    }
    l = l.replace("\r", "");
    if (l.includes(":hex")) {
      const tmpA = l.split(",");
      if (tmpA.length > 3) {
        const name = tmpA[1].replace(":", "").trim();
        const version = tmpA[2].trim().replace(/"/g, "");
        if (name && version) {
          pkgList.push({
            name,
            version,
          });
        }
      }
    }
  });
  return pkgList;
}

/**
 * Parses a GitHub Actions workflow YAML file and returns a list of action
 * components for each step that uses an external action (steps with a "uses"
 * field). Each component captures the action name, group, version/commit SHA,
 * version pinning type, job context (runner, permissions, environment), and
 * workflow-level metadata (triggers, concurrency, write permissions).
 *
 * @param {string} f Path to the GitHub Actions workflow YAML file
 * @returns {Object[]} List of action component objects with purl, properties, and evidence
 */
export function parseGitHubWorkflowData(f) {
  const { components } = parseWorkflowFile(f);
  return components.filter(
    (component) =>
      component.scope === "required" ||
      component.properties?.some(
        (property) =>
          property?.name === "cdx:github:step:usesCargo" &&
          property?.value === "true",
      ),
  );
}

/**
 * Parse Google Cloud Build YAML data and extract container image steps as packages.
 *
 * @param {string} cbwData Raw YAML string of a Cloud Build configuration file
 * @returns {Object[]} Array of package objects parsed from the build steps
 */
export function parseCloudBuildData(cbwData) {
  const pkgList = [];
  const keys_cache = {};
  if (!cbwData) {
    return pkgList;
  }
  const yamlObj = _load(cbwData);
  if (!yamlObj) {
    return pkgList;
  }
  if (yamlObj.steps) {
    for (const step of yamlObj.steps) {
      if (step.name) {
        const tmpA = step.name.split(":");
        if (tmpA.length === 2) {
          let group = dirname(tmpA[0]);
          const name = basename(tmpA[0]);
          if (group === ".") {
            group = "";
          }
          const version = tmpA[1];
          const key = `${group}-${name}-${version}`;
          if (!keys_cache[key] && name && version) {
            keys_cache[key] = key;
            pkgList.push({
              group,
              name,
              version,
            });
          }
        }
      }
    }
  }
  return pkgList;
}

/**
 * Parse Conan lock file data (conan.lock) and return the package list, dependency map,
 * and parent component dependencies.
 *
 * Supports both the legacy `graph_lock.nodes` format (Conan 1.x) and the newer
 * `requires` format (Conan 2.x).
 *
 * @param {string} conanLockData Raw JSON string of the Conan lock file
 * @returns {{ pkgList: Object[], dependencies: Object, parentComponentDependencies: string[] }}
 */
export function parseConanLockData(conanLockData) {
  const pkgList = [];
  const dependencies = {};
  const parentComponentDependencies = [];

  if (!conanLockData) {
    return { pkgList, dependencies, parentComponentDependencies };
  }

  const lockFile = JSON.parse(conanLockData);
  if (!lockFile?.graph_lock?.nodes && !lockFile.requires) {
    return { pkgList, dependencies, parentComponentDependencies };
  }

  if (lockFile.graph_lock?.nodes) {
    const depends = lockFile.graph_lock.nodes;
    const nodeKeyToBomRefMap = {};

    for (const nk of Object.keys(depends)) {
      if (!depends[nk].ref) continue;

      const [purl, name, version] = mapConanPkgRefToPurlStringAndNameAndVersion(
        depends[nk].ref,
      );
      if (purl === null) continue;

      const bomRef = decodeURIComponent(purl);
      pkgList.push({
        name,
        version,
        purl,
        "bom-ref": bomRef,
      });

      nodeKeyToBomRefMap[nk] = bomRef;
    }

    for (const nk of Object.keys(depends)) {
      let requirementNodeKeys = [];
      if (Array.isArray(depends[nk].requires))
        requirementNodeKeys = requirementNodeKeys.concat(depends[nk].requires);
      if (Array.isArray(depends[nk].build_requires))
        requirementNodeKeys = requirementNodeKeys.concat(
          depends[nk].build_requires,
        );

      for (const dependencyNodeKey of requirementNodeKeys) {
        const dependencyBomRef = nodeKeyToBomRefMap[dependencyNodeKey];
        if (!dependencyBomRef) continue;

        const dependentBomRef = nodeKeyToBomRefMap[nk];
        if (dependentBomRef) {
          if (!(dependentBomRef in dependencies))
            dependencies[dependentBomRef] = [];
          if (!dependencies[dependentBomRef].includes(dependencyBomRef))
            dependencies[dependentBomRef].push(dependencyBomRef);
        } else if (nk === "0") {
          // parent component for which the conan.lock was generated
          if (!parentComponentDependencies.includes(dependencyBomRef))
            parentComponentDependencies.push(dependencyBomRef);
        }
      }
    }
  } else if (lockFile.requires) {
    const depends = lockFile.requires;
    for (const nk of Object.keys(depends)) {
      depends[nk] = depends[nk].split("%").shift();
      const [purl, name, version] = mapConanPkgRefToPurlStringAndNameAndVersion(
        depends[nk],
      );
      if (purl !== null) {
        pkgList.push({
          name,
          version,
          purl,
          "bom-ref": decodeURIComponent(purl),
        });
      }
    }
  }
  return { pkgList, dependencies, parentComponentDependencies };
}

/**
 * Parse a Conan conanfile.txt and extract required and optional packages.
 *
 * @param {string} conanData Raw text contents of a conanfile.txt
 * @returns {Object[]} Array of package objects with purl, name, version, and scope
 */
export function parseConanData(conanData) {
  const pkgList = [];
  if (!conanData) {
    return pkgList;
  }
  let scope = "required";
  conanData.split("\n").forEach((l) => {
    l = l.replace("\r", "");
    if (l.includes("[build_requires]")) {
      scope = "optional";
    }
    if (l.includes("[requires]")) {
      scope = "required";
    }

    // The line must start with sequence non-whitespace characters, followed by a slash,
    // followed by at least one more non-whitespace character.
    // Provides a heuristic for locating Conan package references inside conanfile.txt files.
    if (l.match(/^[^\s\/]+\/\S+/)) {
      const [purl, name, version] =
        mapConanPkgRefToPurlStringAndNameAndVersion(l);
      if (purl !== null) {
        pkgList.push({
          name,
          version,
          purl,
          "bom-ref": decodeURIComponent(purl),
          scope,
        });
      }
    }
  });
  return pkgList;
}

/**
 * Construct a generic package component object for collider-managed packages.
 *
 * @param {string} name Package name
 * @param {Object} pkgData Locked package entry from collider.lock
 * @param {string} lockFile Source lock file path
 * @param {string} dependencyKind Whether the package is direct or transitive
 * @returns {Object|undefined} Package component
 */
function buildColliderComponent(name, pkgData, lockFile, dependencyKind) {
  if (!name) {
    return undefined;
  }
  pkgData = pkgData || {};
  dependencyKind = dependencyKind || "transitive";
  const version = pkgData?.version || "";
  const purl = build({
    type: "generic",
    namespace: "" || null,
    name: name,
    version: version || undefined || null,
  });
  const properties = [
    {
      name: "cdx:collider:dependencyKind",
      value: dependencyKind,
    },
  ];
  if (lockFile) {
    properties.unshift({
      name: "SrcFile",
      value: lockFile,
    });
  }
  const wrapHash =
    typeof pkgData?.wrap_hash === "string" ? pkgData.wrap_hash.trim() : "";
  const wrapHashMatch = wrapHash.match(/^sha256:([0-9A-Fa-f]{64})$/);
  if (wrapHash) {
    properties.push({
      name: "cdx:collider:wrapHash",
      value: wrapHash,
    });
  }
  properties.push({
    name: "cdx:collider:hasWrapHash",
    value: wrapHashMatch ? "true" : "false",
  });
  if (wrapHash && !wrapHashMatch) {
    properties.push({
      name: "cdx:collider:wrapHashInvalid",
      value: "true",
    });
  }
  let originReference;
  if (typeof pkgData?.origin === "string" && pkgData.origin.trim()) {
    try {
      const originUrl = new URL(pkgData.origin.trim());
      const originHadSensitiveParts = Boolean(
        originUrl.username ||
          originUrl.password ||
          originUrl.search ||
          originUrl.hash,
      );
      originUrl.username = "";
      originUrl.password = "";
      originUrl.search = "";
      originUrl.hash = "";
      originReference = originUrl.toString();
      properties.push({
        name: "cdx:collider:origin",
        value: originReference,
      });
      properties.push({
        name: "cdx:collider:originScheme",
        value: originUrl.protocol.replace(":", ""),
      });
      if (originUrl.host) {
        properties.push({
          name: "cdx:collider:originHost",
          value: originUrl.host,
        });
      }
      if (originHadSensitiveParts) {
        properties.push({
          name: "cdx:collider:originSanitized",
          value: "true",
        });
      }
    } catch {
      thoughtLog("Ignoring invalid Collider origin URL");
    }
  }
  const component = {
    name,
    version,
    purl,
    "bom-ref": decodeURIComponent(purl),
    properties,
  };
  if (dependencyKind === "direct") {
    component.scope = "required";
  }
  if (wrapHashMatch) {
    component.hashes = [
      {
        alg: "SHA-256",
        content: wrapHashMatch[1].toLowerCase(),
      },
    ];
  }
  if (originReference) {
    component.externalReferences = [
      {
        type: "distribution",
        url: originReference,
      },
    ];
  }
  return component;
}

/**
 * Parse Collider lock file data (collider.lock) and return the package list and
 * parent component dependencies.
 *
 * @param {string} colliderLockData Raw JSON string of the Collider lock file
 * @param {string} lockFile Source lock file path
 * @returns {{ pkgList: Object[], dependencies: Object, parentComponentDependencies: string[] }}
 */
export function parseColliderLockData(colliderLockData, lockFile) {
  const pkgList = [];
  const dependencies = {};
  const parentComponentDependencies = [];
  if (!colliderLockData) {
    return { pkgList, dependencies, parentComponentDependencies };
  }
  let parsedLockFile;
  try {
    parsedLockFile = JSON.parse(colliderLockData);
  } catch {
    return { pkgList, dependencies, parentComponentDependencies };
  }
  const addedBomRefs = new Set();
  const directDependencies = parsedLockFile.dependencies || {};
  const packages = parsedLockFile.packages || {};
  for (const [name, pkgData] of Object.entries(directDependencies)) {
    const component = buildColliderComponent(name, pkgData, lockFile, "direct");
    if (!component) {
      continue;
    }
    if (!addedBomRefs.has(component["bom-ref"])) {
      pkgList.push(component);
      addedBomRefs.add(component["bom-ref"]);
    }
    if (!parentComponentDependencies.includes(component["bom-ref"])) {
      parentComponentDependencies.push(component["bom-ref"]);
    }
    if (!(component["bom-ref"] in dependencies)) {
      dependencies[component["bom-ref"]] = [];
    }
  }
  for (const [name, pkgData] of Object.entries(packages)) {
    const component = buildColliderComponent(
      name,
      pkgData,
      lockFile,
      "transitive",
    );
    if (!component || addedBomRefs.has(component["bom-ref"])) {
      continue;
    }
    pkgList.push(component);
    addedBomRefs.add(component["bom-ref"]);
    if (!(component["bom-ref"] in dependencies)) {
      dependencies[component["bom-ref"]] = [];
    }
  }
  return { pkgList, dependencies, parentComponentDependencies };
}

/**
 * Method to parse flake.nix files
 *
 * @param {String} flakeNixFile flake.nix file to parse
 * @returns {Object} Object containing package information
 */
export function parseFlakeNix(flakeNixFile) {
  const pkgList = [];
  const dependencies = [];

  if (!safeExistsSync(flakeNixFile)) {
    return { pkgList, dependencies };
  }

  try {
    const flakeContent = readFileSync(flakeNixFile, "utf-8");

    // Extract inputs from flake.nix using regex
    const inputsRegex = /inputs\s*=\s*\{[^}]*}/g;
    let match;
    while ((match = inputsRegex.exec(flakeContent)) !== null) {
      const inputBlock = match[0];

      // Match different input patterns including nested inputs
      const inputPatterns = [
        /([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\.url\s*=\s*"([^"]+)"/g,
        /([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\s*=\s*\{\s*url\s*=\s*"([^"]+)"[^}]*}/gs,
      ];

      const addedPackages = new Set();

      for (const pattern of inputPatterns) {
        let subMatch;
        pattern.lastIndex = 0;
        while ((subMatch = pattern.exec(inputBlock)) !== null) {
          const name = subMatch[1];
          const url = subMatch[2] || subMatch[3];

          if (name && url && !addedPackages.has(name)) {
            addedPackages.add(name);
            const pkg = {
              name: name,
              version: "latest",
              description: `Nix flake input: ${name}`,
              scope: "required",
              properties: [
                {
                  name: "SrcFile",
                  value: flakeNixFile,
                },
                {
                  name: "cdx:nix:input_url",
                  value: url,
                },
              ],
              evidence: {
                identity: {
                  field: "purl",
                  confidence: 0.8,
                  methods: [
                    {
                      technique: "manifest-analysis",
                      confidence: 0.8,
                      value: flakeNixFile,
                    },
                  ],
                },
              },
            };

            pkg.purl = generateNixPurl(name, "latest");
            pkg["bom-ref"] = pkg.purl;

            pkgList.push(pkg);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to parse ${flakeNixFile}: ${error.message}`);
  }

  return { pkgList, dependencies };
}

/**
 * Method to parse flake.lock files
 *
 * @param {String} flakeLockFile flake.lock file to parse
 * @returns {Object} Object containing locked dependency information
 */
export function parseFlakeLock(flakeLockFile) {
  const pkgList = [];
  const dependencies = [];

  if (!safeExistsSync(flakeLockFile)) {
    return { pkgList, dependencies };
  }

  try {
    const lockContent = readFileSync(flakeLockFile, "utf-8");
    const lockData = JSON.parse(lockContent);

    if (lockData.nodes) {
      for (const [nodeName, nodeData] of Object.entries(lockData.nodes)) {
        if (nodeName === "root" || !nodeData.locked) continue;

        const locked = nodeData.locked;

        let version = "latest";
        if (locked.rev) {
          version = locked.rev.substring(0, 7);
        } else if (locked.ref) {
          version = locked.ref;
        }

        const pkg = {
          name: nodeName,
          version: version,
          description: `Nix flake dependency: ${nodeName}`,
          scope: "required",
          properties: [
            {
              name: "SrcFile",
              value: flakeLockFile,
            },
          ],
          evidence: {
            identity: {
              field: "purl",
              confidence: 1.0,
              methods: [
                {
                  technique: "manifest-analysis",
                  confidence: 1.0,
                  value: flakeLockFile,
                },
              ],
            },
          },
        };

        if (locked.narHash) {
          pkg.properties.push({
            name: "cdx:nix:nar_hash",
            value: locked.narHash,
          });
        }

        if (locked.lastModified) {
          pkg.properties.push({
            name: "cdx:nix:last_modified",
            value: locked.lastModified.toString(),
          });
        }

        if (locked.rev) {
          pkg.properties.push({
            name: "cdx:nix:revision",
            value: locked.rev,
          });
        }

        if (locked.ref) {
          pkg.properties.push({
            name: "cdx:nix:ref",
            value: locked.ref,
          });
        }

        pkg.purl = generateNixPurl(nodeName, version);
        pkg["bom-ref"] = pkg.purl;

        pkgList.push(pkg);
      }

      // Generate dependency relationships from root inputs
      if (lockData.nodes?.root?.inputs) {
        const rootInputs = Object.keys(lockData.nodes.root.inputs);
        if (rootInputs.length > 0) {
          dependencies.push({
            ref: "pkg:nix/flake@latest",
            dependsOn: rootInputs
              .map(
                (input) =>
                  pkgList.find((pkg) => pkg.name === input)?.["bom-ref"],
              )
              .filter(Boolean),
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to parse ${flakeLockFile}: ${error.message}`);
  }

  return { pkgList, dependencies };
}

/**
 * Generate a Nix PURL from input information
 *
 * @param {String} name Package name
 * @param {String} version Package version
 * @returns {String} PURL string
 */
function generateNixPurl(name, version) {
  // For now, use a generic nix PURL type
  // In the future, this could be more sophisticated based on the source type
  return `pkg:nix/${name}@${version}`;
}

/**
 * Parse composer.json file
 *
 * @param {string} composerJsonFile composer.json file
 *
 * @returns {Object} Object with rootRequires and parent component
 */
export function parseComposerJson(composerJsonFile) {
  const moduleParent = {};
  const composerData = JSON.parse(
    readFileSync(composerJsonFile, { encoding: "utf-8" }),
  );
  const rootRequires = {
    ...composerData.require,
    ...composerData["require-dev"],
  };
  const pkgName = composerData.name;
  if (pkgName) {
    moduleParent.group = dirname(pkgName);
    if (moduleParent.group === ".") {
      moduleParent.group = "";
    }
    moduleParent.name = basename(pkgName);
    moduleParent.type = "application";
    moduleParent.version = composerData.version;
    if (composerData.description) {
      moduleParent.description = composerData.description;
    }
    if (composerData.license) {
      moduleParent.licenses = getLicenses({
        expression: composerData.license,
      });
    }
    moduleParent.purl = build({
      type: "composer",
      namespace: moduleParent.group || null,
      name: moduleParent.name,
      version: moduleParent.version || null,
    });
    moduleParent["bom-ref"] = decodeURIComponent(moduleParent.purl);
  }
  return { rootRequires, moduleParent };
}

/**
 * Parse composer lock file
 *
 * @param {string} pkgLockFile composer.lock file
 * @param {array} rootRequires require section from composer.json
 */
export function parseComposerLock(pkgLockFile, rootRequires) {
  const pkgList = [];
  const dependenciesList = [];
  const dependenciesMap = {};
  const pkgNamePurlMap = {};
  const rootList = [];
  const rootRequiresMap = {};
  if (rootRequires) {
    for (const rr of Object.keys(rootRequires)) {
      // Skip platform requirements (php, hhvm, ext-*, lib-*) — they are never
      // Composer package names and must not be used to identify root packages.
      if (
        rr === "php" ||
        rr === "hhvm" ||
        rr.startsWith("ext-") ||
        rr.startsWith("lib-")
      ) {
        continue;
      }
      rootRequiresMap[rr] = true;
    }
  }
  if (safeExistsSync(pkgLockFile)) {
    let lockData = {};
    try {
      lockData = JSON.parse(readFileSync(pkgLockFile, { encoding: "utf-8" }));
    } catch (_e) {
      console.error("Invalid composer.lock file:", pkgLockFile);
      return [];
    }
    if (lockData) {
      const packages = {};
      if (lockData["packages"]) {
        packages["required"] = lockData["packages"];
      }
      if (lockData["packages-dev"]) {
        packages["optional"] = lockData["packages-dev"];
      }
      // Pass 1: Collect all packages
      for (const compScope in packages) {
        for (const i in packages[compScope]) {
          const pkg = packages[compScope][i];
          // Be extra cautious. Potential fix for #236
          if (!pkg?.name || !pkg.version) {
            continue;
          }

          let group = dirname(pkg.name);
          if (group === ".") {
            group = "";
          }
          const name = basename(pkg.name);
          const purl = build({
            type: "composer",
            namespace: group || null,
            name: name,
            version: pkg.version?.toString() || null,
          });
          const apkg = {
            group: group,
            name: name,
            purl,
            "bom-ref": decodeURIComponent(purl),
            version: pkg.version?.toString(),
            repository: pkg.source,
            license: pkg.license,
            description: pkg.description,
            scope: compScope,
            properties: [
              {
                name: "SrcFile",
                value: pkgLockFile,
              },
            ],
            evidence: {
              identity: {
                field: "purl",
                confidence: 1,
                methods: [
                  {
                    technique: "manifest-analysis",
                    confidence: 1,
                    value: pkgLockFile,
                  },
                ],
              },
            },
          };
          if (pkg?.dist?.url) {
            // Replace placeholders like %prettyVersion% with actual version
            let distUrl = pkg.dist.url;
            if (
              distUrl.includes("%prettyVersion%") ||
              distUrl.includes("%version%")
            ) {
              const version = pkg.version || "unknown";
              distUrl = distUrl
                .replace(/%prettyVersion%/g, version)
                .replace(/%version%/g, version);
            }
            apkg.distribution = { url: distUrl };
          }
          if (pkg?.authors?.length) {
            apkg.authors = pkg.authors.map((a) => {
              return { name: a.name, email: a.email };
            });
          }
          if (pkg?.keywords?.length) {
            apkg.tags = pkg.keywords;
          }
          if (pkg.autoload && Object.keys(pkg.autoload).length) {
            const namespaces = [];
            for (const aaload of Object.keys(pkg.autoload)) {
              if (aaload.startsWith("psr")) {
                for (const ans of Object.keys(pkg.autoload[aaload])) {
                  namespaces.push(ans.trim());
                }
              }
            }
            if (namespaces.length) {
              apkg.properties.push({
                name: "Namespaces",
                value: namespaces.join(", "),
              });
            }
          }
          pkgList.push(apkg);
          dependenciesMap[purl] = new Set();
          pkgNamePurlMap[pkg.name] = purl;
          // Add this package to the root list if needed
          if (rootRequiresMap[pkg.name]) {
            rootList.push(apkg);
          }
        }
      }
      // Pass 2: Construct dependency tree
      for (const compScope in packages) {
        for (const i in packages[compScope]) {
          const pkg = packages[compScope][i];
          if (!pkg?.name || !pkg.version) {
            continue;
          }
          if (!pkg.require || !Object.keys(pkg.require).length) {
            continue;
          }
          const purl = pkgNamePurlMap[pkg.name];
          for (const adepName of Object.keys(pkg.require)) {
            if (pkgNamePurlMap[adepName]) {
              dependenciesMap[purl].add(pkgNamePurlMap[adepName]);
            }
          }
        }
      }
    }
  }
  for (const ref in dependenciesMap) {
    dependenciesList.push({
      ref: ref,
      dependsOn: Array.from(dependenciesMap[ref]).sort(),
    });
  }
  return {
    pkgList,
    dependenciesList,
    rootList,
  };
}

function convertStdoutToList(result) {
  if (result.status !== 0 || result.error) {
    return undefined;
  }
  const stdout = result.stdout;
  if (stdout) {
    const cmdOutput = Buffer.from(stdout).toString();
    return cmdOutput
      .trim()
      .toLowerCase()
      .split("\n")
      .filter((p) => p.length > 2 && p.includes("."))
      .sort();
  }
  return undefined;
}

/**
 * Method to execute dpkg --listfiles to determine the files provided by a given package
 *
 * @param {string} pkgName deb package name
 * @returns
 */
export function executeDpkgList(pkgName) {
  const result = safeSpawnSync("dpkg", ["--listfiles", "--no-pager", pkgName]);
  return convertStdoutToList(result);
}

/**
 * Method to execute dnf repoquery to determine the files provided by a given package
 *
 * @param {string} pkgName deb package name
 * @returns
 */
export function executeRpmList(pkgName) {
  let result = safeSpawnSync("dnf", ["repoquery", "-l", pkgName]);
  // Fallback to rpm
  if (result.status !== 0 || result.error) {
    result = safeSpawnSync("rpm", ["-ql", pkgName]);
  }
  return convertStdoutToList(result);
}

/**
 * Method to execute apk -L info to determine the files provided by a given package
 *
 * @param {string} pkgName deb package name
 * @returns
 */
export function executeApkList(pkgName) {
  const result = safeSpawnSync("apk", ["-L", "info", pkgName]);
  return convertStdoutToList(result);
}

/**
 * Method to execute alpm -Ql to determine the files provided by a given package
 *
 * @param {string} pkgName deb package name
 * @returns
 */
export function executeAlpmList(pkgName) {
  const result = safeSpawnSync("pacman", ["-Ql", pkgName]);
  return convertStdoutToList(result);
}

/**
 * Method to execute equery files to determine the files provided by a given package
 *
 * @param {string} pkgName deb package name
 * @returns
 */
export function executeEqueryList(pkgName) {
  const result = safeSpawnSync("equery", ["files", pkgName]);
  return convertStdoutToList(result);
}

/**
 * Parse swift dependency tree output json object
 *
 * @param {Array} pkgList Package list
 * @param {Array} dependenciesList Dependencies
 * @param {string} jsonObject Swift dependencies json object
 * @param {string} pkgFile Package.swift file
 */
export function parseSwiftJsonTreeObject(
  pkgList,
  dependenciesList,
  jsonObject,
  pkgFile,
) {
  let purl;
  const urlOrPath = jsonObject.url || jsonObject.path;
  if (jsonObject?.url?.startsWith("http")) {
    const version = jsonObject.version;
    purl = purlFromUrlString("swift", urlOrPath, version);
  } else {
    // Local swift packages have no remote URL and therefore no valid swift
    // namespace (cdx-purl requires host/owner). Construct the component
    // directly without a purl.
    purl = null;
  }
  const rootPkg = applyPurl(
    {
      name: purl ? purl.name : jsonObject.name,
      group: purl ? purl.namespace : "",
      version: purl ? purl.version : jsonObject.version,
    },
    purl ? decodeURIComponent(purl.toString()) : null,
    jsonObject.name,
  );
  const properties = [];
  if (jsonObject.name && jsonObject.name !== rootPkg.name) {
    properties.push({
      name: "cdx:swift:packageName",
      value: jsonObject.name,
    });
  }
  if (jsonObject?.path?.includes("checkouts")) {
    const relativeCheckoutPath = relative(dirname(pkgFile), jsonObject.path);
    if (!relativeCheckoutPath.startsWith("..")) {
      properties.push({
        name: "cdx:swift:localCheckoutPath",
        value: relativeCheckoutPath,
      });
    }
  }
  if (urlOrPath) {
    if (urlOrPath.startsWith("http")) {
      rootPkg.repository = { url: urlOrPath };
    } else {
      rootPkg.type = "application";
      properties.push({
        name: "SrcPath",
        value: urlOrPath,
      });
      if (pkgFile) {
        properties.push({
          name: "SrcFile",
          value: pkgFile,
        });
      }
    }
  }
  if (properties.length) {
    rootPkg.properties = properties;
  }
  pkgList.push(rootPkg);
  const depList = new Set();
  if (jsonObject.dependencies) {
    for (const dependency of jsonObject.dependencies) {
      const res = parseSwiftJsonTreeObject(
        pkgList,
        dependenciesList,
        dependency,
        pkgFile,
      );
      depList.add(res);
    }
  }
  dependenciesList.push({
    ref: rootPkg["bom-ref"],
    dependsOn: [...depList].sort(),
  });
  return rootPkg["bom-ref"];
}

/**
 * Parse swift dependency tree output
 * @param {string} rawOutput Swift dependencies json output
 * @param {string} pkgFile Package.swift file
 */
export function parseSwiftJsonTree(rawOutput, pkgFile) {
  if (!rawOutput) {
    return {};
  }
  const pkgList = [];
  const dependenciesList = [];
  try {
    const jsonData = JSON.parse(rawOutput);
    parseSwiftJsonTreeObject(pkgList, dependenciesList, jsonData, pkgFile);
  } catch (e) {
    if (DEBUG_MODE) {
      console.log(e);
    }
    return {};
  }
  const rootList = pkgList.filter((p) => p.type === "application");
  return {
    rootList,
    pkgList,
    dependenciesList,
  };
}

/**
 * Parse swift package resolved file
 * @param {string} resolvedFile Package.resolved file
 */
export function parseSwiftResolved(resolvedFile) {
  const pkgList = [];
  if (safeExistsSync(resolvedFile)) {
    try {
      const pkgData = JSON.parse(
        readFileSync(resolvedFile, { encoding: "utf-8" }),
      );
      let resolvedList = [];
      if (pkgData.pins) {
        resolvedList = pkgData.pins;
      } else if (pkgData.object?.pins) {
        resolvedList = pkgData.object.pins;
      }
      for (const adep of resolvedList) {
        const locationOrUrl = adep.location || adep.repositoryURL;
        const version = adep.state.version || adep.state.revision;
        const purl = purlFromUrlString("swift", locationOrUrl, version);
        const purlString = decodeURIComponent(purl.toString());
        const rootPkg = {
          name: purl.name,
          group: purl.namespace,
          version: purl.version,
          purl: purlString,
          "bom-ref": purlString,
          properties: [
            {
              name: "SrcFile",
              value: resolvedFile,
            },
          ],
          evidence: {
            identity: {
              field: "purl",
              confidence: 1,
              methods: [
                {
                  technique: "manifest-analysis",
                  confidence: 1,
                  value: resolvedFile,
                },
              ],
            },
          },
        };
        if (locationOrUrl) {
          rootPkg.repository = { url: locationOrUrl };
        }
        pkgList.push(rootPkg);
      }
    } catch (_err) {
      // continue regardless of error
    }
  }
  return pkgList;
}

/**
 * Parse a CMake-generated dot/graphviz file and extract components and their dependency
 * relationships.
 *
 * The first `digraph` entry becomes the parent component. Subsequent `node` entries
 * with a `label` attribute are treated as direct dependencies, while commented
 * `node -> node` relationships are used to construct the dependency graph.
 *
 * @param {string} dotFile Path to the CMake-generated dot file
 * @param {string} pkgType PackageURL type to assign to extracted packages (e.g. `"generic"`)
 * @param {Object} options CLI options; may contain `projectGroup`, `projectName`, and `projectVersion`
 * @returns {{ parentComponent: Object, pkgList: Object[], dependenciesList: Object[] }}
 */
export function parseCmakeDotFile(dotFile, pkgType, options = {}) {
  const dotGraphData = readFileSync(dotFile, { encoding: "utf-8" });
  const pkgList = [];
  const dependenciesMap = {};
  const pkgBomRefMap = {};
  let parentComponent = {};
  dotGraphData.split("\n").forEach((l) => {
    l = l.replace("\r", "").trim();
    if (l === "\n" || l.startsWith("#")) {
      return;
    }
    let name = "";
    const group = "";
    const version = "";
    let path;
    if (l.startsWith("digraph")) {
      const tmpA = l.split(" ");
      if (tmpA && tmpA.length > 1) {
        name = tmpA[1].replace(/"/g, "");
      }
    } else if (l.startsWith('"node')) {
      // Direct dependencies are represented as nodes
      if (l.includes("label =")) {
        const tmpA = l.split('label = "');
        if (tmpA && tmpA.length > 1) {
          name = tmpA[1].split('"')[0];
        }
        if (name.includes("\\n")) {
          name = name.split("\\n")[0];
        } else if (name.includes(_sep)) {
          path = name;
          name = basename(name);
        }
      } else if (l.includes("// ")) {
        // Indirect dependencies are represented with comments
        const tmpA = l.split("// ");
        if (tmpA?.length) {
          const relationship = tmpA[1];
          if (relationship.includes("->")) {
            const tmpB = relationship.split(" -> ");
            if (tmpB && tmpB.length === 2) {
              if (tmpB[0].includes(_sep)) {
                tmpB[0] = basename(tmpB[0]);
              }
              if (tmpB[1].includes(_sep)) {
                tmpB[1] = basename(tmpB[1]);
              }
              const ref = pkgBomRefMap[tmpB[0]];
              const depends = pkgBomRefMap[tmpB[1]];
              if (ref && depends) {
                if (!dependenciesMap[ref]) {
                  dependenciesMap[ref] = new Set();
                }
                dependenciesMap[ref].add(depends);
              }
            }
          }
        }
      }
    }
    if (!Object.keys(parentComponent).length) {
      parentComponent = {
        group: options.projectGroup || "",
        name: "project-name" in options ? options.projectName : name,
        version: options.projectVersion || "",
        type: "application",
      };
      parentComponent["purl"] = build({
        type: pkgType,
        namespace: parentComponent.group || null,
        name: parentComponent.name,
        version: parentComponent.version || null,
        subpath: path || null,
      });
      parentComponent["bom-ref"] = decodeURIComponent(parentComponent["purl"]);
    } else if (name) {
      const apkg = {
        name: name,
        type: pkgType,
        purl: build({
          type: pkgType,
          namespace: group || null,
          name: name,
          version: version || null,
          subpath: path ? path.replace(/^\/+/, "") : null,
        }),
      };
      apkg["bom-ref"] = decodeURIComponent(apkg["purl"]);
      pkgList.push(apkg);
      pkgBomRefMap[name] = apkg["bom-ref"];
    }
  });
  const dependenciesList = [];
  for (const pk of Object.keys(dependenciesMap)) {
    const dependsOn = Array.from(dependenciesMap[pk] || []).sort();
    dependenciesList.push({
      ref: pk,
      dependsOn,
    });
  }
  return {
    parentComponent,
    pkgList,
    dependenciesList,
  };
}

/**
 * Parse a CMake-like build file (CMakeLists.txt, meson.build, etc.) and extract the
 * parent component and list of dependency packages.
 *
 * Handles `set`, `project`, `find_package`, `find_library`, `find_dependency`,
 * `find_file`, `FetchContent_MakeAvailable`, and `dependency()` directives.
 * Uses the MesonWrapDB to improve name resolution confidence.
 *
 * @param {string} cmakeListFile Path to the CMake-like build file
 * @param {string} pkgType PackageURL type to assign to extracted packages (e.g. `"generic"`)
 * @param {Object} options CLI options; may contain `projectGroup`, `projectName`, and `projectVersion`
 * @returns {{ parentComponent: Object, pkgList: Object[] }}
 */
export function parseCmakeLikeFile(cmakeListFile, pkgType, options = {}) {
  let cmakeListData = readFileSync(cmakeListFile, { encoding: "utf-8" });
  const pkgList = [];
  const pkgAddedMap = {};
  const versionSpecifiersMap = {};
  const versionsMap = {};
  let parentComponent = {};
  const templateValues = {};
  cmakeListData = cmakeListData
    .replace(/^ {2}/g, "")
    .replace(/\(\r\n/g, "(")
    .replace(/\(\n/g, "(")
    .replace(/,\r\n/g, ",")
    .replace(/,\n/g, ",");
  cmakeListData.split("\n").forEach((l) => {
    l = l.replace("\r", "").trim();
    if (l === "\n" || l.startsWith("#")) {
      return;
    }
    const group = "";
    const path = undefined;
    const name_list = [];
    if (l.startsWith("set")) {
      const tmpA = l.replace("set(", "").replace(")", "").trim().split(" ");
      if (tmpA && tmpA.length === 2) {
        templateValues[tmpA[0]] = tmpA[1];
      }
    } else if (
      l.startsWith("project") &&
      !Object.keys(parentComponent).length
    ) {
      if (l.includes("${")) {
        for (const tmplKey of Object.keys(templateValues)) {
          l = l.replace(`\${${tmplKey}}`, templateValues[tmplKey] || "");
        }
      }
      const tmpA = l.replace("project (", "project(").split("project(");
      if (tmpA && tmpA.length > 1) {
        const tmpB = (tmpA[1] || "")
          .trim()
          .replace(/["']/g, "")
          .replace(/ /g, ",")
          .split(")")[0]
          .split(",")
          .filter((v) => v.length > 1);
        const parentName =
          tmpB.length > 0 ? tmpB[0].replace(":", "").trim() : "";
        let parentVersion;
        // In case of meson.build we can find the version number after the word version
        // thanks to our replaces and splits
        const versionIndex = tmpB.findIndex(
          (v) => v?.toLowerCase() === "version",
        );
        if (versionIndex > -1 && tmpB.length > versionIndex) {
          parentVersion = tmpB[versionIndex + 1];
        }
        if (parentName?.length && !parentName.includes("$")) {
          parentComponent = {
            group: options.projectGroup || "",
            name: parentName,
            version: parentVersion || options.projectVersion || "",
            type: "application",
          };
          const safePath = path ? path.replace(/^\/+/, "") : null;
          parentComponent["purl"] = build({
            type: pkgType,
            namespace: parentComponent.group || null,
            name: parentComponent.name,
            version: parentComponent.version || null,
            subpath: safePath,
          });
          parentComponent["bom-ref"] = decodeURIComponent(
            parentComponent["purl"],
          );
        }
      }
    } else if (l.startsWith("find_")) {
      let tmpA = [];
      for (const fm of [
        "find_package(",
        "find_library(",
        "find_dependency(",
        "find_file(",
        "FetchContent_MakeAvailable(",
      ]) {
        if (l.startsWith(fm)) {
          tmpA = l.split(fm);
          break;
        }
      }
      if (tmpA && tmpA.length > 1) {
        let tmpB = tmpA[1].split(")")[0].split(" ");
        tmpB = tmpB.filter(
          (v) =>
            ![
              "REQUIRED",
              "COMPONENTS",
              "QUIET",
              "NAMES",
              "PATHS",
              "ENV",
              "NO_MODULE",
              "NO_DEFAULT_PATH",
            ].includes(v) &&
            !v.includes("$") &&
            !v.includes("LIB") &&
            !v.startsWith("CMAKE_") &&
            v.length,
        );
        // find_package(Catch2)
        // find_package(GTest REQUIRED)
        // find_package(Boost 1.79 COMPONENTS date_time)
        // find_library(PTHREADPOOL_LIB pthreadpool REQUIRED)
        if (tmpB) {
          let working_name;
          if (l.startsWith("find_library")) {
            name_list.push(tmpB[1]);
            working_name = tmpB[1];
          } else {
            name_list.push(tmpB[0]);
            working_name = tmpB[0];
          }
          if (l.startsWith("find_package") && tmpB.length > 1) {
            if (
              /^\d+/.test(tmpB[1]) &&
              !tmpB[1].includes("${") &&
              !tmpB[1].startsWith("@")
            ) {
              versionsMap[working_name] = tmpB[1];
            }
          } else {
            for (const n of tmpB) {
              if (n.match(/^\d/)) {
                continue;
              }
              if (n.includes(_sep)) {
                if (
                  n.includes(".so") ||
                  n.includes(".a") ||
                  n.includes(".dll")
                ) {
                  name_list.push(basename(n));
                }
              } else {
                name_list.push(n);
              }
            }
          }
        }
      }
    } else if (l.includes("dependency(")) {
      if (!l.includes("_dependency") && !l.includes(".dependency")) {
        const depMatch = l.match(/dependency\(\s*['"]?([^'",)\s]+)['"]?/);
        const depName = depMatch?.[1]?.trim();
        if (depName) {
          name_list.push(depName);
          const versionMatch = l.match(/version\s*:\s*['"]?([^'",)\s]+)['"]?/);
          const depVersion = versionMatch?.[1]?.trim();
          if (depVersion) {
            if (depVersion.includes(">") || depVersion.includes("<")) {
              // We have a version specifier
              versionSpecifiersMap[depName] = depVersion;
            } else if (
              /^\d+/.test(depVersion) &&
              !depVersion.includes("${") &&
              !depVersion.startsWith("@")
            ) {
              // We have a valid version
              versionsMap[depName] = depVersion;
            }
          }
        }
      }
    }
    for (let n of name_list) {
      const props = [];
      let confidence = 0;
      if (
        n &&
        n.length > 1 &&
        !pkgAddedMap[n] &&
        !n.startsWith(_sep) &&
        !n.startsWith("@")
      ) {
        n = n.replace(/"/g, "");
        // Can this be replaced with a db lookup?
        for (const wrapkey of Object.keys(mesonWrapDB)) {
          const awrap = mesonWrapDB[wrapkey];
          if (
            awrap.PkgProvides.includes(n) ||
            awrap.PkgProvides.includes(n.toLowerCase())
          ) {
            // Use the new name
            n = wrapkey;
            for (const eprop of Object.keys(awrap)) {
              props.push({
                name: eprop,
                value: Array.isArray(awrap[eprop])
                  ? awrap[eprop].join("|")
                  : awrap[eprop],
              });
            }
            // Our confidence has improved from 0 since there is a matching wrap so we know the correct name
            // and url. We lack the version details.
            confidence = 0.5;
            break;
          }
        }
        if (versionSpecifiersMap[n]) {
          props.push({
            name: "cdx:build:versionSpecifiers",
            value: versionSpecifiersMap[n],
          });
        }
        const apkg = {
          name: n,
          version: versionsMap[n] || "",
          type: pkgType,
          purl: build({
            type: pkgType,
            namespace: group || null,
            name: n,
            version: versionsMap[n] || "" || null,
            subpath: path || null,
          }),
          evidence: {
            identity: {
              field: "purl",
              confidence,
              methods: [
                {
                  technique: "source-code-analysis",
                  confidence: 0.5,
                  value: `Filename ${cmakeListFile}`,
                },
              ],
            },
          },
          properties: props,
        };
        apkg["bom-ref"] = decodeURIComponent(apkg["purl"]);
        pkgList.push(apkg);
        pkgAddedMap[n] = true;
      }
    }
  });
  return {
    parentComponent,
    pkgList,
  };
}

export function parseCUsageSlice(sliceData) {
  if (!sliceData) {
    return undefined;
  }
  const usageData = {};
  try {
    const objectSlices = sliceData.objectSlices || [];
    for (const slice of objectSlices) {
      if (
        (!slice.fileName && !slice.code.startsWith("#include")) ||
        slice.fileName.startsWith("<includes") ||
        slice.fileName.startsWith("<global") ||
        slice.fileName.includes("__")
      ) {
        continue;
      }
      const slFileName = slice.fileName;
      const allLines = usageData[slFileName] || new Set();
      if (slice.fullName && slice.fullName.length > 3) {
        if (slice.code?.startsWith("#include")) {
          usageData[slice.fullName] = new Set();
        } else {
          allLines.add(slice.fullName);
        }
      }
      for (const ausage of slice.usages) {
        let calls = ausage?.invokedCalls || [];
        calls = calls.concat(ausage?.argToCalls || []);
        for (const acall of calls) {
          if (!acall.resolvedMethod.includes("->")) {
            allLines.add(acall.resolvedMethod);
          }
        }
      }
      if (Array.from(allLines).length) {
        usageData[slFileName] = allLines;
      }
    }
  } catch (_err) {
    // ignore
  }
  return usageData;
}

/**
 * Function to parse the .d make files
 *
 * @param {String} dfile .d file path
 *
 * @returns {Object} pkgFilesMap Object with package name and list of files
 */
export function parseMakeDFile(dfile) {
  const pkgFilesMap = {};
  const dData = readFileSync(dfile, { encoding: "utf-8" });
  const pkgName = basename(dfile).split("-").shift();
  const filesList = new Set();
  dData.split("\n").forEach((l) => {
    l = l.replace("\r", "");
    if (!l.endsWith(".rs:")) {
      return;
    }
    const fileName = `.cargo/${l.split(".cargo/").pop()}`.replace(
      ".rs:",
      ".rs",
    );
    filesList.add(fileName);
  });
  pkgFilesMap[pkgName] = Array.from(filesList);
  return pkgFilesMap;
}
