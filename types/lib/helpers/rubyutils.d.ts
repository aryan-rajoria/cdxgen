/**
 * Is the given string a `Gem::Platform` such as `x86_64-linux` or `java`?
 * The cpu component is an open token in RubyGems, so we validate by looking
 * for a known os name in any position.
 *
 * @param {string} value Candidate platform string
 * @returns {boolean} true if the value looks like a gem platform
 */
export declare function isRubyPlatform(value: string): boolean;
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
 * Method to query rubygems api for gems details
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