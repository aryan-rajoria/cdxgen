export declare function isDosaiDotnetLanguage(language: any): boolean;
export declare function readDosaiJsonFile(jsonFile: any): any;
export declare function runDosaiCommand(command: any, src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiMethodsSlice(src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiDataFlowSlice(src: any, outputFile: any, options?: {}): boolean;
export declare function createDosaiCryptoAnalysis(src: any, outputFile: any, options?: {}): boolean;
export declare function analyzeDosaiCrypto(src: any, options?: {}): any;
/**
 * Persist the combined native dosai report to options.semanticsSlicesFile.
 *
 * Mirrors the rusi/golem persistence contract (analyzeRusiProject /
 * analyzeGolemProject on branch feat/rusi-persist-report): when a semantics-
 * slices path is provided, the FULL native report is written there and kept so
 * downstream tools (depscan) can consume the complete methods + data-flow
 * facts that cdxgen only projects a subset of into the SBOM evidence. dotnet
 * does not otherwise use the semantics slice (atom is never run for dotnet),
 * so the path is free to carry the combined dosai report. Returns the resolved
 * durable path when something was persisted, otherwise undefined.
 */
export declare function persistDosaiSemanticsReport(options: any, methodsSlice: any, dataFlowSlice: any): any;
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