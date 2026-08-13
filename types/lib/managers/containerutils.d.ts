/**
 * Method to get all dirs matching a name
 *
 * @param {string} dirPath Root directory for search
 * @param {string} dirName Directory name
 * @param {boolean} hidden Include hidden directories and files. Default: false
 * @param {boolean} recurse Recurse. Default: false
 */
export declare const getDirs: (dirPath: string, dirName: string, hidden?: boolean, recurse?: boolean) => string[];
export declare const getOnlyDirs: (srcpath: any, dirName: any) => any;
/**
 * Walk a directory tree once and collect all subdirectories whose basename
 * matches any of the target names. Returns a map from name to array of paths.
 *
 * Replaces multiple {@link getOnlyDirs} calls that each walk the same tree.
 *
 * @param {string} srcpath Root directory for search
 * @param {string[]} dirNames Target directory names to collect
 * @returns {Record<string, string[]>} Map of dirName to matching paths
 */
export declare const getOnlyDirsMulti: (srcpath: string, dirNames: string[]) => Record<string, string[]>;
//# sourceMappingURL=containerutils.d.ts.map