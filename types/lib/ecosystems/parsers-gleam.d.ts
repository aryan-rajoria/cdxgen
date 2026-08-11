/**
 * Gleam package parser.
 *
 * Gleam resolves dependencies through Hex, so packages are identified with the
 * registered `hex` purl type (`pkg:hex/<name>@<version>`). No new purl type is
 * introduced: a Gleam package on Hex is a Hex package, with a flat name and no
 * namespace, exactly as the registered `hex` rules allow.
 *
 * Two files are consulted:
 *   - `gleam.toml` — the manifest (project name, version, target, and the
 *     version ranges the project declares for its dependencies).
 *   - `manifest.toml` — the lock file written by the Gleam build tool, which
 *     pins every resolved package version and records which packages each one
 *     requires. The lock is the source of truth for versions and for the
 *     direct/transitive distinction.
 *
 * When `manifest.toml` is absent (the project has not been resolved), the
 * manifest alone is used and versions are left unspecified.
 */
/**
 * Parse a Gleam project from its `gleam.toml` manifest and optional
 * `manifest.toml` lock.
 *
 * @param {string} gleamTomlFile Path to `gleam.toml`
 * @param {string} [manifestTomlFile] Path to `manifest.toml`, if present
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object }}
 */
export declare function parseGleamProject(gleamTomlFile: string, manifestTomlFile?: string): {
    pkgList: object[];
    dependencies: object[];
    parentComponent: object;
};
//# sourceMappingURL=parsers-gleam.d.ts.map