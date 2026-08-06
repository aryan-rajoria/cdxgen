import { join } from "node:path";
import process from "node:process";

import { buildReadCountSuffix, recordObservedActivity } from "./activity.js";
import { safeExistsSync } from "./fs.js";
import { thoughtLog } from "./logger.js";

export const isNode = globalThis.process?.versions?.node !== undefined;
export const isBun = globalThis.Bun?.version !== undefined;
export const isDeno = globalThis.Deno?.version?.deno !== undefined;

export const CDXGEN_SPDX_CREATED_BY = process.env.CDXGEN_SPDX_CREATED_BY;

// Table border style for console output.
export const TABLE_BORDER_STYLE = ["ascii", "unicode", "auto"].includes(
  `${process.env.CDXGEN_TABLE_BORDER || ""}`.toLowerCase(),
)
  ? `${process.env.CDXGEN_TABLE_BORDER}`.toLowerCase()
  : "auto";

// Whether test scope shall be included for java/maven projects; default, if unset shall be 'true'
export const includeMavenTestScope =
  !process.env.CDX_MAVEN_INCLUDE_TEST_SCOPE ||
  ["true", "1"].includes(process.env.CDX_MAVEN_INCLUDE_TEST_SCOPE);

// Whether to use the native maven dependency tree command. Defaults to true.
export const PREFER_MAVEN_DEPS_TREE = !["false", "0"].includes(
  process.env?.PREFER_MAVEN_DEPS_TREE,
);

export function parseMavenArgs(argsString) {
  if (!argsString) {
    return [];
  }
  const args = [];
  let currentArg = "";
  let quoteChar = "";
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    if (char === "\\") {
      const nextChar = argsString[i + 1];
      if (
        nextChar &&
        (/\s/.test(nextChar) || nextChar === '"' || nextChar === "'")
      ) {
        currentArg += nextChar;
        i++;
      } else {
        currentArg += char;
      }
      continue;
    }
    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = "";
      } else {
        currentArg += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = "";
      }
      continue;
    }
    currentArg += char;
  }
  if (currentArg) {
    args.push(currentArg);
  }
  return args;
}

/**
 * Determines whether license information should be fetched from remote sources,
 * based on the FETCH_LICENSE environment variable.
 *
 * @returns {boolean} True if the FETCH_LICENSE env var is set to "true" or "1"
 */
export function shouldFetchLicense() {
  return (
    process.env.FETCH_LICENSE &&
    ["true", "1"].includes(process.env.FETCH_LICENSE)
  );
}

/**
 * Determines whether remote package metadata should be fetched for enrichment.
 *
 * @returns {boolean} True when registry metadata enrichment is enabled.
 */
export function shouldFetchPackageMetadata() {
  return (
    shouldFetchLicense() ||
    (process.env.CDXGEN_FETCH_PKG_METADATA &&
      ["true", "1"].includes(process.env.CDXGEN_FETCH_PKG_METADATA))
  );
}

/**
 * Determines whether VCS (version control system) information should be fetched
 * for Go packages, based on the GO_FETCH_VCS environment variable.
 *
 * @returns {boolean} True if the GO_FETCH_VCS env var is set to "true" or "1"
 */
export function shouldFetchVCS() {
  return (
    process.env.GO_FETCH_VCS && ["true", "1"].includes(process.env.GO_FETCH_VCS)
  );
}

// Whether license information should be fetched
export const FETCH_LICENSE = shouldFetchLicense();

// Whether search.maven.org will be used to identify jars without maven metadata; default, if unset shall be 'true'
export const SEARCH_MAVEN_ORG =
  !process.env.SEARCH_MAVEN_ORG ||
  ["true", "1"].includes(process.env.SEARCH_MAVEN_ORG);

export const JAVA_CMD = getJavaCommand();

/**
 * Returns the Java executable command to use, resolved in priority order:
 * JAVA_CMD env var > JAVA_HOME/bin/java > "java".
 *
 * @returns {string} Path or name of the Java executable
 */
