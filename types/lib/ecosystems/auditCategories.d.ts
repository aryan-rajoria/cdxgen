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
/**
 * Determine the default BOM audit categories for the current CLI invocation.
 *
 * OBOM-focused runs should default to the runtime-specific rule pack unless the
 * user explicitly requests other categories.
 *
 * @param {object} options CLI options
 * @param {string} [commandPath] Invoked command path or name
 * @returns {string | undefined} Default category string, if any
 */
export declare function getDefaultBomAuditCategories(options: object, commandPath?: string): string | undefined;
//# sourceMappingURL=auditCategories.d.ts.map