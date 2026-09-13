/**
 * Erlang rebar3 parser for `rebar.lock`.
 *
 * A rebar lock holds one or two Erlang terms, each ended by a period:
 *
 *   {"1.2.0", [{<<"cowboy">>,{pkg,<<"cowboy">>,<<"2.10.0">>},0}]}.
 *   [{pkg_hash, [{<<"cowboy">>, <<"3AFD...">>}]},
 *    {pkg_hash_ext, [...]}].
 *
 * The first term pairs the lock format version with the locked dependency
 * list; the hashes live in a separate second term, which is absent from locks
 * that hold no hex packages. Lock format 1.0.0 omitted the version and wrote
 * the dependency list as the only term.
 *
 * Rather than a large regular expression over the surface syntax, a small
 * recursive reader parses the terms into plain JavaScript values: tuples and
 * lists become arrays, binaries and strings become strings, atoms become
 * strings. Only the shapes rebar actually writes are understood; anything
 * else is skipped.
 *
 * Hex dependencies are identified with the registered `hex` purl type, since
 * rebar resolves Erlang packages through hex.pm. The `pkg_hash` values hex
 * publishes are SHA-256 digests of the package tarball, so they are emitted
 * into the CycloneDX `hashes` array where consumers expect content hashes.
 */
/**
 * Parse a `rebar.lock` file.
 *
 * @param {string} rebarLockFile Path to `rebar.lock`
 * @returns {{ pkgList: object[] }} Locked packages
 */
export declare function parseRebarLock(rebarLockFile: string): {
    pkgList: object[];
};
/**
 * Parse every period-terminated Erlang term in a source text.
 *
 * @param {string} text Source text
 * @returns {Array} Parsed terms, in file order
 */
export declare function parseErlangTerms(text: string): any[];
//# sourceMappingURL=parsers-rebar.d.ts.map