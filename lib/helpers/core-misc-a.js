import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, readFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { delimiter as _delimiter, dirname, join, resolve } from "node:path";
import process from "node:process";

import { build } from "@cdxgen/cdx-purl";

import {
  cdxgenAgent,
  DEBUG_MODE,
  isSecureMode,
  recordDecisionActivity,
} from "../core/activity.js";
import { PYTHON_CMD, PYTHON_EXCLUDED_COMPONENTS } from "../core/env.js";
import {
  safeExistsSync,
  safeMkdtempSync,
  safeRmSync,
  safeSpawnSync,
  safeWriteSync,
  temporaryFiles,
} from "../core/fs.js";
import { thoughtLog } from "../core/logger.js";
import { dirNameStr, isWin } from "../core/paths.js";
import {
  PYPI_MODULE_PACKAGE_MAPPING,
  PYTHON_STD_MODULES,
} from "../core/state.js";
import { buildAtomCommandEnv } from "./atomUtils.js";
import { flattenDeps } from "./deps.js";
import { getPyMetadata } from "./ecosystems.js";
import { parsePkgJson } from "./parsers-js.js";
import { parseReqFile } from "./parsers-python.js";
import { get_python_command_from_env, getVenvMetadata } from "./pythonutils.js";
import { spdxLicenses } from "./spdx.js";

/**
 * Method to find python modules by parsing the imports and then checking with PyPI to obtain the latest version
 *
 * @param {string} src directory
 * @param {Array} epkgList Existing package list
 * @param {Object} options CLI options
 * @returns List of packages
 */
export async function getPyModules(src, epkgList, options) {
  const allImports = {};
  const dependenciesList = [];
  let modList = [];
  const slicesFile = resolve(
    options.depsSlicesFile || options.usagesSlicesFile,
  );
  // Issue: 615 fix. Reuse existing slices file
  if (slicesFile && safeExistsSync(slicesFile)) {
    const slicesData = JSON.parse(readFileSync(slicesFile, "utf-8"));
    if (slicesData && Object.keys(slicesData) && slicesData.modules) {
      modList = slicesData.modules;
    } else {
      modList = slicesData;
    }
  } else {
    modList = findAppModules(src, "python", "parsedeps", slicesFile, options);
  }
  const pyDefaultModules = new Set(PYTHON_STD_MODULES);
  modList = modList.filter(
    (x) =>
      !pyDefaultModules.has(x.name.toLowerCase()) &&
      !x.name.startsWith("_") &&
      !x.name.startsWith("."),
  );
  let pkgList = modList.map((p) => {
    const apkg = {
      name:
        PYPI_MODULE_PACKAGE_MAPPING[p.name.toLowerCase()] ||
        PYPI_MODULE_PACKAGE_MAPPING[p.name.replace(/_/g, "-").toLowerCase()] ||
        p.name.replace(/_/g, "-").toLowerCase(),
      version: p.version?.trim().length ? p.version : undefined,
      scope: "required",
      properties: [
        {
          name: "cdx:pypi:versionSpecifiers",
          value: p.versionSpecifiers,
        },
      ],
    };
    if (p.importedSymbols) {
      apkg.properties.push({
        name: "ImportedModules",
        value: p.importedSymbols,
      });
    }
    return apkg;
  });
  pkgList = pkgList.filter(
    (obj, index) => pkgList.findIndex((i) => i.name === obj.name) === index,
  );
  if (epkgList?.length) {
    const pkgMaps = epkgList.map((p) => p.name);
    pkgList = pkgList.filter((p) => !pkgMaps.includes(p.name));
  }
  pkgList = await getPyMetadata(pkgList, true);
  // Populate the imports list after dealiasing
  if (pkgList?.length) {
    pkgList.forEach((p) => {
      allImports[p.name] = true;
    });
  }
  for (const p of pkgList) {
    if (p.version) {
      dependenciesList.push({
        ref: `pkg:pypi/${p.name.replace(/_/g, "-")}@${p.version}`.toLowerCase(),
        dependsOn: [],
      });
    }
  }
  return { allImports, pkgList, dependenciesList, modList };
}

/**
 * Method to return the mill command to use.
 *
 * @param {string} srcPath Path to look for mill wrapper
 */
export function getMillCommand(srcPath) {
  let millCmd = `mill${platform() === "win32" ? ".bat" : ""}`;
  if (safeExistsSync(join(srcPath, millCmd))) {
    // Use local mill wrapper if available
    // Enable execute permission
    try {
      chmodSync(join(srcPath, millCmd), 0o775);
    } catch (_e) {
      // continue regardless of error
    }
    millCmd = resolve(join(srcPath, millCmd));
  }
  return millCmd;
}

/**
 * Parse the contents of a 'Podfile.lock'
 *
 * @param {Object} podfileLock The content of the podfile.lock as an Object
 * @param {String} projectPath The path to the project root
 * @returns {Map} Map of all dependencies with their direct dependencies
 */
export async function parsePodfileLock(podfileLock, projectPath) {
  const dependencies = new Map();
  for (const pod of podfileLock["PODS"]) {
    const dependency = {};
    if (pod.constructor === Object) {
      for (const key in pod) {
        dependency.metadata = parseCocoaDependency(key);
        const subDependencies = new Set();
        for (const subPod of pod[key]) {
          subDependencies.add(parseCocoaDependency(subPod, false));
        }
        dependency.dependencies = Array.from(subDependencies);
      }
    } else {
      dependency.metadata = parseCocoaDependency(pod);
    }
    const podName = dependency.metadata.name.includes("/")
      ? dependency.metadata.name.substring(
          0,
          dependency.metadata.name.indexOf("/"),
        )
      : dependency.metadata.name;
    if (podfileLock["EXTERNAL SOURCES"]?.[podName]) {
      const externalPod = podfileLock["EXTERNAL SOURCES"][podName];
      if (externalPod[":git"]) {
        let projectRepo = externalPod[":git"];
        if (projectRepo.includes("github.com")) {
          projectRepo = projectRepo.replace(
            "github.com",
            "raw.githubusercontent.com",
          );
        }
        if (projectRepo.endsWith(".git")) {
          projectRepo = projectRepo.substring(0, projectRepo.length - 4);
        }
        const projectRepoBranchOrTag = externalPod[":tag"]
          ? `tags/${externalPod[":tag"]}`
          : `heads/${externalPod[":branch"] ? externalPod[":branch"] : "<DEFAULT>"}`;
        dependency.metadata.properties = [
          {
            name: "cdx:pods:podspecLocation",
            value: `${projectRepo}/refs/${projectRepoBranchOrTag}/${podName}.podspec`,
          },
        ];
      } else if (externalPod[":path"]) {
        const projectLocation = resolve(projectPath, externalPod[":path"]);
        dependency.metadata.properties = [
          {
            name: "cdx:pods:projectDir",
            value: projectLocation,
          },
        ];
        let podspec = join(projectLocation, `${podName}.podspec`);
        if (!safeExistsSync(podspec)) {
          podspec = `${podspec}.json`;
        }
        if (safeExistsSync(podspec)) {
          dependency.metadata.properties.push({
            name: "cdx:pods:podspecLocation",
            value: podspec,
          });
        }
      } else if (externalPod[":podspec"]) {
        const podspecLocation = resolve(projectPath, externalPod[":podspec"]);
        dependency.metadata.properties = [
          {
            name: "cdx:pods:projectDir",
            value: dirname(podspecLocation),
          },
          {
            name: "cdx:pods:podspecLocation",
            value: podspecLocation,
          },
        ];
      }
    }
    dependencies.set(dependency.metadata.name, dependency);
  }
  if (!["false", "0"].includes(process.env.COCOA_MERGE_SUBSPECS)) {
    for (const subspecComponentName of [...dependencies.keys()].filter((name) =>
      name.includes("/"),
    )) {
      const subspecComponent = dependencies.get(subspecComponentName);
      const mainComponentName = subspecComponentName.split("/")[0];
      let mainComponent = dependencies.get(mainComponentName);
      if (!mainComponent) {
        mainComponent = {
          metadata: {
            name: mainComponentName,
            version: subspecComponent.metadata.version,
          },
        };
        dependencies.set(mainComponentName, mainComponent);
      }
      if (subspecComponent.dependencies) {
        if (mainComponent.dependencies) {
          mainComponent.dependencies = [
            ...mainComponent.dependencies,
            ...subspecComponent.dependencies,
          ];
        } else {
          mainComponent.dependencies = subspecComponent.dependencies;
        }
      }
      mainComponent.metadata.properties = [
        ...(mainComponent.metadata.properties
          ? mainComponent.metadata.properties
          : []),
        {
          name: "cdx:pods:Subspec",
          value: subspecComponentName.substring(
            subspecComponentName.indexOf("/") + 1,
          ),
        },
        ...(subspecComponent.metadata.propertie
          ? subspecComponent.metadata.properties
          : []),
      ];
      dependencies.delete(subspecComponentName);
    }
    for (const [dependencyName, dependency] of dependencies) {
      if (dependency.dependencies) {
        dependency.dependencies.forEach((dep) => {
          dep.name = dep.name.split("/")[0];
        });
        dependency.dependencies = [
          ...new Map(
            dependency.dependencies
              .filter((dep) => dep.name !== dependencyName)
              .map((dep) => [dep.name, dep]),
          ).values(),
        ];
        if (dependency.dependencies.length === 0) {
          delete dependency.dependencies;
        }
      }
    }
  }
  return dependencies;
}

