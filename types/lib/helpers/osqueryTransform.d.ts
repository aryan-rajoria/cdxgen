export declare function deriveOsQueryVersion(res: any): any;
export declare function deriveOsQueryName(res: any, singleResult: any, queryName: any): any;
export declare function deriveOsQueryPublisher(res: any): any;
export declare function deriveOsQueryDescription(res: any): any;
export declare function sanitizeOsQueryIdentity(value: any): string;
export declare function sanitizeOsQueryBomRefValue(value: any, fallback?: string): string;
export declare function createOsQueryFallbackBomRef(queryCategory: any, componentType: any, name: any, version: any, identityField: any, identityValue: any): string;
export declare function shouldCreateOsQueryPurl(componentType: any): boolean;
export declare function createOsQueryPurl(purlType: any, group: any, name: any, version: any, qualifiers: any, subpath: any): string;
//# sourceMappingURL=osqueryTransform.d.ts.map