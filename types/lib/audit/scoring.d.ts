export declare const SEVERITY_ORDER: {
    none: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
};
/**
 * Convert a numeric confidence score into a human readable label.
 *
 * @param {number} confidence confidence score
 * @returns {string} confidence label
 */
export declare function confidenceLabel(confidence: number): string;
/**
 * Check if a severity meets the given threshold.
 *
 * @param {string} severity severity to compare
 * @param {string} threshold threshold severity
 * @returns {boolean} true if severity is at or above threshold
 */
export declare function severityMeetsThreshold(severity: string, threshold: string): boolean;
/**
 * Conservatively score predictive supply-chain risk for a single target.
 *
 * High and critical require corroboration across categories and strong findings,
 * which keeps false positives low.
 *
 * @param {object[]} findings post-generation audit findings
 * @param {object} target target metadata
 * @param {object} context additional scan context
 * @returns {object} conservative risk assessment
 */
export declare function scoreTargetRisk(findings: object[], target: object, context?: object): object;
//# sourceMappingURL=scoring.d.ts.map