/**
 * Parse all targets and their direct dependencies from the 'Podfile'
 *
 * @param {Object} target A JSON-object representing a target
 * @param {Map} allDependencies The map containing all parsed direct dependencies for a target
 * @param {String} [prefix=undefined] Prefix to add to the targets name
 */
export function parsePodfileTargets(
  target,
  allDependencies,
  prefix = undefined,
) {
  const targetName = (prefix ? `${prefix}/` : "") + target.name;
  const targetDependencies = new Set(
    prefix && allDependencies.has(prefix)
      ? allDependencies.get(prefix)
      : targetName !== "Pods"
        ? allDependencies.get("Pods")
        : [],
  );
  if (target["dependencies"]) {
    for (const targetDependency of target["dependencies"]) {
      if (targetDependency.constructor === Object) {
        targetDependencies.add(Object.keys(targetDependency)[0]);
      } else {
        targetDependencies.add(targetDependency);
      }
    }
  }
  allDependencies.set(targetName, Array.from(targetDependencies));
  if (target.children) {
    const childPrefix = targetName === "Pods" ? undefined : targetName;
    for (const childTarget of target.children) {
      parsePodfileTargets(childTarget, allDependencies, childPrefix);
    }
  }
}

/**
 * Parse a single line representing a dependency
 *
 * @param {String} dependencyLine The line that should be parsed as a dependency
 * @param {boolean} [parseVersion=true] Include parsing the version of the dependency
 * @returns {Object} Object representing a dependency
 */
export function parseCocoaDependency(dependencyLine, parseVersion = true) {
  const dependencyData = dependencyLine.split(" (");
  const dependency = { name: dependencyData[0] };
  if (parseVersion) {
    dependency.version = dependencyData[1].substring(
      0,
      dependencyData[1].length - 1,
    );
  }
  return dependency;
}

/**
 * Execute the 'pod'-command with parameters
 *
 * @param {String[]} parameters The parameters for the command
 * @param {String} path The path where the command should be executed
 * @param {Object} options CLI options
 * @returns {Object} The result of running the command
 */
export function executePodCommand(parameters, path, options) {
  if (DEBUG_MODE) {
    if (path) {
      console.log("Executing pod", parameters.join(" "), "in", path);
    } else {
      console.log("Executing pod", parameters.join(" "));
    }
  }
  const result = safeSpawnSync(process.env.POD_CMD || "pod", parameters, {
    cwd: path,
    shell: isWin,
  });
  if (result.status !== 0 || result.error) {
    if (result?.stderr?.includes("Unable to find a pod")) {
      console.log(
        "Try again by running 'pod install' before invoking 'cdxgen'.",
      );
    }
    if (process.env?.CDXGEN_IN_CONTAINER !== "true") {
      console.log(
        "Consider using the cdxgen container image (`ghcr.io/cyclonedx/cdxgen`), which includes cocoapods and additional build tools.",
      );
    } else if (!DEBUG_MODE) {
      console.log(
        "Something went wrong when trying to execute cocoapods -- Set the environment variable 'CDXGEN_DEBUG_MODE=debug' to troubleshoot cocoapods related errors",
      );
    }
    if (options.failOnError || DEBUG_MODE) {
      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.log(result.stderr);
      }
      options.failOnError && process.exit(1);
    }
  }
  return result;
}

/**
 * Method that handles object creation for cocoa pods.
 *
 * @param {Object} dependency The dependency that is to be transformed into an SBOM object
 * @param {Object} options CLI options
 * @param {String} [type="library"] The type of Object to create
 * @returns {Object} An object representing the pod in SBOM-format
 */
export async function buildObjectForCocoaPod(
  dependency,
  options,
  type = "library",
) {
  let component;
  if (
    !["false", "0"].includes(process.env.COCOA_RESOLVE_FROM_NODE) &&
    dependency.properties?.find(({ name }) => name === "cdx:pods:projectDir")
  ) {
    let tmpDir = dependency.properties.find(
      ({ name }) => name === "cdx:pods:projectDir",
    ).value;
    const exclusionDirs = process.env.COCOA_RESOLVE_FROM_NODE_EXCLUSION_DIRS
      ? process.env.COCOA_RESOLVE_FROM_NODE_EXCLUSION_DIRS.split(",")
      : [];
    if (
      tmpDir &&
      !exclusionDirs.some((dir) =>
        `${tmpDir.replaceAll("\\", "/")}/`.includes(
          `/${dir.replaceAll("\\", "/")}/`.replaceAll("//", "/"),
        ),
      ) &&
      tmpDir.indexOf("node_modules") !== -1
    ) {
      do {
        const npmPackages = await parsePkgJson(join(tmpDir, "package.json"));
        if (npmPackages.length === 1) {
          component = npmPackages[0];
          component.type = "library";
          component.properties = component.properties.concat(
            {
              name: "cdx:pods:PodName",
              value: dependency.name,
            },
            dependency.properties,
          );
          tmpDir = undefined;
        } else {
          tmpDir = dirname(tmpDir);
        }
      } while (tmpDir && tmpDir.indexOf("node_modules") !== -1);
    }
  }
  if (!component) {
    let name = dependency.name;
    let subspec = null;
    const locationOfSubspec = dependency.name.indexOf("/");
    if (locationOfSubspec !== -1) {
      name = dependency.name.substring(0, locationOfSubspec);
      subspec = dependency.name.substring(locationOfSubspec + 1);
    }
    component = {
      ...dependency,
      type,
    };
    if (subspec) {
      if (!component.properties) {
        component.properties = [];
      }
      component.properties.push({
        name: "cdx:pods:Subspec",
        value: subspec,
      });
    }
    const purl = build({
      type: "cocoapods",
      namespace: "" || null,
      name: name,
      version: component.version || null,
      subpath: subspec || null,
    });
    component["purl"] = purl;
    component["bom-ref"] = decodeURIComponent(purl);
    if (options && !["false", "0"].includes(process.env.COCOA_FULL_SCAN)) {
      await fullScanCocoaPod(dependency, component, options);
    }
  }
  return component;
}

