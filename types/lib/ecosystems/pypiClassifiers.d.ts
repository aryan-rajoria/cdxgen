/**
 * `Framework ::` values that do not mean "an application is built on this".
 *
 * Two groups, both of which would otherwise put a `framework` tag — and therefore
 * `type: "framework"` — on a large share of an ordinary dependency tree, drowning
 * the runtime frameworks the tag exists to surface:
 *
 *   * Development, build, test and documentation tooling. A pytest plugin
 *     declaring `Framework :: Pytest` is making a true statement, but it belongs
 *     to the dev dependencies, not to what the application runs on.
 *   * Concurrency runtimes. `Framework :: AsyncIO` is declared by a very large
 *     number of libraries to advertise that they work under asyncio; observed on
 *     `fastapi`, and `Framework :: AnyIO` likewise on `starlette`. It describes an
 *     execution model, not a framework the application is written against.
 *
 * The declared name is still emitted as a tag in every case, and still recorded in
 * `cdx:pypi:frameworks`; only the generic `framework` tag is withheld.
 */
export declare const PYPI_NON_APPLICATION_FRAMEWORKS: Set<string>;
/**
 * Normalize a distribution name per PEP 503.
 *
 * @param {string} name Distribution name
 * @returns {string} Normalized name, or an empty string for unusable input
 */
export declare function normalizePypiName(name: string): string;
/**
 * Best-known import module names for a PyPI distribution.
 *
 * Two sources, in order: the curated alias map (which is where the cases that
 * cannot be derived from the name live — `pyyaml` installs `yaml`, `absl-py`
 * installs `absl`, `beautifulsoup4` installs `bs4`), and the name-derived form,
 * which is correct for the large majority of distributions. Callers that need to
 * distinguish the two should read the alias map themselves; for tagging purposes
 * both are usable and a wrong extra candidate simply matches nothing.
 *
 * This is deliberately not a guess at *every* module a distribution ships — only
 * at its top-level import names.
 *
 * @param {string} name Distribution name, e.g. "PyYAML"
 * @returns {string[]} Candidate top-level module names, deduplicated
 */
export declare function pypiModulesForPackage(name: string): string[];
/**
 * Interpret a PyPI classifier list.
 *
 * @param {string[]} classifiers Raw `info.classifiers` from the PyPI JSON API
 * @returns {{frameworks: string[], tags: string[]}} Declared frameworks (lowercased,
 *   e.g. `["django"]`) and the tag vocabulary they and the `Topic ::` lines imply
 */
export declare function parsePypiClassifiers(classifiers: string[]): {
    frameworks: string[];
    tags: string[];
};
/**
 * Attach classifier-derived tags and properties to a package.
 *
 * Tags are merged into any the package already carries rather than replacing
 * them — `lib/managers/binary.js` sets `tags: ["source"]` as an identity marker,
 * and losing it would change how that package is reconciled later.
 *
 * @param {Object} pkg Package object, mutated in place
 * @param {string[]} classifiers Raw `info.classifiers` from the PyPI JSON API
 * @returns {Object} The same package object
 */
export declare function applyPypiClassifierMetadata(pkg: Object, classifiers: string[]): Object;
/**
 * Attach the distribution's top-level import module names as `internal:Namespaces`.
 *
 * This is the same property jar, gem, nuget and composer components already carry,
 * so downstream consumers that map namespaces back to components need no
 * pypi-specific path. Unlike the jar case the value is name-derived and
 * alias-curated rather than read out of the artifact, which is why
 * `cdx:pypi:modulesFrom` records the provenance.
 *
 * @param {Object} pkg Package object, mutated in place
 * @returns {Object} The same package object
 */
export declare function applyPypiModuleNames(pkg: Object): Object;
//# sourceMappingURL=pypiClassifiers.d.ts.map