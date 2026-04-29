export namespace rustFormulationParser {
    let id: string;
    let patterns: string[];
    function parse(files: any): {
        components: {
            type: string;
            name: any;
            version: string;
            "bom-ref": string;
            properties: {
                name: string;
                value: any;
            }[];
        }[];
    };
}
//# sourceMappingURL=rustFormulationParser.d.ts.map