async function fullScanCocoaPod(dependency, component, options) {
  let result;
  if (
    component.properties?.find(
      ({ name }) => name === "cdx:pods:podspecLocation",
    )
  ) {
    let podspecLocation = component.properties.find(
      ({ name }) => name === "cdx:pods:podspecLocation",
    ).value;
    if (
      component.properties.find(({ name }) => name === "cdx:pods:projectDir")
    ) {
      component.properties.push({
        name: "SrcFile",
        value: podspecLocation,
      });
    }
    let replacements = [];
    if (
      podspecLocation.endsWith(".podspec") &&
      process.env.COCOA_PODSPEC_REPLACEMENTS
    ) {
      replacements = process.env.COCOA_PODSPEC_REPLACEMENTS.split(";");
    } else if (
      podspecLocation.endsWith(".json") &&
      process.env.COCOA_PODSPEC_JSON_REPLACEMENTS
    ) {
      replacements = process.env.COCOA_PODSPEC_JSON_REPLACEMENTS.split(";");
    }
    if (replacements || podspecLocation.startsWith("http")) {
      let podspecContent;
      if (podspecLocation.startsWith("http")) {
        let httpResult;
        for (const branchName of ["main", "master"]) {
          try {
            httpResult = await cdxgenAgent.get(
              podspecLocation.replace("<DEFAULT>", branchName),
            );
            podspecLocation = podspecLocation.replace("<DEFAULT>", branchName);
          } catch (_err) {
            try {
              httpResult = await cdxgenAgent.get(
                `${podspecLocation.replace("<DEFAULT>", branchName)}.json`,
              );
              podspecLocation = `${podspecLocation.replace("<DEFAULT>", branchName)}.json`;
            } catch (_err) {
              continue;
            }
          }
          component.properties.find(
            ({ name }) => name === "cdx:pods:podspecLocation",
          ).value = podspecLocation;
          podspecLocation = `${randomUUID()}.${podspecLocation.substring(podspecLocation.lastIndexOf(".") + 1)}`;
          podspecContent = httpResult.body;
          break;
        }
      } else {
        podspecContent = readFileSync(podspecLocation, "utf-8");
      }
      for (const replacement of replacements) {
        const replacementPair = replacement.split("=");
        let match = replacementPair[0].replaceAll("<NEWLINE>", "\n");
        if (match.startsWith("/") && match.endsWith("/")) {
          match = new RegExp(match.substring(1, match.length - 1), "g");
        }
        const repl = replacementPair[1].replaceAll("<NEWLINE>", "\n");
        podspecContent = podspecContent.replaceAll(match, repl);
      }
      podspecLocation = join(
        dirname(podspecLocation),
        `${randomUUID()}.${podspecLocation.substring(podspecLocation.lastIndexOf(".") + 1)}`,
      );
      safeWriteSync(podspecLocation, podspecContent);
      temporaryFiles.add(podspecLocation);
    }
    result = executePodCommand(
      ["ipc", "spec", "--silent", podspecLocation],
      undefined,
      options,
    );
  } else {
    let dependencyName = dependency.name;
    if (dependencyName.includes("/")) {
      dependencyName = dependencyName.substring(0, dependencyName.indexOf("/"));
    }
    // `pod` may not be installed at all, in which case spawn returns a result
    // with no stdout. Calling .trim() on that threw and aborted the whole
    // CocoaPods scan, so any machine without CocoaPods could not generate a
    // BOM from a Podfile.lock it had already parsed successfully.
    const srcFileResult = executePodCommand(
      [
        "spec",
        "which",
        `^${dependencyName}$`,
        "--regex",
        `--version=${dependency.version}`,
      ],
      undefined,
      options,
    );
    if (srcFileResult?.stdout) {
      const srcFileProperty = {
        name: "SrcFile",
        value: srcFileResult.stdout.trim(),
      };
      if (component.properties) {
        component.properties.push(srcFileProperty);
      } else {
        component.properties = [srcFileProperty];
      }
    }
    result = executePodCommand(
      [
        "spec",
        "cat",
        `^${dependencyName}$`,
        "--regex",
        `--version=${dependency.version}`,
      ],
      undefined,
      options,
    );
  }
  // Same reason as above: no `pod` binary means no result to parse.
  const podspecText = result?.stdout;
  if (!podspecText) {
    return;
  }
  let podspec;
  try {
    podspec = JSON.parse(
      podspecText.substring(
        podspecText.indexOf("{"),
        podspecText.lastIndexOf("}") + 1,
      ),
    );
  } catch (_e) {
    return;
  }
  const externalRefs = [];
  if (podspec.authors) {
    component.authors = [];
    if (podspec.authors.constructor === Object) {
      Object.entries(podspec.authors).forEach(([name, email]) => {
        email.includes("@")
          ? component.authors.push({ name, email })
          : component.authors.push({ name });
      });
    } else if (podspec.authors.constructor === Array) {
      podspec.authors.forEach((name) => {
        component.authors.push({ name });
      });
    } else {
      component.authors.push({ name: podspec.authors });
    }
  }
  if (podspec.description) {
    component.description = podspec.description;
  } else if (podspec.summary) {
    component.description = podspec.summary;
  }
  if (podspec.documentation_url) {
    externalRefs.push({
      type: "documentation",
      url: podspec.documentation_url,
    });
  } else if (podspec.readme) {
    externalRefs.push({
      type: "documentation",
      url: podspec.readme,
    });
  }
  if (podspec.homepage) {
    externalRefs.push({
      type: "website",
      url: podspec.homepage,
    });
  }
  if (podspec.license) {
    if (podspec.license.constructor === Object) {
      if (podspec.license.type === "Copyright") {
        component.copyright = podspec.license.text;
      } else {
        component.licenses = [{ license: {} }];
        if (spdxLicenses.includes(podspec.license.type)) {
          component.licenses[0].license.id = podspec.license.type;
        } else {
          component.licenses[0].license.name = podspec.license.type;
        }
        const licenseText = [];
        if (podspec.license.text) {
          if (podspec.license.text.startsWith("http")) {
            component.licenses[0].license.url = podspec.license.text;
          } else {
            licenseText.push(podspec.license.text);
          }
        }
        if (podspec.license.file) {
          if (podspec.license.file.startsWith("http")) {
            if (component.licenses[0].license.url) {
              if (licenseText.length !== 0) {
                licenseText.push("");
              }
              licenseText.push(
                `See also: ${component.licenses[0].license.url}`,
              );
            }
            component.licenses[0].license.url = podspec.license.file;
          } else {
            if (licenseText.length !== 0) {
              licenseText.push("");
            }
            licenseText.push(`See license in file '${podspec.license.file}'`);
          }
        }
        if (licenseText.length !== 0) {
          component.licenses[0].license.text = {
            content: licenseText.join("\n"),
          };
        }
      }
    } else {
      if (spdxLicenses.includes(podspec.license)) {
        component.licenses = [{ license: { id: podspec.license } }];
      } else {
        component.licenses = [{ license: { name: podspec.license } }];
      }
    }
  }
  if (podspec.social_media_url) {
    externalRefs.push({
      type: "social",
      url: podspec.social_media_url,
    });
  }
  if (podspec.source) {
    const comment = [];
    if (podspec.source.http) {
      const sourceDistro = {
        type: "source-distribution",
        url: podspec.source.http,
      };
      const hashes = [];
      if (podspec.source.http.sha1) {
        hashes.push({
          alg: "SHA-1",
          content: podspec.source.http.sha1,
        });
      }
      if (podspec.source.http.sha256) {
        hashes.push({
          alg: "SHA-256",
          content: podspec.source.http.sha256,
        });
      }
      if (hashes.length !== 0) {
        sourceDistro.hashes = hashes;
      }
      if (podspec.source.flatten) {
        comment.push(`Flatten: ${podspec.source.flatten}`);
      }
      if (podspec.source.type) {
        comment.push(`Type: ${podspec.source.type}`);
      }
      if (podspec.source.headers) {
        comment.push(`Headers: ${podspec.source.headers}`);
      }
      if (comment.length !== 0) {
        sourceDistro.comment = comment.join("\n");
      }
      externalRefs.push(sourceDistro);
    } else {
      let url;
      if (podspec.source.git) {
        url = podspec.source.git;
        comment.push("Type: git");
        if (podspec.source.branch) {
          comment.push(`Branch: ${podspec.source.branch}`);
        }
        if (podspec.source.commit) {
          comment.push(`Commit: ${podspec.source.commit}`);
        }
        if (podspec.source.tag) {
          comment.push(`Tag: ${podspec.source.tag}`);
        }
        if (podspec.source.submodules) {
          comment.push(`Submodules: ${podspec.source.submodules}`);
        }
      } else if (podspec.source.hg) {
        url = podspec.source.hg;
        comment.push("Type: hg");
        if (podspec.source.revision) {
          comment.push(`Revision: ${podspec.source.revision}`);
        }
      } else if (podspec.source.svn) {
        url = podspec.source.svn;
        comment.push("Type: svn");
        if (podspec.source.folder) {
          comment.push(`Folder: ${podspec.source.folder}`);
        }
        if (podspec.source.revision) {
          comment.push(`Revision: ${podspec.source.revision}`);
        }
        if (podspec.source.tag) {
          comment.push(`Tag: ${podspec.source.tag}`);
        }
      }
      if (url) {
        externalRefs.push({
          type: "vcs",
          url: url,
          comment: comment.join("\n"),
        });
      } else {
        console.warn(
          `${dependency.name} has property 'source' defined, but it does not contain a URL -- ignoring...`,
        );
      }
    }
  }
  if (externalRefs.length !== 0) {
    component.externalReferences = externalRefs;
  }
}

