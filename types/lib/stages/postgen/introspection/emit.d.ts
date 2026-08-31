/**
 * Report emission for build introspection: resolving report destinations,
 * writing the markdown and JSON reports, and printing the console summary.
 *
 * This module is the only place in the introspection chain that touches the
 * filesystem or prints, which keeps every renderer above it pure and
 * testable against committed fixtures. All writes go through the safe
 * wrappers, and dry-run mode produces the report without writing anything.
 */
/**
 * Report destination meaning "write this report to the diagnostic stream".
 *
 * @type {string}
 */
export declare const INTROSPECTION_STDERR_TARGET: string;
/**
 * Resolve the report destinations for a run. A user-provided path wins; the
 * defaults are derived from the BOM output path so the reports travel with
 * the BOM, falling back to the working directory when the BOM goes to stdout.
 *
 * @param {Object} [options] CLI options.
 * @param {string} [options.output] Path the BOM is written to, or "-" for stdout.
 * @param {string} [options.introspectReport] Requested markdown report path.
 * @param {string} [options.introspectJson] Requested JSON report path.
 * @returns {{reportPath: string, jsonPath: string}} Resolved destinations; "-" means the diagnostic stream.
 */
export declare function resolveIntrospectionReportPaths(options?: {
    output?: string;
    introspectReport?: string;
    introspectJson?: string;
}): {
    reportPath: string;
    jsonPath: string;
};
/**
 * Mark every remediation in a scoring document blocked because a dry-run
 * records intent without executing anything: no fix the report proposes can
 * be applied by this run, so the loop must not try.
 *
 * @param {Object} scored Scoring document from scoreReflection, mutated in place.
 * @returns {void}
 */
export declare function blockRemediationsForDryRun(scored: Object): void;
/**
 * Write the markdown and JSON reports for a completed reflection and return
 * the destinations they reached. Dry-run mode prints the markdown report to
 * the diagnostic stream instead of creating files, matching the read-only
 * contract of the mode.
 *
 * @param {Object} reflection Reflection document from reflectOnRun.
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [options] CLI options naming the report destinations.
 * @returns {{reportTarget: string|undefined, jsonTarget: string|undefined, dryRun: boolean}} Destinations reached; undefined means the report was not produced as a file.
 */
export declare function emitIntrospectionReports(reflection: Object, scored: Object, options?: Object): {
    reportTarget: string | undefined;
    jsonTarget: string | undefined;
    dryRun: boolean;
};
/**
 * Print the console summary for a completed introspection. Called after the
 * reports are delivered, so every path it names exists (or is the explicit
 * stream marker). Diagnostics go to the diagnostic stream so a piped stdout
 * never carries anything but the BOM payload.
 *
 * @param {Object} scored Scoring document from scoreReflection.
 * @param {Object} [delivery] Destinations returned by emitIntrospectionReports.
 * @returns {void}
 */
export declare function printIntrospectionSummary(scored: Object, delivery?: Object): void;
//# sourceMappingURL=emit.d.ts.map