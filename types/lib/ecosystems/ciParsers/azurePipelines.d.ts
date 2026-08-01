/**
 * Azure Pipelines formulation parser.
 *
 * Matches `azure-pipelines.yml`, `azure-pipelines.yaml`, and
 * `.azure-pipelines/*.yml` files and converts them into CycloneDX formulation
 * workflow objects.
 *
 * Parser contract: `parse(files, options)` returns
 * `{ workflows, components, services, properties, dependencies }`.
 */
export declare const azurePipelinesParser: {
    id: string;
    patterns: string[];
    /**
     * @param {string[]} files Matched pipeline file paths
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
//# sourceMappingURL=azurePipelines.d.ts.map