export function getJavaCommand() {
  let javaCmd = "java";
  if (process.env.JAVA_CMD) {
    javaCmd = process.env.JAVA_CMD;
  } else if (
    process.env.JAVA_HOME &&
    safeExistsSync(process.env.JAVA_HOME) &&
    safeExistsSync(join(process.env.JAVA_HOME, "bin", "java"))
  ) {
    javaCmd = join(process.env.JAVA_HOME, "bin", "java");
  }
  return javaCmd;
}

export const PYTHON_CMD = getPythonCommand();

/**
 * Returns the Python executable command to use, resolved in priority order:
 * PYTHON_CMD env var > CONDA_PYTHON_EXE env var > "python".
 *
 * @returns {string} Path or name of the Python executable
 */
export function getPythonCommand() {
  let pythonCmd = "python";
  if (process.env.PYTHON_CMD) {
    pythonCmd = process.env.PYTHON_CMD;
  } else if (process.env.CONDA_PYTHON_EXE) {
    pythonCmd = process.env.CONDA_PYTHON_EXE;
  }
  return pythonCmd;
}

export let DOTNET_CMD = "dotnet";
if (process.env.DOTNET_CMD) {
  DOTNET_CMD = process.env.DOTNET_CMD;
}
export let NODE_CMD = "node";
if (process.env.NODE_CMD) {
  NODE_CMD = process.env.NODE_CMD;
}
export let NPM_CMD = "npm";
if (process.env.NPM_CMD) {
  NPM_CMD = process.env.NPM_CMD;
}
export let YARN_CMD = "yarn";
if (process.env.YARN_CMD) {
  YARN_CMD = process.env.YARN_CMD;
}
export let GCC_CMD = "gcc";
if (process.env.GCC_CMD) {
  GCC_CMD = process.env.GCC_CMD;
}
export let RUSTC_CMD = "rustc";
if (process.env.RUSTC_CMD) {
  RUSTC_CMD = process.env.RUSTC_CMD;
}
export let GO_CMD = "go";
if (process.env.GO_CMD) {
  GO_CMD = process.env.GO_CMD;
}
export let CARGO_CMD = "cargo";
if (process.env.CARGO_CMD) {
  CARGO_CMD = process.env.CARGO_CMD;
}

// Clojure CLI
export let CLJ_CMD = "clj";
if (process.env.CLJ_CMD) {
  CLJ_CMD = process.env.CLJ_CMD;
}

export let LEIN_CMD = "lein";
if (process.env.LEIN_CMD) {
  LEIN_CMD = process.env.LEIN_CMD;
}

export let CDXGEN_TEMP_DIR = "temp";
if (process.env.CDXGEN_TEMP_DIR) {
  CDXGEN_TEMP_DIR = process.env.CDXGEN_TEMP_DIR;
}

export const SWIFT_CMD = process.env.SWIFT_CMD || "swift";

export const RUBY_CMD = process.env.RUBY_CMD || "ruby";

// Python components that can be excluded
export const PYTHON_EXCLUDED_COMPONENTS = [
  "pip",
  "setuptools",
  "wheel",
  "conda",
  "conda-build",
  "conda-index",
  "conda-libmamba-solver",
  "conda-package-handling",
  "conda-package-streaming",
  "conda-content-trust",
];

