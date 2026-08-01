export declare function createOccurrenceEvidence(location: any, details?: {}): {
    location: string;
} | undefined;
export declare function parseOccurrenceEvidenceLocation(location: any, details?: {}): {
    location: string;
} | undefined;
export declare function formatOccurrenceEvidence(occurrence: any): any;
/**
 * Collect bom-refs from metadata.tools entries.
 *
 * @param {Object[]|Object} tools CycloneDX metadata.tools section
 * @param {Function} predicate Optional filter function
 * @returns {string[]} Unique tool bom-refs
 */
export declare function extractToolRefs(tools: Object[] | Object, predicate: Function): string[];
/**
 * Attach evidence.identity.tools references to the supplied subjects.
 *
 * @param {Object|Object[]} subjects Component or service objects
 * @param {string[]} toolRefs Tool bom-refs
 * @returns {Object|Object[]} The same mutated subject(s)
 */
export declare function attachIdentityTools(subjects: Object | Object[], toolRefs: string[]): Object | Object[];
export declare function addEvidenceForImports(pkgList: any, allImports: any, allExports: any, deep: any): Promise<any>;
/**
 * Method to find c/c++ modules by collecting usages with atom
 *
 * @param {string} src directory
 * @param {object} options Command line options
 * @param {array} osPkgsList Array of OS pacakges represented as components
 * @param {array} epkgList Existing packages list
 */
export declare function getCppModules(src: string, options: object, osPkgsList: array, epkgList: array): {
    parentComponent: Object | {
        name: any;
        version: any;
        description: any;
        license: any;
        purl: any;
        type: string;
        "bom-ref": string;
        group?: undefined;
    } | {
        purl?: undefined;
        description?: undefined;
        license?: undefined;
        "bom-ref"?: undefined;
        group: any;
        name: any;
        version: string;
        type: string;
    } | undefined;
    pkgList: any[];
    dependenciesList: {
        ref: any;
        dependsOn: any[];
    }[];
};
/**
 * Enrich .NET package components with occurrence evidence and imported module/method
 * information from a dosai dependency slices file.
 *
 * Builds a mapping of DLL filenames to purls using the `PackageFiles` property of each
 * package, then reads the slices file to add occurrence locations, imported modules,
 * called methods, and assembly version information where available.
 *
 * @param {Object[]} pkgList Array of .NET package component objects to enrich
 * @param {string} slicesFile Path to the dosai dependency slices JSON file
 * @returns {Object[]} The enriched package list (same array, mutated in place)
 */
export declare function addEvidenceForDotnet(pkgList: Object[], slicesFile: string): Object[];
/**
 * Convert OS query results
 *
 * @param {string} queryCategory Query category
 * @param {Object} queryObj Query Object from the queries.json configuration
 * @param {Array} results Query Results
 * @param {Boolean} enhance Optionally enhance results by invoking additional package manager commands
 */
export declare function convertOSQueryResults(queryCategory: string, queryObj: Object, results: any[], enhance?: boolean): {
    name: any;
    group: string;
    version: any;
    description: any;
    publisher: any;
    "bom-ref": string;
    scope: any;
    type: any;
}[];
//# sourceMappingURL=evidenceUtils.d.ts.map