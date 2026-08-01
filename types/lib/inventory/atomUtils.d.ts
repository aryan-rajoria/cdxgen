/**
 * Convert cdxgen's glob-style exclude patterns to a Scala/Java regex string.
 *
 * @param {string[]} patterns Glob patterns from cdxgen's `--exclude` option
 * @returns {string|undefined} Scala-compatible regex or undefined when empty
 */
export declare function globPatternsToAtomIgnoreRegex(patterns?: string[]): string | undefined;
export declare function isPathExcludedByGlobPatterns(filePath: any, patterns?: any[]): boolean;
export declare function filterAtomSlicesByExcludePatterns(sliceData: any, patterns?: any[]): any;
/**
 * Build additional environment variables for Atom from cdxgen CLI options.
 *
 * @param {Object} options CLI options
 * @param {string} language Atom language name
 * @returns {Object} Environment variables to pass to Atom
 */
export declare function buildAtomCommandEnv(options?: Object, language?: string): Object;
/**
 * Retrieves the atom command by referring to various environment variables
 */
export declare function getAtomCommand(): any;
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
export declare function executeAtom(src: string, args: string[], extra_env?: Object): boolean;
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
export declare function findAppModules(src: string, language: string, methodology?: string, slicesFile?: string, options?: Object): any;
//# sourceMappingURL=atomUtils.d.ts.map