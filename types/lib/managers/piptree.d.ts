/**
 * Execute the piptree plugin and return the generated tree as json object.
 * The resulting tree would also include dependencies belonging to pip.
 * Usage analysis is performed at a later stage to mark many of these packages as optional.
 *
 * @param {Object} env Environment variables to use
 * @param {String} python_cmd Python command to use
 * @param {String} basePath Current working directory
 *
 * @returns {Object} Dependency tree
 */
export declare const getTreeWithPlugin: (env: Object, python_cmd: string, basePath: string) => Object;
//# sourceMappingURL=piptree.d.ts.map