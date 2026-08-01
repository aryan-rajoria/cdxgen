/**
 * Discover AI agent instruction and skill files that can hide MCP/runtime
 * surfaces from package-only inventory.
 */
export declare const agentFormulationParser: {
    id: string;
    patterns: string[];
    parse(files: any, _options?: {}): {
        components: {
            "bom-ref": string;
            name: any;
            properties: {
                name: string;
                value: any;
            }[];
            type: string;
        }[];
        services: any[];
    };
};
//# sourceMappingURL=agentFormulationParser.d.ts.map