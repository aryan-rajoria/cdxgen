/**
 * Is the given string a `Gem::Platform` such as `x86_64-linux` or `java`?
 * The cpu component is an open token in RubyGems, so we validate by looking
 * for a known os name in any position.
 *
 * Note that `truffleruby` is deliberately absent from the os table.
 * `Gem::Platform.new("truffleruby").to_s` is `"unknown"`: TruffleRuby reports a
 * conventional local platform such as `x86_64-linux`, and reuses plain ruby
 * gems via an allowlist rather than through a platform of its own. So
 * `truffleruby` never appears as a platform suffix.
 *
 * @param {string} value Candidate platform string
 * @returns {boolean} true if the value looks like a gem platform
 */
export declare function isRubyPlatform(value: string): boolean;
/**
 * Normalize a gem platform the way `Gem::Platform` does.
 *
 * The only alias that matters for a lockfile or a gemspec is `jruby`, which
 * `Gem::Platform` maps to the os `java`, so `Gem::Platform.new("jruby").to_s`
 * is `"java"`. Normalizing keeps a JRuby gem from being reported under two
 * different purls depending on which spelling the source used.
 *
 * @param {string | undefined} platform Platform to normalize
 * @returns {string | undefined} Normalized platform
 */
export declare function normalizeGemPlatform(platform: string | undefined): string | undefined;
/**
 * Split a gem version string into its version and optional native platform.
 *
 * Bundler writes native gems as `name (version-platform)`, for example
 * `google-protobuf (3.25.1-x86_64-linux)`. This mirrors how Bundler itself
 * parses the lockfile: its `NAME_VERSION` regex captures the version as
 * `([^-]*)` followed by an optional `-(.*)` platform, i.e. it splits at the
 * *first* hyphen. That is unambiguous because `Gem::Version` rewrites any `-`
 * to `.pre.` on construction, so a canonical version string, which is what
 * Bundler writes to the lockfile, never contains a hyphen.
 *
 * @param {string | undefined} version Version that may include a platform suffix
 * @returns {{version: (string | undefined), platform: (string | undefined)}} Version and platform
 */
export declare function splitRubyVersionPlatform(version: string | undefined): {
    version: (string | undefined);
    platform: (string | undefined);
};
/**
 * Simplify the ruby version by removing platform suffixes
 *
 * @param {string} version Version to simplify
 * @returns {string} Simplified version
 */
export declare function simplifyRubyVersion(version: string): string;
/**
 * Construct a gem purl. Per the purl specification, the native platform is
 * represented with the `platform` qualifier and not as part of the version.
 * `ruby` is the implied default platform, so it is left out.
 *
 * @param {string} name Gem name
 * @param {string | undefined} version Gem version without any platform suffix
 * @param {string | undefined} platform Gem platform such as `x86_64-linux`
 * @returns {string} purl string
 */
export declare function toGemPurl(name: string, version: string | undefined, platform: string | undefined): string;
/**
 * Parse a single line from the `CHECKSUMS` section of a Gemfile.lock. Bundler
 * 2.5 onwards writes `name (version[-platform]) algo=digest[,algo=digest]`,
 * where the `name (version[-platform])` token is identical to the one used in
 * the `specs:` section. The digest is lowercase hex. An entry may carry no
 * checksum at all when Bundler could not obtain one.
 *
 * @param {string} line Trimmed line from the CHECKSUMS section
 * @returns {{lockName: string, hashes: Array<object>} | undefined} Lock name and CycloneDX hashes
 */
export declare function parseGemChecksumLine(line: string): {
    lockName: string;
    hashes: Array<object>;
} | undefined;
/**
 * Default location of Bundler's compact index cache. This is the protocol
 * Bundler itself uses to resolve, so any gem the developer has ever installed
 * has a cached `info/<gem>` file here.
 *
 * @returns {string} Path to the compact index cache directory
 */
