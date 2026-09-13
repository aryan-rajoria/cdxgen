/**
 * Crystal parser for `shard.yml` and `shard.lock`.
 *
 * Shards resolves dependencies declared in `shard.yml` and records the
 * resolved set in `shard.lock`, which pins each dependency's version and
 * source repository. Both files are YAML and are read with the standard
 * parser.
 *
 * No `crystal` purl type is registered, so shards are identified as generic
 * packages carrying a `cdx:purl:proposedType=crystal` property, following
 * the convention used for nix and zig. This keeps the BOM valid today and
 * allows a mechanical migration if a type is registered upstream.
 */
/**
 * Parse a Crystal project from `shard.yml` and optional `shard.lock`.
 *
 * @param {string} shardYmlFile Path to `shard.yml`
 * @param {string} [shardLockFile] Path to `shard.lock`, if present
 * @returns {{ pkgList: object[], dependencies: object[], parentComponent: object, rootInputs?: string[] }}
 */
export declare function parseShardsProject(shardYmlFile: string, shardLockFile?: string): {
    pkgList: object[];
    dependencies: object[];
    parentComponent: object;
    rootInputs?: string[];
};
//# sourceMappingURL=parsers-crystal.d.ts.map