/**
 * Method to return the maven command to use.
 *
 * @param {string} srcPath Path to look for maven wrapper
 * @param {string} rootPath Root directory to look for maven wrapper
 */
export function getMavenCommand(srcPath, rootPath) {
  let mavenCmd = "mvn";
  // Check if the wrapper script is both available and functional
  let isWrapperReady = false;
  let isWrapperFound = false;
  let findMavenFile = "mvnw";
  let mavenWrapperCmd = null;
  if (platform() === "win32") {
    findMavenFile = "mvnw.bat";
    if (
      !safeExistsSync(join(srcPath, findMavenFile)) &&
      safeExistsSync(join(srcPath, "mvnw.cmd"))
    ) {
      findMavenFile = "mvnw.cmd";
    }
  }

  if (safeExistsSync(join(srcPath, findMavenFile))) {
    // Use local maven wrapper if available
    // Enable execute permission
    try {
      chmodSync(join(srcPath, findMavenFile), 0o775);
    } catch (_e) {
      // continue regardless of error
    }
    mavenWrapperCmd = resolve(join(srcPath, findMavenFile));
    isWrapperFound = true;
    recordDecisionActivity(mavenWrapperCmd, {
      metadata: {
        decisionType: "path-resolution",
        selectedSource: "project-wrapper-candidate",
        tool: "maven",
      },
      reason: `Found Maven wrapper candidate ${mavenWrapperCmd}.`,
    });
  } else if (rootPath && safeExistsSync(join(rootPath, findMavenFile))) {
    // Check if the root directory has a wrapper script
    try {
      chmodSync(join(rootPath, findMavenFile), 0o775);
    } catch (_e) {
      // continue regardless of error
    }
    mavenWrapperCmd = resolve(join(rootPath, findMavenFile));
    isWrapperFound = true;
    recordDecisionActivity(mavenWrapperCmd, {
      metadata: {
        decisionType: "path-resolution",
        selectedSource: "root-wrapper-candidate",
        tool: "maven",
      },
      reason: `Found root-level Maven wrapper candidate ${mavenWrapperCmd}.`,
    });
  }
  if (isWrapperFound) {
    if (DEBUG_MODE) {
      console.log("Testing the wrapper script by invoking --version");
    }
    const result = safeSpawnSync(mavenWrapperCmd, ["--version"], {
      cdxgenActivity: {
        kind: "probe",
        metadata: {
          tool: "maven",
        },
        probeType: "wrapper-readiness",
      },
      cwd: rootPath,
      shell: isWin,
    });
    if (!result.error && !result.status) {
      isWrapperReady = true;
      mavenCmd = mavenWrapperCmd;
      recordDecisionActivity(mavenCmd, {
        metadata: {
          decisionType: "path-resolution",
          selectedSource: "wrapper",
          tool: "maven",
        },
        reason: `Selected Maven wrapper ${mavenCmd} after readiness probe.`,
      });
    } else {
      if (DEBUG_MODE) {
        console.log(
          "Maven wrapper script test has failed. Will use the installed version of maven.",
        );
      }
      recordDecisionActivity(mavenWrapperCmd, {
        metadata: {
          decisionType: "fallback",
          selectedSource: "PATH",
          skippedSource: "wrapper",
          tool: "maven",
        },
        reason: `Maven wrapper readiness probe failed for ${mavenWrapperCmd}; falling back to installed Maven.`,
      });
    }
  }
  if (!isWrapperFound || !isWrapperReady) {
    if (process.env.MVN_CMD || process.env.MAVEN_CMD) {
      mavenCmd = process.env.MVN_CMD || process.env.MAVEN_CMD;
      recordDecisionActivity(mavenCmd, {
        metadata: {
          decisionType: "path-resolution",
          selectedSource: process.env.MVN_CMD ? "MVN_CMD" : "MAVEN_CMD",
          tool: "maven",
        },
        reason: `Selected Maven command from environment (${mavenCmd}).`,
      });
    } else if (process.env.MAVEN_HOME) {
      mavenCmd = join(process.env.MAVEN_HOME, "bin", "mvn");
      recordDecisionActivity(mavenCmd, {
        metadata: {
          decisionType: "path-resolution",
          selectedSource: "MAVEN_HOME",
          tool: "maven",
        },
        reason: `Selected Maven command from MAVEN_HOME (${mavenCmd}).`,
      });
    } else {
      recordDecisionActivity(mavenCmd, {
        metadata: {
          decisionType: "path-resolution",
          selectedSource: "PATH",
          tool: "maven",
        },
        reason: "Falling back to Maven from PATH.",
      });
    }
  }
  return mavenCmd;
}

/**
 * Retrieves the atom command by referring to various environment variables
 */
export function getAtomCommand() {
  if (process.env.ATOM_CMD) {
    return process.env.ATOM_CMD;
  }
  if (process.env.ATOM_HOME) {
    return join(process.env.ATOM_HOME, "bin", "atom");
  }
  const NODE_CMD = process.env.NODE_CMD || "node";
  const localAtom = join(
    dirNameStr,
    "node_modules",
    "@appthreat",
    "atom",
    "index.js",
  );
  if (safeExistsSync(localAtom)) {
    return `${NODE_CMD} ${localAtom}`;
  }
  return "atom";
}

/**
 * Execute the atom tool against a source directory or file with the given arguments.
 *
 * Resolves the atom binary via `getAtomCommand`, sets up the required environment
 * (including `JAVA_HOME` from `ATOM_JAVA_HOME` if set), and spawns the process.
 * Logs diagnostic messages for common failure modes such as unsupported Java versions,
 * missing `astgen`, and JVM crashes.
 *
 * @param {string} src Path to the source directory or file to analyse
 * @param {string[]} args Arguments to pass to the atom command
 * @param {Object} extra_env Additional environment variables to merge into the process environment
 * @returns {boolean} `true` if atom executed successfully and the language is supported; `false` otherwise
 */
