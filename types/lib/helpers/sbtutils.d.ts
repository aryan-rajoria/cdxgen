/**
 * Returns a default location of the plugins file.
 *
 * @param {string} projectPath Path to the SBT project
 */
export declare function sbtPluginsPath(projectPath: string): any;
/**
 * Determine the version of SBT used in compilation of this project.
 * By default it looks into a standard SBT location i.e.
 * <path-project>/project/build.properties
 * Returns `null` if the version cannot be determined.
 *
 * @param {string} projectPath Path to the SBT project
 */
export declare function determineSbtVersion(projectPath: string): string | null;
/**
 * Adds a new plugin to the SBT project by amending its plugins list.
 * Only recommended for SBT < 1.2.0 or otherwise use `addPluginSbtFile`
 * parameter.
 * The change manipulates the existing plugins' file by creating a copy of it
 * and returning a path where it is moved to.
 * Once the SBT task is complete one must always call `cleanupPlugin` to remove
 * the modifications made in place.
 *
 * @param {string} projectPath Path to the SBT project
 * @param {string} plugin Name of the plugin to add
 */
export declare function addPlugin(projectPath: string, plugin: string): string | null;
/**
 * Cleans up modifications to the project's plugins' file made by the
 * `addPlugin` function.
 *
 * @param {string} projectPath Path to the SBT project
 * @param {string} originalPluginsFile Location of the original plugins file, if any
 */
export declare function cleanupPlugin(projectPath: string, originalPluginsFile: string): boolean;
/**
 * Find the repository URL from the local Coursier cache for a given Maven package.
 *
 * @param {string} group Maven groupId
 * @param {string} name Maven artifactId (original name with suffix if applicable)
 * @param {string} version Package version
 * @returns {string|null} The repository URL or null if not found
 */
export declare function findCoursierRegistryUrl(group: string, name: string, version: string): string | null;
/**
 * Test if a given URL exists (returns 2xx/3xx for http/https, or exists on disk for file)
 *
 * @param {string} url URL to test
 * @returns {Promise<boolean>} true if URL exists
 */
export declare function testUrlExists(url: string): Promise<boolean>;
/**
 * Find the local jar path in Coursier cache if it exists.
 *
 * @param {string} group Maven groupId
 * @param {string} name Maven artifactId (original name with suffix)
 * @param {string} version Package version
 * @returns {string|null} local jar path or null
 */
export declare function findLocalJarPath(group: string, name: string, version: string): string | null;
export declare function resolveJarDistribution(group: any, name: any, version: any): Promise<any>;
/**
 * Parse an sbt dependency tree output file and return the package list and dependency tree.
 *
 * Reads a file produced by the sbt `dependencyTree` command and extracts Maven artifact
 * coordinates, building a hierarchical dependency graph. Evicted packages and ranges are ignored.
 *
 * @param {string} sbtTreeFile Path to the sbt dependency tree output file
 * @returns {{ pkgList: Object[], dependenciesList: Object[] }}
 */
export declare function parseSbtTree(sbtTreeFile: string): {
    pkgList: Object[];
    dependenciesList: Object[];
};
/**
 * Parse sbt lock file
 *
 * @param {string} pkgLockFile build.sbt.lock file
 */
export declare function parseSbtLock(pkgLockFile: string): Promise<{
    group: any;
    name: any;
    version: any;
    _integrity: string;
    scope: string | undefined;
    properties: {
        name: string;
        value: string;
    }[];
    purl: string;
    "bom-ref": string;
    evidence: {
        identity: {
            field: string;
            confidence: number;
            concludedValue: string;
            methods: {
                technique: string;
                confidence: number;
                value: string;
            }[];
        };
    };
}[]>;
/**
 * Parse the root build.sbt to extract the aggregate project name, organization, and version.
 *
 * @param {string} projectPath Directory path of the project
 * @returns {{ name: string, group: string, version: string }|null}
 */
export declare function parseSbtRootProject(projectPath: string): {
    name: string;
    group: string;
    version: string;
} | null;
/**
 * Discover SBT subproject names statically by parsing build.sbt and project files.
 *
 * @param {string} projectPath Directory path of the project
 * @returns {string[]} List of discovered subproject names
 */
export declare function discoverSbtProjects(projectPath: string): string[];
/**
 * Parse the output of the sbt `projects` command to extract the real project
 * identifiers as understood by sbt. This is more accurate than scraping the
 * build files with a regex (see {@link discoverSbtProjects}), since it relies
 * on sbt's own project resolution and therefore avoids false positives from
 * commented-out code, examples or values that merely look like project
 * definitions.
 *
 * A typical `sbt projects` output looks like:
 *
 * ```
 * [info] In file:/path/to/build/
 * [info] 	   * chen
 * [info] 	     platform
 * [info] 	     dataflowengineoss
 * ```
 *
 * The project marked with `*` is the currently selected (usually the
 * aggregating root) project.
 *
 * @param {string} stdout Raw stdout captured from `sbt projects`
 * @returns {{projects: string[], root: string | undefined}} The discovered
 *  project ids and the currently selected (root) project id, if any.
 */
export declare function parseSbtProjects(stdout: string): {
    projects: string[];
    root: string | undefined;
};
/**
 * Parse plugins.sbt files to extract sbt plugins as development dependencies.
 *
 * @param {string} projectPath Directory path of the project
 * @returns {Object[]} List of parsed dependency components
 */
export declare function parseSbtPlugins(projectPath: string): Object[];
//# sourceMappingURL=sbtutils.d.ts.map