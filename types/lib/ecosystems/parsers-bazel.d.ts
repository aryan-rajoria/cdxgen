/**
 * Parse a `MODULE.bazel` manifest and return its BCR modules and ecosystem
 * dependencies. The MODULE.bazel file is Starlark; this extractor finds calls
 * by name and reads their keyword/string arguments using a balanced-paren scan
 * rather than a regex, because MODULE.bazel calls can nest.
 *
 * @param {string} moduleFile Path to `MODULE.bazel`
 * @returns {{ pkgList: object[], parentComponent: object, rootInputs: string[] }}
 */
export declare function parseModuleBazel(moduleFile: string): {
    pkgList: object[];
    parentComponent: object;
    rootInputs: string[];
};
/**
 * Parse a `MODULE.bazel.lock` for resolved dependencies and the module graph.
 *
 * @param {string} lockFile Path to `MODULE.bazel.lock`
 * @returns {{ pkgList: object[], dependencies: object[] }}
 */
export declare function parseModuleBazelLock(lockFile: string): {
    pkgList: object[];
    dependencies: object[];
};
/**
 * Find every top-level call to `name(...)` in Starlark source and return the
 * parsed keyword/string arguments of each. Scanning uses a balanced-paren
 * counter rather than a regex, because MODULE.bazel calls can nest other calls
 * inside their argument lists.
 *
 * @param {string} src Starlark source
 * @param {string} name Function name to match (dotted names supported)
 * @returns {Array<Map<string, string|string[]>>} one argument map per call
 */
export declare function findAllCalls(src: string, name: string): Array<Map<string, string | string[]>>;
//# sourceMappingURL=parsers-bazel.d.ts.map