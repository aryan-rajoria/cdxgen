/**
 * Perl parser for `cpanfile` and `cpanfile.snapshot`.
 *
 * Carton snapshots the resolved install set as a text document: one entry per
 * distribution, each carrying the `pathname` it was fetched from (which
 * encodes the PAUSE author id), the packages it provides, and the
 * requirements it was resolved against. The declared `cpanfile` lists the
 * project's own requirements.
 *
 * Distributions are identified with the registered `cpan` purl type, whose
 * rules require the author id as the namespace
 * (`pkg:cpan/<AUTHOR>/<Distribution>@<version>`).
 */
/**
 * Parse a `cpanfile.snapshot` into distributions with a dependency graph.
 *
 * @param {string} snapshotFile Path to `cpanfile.snapshot`
 * @param {string} [cpanfileFile] Path to `cpanfile`, if present
 * @returns {{ pkgList: object[], dependencies: object[] }}
 */
export declare function parseCpanSnapshot(snapshotFile: string, cpanfileFile?: string): {
    pkgList: object[];
    dependencies: object[];
};
/**
 * Collect the requirement names declared in a `cpanfile`.
 *
 * Only the `requires` keyword outside phase blocks is read; phases such as
 * `on 'test'` are ignored so test-only modules do not become direct
 * dependencies.
 *
 * @param {string} cpanfileFile Path to `cpanfile`
 * @returns {Set<string>} Declared requirement names
 */
export declare function directRequirementsFromCpanfile(cpanfileFile: string): Set<string>;
//# sourceMappingURL=parsers-perl.d.ts.map