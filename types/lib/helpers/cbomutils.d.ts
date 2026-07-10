/**
 * Method to collect crypto and ssl libraries from the OS.
 *
 * @param {Object} options
 * @returns osPkgsList Array of OS crypto packages
 */
export declare function collectOSCryptoLibs(options: Object): any[];
export declare function collectSourceCryptoComponents(src: any, options?: {}): Promise<any[]>;
export declare function collectDosaiCryptoComponents(src: any, options?: {}): Promise<any[]>;
/**
 * Find crypto algorithm in the given code snippet
 *
 * @param {string} code Code snippet
 * @returns {Array} Arary of crypto algorithm objects with oid and description
 */
export declare function findCryptoAlgos(code: string): any[];
//# sourceMappingURL=cbomutils.d.ts.map