export function executeAtom(src, args, extra_env = {}) {
  const cwd =
    safeExistsSync(src) && lstatSync(src).isDirectory() ? src : dirname(src);
  let ATOM_BIN = getAtomCommand();
  let isSupported = true;
  if (ATOM_BIN.includes(" ")) {
    const tmpA = ATOM_BIN.split(" ");
    if (tmpA && tmpA.length > 1) {
      ATOM_BIN = tmpA[0];
      args.unshift(tmpA[1]);
    }
  }
  if (DEBUG_MODE) {
    console.log("Executing", ATOM_BIN);
  }
  const env = {
    ...process.env,
    ...extra_env,
  };
  // Atom requires Java >= 21
  if (process.env?.ATOM_JAVA_HOME) {
    env.JAVA_HOME = process.env.ATOM_JAVA_HOME;
  }
  if (isWin) {
    env.PATH = `${env.PATH || env.Path}${_delimiter}${join(
      dirNameStr,
      "node_modules",
      ".bin",
    )}`;
  } else {
    env.PATH = `${env.PATH}${_delimiter}${join(
      dirNameStr,
      "node_modules",
      ".bin",
    )}`;
  }
  const result = safeSpawnSync(ATOM_BIN, args, {
    cwd,
    shell: isWin,
    killSignal: "SIGKILL",
    env,
  });
  if (result.stderr) {
    if (
      result.stderr?.includes(
        "has been compiled by a more recent version of the Java Runtime",
      ) ||
      result.stderr?.includes(
        "Error: Could not create the Java Virtual Machine",
      )
    ) {
      console.log(
        "Atom requires Java 21 or above. To improve the SBOM accuracy, please install a suitable version, set the JAVA_HOME environment variable, and re-run cdxgen.\nAlternatively, use the cdxgen container image.",
      );
      console.log(`Current JAVA_HOME: ${env["JAVA_HOME"] || ""}`);
    } else if (result.stderr?.includes("astgen")) {
      console.warn(
        "WARN: Unable to locate astgen command. Install atom globally using sudo npm install -g @appthreat/atom-parsetools to resolve this issue.",
      );
    } else if (
      result.stderr?.includes(
        "The crash happened outside the Java Virtual Machine in native code",
      )
    ) {
      console.warn(
        "WARN: The binary plugin used by atom has crashed. Please try an alternative container image and file an issue with steps to reproduce at: https://github.com/AppThreat/atom/issues",
      );
    } else if (
      result.stderr?.includes("Could not parse command line options")
    ) {
      console.warn(
        "Invalid command-line options passed to atom. Please file a bug in the cdxgen repository.",
      );
    }
  }
  if (result.stdout) {
    if (result.stdout.includes("No language frontend supported for language")) {
      console.log("This language is not yet supported by atom.");
      isSupported = false;
    } else if (
      result.stdout.includes(
        "The crash happened outside the Java Virtual Machine in native code",
      ) ||
      result.stdout.includes(
        "A fatal error has been detected by the Java Runtime Environment",
      )
    ) {
      console.warn(
        "WARN: The binary plugin used by atom has crashed. Please try an alternative container image and file an issue with steps to reproduce at: https://github.com/AppThreat/atom/issues",
      );
    }
  }
  if (DEBUG_MODE) {
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.log(result.stderr);
    }
  }
  return isSupported && !result.error;
}

/**
 * Find the imported modules in the application with atom parsedeps command
 *
 * @param {string} src
 * @param {string} language
 * @param {string} methodology
 * @param {string} slicesFile
 * @param {Object} options CLI options
 * @returns List of imported modules
 */
export function findAppModules(
  src,
  language,
  methodology = "usages",
  slicesFile = undefined,
  options = {},
) {
  const tempDir = safeMkdtempSync(join(tmpdir(), "atom-deps-"));
  const atomFile = join(tempDir, `${language}-app.atom`);
  if (!slicesFile) {
    slicesFile = join(tempDir, "slices.json");
  }
  let retList = [];
  const args = [
    methodology,
    "-l",
    language,
    "-o",
    resolve(atomFile),
    "--slice-outfile",
    resolve(slicesFile),
    resolve(src),
  ];
  executeAtom(src, args, buildAtomCommandEnv(options, language));
  if (safeExistsSync(slicesFile)) {
    const slicesData = JSON.parse(readFileSync(slicesFile, "utf-8"), {
      encoding: "utf-8",
    });
    if (slicesData && Object.keys(slicesData) && slicesData.modules) {
      retList = slicesData.modules;
    } else {
      retList = slicesData;
    }
  } else {
    console.log(
      "Slicing was not successful. For large projects (> 1 million lines of code), try running atom cli externally in Java mode. Please refer to the instructions in https://github.com/cdxgen/cdxgen/blob/master/ADVANCED.md.",
    );
  }
  // Clean up
  if (tempDir?.startsWith(tmpdir())) {
    safeRmSync(tempDir, { recursive: true, force: true });
  }
  return retList;
}

/**
 * Create uv.lock file with uv sync command.
 *
 * @param {string} basePath Path
 * @param {Object} options CLI options
 */
export function createUVLock(basePath, options) {
  const python_cmd = get_python_command_from_env(process.env);
  let uvSyncArgs = ["-m", "uv", "sync"];
  // Do not update the lock file in pre-build mode
  if (options?.lifecycle?.includes("pre-build")) {
    uvSyncArgs.push("--frozen");
  } else if (options?.recurse) {
    uvSyncArgs = uvSyncArgs.concat(["--all-groups", "--all-packages"]);
  }
  // Install everything and do not remove anything extraneous
  if (options?.deep) {
    uvSyncArgs = uvSyncArgs.concat(["--all-extras", "--inexact"]);
  }
  if (process?.env?.UV_INSTALL_ARGS) {
    const addArgs = process.env.UV_INSTALL_ARGS.split(" ");
    uvSyncArgs = uvSyncArgs.concat(addArgs);
  }
  if (DEBUG_MODE) {
    console.log(
      `Executing ${python_cmd} ${uvSyncArgs.join(" ")} in ${basePath}`,
    );
  }
  let result = safeSpawnSync(python_cmd, uvSyncArgs, {
    shell: isWin,
    cwd: basePath,
  });
  if (result.status !== 0 || result.error) {
    if (result?.stderr?.includes("No module named uv")) {
      if (DEBUG_MODE) {
        console.log(`Executing uv sync in ${basePath}`);
      }
      result = safeSpawnSync("uv", ["sync"], {
        shell: isWin,
        cwd: basePath,
      });
      if (result.status !== 0 || result.error) {
        console.log("Check if uv is installed and available in PATH.");
        if (process.env?.CDXGEN_IN_CONTAINER !== "true") {
          console.log(
            "Use the cdxgen container image which comes with uv installed.",
          );
        }
        console.log(result.stderr);
      }
    } else {
      console.log(result.stderr);
    }
  }
}

/**
 * Execute pip freeze by creating a virtual env in a temp directory and construct the dependency tree
 *
 * @param {string} basePath Base path
 * @param {string} reqOrSetupFile Requirements or setup.py file
 * @param {string} tempVenvDir Temp venv dir
 * @param {Object} parentComponent Parent component
 *
 * @returns {Object} List of packages from the virtual env
 */
