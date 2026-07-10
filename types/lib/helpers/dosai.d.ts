export declare function isDosaiDotnetLanguage(language: any): boolean;
export declare function readDosaiJsonFile(jsonFile: any): any;
export declare function runDosaiCommand(command: any, src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiMethodsSlice(src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiDataFlowSlice(src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiCryptoAnalysis(src: any, outputFile: any, options?: {}): boolean;
export declare function analyzeDosaiCrypto(src: any, options?: {}): any;
export declare function buildPurlAliasMap(components?: any[]): Map<any, any>;
export declare function resolveComponentPurl(purl: any, purlAliasMap: any): any;
export declare function collectDosaiPurlEvidence(methodsSlice: any, components?: any[]): {
    purlLocationMap: {};
    purlModulesMap: {};
    purlMethodsMap: {};
};
export declare function collectDosaiDataFlowFrames(dataFlowResult: any, components?: any[]): {};
export declare function collectDosaiServicesFromMethods(methodsSlice: any, servicesMap?: {}): {};
export declare function normalizeDosaiServiceMap(servicesMap?: {}): {
    name: string;
    endpoints: any[];
    authenticated: any;
    "x-trust-boundary": any;
    properties: any;
}[];
//# sourceMappingURL=dosai.d.ts.map