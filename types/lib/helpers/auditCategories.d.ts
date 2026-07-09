export declare const HBOM_AUDIT_CATEGORIES: readonly string[];
export declare const CBOM_AUDIT_CATEGORIES: readonly string[];
export declare const HOST_TOPOLOGY_AUDIT_CATEGORIES: readonly string[];
export declare const GOLEM_AUDIT_CATEGORIES: readonly string[];
export declare const AI_BOM_AUDIT_CATEGORIES: readonly string[];
export declare const DEFAULT_HBOM_AUDIT_CATEGORIES: string;
export declare const BOM_AUDIT_CATEGORY_ALIASES: Readonly<{
    "ai-inventory": string[];
    aibom: string[];
    "ai-bom": string[];
    "ai-provenance": string[];
    "ai-oversight": string[];
    cbom: string[];
    "crypto-bom": string[];
    golem: string[];
    hbom: string[];
    host: string[];
}>;
export declare function normalizeBomAuditCategories(categories: any): any[];
export declare function expandBomAuditCategories(categories: any): any[];
export declare function availableBomAuditCategories(rules: any): any[];
export declare function validateBomAuditCategories(categories: any, rules: any): {
    categories: any[];
    expandedCategories: any[];
    validCategories: any[];
};
//# sourceMappingURL=auditCategories.d.ts.map