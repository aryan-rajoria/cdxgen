/**
 * Platform-specific @appthreat/atom-* native package names that carry the
 * bundled native `atom` binary.
 */
export declare const ATOM_NATIVE_PACKAGES: Set<string>;
/**
 * Convert cdxgen's glob-style exclude patterns to a Scala/Java regex string.
 *
 * @param {string[]} patterns Glob patterns from cdxgen's `--exclude` option
 * @returns {string|undefined} Scala-compatible regex or undefined when empty
 */
export declare function globPatternsToAtomIgnoreRegex(patterns?: string[]): string | undefined;
/**
 * Determine whether a file path is excluded by the given atom-style glob
 * exclude patterns.
 *
 * @param {string} filePath File path to test.
 * @param {string[]} [patterns=[]] Glob exclude patterns.
 * @returns {boolean} True when the path matches an exclude pattern.
 */
export declare function isPathExcludedByGlobPatterns(filePath: string, patterns?: string[]): boolean;
/**
 * Remove atom-slice entries whose source file matches the given glob exclude
 * patterns, preserving the original slice structure otherwise.
 *
 * Filters `objectSlices`, `userDefinedTypes`, `reachables`, and reachable
 * `paths`/`graph` nodes/edges that reference excluded files.
 *
 * @param {object|Array} sliceData Atom slice data object or array.
 * @param {string[]} [patterns=[]] Glob exclude patterns.
 * @returns {object|Array} Filtered slice data (shallow copy when an object).
 */
export declare function filterAtomSlicesByExcludePatterns(sliceData: object | any[], patterns?: string[]): object | any[];
/**
 * Build additional environment variables for Atom from cdxgen CLI options.
 *
 * @param {Object} options CLI options
 * @param {string} language Atom language name
 * @returns {Object} Environment variables to pass to Atom
 */
export declare function buildAtomCommandEnv(options?: Object, language?: string): Object;
/**
 * Resolve the atom platform sub-package name and provider kind for the current
 * (or supplied) runtime. This is a cdxgen-side reimplementation of atom's own
 * `resolveAtomProvider`, kept here rather than imported from
 * `@appthreat/atom/resolve.js` so it is safe under every cdxgen runtime
 * (node, bun, deno, caxa) and inside the extracted caxa tree where the
 * dispatcher's own resolver may not find a sibling sub-package.
 *
 * The returned `preferredPkg`/`kind` pair must agree with atom's
 * `resolveAtomProvider` and `NATIVE_PACKAGES`; the parity test in
 * atomUtils.poku.js asserts the agreement for all eight published triples.
 *
 * @param {Object} [opts] Optional overrides for testability
 * @param {string} [opts.platform] Defaults to `process.platform`
 * @param {string} [opts.arch] Defaults to `process.arch`
 * @param {string} [opts.libc] Defaults to detected libc on linux
 * @returns {{preferredPkg: string, kind: "native"|"jar", platform: string, arch: string, libc?: string}}
 */
export declare function resolveAtomProvider(opts?: {
    platform?: string;
    arch?: string;
    libc?: string;
}): {
    preferredPkg: string;
    kind: "native" | "jar";
    platform: string;
    arch: string;
    libc?: string;
};
/**
 * Returns `"native"` or `"jar"` for the currently resolved atom provider.
 * Used to gate Java/JDK advice so users on the five native platforms are not
 * told to install a JDK for a failure that has nothing to do with Java.
 */
export declare function atomProviderKind(): "jar" | "native";
/**
 * Locate the `php-parse` binary that the PHP frontend needs.
 *
 * atom 3's dispatcher unconditionally sets `PHP_PARSER_BIN=<ATOM_HOME>/bin/php-parse`,
 * which for a native sub-package does not exist and also clobbers a caller-set
 * value. cdxgen therefore resolves the real location and forwards it through
 * the child env (see `buildAtomCommandEnv`); `executeAtom` then spawns the
 * native binary directly for PHP so the dispatcher cannot clobber it (see
 * `resolveDirectAtomBinaryPath`). Resolution order:
 *   1. explicit `PHP_PARSER_BIN` env var (operators / container images)
 *   2. `@appthreat/atom-parsetools/plugins/bin/php-parse` under cdxgen's own
 *      node_modules, then under `GLOBAL_NODE_MODULES_PATH` for global installs
 *
 * Returns `undefined` when neither is found, in which case PHP analysis runs
 * through the dispatcher unchanged (and fails on native platforms until atom
 * fixes the clobber).
 *
 * @returns {string|undefined}
 */
export declare function resolvePhpParseBin(): string | undefined;
/**
 * Resolve the atom native binary path directly, bypassing the dispatcher.
 *
 * This is required for the PHP frontend: the dispatcher clobbers
 * `PHP_PARSER_BIN` with a path that does not exist on native platforms, and
 * atom 3.0.x crashes in `defaultPhpParserBin` parsing that bogus value before
 * any `--frontend-args php-parser-bin=` override is consulted. Spawning the
 * native binary directly lets cdxgen control the child env, so the correct
 * `PHP_PARSER_BIN` reaches atom. Returns `undefined` when the provider is the
 * jar kind or the native binary cannot be located (in which case the dispatcher
 * is used as-is).
 *
 * @returns {string|undefined}
 */
export declare function resolveDirectAtomBinaryPath(): string | undefined;
/**
 * Retrieves the atom command by referring to various environment variables
 */
export declare function getAtomCommand(): any;
/**
 * Compute the maximum heap atom may grow to, in bytes.
 *
 * Neither of atom's two runtimes bounds itself to anything a machine can
 * comfortably back: a GraalVM native image defaults to
 * `MaximumHeapSizePercent=80` of physical memory, and HotSpot to a quarter of
 * it. Both use a collector that grows the heap in preference to collecting, so
 * on a large host atom reserves tens of gigabytes and the machine, not atom,
 * is what runs out of memory.
 *
 * The ceiling is therefore the smaller of half of physical memory and
 * `ATOM_MAX_HEAP_CAP_BYTES`, with a floor so that a small container still gets
 * a workable heap. `ATOM_MAX_HEAP` overrides the whole calculation and accepts
 * a plain byte count or a `k`/`m`/`g` suffix.
 *
 * @returns {number|undefined} Heap ceiling in bytes, or `undefined` to leave the runtime default in place
 */
export declare function atomMaxHeapBytes(): number | undefined;
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