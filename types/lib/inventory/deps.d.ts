/**
 * Collect maven dependencies
 *
 * @param {string} mavenCmd Maven command to use
 * @param {string} basePath Path to the maven project
 * @param {boolean} cleanup Remove temporary directories
 * @param {boolean} includeCacheDir Include maven and gradle cache directories
 */
export declare function collectMvnDependencies(mavenCmd: string, basePath: string, cleanup?: boolean, includeCacheDir?: boolean): Promise<{}>;
/**
 * Method to collect class names from all jars in a directory
 *
 * @param {string} jarPath Path containing jars
 * @param {object} pomPathMap Map containing jar to pom names. Required to successfully parse gradle cache.
 *
 * @return object containing jar name and class list
 */
export declare function collectJarNS(jarPath: string, pomPathMap?: object): Promise<{}>;
/**
 * Convert a JAR namespace mapping (produced by {@link collectJarNS}) into an array
 * of CycloneDX package component objects.
 *
 * Each entry in the mapping is resolved to a component with name, group, version,
 * purl, hashes, namespace properties, and source file evidence.
 *
 * @param {Object} jarNSMapping Map of purl string to `{ jarFile, pom, namespaces, hashes }`
 * @returns {Promise<Object[]>} Array of component objects derived from the JAR mapping
 */
export declare function convertJarNSToPackages(jarNSMapping: Object): Promise<Object[]>;
/**
 * Deprecated function to parse pom.xml. Use parsePom instead.
 *
 * @deprecated
 * @param pomXmlData XML contents
 * @returns {Object} Parent component data
 */
export declare function parsePomXml(pomXmlData: any): Object;
/**
 * Parse a JAR MANIFEST.MF file and return its key-value pairs as an object.
 *
 * @param {string} jarMetadata Raw text contents of a MANIFEST.MF file
 * @returns {Object} Key-value pairs extracted from the manifest
 */
export declare function parseJarManifest(jarMetadata: string): Object;
/**
 * Select the most reliable group candidate from JAR manifest metadata.
 *
 * @param {Object} jarMetadata Parsed MANIFEST.MF key-value map
 * @returns {string} Best group candidate, or empty string if none exists
 */
export declare function inferJarGroupFromManifest(jarMetadata?: Object): string;
/**
 * Trim group suffix that duplicates the artifact name for compound artifact names.
 *
 * @param {string} group Group candidate
 * @param {string} name Artifact name candidate
 * @returns {string} Adjusted group
 */
export declare function trimJarGroupSuffix(group: string, name: string): string;
/**
 * Parse a Maven pom.properties file and return its key-value pairs as an object.
 *
 * @param {string} pomProperties Raw text contents of a pom.properties file
 * @returns {Object} Key-value pairs extracted from the properties file
 */
export declare function parsePomProperties(pomProperties: string): Object;
/**
 * Method to get pom properties from maven directory
 *
 * @param {string} mavenDir Path to maven directory
 *
 * @return array with pom properties
 */
export declare function getPomPropertiesFromMavenDir(mavenDir: string): {};
/**
 * Method to read a single file entry from a zip file
 *
 * @param {string} zipFile Zip file to read
 * @param {string} filePattern File pattern
 * @param {string} contentEncoding Encoding. Defaults to utf-8
 *
 * @returns {Promise<string|undefined>} File contents
 */
export declare function readZipEntry(zipFile: string, filePattern: string, contentEncoding?: string): Promise<string | undefined>;
/**
 * Method to get the classes and relevant sources in a jar file
 *
 * @param {string} jarFile Jar file to read
 *
 * @returns List of classes and sources matching certain known patterns
 */
export declare function getJarClasses(jarFile: string): Promise<any>;
export declare function flattenDeps(dependenciesMap: any, pkgList: any, reqOrSetupFile: any, t: any): void;
/**
 * Comparator function for sorting CycloneDX component objects.
 *
 * Compares components by `bom-ref`, then `purl`, then `name`, using locale-aware
 * string comparison on the first available key.
 *
 * @param {Object|string} a First component to compare
 * @param {Object|string} b Second component to compare
 * @returns {number} Negative, zero, or positive integer as required by Array.sort
 */
export declare function componentSorter(a: Object | string, b: Object | string): number;
//# sourceMappingURL=deps.d.ts.map