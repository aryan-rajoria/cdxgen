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

import {
  isIntrospectionEnabled,
  LEDGER_EVENT_KINDS,
  recordLedgerEvent,
} from "./buildLedger.js";
import { thoughtLog } from "./logger.js";

/**
 * Exit status used when an introspected run completes its outputs despite a
 * `--fail-on-error` extractor failure. Distinct from 1 (generic failure),
 * 3 (TEA publish failure) and 4 (the introspection fidelity gate).
 *
 * @type {number}
 */
export const INTROSPECTION_FAILURE_EXIT_CODE = 5;

/**
 * Control-flow signal thrown by {@link deferFailOnError} on an introspected
 * run. The extractor that called it must let it unwind to its completion
 * point, keep everything it collected until then, and rethrow anything else.
 */
export class DeferredFailOnError extends Error {
  /**
   * @param {string} message Human-readable failure summary.
   */
  constructor(message) {
    super(message);
    this.name = "DeferredFailOnError";
  }
}

/**
 * The extractor failures deferred so far. Populated only on introspected
 * runs; the CLI reads it after the BOM and the reports are written to decide
 * the process exit status.
 *
 * @type {Array<{ecosystem: string, tool: string, detail: string, exitCode: number|undefined, command: string|undefined}>}
 */
const deferredFailures = [];

/**
 * Test whether an error is the fail-on-error deferral signal.
 *
 * @param {unknown} err The caught error.
 * @returns {boolean} True when the error unwinds a deferred fail-on-error abort.
 */
export function isDeferredFailOnError(err) {
  return err instanceof DeferredFailOnError;
}

/**
 * Snapshot of the deferred failures recorded by this run.
 *
 * @returns {Array<Object>} Frozen copies of the recorded failures.
 */
export function getDeferredFailures() {
  return deferredFailures.map((failure) => Object.freeze({ ...failure }));
}

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
 * @returns {void} Never returns on an introspected run; it throws.
 */
export function deferFailOnError(options, failure) {
  if (!options?.failOnError) {
    return;
  }
  const entry = {
    ecosystem: failure?.ecosystem || "cdxgen",
    tool: failure?.tool || "unknown",
    detail: failure?.detail || "the extractor reported a failure",
    exitCode:
      typeof failure?.exitCode === "number" ? failure.exitCode : undefined,
    command: failure?.command,
  };
  if (!isIntrospectionEnabled(options)) {
    process.exit(1);
    // Unreachable in a real run; the explicit return keeps the deferral from
    // continuing wherever process.exit is instrumented rather than fatal.
    return;
  }
  deferredFailures.push(entry);
  thoughtLog(
    `Deferring the fail-on-error exit for ${entry.tool} so the introspection verdict can be produced: ${entry.detail}`,
  );
  // A `command.failed` observation on the row the failure cost evidence: it
  // carries no remediationId, so it reports the deferral without competing
  // with the degradation the extractor recorded for the same failure, and it
  // never trips the truncation marker, which keys on `evidence.degraded`
  // under the reserved recorder ecosystem.
  recordLedgerEvent(LEDGER_EVENT_KINDS.COMMAND_FAILED, {
    ecosystem: entry.ecosystem,
    tool: entry.tool,
    exitCode: entry.exitCode,
    command: entry.command,
    detail: `fail-on-error was deferred so the BOM and the report could be written: ${entry.detail}`,
  });
  throw new DeferredFailOnError(`${entry.tool}: ${entry.detail}`);
}