export declare function getCompactIndexCacheDir(): string;
/**
 * Parse the contents of a Bundler compact index `info/<gem>` file. Each line
 * describes one release:
 *
 *   `VERSION[-PLATFORM] <deps>|checksum:<sha256>,ruby:<req>,rubygems:<req>,...`
 *
 * This is the cheapest source of gem metadata available: a single local file
 * carries the sha256, the runtime dependencies and the required ruby and
 * rubygems versions for every release of a gem.
 *
 * @param {string} infoData Contents of an info file
 * @returns {object} Map of `version[-platform]` to release metadata
 */
export declare function parseCompactIndexInfo(infoData: string): object;
/**
 * Parse a `.bundle/config` file. Bundler writes a small YAML document of
 * `BUNDLE_<SETTING>: "value"` pairs. Two settings matter for an SBOM:
 * `BUNDLE_PATH`, which tells us where the gems actually live, and
 * `BUNDLE_WITHOUT`, which tells us that some groups were never installed and
 * that the SBOM is therefore incomplete by construction.
 *
 * @param {string} configFile Path to a .bundle/config file
 * @returns {object} Map of setting name to value
 */
export declare function parseBundleConfig(configFile: string): object;
/**
 * Enrich gem components from the caches present on the machine, without making
 * any network calls. Two sources are consulted:
 *
 * 1. Bundler's compact index cache, for the sha256 and the required ruby and
 *    rubygems versions of the exact release, including native variants.
 * 2. The installed gemspecs under `GEM_HOME/specifications`, for licenses,
 *    description, project URIs and the native extension list.
 *
 * Because this only reads files it also works in dry-run mode, where the
 * registry lookups performed by `getRubyGemsMetadata` are blocked.
 *
 * @param {Array} pkgList List of gem components to enrich in place
 * @param {object} options Options
 * @param {string} options.gemHome GEM_HOME to read installed gemspecs from
 * @param {string} options.compactIndexCacheDir Bundler compact index cache directory
 * @returns {Promise<Array>} The enriched package list
 */
export declare function enrichGemsFromLocalCache(pkgList: any[], options?: {
    gemHome: string;
    compactIndexCacheDir: string;
}): Promise<any[]>;
/**
 * Method to query rubygems api for gems details
 *
 * A gem that ships several native builds appears in the BOM once per platform.
 * Rather than making one request per variant, the versions listing endpoint is
 * used to fetch every version and platform of such a gem in a single request.
 *
 * @param {Array} pkgList List of packages with metadata
 */
export declare function getRubyGemsMetadata(pkgList: any[]): Promise<any[]>;
/**
 * Utility method to convert a gem package name to a CamelCased module name. Low accuracy.
 *
 * @param name Package name
 */
export declare function toGemModuleNames(name: any): string[];
/**
 * Collect all namespaces for a given gem present at the given gemHome
 *
 * @param {String} rubyCommand Ruby command to use if bundle is not available
 * @param {String} bundleCommand Bundle command to use
 * @param {String} gemHome Value to use as GEM_HOME env variable
 * @param {String} gemName Name of the gem
 * @param {String} filePath File path to the directory containing the Gemfile or .bundle directory
 *
 * @returns {Array<string>} List of module names
 */
export declare function collectGemModuleNames(rubyCommand: string, bundleCommand: string, gemHome: string, gemName: string, filePath: string): Array<string>;
/**
 * Method to parse Gemspec file contents
 *
 * @param {string} gemspecData Gemspec data
 * @param {string} gemspecFile File name for evidence.
 */
export declare function parseGemspecData(gemspecData: string, gemspecFile: string): Promise<any[]>;
/**
 * Method to parse Gemfile.lock
 *
 * @param {object} gemLockData Gemfile.lock data
 * @param {string} lockFile Lock file
 */
export declare function parseGemfileLockData(gemLockData: object, lockFile: string): Promise<any[] | {
    pkgList: any[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
    rootList: any[];
}>;
//# sourceMappingURL=rubyutils.d.ts.map