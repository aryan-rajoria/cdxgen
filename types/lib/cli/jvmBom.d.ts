export declare let GRADLE_CACHE_DIR: any;
export declare const GRADLE_INIT_SCRIPT: any;
export declare const SBT_CACHE_DIR: any;
/**
 * Function to create bom string for Java jars
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 *
 * @returns {Object} BOM with namespace mapping
 */
export declare function createJarBom(path: string, options: Object): Object;
/**
 * Discover the real sbt project ids for a build by invoking sbt's own
 * `projects` command. This is more reliable than scraping the build files with
 * a regex, since it uses sbt's project resolution and avoids false positives
 * (commented-out code, examples, values that merely resemble project defs) that
 * can lead to hangs when those bogus scopes are later passed to `dependencyTree`.
 *
 * Falls back to the regex-based {@link discoverSbtProjects} heuristic when the
 * sbt invocation fails or yields nothing useful.
 *
 * @param {string} basePath Directory of the sbt build
 * @param {string} sbtCmd sbt executable
 * @param {Object} env Environment for the spawned process
 * @returns {string[]} List of sbt project ids
 */
export declare function discoverSbtProjectsFromCmd(basePath: string, sbtCmd: string, env: Object): string[];
/**
 * Function to create bom string for Java projects
 *
 * @param {string} path to the project
 * @param {Object} options Parse options from the cli
 * @returns {Promise<Object>} Promise resolving to BOM object
 */
export declare function createJavaBom(path: string, options: Object): Promise<Object>;
//# sourceMappingURL=jvmBom.d.ts.map