/**
 * Haskell Stack parser for `stack.yaml` and its lock file.
 *
 * Stack resolves packages from a snapshot plus the `extra-deps` a project
 * declares, and writes the completed locations to `stack.yaml.lock` (named
 * after the configuration file, so a custom `foo.yaml` locks to
 * `foo.yaml.lock`). The lock is YAML with two lists:
 *
 *   - `packages` — one entry per extra-dep, each holding the `original`
 *     incomplete specification and the `completed` location. A Hackage
 *     location is the string `<name>-<version>@sha256:<hex>,<size>`; a
 *     repository location carries `url`, `commit` and `subdir`.
 *   - `snapshots` — the resolved snapshot chain, each with the `original`
 *     name (`lts-22.28`) and the `completed` url, size and sha256.
 *
 * The lock pins only the extra-deps: packages taken from the snapshot are not
 * listed, because the snapshot url and digest already pin them. The snapshot
 * is therefore recorded on the parent component rather than expanded.
 *
 * Hackage packages are identified with the registered `hackage` purl type
 * (`pkg:hackage/<name>@<version>`).
 */
/**
 * Parse a Stack project from its lock file, with optional `stack.yaml`.
 *
 * @param {string} stackLockFile Path to `stack.yaml.lock` or `stack.lock`
 * @param {string} [stackYamlFile] Path to `stack.yaml`, if present
 * @returns {{ pkgList: object[], parentComponent: object, rootInputs: string[] }}
 */
export declare function parseStackProject(stackLockFile: string, stackYamlFile?: string): {
    pkgList: object[];
    parentComponent: object;
    rootInputs: string[];
};
//# sourceMappingURL=parsers-stack.d.ts.map