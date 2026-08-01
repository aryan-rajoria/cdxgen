import { join } from "node:path";
import process from "node:process";

import { safeExistsSync } from "./fs.js";

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
