/**
 * Parse a single GitHub Actions workflow file into workflow, component, and dependency data.
 *
 * @param {string} f Absolute path to a workflow YAML file
 * @param {Object} options CLI options
 * @returns {{ workflows: Object[], components: Object[], dependencies: Object[] }}
 */
export declare function parseWorkflowFile(f: string, options: Object): {
    workflows: Object[];
    components: Object[];
    dependencies: Object[];
};
/**
 * GitHub Actions formulation parser.
 *
 * Matches `.github/workflows/*.yml` and `*.yaml` files and converts them into
 * CycloneDX formulation workflow objects, with referenced actions as components.
 *
 * Parser contract: `parse(files, options)` returns
 * `{ workflows, components, services, properties, dependencies }`.
 */
export declare const githubActionsParser: {
    id: string;
    patterns: string[];
    /**
     * @param {string[]} files Matched workflow file paths
     * @param {Object} options CLI options
     * @returns {{ workflows: Object[], components: Object[], services: Object[], properties: Object[], dependencies: Object[] }}
     */
    parse(files: string[], options: Object): {
        workflows: Object[];
        components: Object[];
        services: Object[];
        properties: Object[];
        dependencies: Object[];
    };
};
//# sourceMappingURL=githubActions.d.ts.map