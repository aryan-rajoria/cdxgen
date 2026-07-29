export declare const isNode: boolean;
export declare const isBun: boolean;
export declare const isDeno: boolean;
export declare const CDXGEN_SPDX_CREATED_BY: any;
export declare const TABLE_BORDER_STYLE: string;
export declare const includeMavenTestScope: boolean;
export declare const PREFER_MAVEN_DEPS_TREE: boolean;
export declare function parseMavenArgs(argsString: any): string[];
/**
 * Determines whether license information should be fetched from remote sources,
 * based on the FETCH_LICENSE environment variable.
 *
 * @returns {boolean} True if the FETCH_LICENSE env var is set to "true" or "1"
 */
export declare function shouldFetchLicense(): boolean;
/**
 * Determines whether remote package metadata should be fetched for enrichment.
 *
 * @returns {boolean} True when registry metadata enrichment is enabled.
 */
export declare function shouldFetchPackageMetadata(): boolean;
/**
 * Determines whether VCS (version control system) information should be fetched
 * for Go packages, based on the GO_FETCH_VCS environment variable.
 *
 * @returns {boolean} True if the GO_FETCH_VCS env var is set to "true" or "1"
 */
export declare function shouldFetchVCS(): boolean;
export declare const FETCH_LICENSE: boolean;
export declare const SEARCH_MAVEN_ORG: boolean;
export declare const JAVA_CMD: string;
/**
 * Returns the Java executable command to use, resolved in priority order:
 * JAVA_CMD env var > JAVA_HOME/bin/java > "java".
 *
 * @returns {string} Path or name of the Java executable
 */
export declare function getJavaCommand(): string;
export declare const PYTHON_CMD: string;
/**
 * Returns the Python executable command to use, resolved in priority order:
 * PYTHON_CMD env var > CONDA_PYTHON_EXE env var > "python".
 *
 * @returns {string} Path or name of the Python executable
 */
export declare function getPythonCommand(): string;
export declare let DOTNET_CMD: string;
export declare let NODE_CMD: string;
export declare let NPM_CMD: string;
export declare let YARN_CMD: string;
export declare let GCC_CMD: string;
export declare let RUSTC_CMD: string;
export declare let GO_CMD: string;
export declare let CARGO_CMD: string;
export declare let CLJ_CMD: string;
export declare let LEIN_CMD: string;
export declare let CDXGEN_TEMP_DIR: string;
export declare const SWIFT_CMD: any;
export declare const RUBY_CMD: any;
export declare const PYTHON_EXCLUDED_COMPONENTS: string[];
export declare const PROJECT_TYPE_ALIASES: {
    java: string[];
    android: string[];
    jar: string[];
    "gradle-index": string[];
    "sbt-index": string[];
    "maven-index": string[];
    "cargo-cache": string[];
    js: string[];
    mcp: string[];
    "ai-skill": string[];
    py: string[];
    go: string[];
    rust: string[];
    php: string[];
    ruby: string[];
    csharp: string[];
    dart: string[];
    haskell: string[];
    elixir: string[];
    c: string[];
    clojure: string[];
    github: string[];
    hbom: string[];
    os: string[];
    jenkins: string[];
    helm: string[];
    "helm-index": string[];
    universal: string[];
    cloudbuild: string[];
    swift: string[];
    binary: string[];
    oci: string[];
    cocoa: string[];
    scala: string[];
    nix: string[];
    caxa: string[];
    asar: string[];
    "vscode-extension": string[];
    "chrome-extension": string[];
    dynamic: string[];
    "ai-provenance": string[];
};
export declare const PACKAGE_MANAGER_ALIASES: {
    scala: string[];
};
//# sourceMappingURL=core-env.d.ts.map