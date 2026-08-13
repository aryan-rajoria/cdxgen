/**
 * Method to collect crypto and ssl libraries from the OS.
 *
 * @param {Object} options
 * @returns osPkgsList Array of OS crypto packages
 */
export declare function collectOSCryptoLibs(options: Object, executeOsQueryFn: any): any[];
/**
 * Build cryptographic-asset components by running source-level JS crypto
 * detection over the given directory.
 *
 * @param {string} src Path to the source directory to scan.
 * @param {object} [options] Collection options forwarded to the detector and evidence normalizer.
 * @param {boolean} [options.deep] When true, perform a deep scan including nested directories.
 * @returns {Promise<Object[]>} Sorted array of cryptographic-asset component objects.
 */
export declare function collectSourceCryptoComponents(src: string, options?: {
    deep?: boolean;
}): Promise<Object[]>;
/**
 * Build cryptographic-asset components from dosai crypto analysis output,
 * mapping detected algorithms, operations, and key materials into CycloneDX
 * components.
 *
 * @param {string} src Path to the source directory used for evidence attribution.
 * @param {object} [options] Collection options forwarded to the analyzer and evidence normalizer.
 * @returns {Promise<Object[]>} Sorted array of cryptographic-asset component objects (empty when dosai produces no output).
 */
export declare function collectDosaiCryptoComponents(src: string, options?: object): Promise<Object[]>;
/**
 * Find crypto algorithm in the given code snippet
 *
 * @param {string} code Code snippet
 * @returns {Array} Arary of crypto algorithm objects with oid and description
 */
export declare function findCryptoAlgos(code: string): any[];
//# sourceMappingURL=cbomutils.d.ts.map