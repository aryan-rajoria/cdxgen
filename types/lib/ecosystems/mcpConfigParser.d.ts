export declare const mcpConfigParser: {
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
        services: {
            "bom-ref": string;
            authenticated: boolean | undefined;
            endpoints: string[];
            group: string;
            name: any;
            properties: {
                name: string;
                value: any;
            }[];
            version: string;
        }[];
    };
};
//# sourceMappingURL=mcpConfigParser.d.ts.map