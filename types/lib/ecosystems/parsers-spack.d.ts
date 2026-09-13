/**
 * HPC Spack parser for `spack.lock`.
 *
 * Spack writes a JSON lock file when an environment is concretised:
 *
 *   - `roots` — the specs the user asked for, each as `{hash, spec}`.
 *   - `concrete_specs` — every node of the resolved DAG, keyed by its DAG
 *     hash. A node carries its `name`, `version`, `namespace`, the compiler
 *     and architecture it was built for, and a `dependencies` list whose
 *     entries reference other nodes by hash.
 *
 * The DAG hash is the identity Spack itself uses: two builds of the same
 * version with different variants or compilers are different hashes, so the
 * graph is keyed by hash throughout and the hash is carried into each
 * component's bom-ref.
 *
 * No `spack` purl type is registered, so nodes are identified as generic
 * packages carrying a `cdx:purl:proposedType=spack` property, following the
 * convention used for nix and zig. The DAG hash is kept as a property because
 * it identifies the concrete build, not the artifact bytes.
 */
/**
 * Parse a `spack.lock` file.
 *
 * @param {string} spackLockFile Path to `spack.lock`
 * @returns {{ pkgList: object[], dependencies: object[], rootInputs: string[] }}
 */
export declare function parseSpackLock(spackLockFile: string): {
    pkgList: object[];
    dependencies: object[];
    rootInputs: string[];
};
//# sourceMappingURL=parsers-spack.d.ts.map