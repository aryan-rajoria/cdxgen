export const CHROMIUM_EXTENSION_CAPABILITY_CATEGORIES: string[];
export function findJSImportsExports(src: any, deep: any): Promise<{
    allImports: {};
    allExports: {};
}>;
export function detectExtensionCapabilities(src: string, deep?: boolean): {
    capabilities: string[];
    indicators: {
        [x: string]: string[];
    };
};
//# sourceMappingURL=analyzer.d.ts.map