// Project type aliases
export const PROJECT_TYPE_ALIASES = {
  java: [
    "java",
    "java8",
    "java11",
    "java17",
    "java21",
    "java22",
    "java23",
    "java24",
    "java25",
    "java26",
    "groovy",
    "kotlin",
    "kt",
    "scala",
    "jvm",
    "gradle",
    "mvn",
    "maven",
    "sbt",
    "bazel",
    "quarkus",
    "mill",
  ],
  android: ["android", "apk", "aab"],
  jar: ["jar", "war", "ear"],
  "gradle-index": ["gradle-index", "gradle-cache"],
  "sbt-index": ["sbt-index", "sbt-cache"],
  "maven-index": ["maven-index", "maven-cache", "maven-core"],
  "cargo-cache": ["cargo-cache", "cargo-index"],
  js: [
    "npm",
    "pnpm",
    "nodejs",
    "nodejs8",
    "nodejs10",
    "nodejs12",
    "nodejs14",
    "nodejs16",
    "nodejs18",
    "nodejs20",
    "nodejs22",
    "nodejs23",
    "node",
    "node8",
    "node10",
    "node12",
    "node14",
    "node16",
    "node18",
    "node20",
    "node22",
    "node23",
    "js",
    "javascript",
    "typescript",
    "ts",
    "tsx",
    "yarn",
    "rush",
    "bun",
    "deno",
  ],
  mcp: ["mcp"],
  "ai-skill": ["ai-skill", "skill", "skills"],
  py: [
    "py",
    "python",
    "pypi",
    "python36",
    "python38",
    "python39",
    "python310",
    "python311",
    "python312",
    "python313",
    "pixi",
    "pip",
    "poetry",
    "uv",
    "pdm",
    "rye",
    "hatch",
    "conda",
    "miniconda",
    "pyenv",
    "mojo",
  ],
  go: ["go", "golang", "gomod", "gopkg"],
  rust: ["rust", "rust-lang", "cargo", "rs"],
  php: ["php", "composer", "wordpress"],
  ruby: ["ruby", "gems", "rubygems", "bundler", "rb", "gemspec"],
  csharp: [
    "csharp",
    "netcore",
    "netcore2.1",
    "netcore3.1",
    "dotnet",
    "dotnet6",
    "dotnet7",
    "dotnet8",
    "dotnet9",
    "dotnet-framework",
    "dotnet-framework47",
    "dotnet-framework48",
    "vb",
    "vbnet",
    "visualbasic",
    "f#",
    "fs",
    "fsharp",
    "twincat",
    "csproj",
    "tsproj",
    "vbproj",
    "sln",
    "fsproj",
    "plcproj",
    "hmiproj",
  ],
  dart: ["dart", "flutter", "pub"],
  haskell: ["haskell", "hackage", "cabal"],
  elixir: ["elixir", "hex", "mix"],
  c: ["c", "cpp", "c++", "conan", "collider"],
  clojure: ["clojure", "edn", "clj", "leiningen"],
  github: ["github", "actions"],
  hbom: ["hbom", "hardware"],
  os: ["os", "osquery", "windows", "linux", "mac", "macos", "darwin"],
  jenkins: ["jenkins", "hpi"],
  helm: ["helm", "charts"],
  "helm-index": ["helm-index", "helm-repo"],
  universal: [
    "universal",
    "containerfile",
    "docker-compose",
    "dockerfile",
    "swarm",
    "tekton",
    "kustomize",
    "operator",
    "skaffold",
    "kubernetes",
    "openshift",
    "yaml-manifest",
  ],
  cloudbuild: ["cloudbuild"],
  swift: [
    "swift",
    "ios",
    "macos",
    "swiftpm",
    "ipados",
    "tvos",
    "watchos",
    "visionos",
  ],
  binary: ["binary", "blint"],
  oci: ["docker", "oci", "container", "podman", "rootfs", "oci-dir"],
  cocoa: ["cocoa", "cocoapods", "objective-c", "swift", "ios"],
  scala: ["scala", "scala3", "sbt", "mill"],
  nix: ["nix", "nixos", "flake"],
  zig: ["zig", "zon"],
  gleam: ["gleam"],
  caxa: ["caxa"],
  asar: ["asar", "electron", "electron-asar"],
  "vscode-extension": [
    "vscode-extension",
    "vsix",
    "vscode",
    "openvsx",
    "vscode-extensions",
    "ide-extension",
    "ide-extensions",
  ],
  "chrome-extension": [
    "chrome-extension",
    "chrome-extensions",
    "chromium-extension",
    "chromium-extensions",
  ],
  dynamic: ["dynamic", "trace"],
  "ai-provenance": ["ai-provenance", "ai-authorship", "aicode", "ai-codegen"],
};

// Package manager aliases
export const PACKAGE_MANAGER_ALIASES = {
  scala: ["sbt"],
};

