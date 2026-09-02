/**
 * Deferred `fail-on-error` exits for introspected runs.
 *
 * `--fail-on-error` promises an operator that a failing dependency extractor
 * never produces a plausible-but-incomplete BOM, so the extractors exit the
 * process the moment a build tool fails. Under `--introspect` that exit
 * destroys the very evidence the run exists to produce: the ledger events
 * recorded a statement earlier die with the process, `postProcess` never
 * runs, and neither the BOM nor the fidelity report is written.
 *
 * On an introspected run the extractor instead records the failure here and
 * throws {@link DeferredFailOnError}, which the extractor catches at its
 * completion point so it still returns everything it collected before the
 * failure — the incomplete-result fallbacks stay skipped, exactly as
 * `fail-on-error` demands. The CLI then writes the BOM and both reports and
 * exits with the dedicated {@link INTROSPECTION_FAILURE_EXIT_CODE} status, so
 * the exit code still claims "an extractor failed", distinct from the
 * fidelity gate's 4.
 *
 * Without introspection this module is a pass-through to `process.exit(1)`;
 * the default contract of the flag is unchanged.
 */
/**
 * Exit status used when an introspected run completes its outputs despite a
 * `--fail-on-error` extractor failure. Distinct from 1 (generic failure),
 * 3 (TEA publish failure) and 4 (the introspection fidelity gate).
 *
 * @type {number}
 */
export declare const INTROSPECTION_FAILURE_EXIT_CODE: number;
/**
 * Control-flow signal thrown by {@link deferFailOnError} on an introspected
 * run. The extractor that called it must let it unwind to its completion
 * point, keep everything it collected until then, and rethrow anything else.
 */
export declare class DeferredFailOnError extends Error {
    /**
     * @param {string} message Human-readable failure summary.
     */
    constructor(message: string);
}
/**
 * Test whether an error is the fail-on-error deferral signal.
 *
 * @param {unknown} err The caught error.
 * @returns {boolean} True when the error unwinds a deferred fail-on-error abort.
 */
export declare function isDeferredFailOnError(err: unknown): boolean;
/**
 * Snapshot of the deferred failures recorded by this run.
 *
 * @returns {Array<Object>} Frozen copies of the recorded failures.
 */
export declare function getDeferredFailures(): Array<Object>;
/**
 * Handle a failing extractor on behalf of a `options.failOnError &&
 * process.exit(1)` site. Without `fail-on-error` the run continues exactly
 * as it would have. With the flag and no introspection the process exits 1,
 * unchanged. On an introspected run the failure is recorded — including one
 * ledger observation on the ecosystem row the failure cost evidence — and
 * the deferral signal is thrown so the extractor stops where it is without
 * taking any incomplete-result fallback.
 *
 * @param {Object} options CLI options.
 * @param {Object} failure What failed, for the operator message and the report.
 * @param {string} failure.tool The build tool that failed.
 * @param {string} [failure.ecosystem] The ecosystem the tool serves, so the
 *   observation lands on the row whose evidence the failure cost.
 * @param {string} failure.detail One sentence, present tense.
 * @param {number} [failure.exitCode] The tool's exit status, when known.
 * @param {string} [failure.command] The redacted command that was attempted.
 * @param {string} [failure.outputExcerpt] The failed command's combined output,
 *   when the caller already holds it; the recorder bounds and redacts it.
 * @returns {void} Never returns on an introspected run; it throws.
 */
export declare function deferFailOnError(options: Object, failure: {
    tool: string;
    ecosystem?: string;
    detail: string;
    exitCode?: number;
    command?: string;
    outputExcerpt?: string;
}): void;
//# sourceMappingURL=deferredExit.d.ts.map