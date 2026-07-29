export declare let metadata_cache: {};
/**
 * Internal helper to reset metadata_cache. Used by parseGoModData (still in
 * utils.js until batch 6) because ESM forbids reassigning an imported binding.
 * NOT re-exported through the utils.js barrel.
 */
export declare function _clearMetadataCache(): void;
/**
 * Fetches license information for a list of Swift packages by querying the
 * GitHub repository license API for packages hosted on github.com.
 *
 * @param {Object[]} pkgList List of Swift package objects with optional repository.url fields
 * @returns {Promise<Object[]>} Resolved list of package objects, each augmented with a license field where available
 */
export declare function getSwiftPackageMetadata(pkgList: Object[]): Promise<Object[]>;
/**
 * Method to retrieve metadata for npm packages by querying npmjs
 *
 * @param {Array} pkgList Package list
 */
export declare function getNpmMetadata(pkgList: any[], registryUrl: any): Promise<any[]>;
/**
 * Method to locate local Gradle, Maven, or Coursier cache files for a given maven coordinate.
 *
 * @param {string} group Maven groupId
 * @param {string} name Maven artifactId
 * @param {string} version Package version
 * @returns {Object|null} Object containing jarPath, sha1, and pomPath, or null
 */
export declare function findLocalMvnArtifact(group: string, name: string, version: string): Object | null;
/**
 * Method to retrieve metadata for maven packages by querying maven central
 *
 * @param {Array} pkgList Package list
 * @param {Object} jarNSMapping Jar Namespace mapping object
 * @param {Boolean} force Force fetching of license
 *
 * @returns {Array} Updated package list
 */
export declare function getMvnMetadata(pkgList: any[], jarNSMapping?: Object, force?: boolean): any[];
/**
 * Method to compose URL of pom.xml
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {String} fullUrl
 */
export declare function composePomXmlUrl({ urlPrefix, group, name, version }: string): string;
/**
 * Method to fetch pom.xml data and parse it to JSON
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Object|undefined}
 */
export declare function fetchPomXmlAsJson({ urlPrefix, group, name, version }: string): Object | undefined;
/**
 * Method to fetch pom.xml data
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Promise<String>}
 */
export declare function fetchPomXml({ urlPrefix, group, name, version }: string): Promise<string>;
/**
 * Method extract single or multiple license entries that might appear in pom.xml
 *
 * @param {Object|Array} license
 */
export declare function parseLicenseEntryOrArrayFromPomXml(license: Object | any[]): any[] | undefined;
/**
 * Method to parse pom.xml in search of a comment containing license text
 *
 * @param {String} urlPrefix
 * @param {String} group
 * @param {String} name
 * @param {String} version
 *
 * @return {Promise<String>} License ID
 */
export declare function extractLicenseCommentFromPomXml({ urlPrefix, group, name, version, }: string): Promise<string>;
/**
 * Method to mimic pip version solver using node-semver
 *
 * @param {Array} versionsList List of version numbers available
 * @param {*} versionSpecifiers pip version specifier
 */
export declare function guessPypiMatchingVersion(versionsList: any[], versionSpecifiers: any): any;
/**
 * Method to retrieve metadata for python packages by querying pypi
 *
 * @param {Array} pkgList Package list
 * @param {Boolean} fetchDepsInfo Fetch dependencies info from pypi
 */
export declare function getPyMetadata(pkgList: any[], fetchDepsInfo: boolean): Promise<any[]>;
/**
 * Method to parse bdist_wheel metadata (dist-info/METADATA)
 *
 * @param {string} mDataFile bdist_wheel metadata file
 * @param {string} rawMetadata Raw metadata
 *
 */
export declare function parseBdistMetadata(mDataFile: string, rawMetadata?: string): {
    name: string;
    version: string;
    description: string;
    author: string;
    licenses: never[];
    externalReferences: never[];
    properties: never[];
}[];
export declare function createExternalReferenceKey(reference: any): string;
export declare function mergeExternalReferences(component: any, references: any): void;
/**
 * Method to construct a GitHub API url for the given repo metadata
 * @param {Object} repoMetadata Repo metadata with group and name
 * @return {String|undefined} github api url (or undefined - if not enough data)
 */
export declare function repoMetadataToGitHubApiUrl(repoMetadata: Object): string | undefined;
/**
 * Method to split GitHub url into its parts
 * @param {String} repoUrl Repository url
 * @return {[String]} parts from url
 */
export declare function getGithubUrlParts(repoUrl: string): [string];
/**
 * Method to construct GitHub api url from repo metadata or one of multiple formats of repo URLs
 * @param {String} repoUrl Repository url
 * @param {Object} repoMetadata Object containing group and package name strings
 * @return {String|undefined} github api url (or undefined - if not a GitHub repo)
 */
export declare function toGitHubApiUrl(repoUrl: string, repoMetadata: Object): string | undefined;
/**
 * Method to retrieve repo license by querying github api
 *
 * @param {String} repoUrl Repository url
 * @param {Object} repoMetadata Object containing group and package name strings
 * @return {Promise<String>} SPDX license id
 */
export declare function getRepoLicense(repoUrl: string, repoMetadata: Object): Promise<string>;
/**
 * Method to get go pkg license from go.dev site.
 *
 * @param {Object} repoMetadata Repo metadata
 */
export declare function getGoPkgLicense(repoMetadata: Object): Promise<any>;
/**
 * Method to get go pkg vcs url from go.dev site.
 *
 * @param {String} group Package group
 * @param {String} name Package name
 */
export declare function getGoPkgVCSUrl(group: string, name: string): Promise<any>;
/**
 * Method to retrieve metadata for rust packages by querying crates
 *
 * @param {Array} pkgList Package list
 */
export declare function getCratesMetadata(pkgList: any[]): Promise<any[]>;
/**
 * Method to retrieve metadata for dart packages by querying pub.dev
 *
 * @param {Array} pkgList Package list
 */
export declare function getDartMetadata(pkgList: any[]): Promise<any[]>;
export declare function normalizeCargoIntegrity(integrity: any): string | undefined;
/**
 * Method to extract a war or ear file
 *
 * @param {string} jarFile Path to jar file
 * @param {string} tempDir Temporary directory to use for extraction
 * @param {object} jarNSMapping Jar class names mapping object
 *
 * @return pkgList Package list
 */
export declare function extractJarArchive(jarFile: string, tempDir: string, jarNSMapping?: object): Promise<any[]>;
/**
 * Method to retrieve metadata for nuget packages
 *
 * @param {Array} pkgList Package list
 * @param {Array} dependencies Dependencies
 */
export declare function getNugetMetadata(pkgList: any[], dependencies?: any[]): Promise<{
    pkgList: any[];
    dependencies: any[];
}>;
//# sourceMappingURL=ecosystems.d.ts.map