export async function getPipFrozenTree(
  basePath,
  reqOrSetupFile,
  tempVenvDir,
  parentComponent,
  projectRoot,
  getTreeWithPluginFn,
) {
  const pkgList = [];
  const formulationList = [];
  const rootList = [];
  const dependenciesList = [];
  let result;
  let frozen = true;
  const env = {
    ...process.env,
  };
  if (!env.CFLAGS) {
    env.CFLAGS = "-fcommon";
  } else if (!env.CFLAGS.includes("-fcommon")) {
    env.CFLAGS = `${env.CFLAGS} -fcommon`;
  }

  const explicitDeps = new Set();
  if (reqOrSetupFile?.endsWith(".txt") && safeExistsSync(reqOrSetupFile)) {
    // We only need the package names, so we pass `false` to avoid fetching full metadata.
    const tempPkgList = await parseReqFile(reqOrSetupFile, null, false);
    for (const pkg of tempPkgList) {
      if (pkg.name) {
        explicitDeps.add(pkg.name.replace(/_/g, "-").toLowerCase());
      }
    }
  }

  /**
   * Let's start with an attempt to create a new temporary virtual environment in case we aren't in one
   *
   * By checking the environment variable "VIRTUAL_ENV" we decide whether to create an env or not
   */
  if (
    !process.env.VIRTUAL_ENV &&
    !process.env.CONDA_PREFIX &&
    reqOrSetupFile &&
    !reqOrSetupFile.endsWith("poetry.lock")
  ) {
    thoughtLog(
      "Let me create a new virtual environment for installing the packages with pip.",
    );
    const venvCreationArgs = ["-m", "venv", tempVenvDir];
    if (isSecureMode) {
      venvCreationArgs.unshift("-S");
    }
    result = safeSpawnSync(PYTHON_CMD, venvCreationArgs, {
      shell: isWin,
    });
    if (result.status !== 0 || result.error) {
      frozen = false;
      if (DEBUG_MODE) {
        console.log("Virtual env creation has failed");
        if (result.stderr?.includes("safeSpawnSync python ENOENT")) {
          console.log(
            "Install suitable version of python or set the environment variable PYTHON_CMD.",
          );
        }
      }
    } else {
      if (DEBUG_MODE) {
        console.log("Using the virtual environment", tempVenvDir);
      }
      env.VIRTUAL_ENV = tempVenvDir;
      env.PATH = `${join(
        tempVenvDir,
        platform() === "win32" ? "Scripts" : "bin",
      )}${_delimiter}${process.env.PATH || ""}`;
      // When cdxgen is invoked with the container image, we seem to be including unnecessary packages from the image.
      // This workaround, unsets PYTHONPATH to suppress the pre-installed packages
      if (
        env?.PYTHONPATH === "/opt/pypi" &&
        env?.CDXGEN_IN_CONTAINER === "true"
      ) {
        env.PYTHONPATH = undefined;
      }
    }
  }
  const venvMeta = getVenvMetadata(env);
  const python_cmd_for_tree = get_python_command_from_env(env);
  // Check if pyproject.toml is actually a uv-configured workspace
  let hasToolUv = false;
  let hasToolPoetry = false;
  if (
    reqOrSetupFile?.endsWith("pyproject.toml") &&
    safeExistsSync(reqOrSetupFile)
  ) {
    try {
      const content = readFileSync(reqOrSetupFile, "utf-8");
      hasToolUv = content.includes("[tool.uv]");
      hasToolPoetry = content.includes('build-backend = "poetry.core');
    } catch (_err) {
      // Ignore read error
    }
  }
  if (reqOrSetupFile) {
    // We have a poetry.lock file
    if (reqOrSetupFile.endsWith("poetry.lock") || hasToolPoetry) {
      const poetryConfigArgs = [
        "-m",
        "poetry",
        "config",
        "virtualenvs.options.no-setuptools",
        "true",
        "--local",
      ];
      if (isSecureMode) {
        poetryConfigArgs.unshift("-S");
      }
      result = safeSpawnSync(PYTHON_CMD, poetryConfigArgs, {
        cwd: basePath,
        shell: isWin,
      });
      thoughtLog("Performing poetry install");
      let poetryInstallArgs = ["-m", "poetry", "install", "-n", "--no-root"];
      if (isSecureMode) {
        poetryInstallArgs.unshift("-S");
      }
      // Attempt to perform poetry install
      result = safeSpawnSync(PYTHON_CMD, poetryInstallArgs, {
        cwd: basePath,
        shell: isWin,
      });
      if (result.status !== 0 || result.error) {
        if (result.stderr?.includes("No module named poetry")) {
          thoughtLog(
            "Hmm, poetry doesn't seem to be available as a module. Perhaps it was installed directly 🤔?",
          );
          poetryInstallArgs = ["install", "-n", "--no-root"];
          // Attempt to perform poetry install
          result = safeSpawnSync("poetry", poetryInstallArgs, {
            cwd: basePath,
            shell: isWin,
            env,
          });
          if (result.status !== 0 || result.error) {
            frozen = false;
            if (DEBUG_MODE && result.stderr) {
              console.log(result.stderr);
            }
            thoughtLog(
              "poetry install has failed. Let me suggest some troubleshooting ideas.",
            );
            console.log("poetry install has failed.");
            console.log(
              "1. Install the poetry command using python -m pip install poetry.",
            );
            console.log(
              "2. Check the version of python supported by the project. Poetry is strict about the version used.",
            );
            console.log(
              "3. Setup and activate the poetry virtual environment and re-run cdxgen.",
            );
          }
        } else {
          frozen = false;
          console.log(
            "Poetry install has failed. Setup and activate the poetry virtual environment and re-run cdxgen.",
          );
          if (DEBUG_MODE) {
            if (result.error) {
              console.log(result.error);
            }
            if (result.stderr) {
              console.log(result.stderr);
            }
          }
        }
      } else {
        const poetryEnvArgs = ["env info", "--path"];
        result = safeSpawnSync("poetry", poetryEnvArgs, {
          cwd: basePath,
          shell: isWin,
          env,
        });
        tempVenvDir = result.stdout?.replaceAll(/[\r\n]+/g, "");
        if (tempVenvDir?.length) {
          env.VIRTUAL_ENV = tempVenvDir;
          env.PATH = `${join(
            tempVenvDir,
            platform() === "win32" ? "Scripts" : "bin",
          )}${_delimiter}${process.env.PATH || ""}`;
        }
      }
    } else if (reqOrSetupFile.endsWith("pdm.lock") || venvMeta.type === "pdm") {
      thoughtLog("Performing pdm install");
      result = safeSpawnSync("pdm", ["install"], {
        cwd: basePath,
        shell: isWin,
        env,
      });
      if (result.status !== 0 || result.error) {
        frozen = false;
      }
    } else if (
      reqOrSetupFile.endsWith("pixi.lock") ||
      venvMeta.type === "pixi"
    ) {
      thoughtLog("Performing pixi install");
      result = safeSpawnSync("pixi", ["install"], {
        cwd: basePath,
        shell: isWin,
        env,
      });
      if (result.status !== 0 || result.error) {
        frozen = false;
      }
    } else if (
      reqOrSetupFile.endsWith("uv.lock") ||
      (venvMeta.type === "uv" && hasToolUv)
    ) {
      thoughtLog("Performing uv sync");
      result = safeSpawnSync("uv", ["sync"], {
        cwd: basePath,
        shell: isWin,
        env,
      });
      if (result.status !== 0 || result.error) {
        frozen = false;
      }
    } else if (
      venvMeta.type === "rye" ||
      reqOrSetupFile.endsWith("requirements.lock")
    ) {
      thoughtLog("Performing rye sync");
      result = safeSpawnSync("rye", ["sync"], {
        cwd: basePath,
        shell: isWin,
        env,
      });
      if (result.status !== 0 || result.error) {
        frozen = false;
      }
    } else {
      // General package installation (Handling pip, or uv pip)
      let installCmd = python_cmd_for_tree;
      let pipInstallArgs = [];
      if (venvMeta.type === "uv") {
        installCmd = "uv";
        pipInstallArgs = ["pip", "install"];
        if (isSecureMode) {
          pipInstallArgs.push("--only-binary");
          pipInstallArgs.push(":all:");
        }
      } else {
        pipInstallArgs = [
          "-m",
          "pip",
          "install",
          "--disable-pip-version-check",
        ];
        if (isSecureMode) {
          pipInstallArgs.push("--only-binary=:all:");
          pipInstallArgs.unshift("-S");
        }
      }
      if (
        !reqOrSetupFile.endsWith("setup.py") &&
        !reqOrSetupFile.endsWith("pyproject.toml")
      ) {
        pipInstallArgs.push("-r");
        pipInstallArgs.push(resolve(reqOrSetupFile));
        if (reqOrSetupFile.includes("test")) {
          thoughtLog(
            `${reqOrSetupFile} appears to be related to tests. Should I suggest the "--exclude" argument?`,
          );
        }
      } else {
        pipInstallArgs.push(resolve(basePath));
      }
      if (process?.env?.PIP_INSTALL_ARGS) {
        const addArgs = process.env.PIP_INSTALL_ARGS.split(" ");
        pipInstallArgs = pipInstallArgs.concat(addArgs);
      }
      thoughtLog(
        `**INSTALL**: Trying package install using the arguments: ${installCmd} ${pipInstallArgs.join(" ")}`,
      );
      if (DEBUG_MODE) {
        console.log("Executing", installCmd);
      }
      result = safeSpawnSync(installCmd, pipInstallArgs, {
        cwd: projectRoot || basePath,
        shell: isWin,
        env,
      });
      if (result.status !== 0 || result.error) {
        frozen = false;
        let versionRelatedError = false;
        if (
          result.stderr?.includes(
            "Could not find a version that satisfies the requirement",
          ) ||
          result.stderr?.includes("No matching distribution found for")
        ) {
          versionRelatedError = true;
          if (process.env.PIP_INSTALL_ARGS) {
            console.log(
              "1. Try invoking cdxgen with a different python type. Example: `-t python`, `-t python310`, or `-t python39`\n",
            );
          } else {
            console.log(
              "The version or the version specifiers used for a dependency is invalid. Try with a different python type such as -t python310 or -t python39.\nOriginal error from pip:\n",
            );
          }
          console.log(result.stderr);
        } else if (result?.stderr?.includes("No module named pip")) {
          console.log(
            "Using uv? Ensure 'uv' is in your PATH to allow cdxgen to use `uv pip install` automatically.",
          );
        } else if (
          process.env.PIP_INSTALL_ARGS &&
          result.stderr?.includes("Cannot set --home and --prefix together")
        ) {
          versionRelatedError = true;
          thoughtLog(`Got the error: ${result.stderr.split("\n").slice(0, 5)}`);
          if (DEBUG_MODE) {
            console.log(result.stderr);
          } else {
            console.log(
              "Possible build errors detected with 'pip install'. Set the environment variable CDXGEN_DEBUG_MODE=debug to troubleshoot.",
            );
            if (result?.stderr?.includes("No module named pip")) {
              console.log(
                "Using uv? Run uv pip install command prior to running cdxgen.",
              );
            } else {
              console.log(result.stderr.split("\n").slice(0, 5));
            }
          }
          console.warn(
            "This project does not support python with version types. Use an appropriate container image such as `ghcr.io/appthreat/cdxgen-python39:v13` or `ghcr.io/appthreat/cdxgen-python311:v13` and invoke cdxgen with `-t python` instead.\n",
          );
        } else if (
          result?.stderr?.includes(
            "pip subprocess to install build dependencies",
          )
        ) {
          console.log(
            "Installing build dependencies has failed. Use an appropriate container image such as `ghcr.io/appthreat/cdxgen-python39:v13` or `ghcr.io/appthreat/cdxgen-python311:v13` and invoke cdxgen with `-t python` instead.",
          );
          if (
            result?.stderr?.includes(
              "Failed to build installable wheels for some pyproject.toml based projects",
            )
          ) {
            console.log(
              "Try upgrading setuptools with `python -m pip install setuptools --upgrade`",
            );
          }
          if (process.env?.CDXGEN_IN_CONTAINER !== "true") {
            thoughtLog(
              "Installation of build dependencies failed. I told you we must use container images for python.",
            );
          } else {
            thoughtLog(
              "Installation of build dependencies failed. Perhaps the user is using the wrong container image?",
            );
          }
        }
        if (!versionRelatedError) {
          if (DEBUG_MODE) {
            console.info(
              "\nEXPERIMENTAL: Invoke cdxgen with '--feature-flags safe-pip-install' to recover a partial dependency tree for projects with build errors.\n",
            );
            if (result.stderr) {
              console.log(result.stderr);
            }
            console.log(
              "Possible build errors detected. The resulting list in the SBOM would therefore be incomplete.\nTry installing any missing build tools or development libraries to improve the accuracy.",
            );
            thoughtLog(
              "Possible build errors detected. We have an incomplete list of pypi components and dependencies.",
            );
            if (platform() === "win32") {
              console.log(
                "- Install the appropriate compilers and build tools on Windows by following this documentation - https://wiki.python.org/moin/WindowsCompilers",
              );
            } else {
              console.log(
                "- For example, you may have to install gcc, gcc-c++ compiler, postgresql or mysql devel packages and additional development libraries using apt-get or yum package manager.",
              );
            }
            console.log(
              "- Certain projects would only build with specific versions of Python. Data science and ML related projects might require a conda/anaconda distribution.",
            );
            console.log(
              "- Check if any git submodules have to be initialized.\n- If the application has its own Dockerfile, look for any clues for build dependencies.",
            );
            if (
              process.env?.CDXGEN_IN_CONTAINER !== "true" &&
              !process.env.PIP_INSTALL_ARGS
            ) {
              console.log(
                "1. Try invoking cdxgen with a specific python version type. Example: `-t python36` or `-t python39`",
              );
              console.log(
                "2. Alternatively, try using the custom container images `ghcr.io/cyclonedx/cdxgen-python39:v13` or `ghcr.io/cyclonedx/cdxgen-python311:v13`, which bundles a range of build tools and development libraries.",
              );
            } else if (
              process.env?.PIP_INSTALL_ARGS?.includes("--python-version")
            ) {
              console.log(
                "1. Try invoking cdxgen with a different python version type. Example: `-t python`, `-t python39`, or `-t python311`",
              );
              console.log(
                "2. Try with the experimental flag '--feature-flags safe-pip-install'",
              );
            }
          } else {
            if (process.env?.CDXGEN_IN_CONTAINER !== "true") {
              thoughtLog(
                "**PIP**: Installation of build dependencies failed. If in doubt, use the cdxgen container images for python.",
              );
            } else {
              thoughtLog(
                "Installation of build dependencies failed. Perhaps the user is using the wrong cdxgen container image? Should I recommend raising a GitHub issue?",
              );
            }
            // Bug #1640. result.stderr is null here despite the process erroring with a non-zero value.
            // How do we reproduce this with repo tests?
            if (result?.stderr) {
              if (result?.stderr?.includes("No module named pip")) {
                console.log(
                  "Using uv? Run uv pip install command prior to running cdxgen.",
                );
              } else {
                console.log(
                  "Possible build errors detected. Set the environment variable CDXGEN_DEBUG_MODE=debug to troubleshoot.",
                );
                console.log(result.stderr?.split("\n")?.slice(0, 5));
              }
            }
          }
        }
      }
    }
  }
  // Bug #375. Attempt pip freeze on existing and new virtual environments
  if (env.VIRTUAL_ENV?.length || env.CONDA_PREFIX?.length) {
    const venvRoot = env.VIRTUAL_ENV || env.CONDA_PREFIX;
    const binDir = platform() === "win32" ? "Scripts" : "bin";
    const pipExe = join(
      venvRoot,
      binDir,
      platform() === "win32" ? "pip.exe" : "pip",
    );
    if (!safeExistsSync(pipExe)) {
      thoughtLog(
        "The 'pip' module is missing in this environment. Bootstrapping it to support piptree extraction.",
      );
      if (venvMeta.type === "uv") {
        safeSpawnSync("uv", ["pip", "install", "pip"], {
          cwd: basePath,
          shell: isWin,
          env,
        });
      } else if (venvMeta.type === "rye") {
        safeSpawnSync("rye", ["run", "pip", "install", "pip"], {
          cwd: basePath,
          shell: isWin,
          env,
        });
      } else {
        safeSpawnSync(python_cmd_for_tree, ["-m", "ensurepip", "--upgrade"], {
          cwd: basePath,
          shell: isWin,
          env,
        });
      }
    }
    if (DEBUG_MODE && reqOrSetupFile) {
      console.log(
        `About to construct the dependency tree based on ${reqOrSetupFile}. Please wait ...`,
      );
    }
    // This is a slow step that ideally needs to be invoked only once per venv
    const tree = getTreeWithPluginFn(env, python_cmd_for_tree, basePath);
    if (DEBUG_MODE && !tree.length) {
      console.log(
        "Dependency tree generation has failed. Please check for any errors or version incompatibilities reported in the logs.",
      );
    }
    const dependenciesMap = {};
    for (const t of tree) {
      const name = t.name.replace(/_/g, "-").toLowerCase();
      // Bug #1232 - the root package might lack a version resulting in duplicate tree
      // So we make use of the existing parent component to try and patch the version
      if (
        parentComponent &&
        parentComponent.name === t.name &&
        parentComponent.version &&
        parentComponent?.version !== "latest" &&
        t.version === "latest"
      ) {
        t.version = parentComponent.version;
      }
      const version = t.version;
      const scope = PYTHON_EXCLUDED_COMPONENTS.includes(name)
        ? "excluded"
        : undefined;
      if (!scope && !t.version.length) {
        // Don't leave out any local dependencies
        if (t.dependencies.length) {
          flattenDeps(dependenciesMap, pkgList, reqOrSetupFile, t);
        }
        continue;
      }
      const purlString = build({
        type: "pypi",
        namespace: "" || null,
        name: name,
        version: version || null,
      });
      const apkg = {
        name,
        version,
        purl: purlString,
        type: "library",
        "bom-ref": decodeURIComponent(purlString),
        scope,
        evidence: {
          identity: {
            field: "purl",
            confidence: 1,
            methods: [
              {
                technique: "instrumentation",
                confidence: 1,
                value: env.VIRTUAL_ENV || env.CONDA_PREFIX,
              },
            ],
          },
        },
        properties: [
          {
            name: "SrcFile",
            value: reqOrSetupFile,
          },
        ],
      };
      if (scope !== "excluded") {
        pkgList.push(apkg);
        if (explicitDeps.size === 0 || explicitDeps.has(name)) {
          rootList.push({
            name,
            version,
            purl: purlString,
            "bom-ref": decodeURIComponent(purlString),
          });
        }
        flattenDeps(dependenciesMap, pkgList, reqOrSetupFile, t);
      } else {
        formulationList.push(apkg);
      }
    } // end for
    for (const k of Object.keys(dependenciesMap)) {
      dependenciesList.push({
        ref: k,
        dependsOn: [...new Set(dependenciesMap[k])].sort(),
      });
    }
  }
  return {
    pkgList,
    formulationList,
    rootList,
    dependenciesList,
    frozen,
  };
}

