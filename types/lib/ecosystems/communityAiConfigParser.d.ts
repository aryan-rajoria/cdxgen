export declare const communityAiConfigParser: {
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
            version: string | undefined;
        }[];
        services: {
            "bom-ref": string;
            group: any;
            name: any;
            properties: {
                name: string;
                value: any;
            }[];
            version: string;
        }[];
    };
};
//# sourceMappingURL=communityAiConfigParser.d.ts.map