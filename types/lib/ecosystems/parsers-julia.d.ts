/**
 * Julia project parser.
 *
 * Two files are consulted:
 *   - `Project.toml` — the manifest holding the project name, UUID, version,
 *     the names (and UUIDs) of its direct dependencies, and version
 *     compatibility constraints.
 *   - `Manifest.toml` — the lock file written by Pkg on resolve, pinning every
 *     package in the environment with its UUID, version, content hash, and the
 *     names of the packages it depends on.
 *
 * Packages are identified with the registered `julia` purl type, which carries
 * the package UUID as a required qualifier (`pkg:julia/JSON@0.21.4?uuid=…`).
 * The UUID is what Julia itself uses to identify packages, so keeping it in
 * the purl lets consumers match components across differently named mirrors.
 *
 * Julia standard libraries ship with the language itself and carry no version
 * in the manifest; they are emitted without a version and marked as standard
 * libraries so they can be told apart from registry packages.
 */
/**
 * Parse a Julia environment from its `Project.toml` and optional
 * `Manifest.toml`.
 *
 * @param {string} [projectTomlFile] Path to `Project.toml`, if present
 * @param {string} [manifestTomlFile] Path to `Manifest.toml`, if present
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs?: string[] }}
 */
export declare function parseJuliaProject(projectTomlFile?: string, manifestTomlFile?: string): {
    pkgList: object[];
    dependencies: object[];
    parentComponent: object;
    rootInputs?: string[];
};
/**
 * Tell whether a `Project.toml` declares a Julia environment.
 *
 * Cloud Native Buildpacks and Gleam use the same file names, so the caller
 * needs a content check before dispatching. A Julia project always carries a
 * package `uuid`, a `[deps]` table, or a `[compat]` table.
 *
 * @param {string} filePath Path to the candidate `Project.toml`
 * @returns {boolean} true when the file is a Julia project
 */
export declare function isJuliaProjectFile(filePath: string): boolean;
/**
 * Tell whether a `Manifest.toml` is a Julia lock file.
 *
 * Gleam writes a lowercase `manifest.toml` that case-insensitive filesystems
 * surface under the same glob; a Julia manifest is recognised by its
 * `manifest_format` marker or its `[[deps.<Name>]]` tables.
 *
 * @param {string} filePath Path to the candidate `Manifest.toml`
 * @returns {boolean} true when the file is a Julia manifest
 */
export declare function isJuliaManifestFile(filePath: string): boolean;
//# sourceMappingURL=parsers-julia.d.ts.map