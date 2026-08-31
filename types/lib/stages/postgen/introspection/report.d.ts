/**
 * Renderers over a completed reflection document and its scoring document.
 *
 * Every function here is pure: the reflection and scoring documents are the
 * only evidence inputs, nothing reads the filesystem, the ledger, or the BOM
 * again, and nothing writes a file. The caller owns serialization and printing,
 * which is what makes these renderable against a committed fixture without a
 * temporary directory.
 *
 * The markdown report is written for a human reading it in a terminal pager, a
 * CI log, or a pull-request comment: plain GitHub-flavoured markdown, no HTML,
 * no emoji, and a verdict line that carries the right impression on its own.
 * The JSON report is written for the remediation loop: a versioned contract
 * with stable key order and no content that churns between identical runs, so
 * an agent can diff consecutive reports to detect progress. Free text is
 * redacted again here even though the ledger already sanitized it, because
 * this report is the artifact most likely to be pasted into a chat window.
 */
/**
 * Version of the JSON report contract. Additive fields bump the minor version;
 * removals or semantic changes bump the major version.
 *
 * @type {string}
 */
export declare const INTROSPECTION_REPORT_SCHEMA_VERSION: string;
/**
 * Derive the overall tier and confidence labels from the scored rows.
 *
 * The scoring document publishes a number only. Both labels the reports
 * publish are the *worst* among the scored rows: one unhealthy ecosystem must
 * not disappear behind a healthy average, and no report may claim more
 * confidence than its least-corroborated row. A reflection with no scored
 * rows carries no verdict at all, so both labels are null.
 *
 * @param {Object} scored Scoring document from scoreReflection.
 * @returns {{tier: string|null, confidence: string|null}} Worst tier and confidence among the scored rows.
 */
export declare function overallAssessment(scored: Object): {
    tier: string | null;
    confidence: string | null;
};
/**
 * Build the JSON report document, the remediation loop's contract.
 *
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [options] CLI options that name the run's outputs.
 * @param {string} [options.output] Path the BOM was written to.
 * @param {number} [options.introspectFailBelow] CI gate threshold, when configured.
 * @returns {Object} The report document; serializing it is the caller's job.
 */
export declare function buildIntrospectionJson(reflection: Object, scored: Object, options?: {
    output?: string;
    introspectFailBelow?: number;
}): Object;
/**
 * Render the markdown report.
 *
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [options] CLI options that name the run's outputs.
 * @param {string} [options.output] Path the BOM was written to.
 * @param {boolean} [options.installDeps] Whether the run installs dependencies.
 * @returns {string} The complete markdown report.
 */
export declare function renderIntrospectionMarkdown(reflection: Object, scored: Object, options?: {
    output?: string;
    installDeps?: boolean;
}): string;
/**
 * Render the console summary: a handful of diagnostic lines carrying the
 * verdict, the remediation counts, and the paths the reports were written
 * to. The full report never goes to the console.
 *
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [options] CLI options naming the report outputs.
 * @param {string} [options.introspectReport] Path of the markdown report.
 * @param {string} [options.introspectJson] Path of the JSON report.
 * @returns {string} Newline-terminated lines for the diagnostic stream.
 */
export declare function renderIntrospectionConsole(scored: Object, options?: {
    introspectReport?: string;
    introspectJson?: string;
}): string;
//# sourceMappingURL=report.d.ts.map