/**
 * Method to check if a given feature flag is enabled.
 *
 * @param {Object} cliOptions CLI options
 * @param {String} feature Feature flag
 *
 * @returns {Boolean} True if the feature is enabled
 */
export function isFeatureEnabled(cliOptions, feature) {
  if (cliOptions?.featureFlags?.includes(feature)) {
    return true;
  }
  if (
    process.env[feature.toUpperCase()] &&
    ["true", "1"].includes(process.env[feature.toUpperCase()])
  ) {
    return true;
  }
  // Retry by replacing hyphens with underscore
  return !!(
    process.env[feature.replaceAll("-", "_").toUpperCase()] &&
    ["true", "1"].includes(
      process.env[feature.replaceAll("-", "_").toUpperCase()],
    )
  );
}

/**
 * Method to check if the given project types are allowed by checking against include and exclude types passed from the CLI arguments.
 *
 * @param {Array} projectTypes project types to check
 * @param {Object} options CLI options
 * @param {Boolean} defaultStatus Default return value if there are no types provided
 */
export function hasAnyProjectType(projectTypes, options, defaultStatus = true) {
  // If no project type is specified, then consider it as yes
  if (
    !projectTypes ||
    (!options.projectType?.length && !options.excludeType?.length)
  ) {
    return defaultStatus;
  }
  // Convert string project types to an array
  if (
    projectTypes &&
    (typeof projectTypes === "string" || projectTypes instanceof String)
  ) {
    projectTypes = projectTypes.split(",");
  }
  // If only exclude type is specified, then do not allow oci type
  if (
    (projectTypes?.length === 1 || !defaultStatus) &&
    !options.projectType?.length &&
    options.excludeType?.length
  ) {
    const isExcluded = projectTypes.some((pt) => {
      const ptLower = pt.toLowerCase();
      if (options.excludeType.includes(ptLower)) {
        return true;
      }
      for (const et of options.excludeType) {
        const etLower = et.toLowerCase();
        for (const [key, aliases] of Object.entries(PROJECT_TYPE_ALIASES)) {
          if (
            (key === etLower || aliases.includes(etLower)) &&
            (key === ptLower || aliases.includes(ptLower))
          ) {
            return true;
          }
        }
      }
      return false;
    });
    if (isExcluded) {
      return false;
    }
    return (
      !projectTypes.includes("oci") &&
      !projectTypes.includes("oci-dir") &&
      !projectTypes.includes("os") &&
      !projectTypes.includes("docker") &&
      !options.excludeType.includes("oci")
    );
  }
  const allProjectTypes = [...projectTypes];
  // Convert the project types into base types
  const baseProjectTypes = [];
  // Support for arbitrary versioned ruby type
  if (
    options.projectType?.length &&
    projectTypes.filter((p) => p.startsWith("ruby")).length
  ) {
    baseProjectTypes.push("ruby");
  }
  const baseExcludeTypes = [];
  for (const abt of Object.keys(PROJECT_TYPE_ALIASES)) {
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) =>
        new Set(options?.projectType).has(pt),
      ).length
    ) {
      baseProjectTypes.push(abt);
    }
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) => new Set(projectTypes).has(pt))
        .length
    ) {
      allProjectTypes.push(abt);
    }
    if (
      PROJECT_TYPE_ALIASES[abt].filter((pt) =>
        new Set(options?.excludeType).has(pt),
      ).length
    ) {
      baseExcludeTypes.push(abt);
    }
  }
  const shouldInclude =
    !options.projectType?.length ||
    options.projectType?.includes("universal") ||
    options.projectType?.filter((pt) => new Set(allProjectTypes).has(pt))
      .length > 0 ||
    baseProjectTypes.filter((pt) => new Set(allProjectTypes).has(pt)).length >
      0;
  if (shouldInclude && options.excludeType) {
    return (
      !baseExcludeTypes.filter((pt) => pt && new Set(baseProjectTypes).has(pt))
        .length &&
      !baseExcludeTypes.filter((pt) => pt && new Set(allProjectTypes).has(pt))
        .length
    );
  }
  return shouldInclude;
}

