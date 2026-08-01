/**
 * Safely check if a file path exists without crashing due to a lack of permissions
 *
 * @param {String} filePath File path
 * @Boolean True if the path exists. False otherwise
 */
export declare function safeExistsSync(filePath: string): any;
export declare function safeWriteSync(filePath: any, data: any, options: any): undefined;
/**
 * Safely create a directory without crashing due to a lack of permissions
 *
 * @param {String} filePath File path
 * @param options {Options} mkdir options
 * @Boolean True if the path exists. False otherwise
 */
export declare function safeMkdirSync(filePath: string, options: Options): undefined;
export declare function safeMkdtempSync(prefix: any, options?: undefined): any;
export declare function safeRmSync(filePath: any, options?: undefined): undefined;
export declare function safeUnlinkSync(filePath: any): undefined;
export declare function safeCopyFileSync(src: any, dest: any, mode?: undefined): any;
export declare function safeExtractArchive(sourcePath: any, targetPath: any, extractor: any, kind?: string, options?: undefined): Promise<boolean>;
export declare const temporaryFiles: Set<any>;
export declare const commandsExecuted: Set<any>;
/**
 * Safe wrapper around spawnSync that enforces permission checks, injects default
 * options (maxBuffer, encoding, timeout), warns about unsafe Python and pip/uv
 * invocations, and records every executed command in the commandsExecuted set.
 *
 * @param {string} command The executable to spawn
 * @param {string[]} args Arguments to pass to the command
 * @param {Object} options Options forwarded to spawnSync (e.g. cwd, env, shell)
 * @returns {Object} spawnSync result object with status, stdout, stderr, and error fields
 */
export declare function safeSpawnSync(command: string, args: string[], options: Object): Object;
export declare const TIMEOUT_MS: number;
export declare const MAX_BUFFER: number;
/**
 * Method to get files matching a pattern
 *
 * @param {string} dirPath Root directory for search
 * @param {string} pattern Glob pattern (eg: *.gradle)
 * @param {Object} options CLI options
 *
 * @returns {Array[string]} List of matched files
 */
export declare function getAllFiles(dirPath: string, pattern: string, options?: Object): any;
/**
 * Method to get files matching a pattern
 *
 * @param {string} dirPath Root directory for search
 * @param {string} pattern Glob pattern (eg: *.gradle)
 * @param {Boolean} includeDot whether hidden files can be included.
 * @param {Array} ignoreList Directory patterns to ignore
 *
 * @returns {Array[string]} List of matched files
 */
export declare function getAllFilesWithIgnore(dirPath: string, pattern: string, includeDot: boolean, ignoreList: any[]): any;
/**
 * Return the current timestamp in YYYY-MM-DDTHH:MM:SSZ format.
 *
 * @returns {string} ISO formatted timestamp, without milliseconds.
 */
export declare function getTimestamp(): string;
export declare function getTmpDir(): any;
/**
 * Computes the checksum for a file path using the given hash algorithm
 *
 * @param {string} hashName name of hash algorithm
 * @param {string} path path to file
 * @returns {Promise<String>} hex value of hash
 */
export declare function checksumFile(hashName: string, path: string): Promise<string>;
/**
 * Computes multiple checksum for a file path using the given hash algorithms
 *
 * @param {Array[String]} algorithms Array of algorithms
 * @param {string} path path to file
 * @returns {Promise<Object>} hashes object
 */
export declare function multiChecksumFile(algorithms: any, path: string): Promise<Object>;
//# sourceMappingURL=fs.d.ts.map