/**
 * The problem: pip installation can fail for a number of reasons such as missing OS dependencies and devel packages.
 * When it fails, we don't get any dependency tree. As a workaroud, this method would attempt to install one package at a time to the same virtual environment and then attempts to obtain a dependency tree.
 * Such a tree could be incorrect or quite approximate, but some users might still find it useful to know the names of the indirect dependencies.
 *
 * @param {string} basePath Base path
 * @param {Array} pkgList Existing package list
 * @param {string} tempVenvDir Temp venv dir
 * @param {Object} parentComponent Parent component
 *
 * @returns List of packages from the virtual env
 */
export function getPipTreeForPackages(
  basePath,
  pkgList,
  tempVenvDir,
  parentComponent,
  getTreeWithPluginFn,
) {
  const failedPkgList = [];
  const rootList = [];
  const dependenciesList = [];
  let result;
  const env = {
    ...process.env,
  };
  if (!env.CFLAGS) {
    env.CFLAGS = "-fcommon";
  } else if (!env.CFLAGS.includes("-fcommon")) {
    env.CFLAGS = `${env.CFLAGS} -fcommon`;
  }
  if (!process.env.VIRTUAL_ENV && !process.env.CONDA_PREFIX) {
    // Create a virtual environment
    const venvCreationArgs = ["-m", "venv", tempVenvDir];
    if (isSecureMode) {
      venvCreationArgs.unshift("-S");
    }
    result = safeSpawnSync(PYTHON_CMD, venvCreationArgs, {
      shell: isWin,
    });
    if (result.status !== 0 || result.error) {
      console.log("Virtual env creation has failed. Unable to continue.");
      return {};
    }
    env.VIRTUAL_ENV = tempVenvDir;
    env.PATH = `${join(
      tempVenvDir,
      platform() === "win32" ? "Scripts" : "bin",
    )}${_delimiter}${process.env.PATH || ""}`;
    // When cdxgen is invoked with the container image, we seem to be including unnecessary packages from the image.
    // This workaround, unsets PYTHONPATH to suppress the pre-installed packages
    if (
      env?.PYTHONPATH === "/opt/pypi" &&
      env?.CDXGEN_IN_CONTAINER === "true"
    ) {
      env.PYTHONPATH = undefined;
    }
  }
  const venvMeta = getVenvMetadata(env);
  const python_cmd_for_tree = get_python_command_from_env(env);
  let installCmd = python_cmd_for_tree;
  let pipInstallArgs = [];
  if (venvMeta.type === "uv") {
    installCmd = "uv";
    pipInstallArgs = ["pip", "install"];
    if (isSecureMode) {
      pipInstallArgs.push("--only-binary");
      pipInstallArgs.push(":all:");
    }
  } else {
    pipInstallArgs = ["-m", "pip", "install", "--disable-pip-version-check"];
    if (isSecureMode) {
      pipInstallArgs.push("--only-binary=:all:");
      pipInstallArgs.unshift("-S");
    }
  }
  // Support for passing additional arguments to pip
  // Eg: --python-version 3.10 --ignore-requires-python --no-warn-conflicts
  if (process?.env?.PIP_INSTALL_ARGS) {
    const addArgs = process.env.PIP_INSTALL_ARGS.split(" ");
    pipInstallArgs = pipInstallArgs.concat(addArgs);
  } else {
    if (venvMeta.type !== "uv") {
      pipInstallArgs = pipInstallArgs.concat([
        "--ignore-requires-python",
        "--no-compile",
        "--no-warn-script-location",
        "--no-warn-conflicts",
      ]);
    } else {
      pipInstallArgs.push("--no-compile");
    }
  }
  if (DEBUG_MODE) {
    console.log(
      "Installing",
      pkgList.length,
      "packages using the command",
      installCmd,
      pipInstallArgs.join(" "),
    );
  }
  for (const apkg of pkgList) {
    let pkgSpecifier = apkg.name;
    if (apkg.version && apkg.version !== "latest") {
      pkgSpecifier = `${apkg.name}==${apkg.version}`;
    } else if (apkg.properties) {
      let versionSpecifierFound = false;
      for (const aprop of apkg.properties) {
        if (aprop.name === "cdx:pypi:versionSpecifiers") {
          pkgSpecifier = `${apkg.name}${aprop.value}`;
          versionSpecifierFound = true;
          break;
        }
      }
      if (!versionSpecifierFound) {
        failedPkgList.push(apkg);
        continue;
      }
    } else {
      failedPkgList.push(apkg);
      continue;
    }
    if (DEBUG_MODE) {
      console.log("Installing", pkgSpecifier);
    }
    const result = safeSpawnSync(
      installCmd,
      [...pipInstallArgs, pkgSpecifier],
      {
        cwd: basePath,
        shell: isWin,
        env,
      },
    );
    if (result.status !== 0 || result.error) {
      failedPkgList.push(apkg);
      if (DEBUG_MODE) {
        console.log(apkg.name, "failed to install.");
      }
    }
  }
  // Did any package get installed successfully?
  if (failedPkgList.length < pkgList.length) {
    const venvRoot = env.VIRTUAL_ENV || env.CONDA_PREFIX;
    if (venvRoot) {
      const binDir = platform() === "win32" ? "Scripts" : "bin";
      const pipExe = join(
        venvRoot,
        binDir,
        platform() === "win32" ? "pip.exe" : "pip",
      );
      if (!safeExistsSync(pipExe)) {
        if (venvMeta.type === "uv") {
          safeSpawnSync("uv", ["pip", "install", "pip"], {
            cwd: basePath,
            shell: isWin,
            env,
          });
        } else {
          safeSpawnSync(python_cmd_for_tree, ["-m", "ensurepip", "--upgrade"], {
            cwd: basePath,
            shell: isWin,
            env,
          });
        }
      }
    }
    const dependenciesMap = {};
    const tree = getTreeWithPluginFn(env, python_cmd_for_tree, basePath);
    for (const t of tree) {
      const name = t.name.replace(/_/g, "-").toLowerCase();
      // We can ignore excluded components such as build tools
      if (PYTHON_EXCLUDED_COMPONENTS.includes(name)) {
        continue;
      }
      if (parentComponent && parentComponent.name === t.name) {
        t.version = parentComponent.version;
      } else if (t.version && t.version === "latest") {
        continue;
      }
      const version = t.version;
      const purlString = build({
        type: "pypi",
        namespace: "" || null,
        name: name,
        version: version || null,
      });
      const apkg = {
        name,
        version,
        purl: purlString,
        type: "library",
        "bom-ref": decodeURIComponent(purlString),
        evidence: {
          identity: {
            field: "purl",
            confidence: 0.5,
            methods: [
              {
                technique: "instrumentation",
                confidence: 0.5,
                value: env.VIRTUAL_ENV,
              },
            ],
          },
        },
      };
      // These packages have lower confidence
      pkgList.push(apkg);
      rootList.push({
        name,
        version,
        purl: purlString,
        "bom-ref": decodeURIComponent(purlString),
      });
      flattenDeps(dependenciesMap, pkgList, undefined, t);
    } // end for
    for (const k of Object.keys(dependenciesMap)) {
      dependenciesList.push({
        ref: k,
        dependsOn: [...new Set(dependenciesMap[k])].sort(),
      });
    }
  } // end if
  return {
    failedPkgList,
    rootList,
    dependenciesList,
  };
}