/**
 * Determine whether the predictive dependency audit should run for the current
 * CLI invocation.
 *
 * OBOM-focused runs (`obom` or explicit `-t os` / OS aliases only) should keep
 * the direct BOM audit findings but skip the predictive dependency audit.
 *
 * @param {object} options CLI options
 * @param {string} [commandPath] Invoked command path or name
 * @returns {boolean} True when predictive dependency audit should run
 */
export function shouldRunPredictiveBomAudit(options, commandPath) {
  const normalizedCommandPath = `${commandPath || ""}`.toLowerCase();
  if (normalizedCommandPath.includes("obom")) {
    return false;
  }
  if (normalizedCommandPath.includes("hbom")) {
    return false;
  }
  const projectTypes = Array.isArray(options?.projectType)
    ? options.projectType
    : typeof options?.projectType === "string"
      ? options.projectType.split(",")
      : [];
  const normalizedProjectTypes = projectTypes
    .map((projectType) => `${projectType || ""}`.trim().toLowerCase())
    .filter(Boolean);
  if (!normalizedProjectTypes.length) {
    return true;
  }
  const hbomProjectTypes = new Set(["hbom", "hardware"]);
  if (
    normalizedProjectTypes.every((projectType) =>
      hbomProjectTypes.has(projectType),
    )
  ) {
    return false;
  }
  const osProjectTypes = new Set(["os", ...(PROJECT_TYPE_ALIASES.os || [])]);
  return !normalizedProjectTypes.every((projectType) =>
    osProjectTypes.has(projectType),
  );
}

/**
 * Convenient method to check if the given package manager is allowed.
 *
 * @param {String} name Package manager name
 * @param {Array} conflictingManagers List of package managers
 * @param {Object} options CLI options
 *
 * @returns {Boolean} True if the package manager is allowed
 */
export function isPackageManagerAllowed(name, conflictingManagers, options) {
  for (const apm of conflictingManagers) {
    if (options?.projectType?.includes(apm)) {
      return false;
    }
  }
  const res = !options.excludeType?.filter(
    (p) => p === name || PACKAGE_MANAGER_ALIASES[p]?.includes(name),
  ).length;
  if (res) {
    thoughtLog(
      `**PACKAGE MANAGER**: Let's make use of the package manager '${name}', which is allowed.`,
    );
  }
  return res;
}

/**
 * Function to parse a list of environment variables to identify the paths containing executable binaries
 *
 * @param envValues {Array[String]} Environment variables list
 * @returns {Array[String]} Binary Paths identified from the environment variables
 */
export function extractPathEnv(envValues) {
  if (!envValues) {
    return [];
  }
  let binPaths = new Set();
  const shellVariables = {};
  // Let's focus only on linux container images for now
  for (const env of envValues) {
    if (env.startsWith("PATH=")) {
      binPaths = new Set(env.replace("PATH=", "").split(":"));
    } else {
      const tmpA = env.split("=");
      if (tmpA.length === 2) {
        shellVariables[`$${tmpA[0]}`] = tmpA[1];
        shellVariables[`\${${tmpA[0]}}`] = tmpA[1];
      }
    }
  }
  binPaths = Array.from(binPaths);
  const expandedBinPaths = [];
  for (let apath of binPaths) {
    // Filter empty paths
    if (!apath.length) {
      continue;
    }
    if (apath.includes("$")) {
      for (const k of Object.keys(shellVariables)) {
        apath = apath.replace(k, shellVariables[k]);
      }
    }
    // We're here, but not all paths got substituted
    // Let's ignore them for now instead of risking substitution based on host values.
    // Eg: ${GITHUB_TOKEN} could get expanded with the values from the host
    if (apath.length && !apath.includes("$")) {
      expandedBinPaths.push(apath);
    }
  }
  recordObservedActivity("path-resolution", "PATH", {
    metadata: {
      capability: "path-lookup",
      pathCount: expandedBinPaths.length,
    },
    reasonBuilder: (count) =>
      `Expanded PATH into ${expandedBinPaths.length} executable search path(s)${buildReadCountSuffix(count)}.`,
  });
  return expandedBinPaths;
}
