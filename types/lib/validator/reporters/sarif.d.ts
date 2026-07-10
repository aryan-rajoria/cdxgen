/**
 * SARIF 2.1.0 reporter — renders findings as a SARIF log suitable for upload
 * to GitHub code scanning or any other SARIF-aware consumer.
 *
 * No external dependencies. Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 */
/**
 * Render a validation report as SARIF.
 *
 * @param {object} report Output of validateBomAdvanced().
 * @param {object} [options]
 * @param {string} [options.toolName]    Override driver name.
 * @param {string} [options.toolVersion] Driver version to embed.
 * @param {boolean} [options.includeManual] Include manual-review findings (default false).
 * @returns {string}
 */
export declare function render(report: object, options?: {
    toolName?: string;
    toolVersion?: string;
    includeManual?: boolean;
}): string;
//# sourceMappingURL=sarif.d.ts.map