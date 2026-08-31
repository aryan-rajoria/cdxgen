/**
 * Report emission for build introspection: resolving report destinations,
 * writing the markdown and JSON reports, and printing the console summary.
 *
 * This module is the only place in the introspection chain that touches the
 * filesystem or prints, which keeps every renderer above it pure and
 * testable against committed fixtures. All writes go through the safe
 * wrappers, and dry-run mode produces the report without writing anything.
 */

import { dirname } from "node:path";

import { isDryRun } from "../../../core/activity.js";
import {
  safeExistsSync,
  safeMkdirSync,
  safeWriteSync,
} from "../../../core/fs.js";
import { diagnosticStream } from "../../../core/syncFileWriter.js";
import {
  buildIntrospectionJson,
  renderIntrospectionConsole,
  renderIntrospectionMarkdown,
} from "./report.js";

/**
 * Report destination meaning "write this report to the diagnostic stream".
 *
 * @type {string}
 */
export const INTROSPECTION_STDERR_TARGET = "-";

/** Default markdown report name when the run has no output file (`--print`). */
const DEFAULT_REPORT_NAME = "cdxgen-introspection.md";
/** Default JSON report name when the run has no output file (`--print`). */
const DEFAULT_JSON_NAME = "cdxgen-introspection.json";

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
export function resolveIntrospectionReportPaths(options = {}) {
  const output =
    typeof options?.output === "string" &&
    options.output &&
    options.output !== INTROSPECTION_STDERR_TARGET
      ? options.output
      : undefined;
  const reportPath =
    options?.introspectReport ||
    (output ? `${output}.introspection.md` : DEFAULT_REPORT_NAME);
  const jsonPath =
    options?.introspectJson ||
    (output ? `${output}.introspection.json` : DEFAULT_JSON_NAME);
  return { reportPath, jsonPath };
}

/** Last summary printed in this process, so a repeated verdict stays quiet. */
let lastPrintedSummary;

/**
 * Serialize the JSON report the way it is written to disk: stable key order
 * comes from the renderer, two-space indentation from the document convention.
 *
 * @param {Object} report Report document from buildIntrospectionJson.
 * @returns {string} Serialized report.
 */
function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Write text to a path, creating the parent directory when needed.
 *
 * @param {string} filePath Destination path.
 * @param {string} content File content.
 * @returns {void}
 */
function writeReportFile(filePath, content) {
  const parentDir = dirname(filePath);
  if (parentDir && !safeExistsSync(parentDir)) {
    safeMkdirSync(parentDir, { recursive: true });
  }
  safeWriteSync(filePath, content);
}

/**
 * Deliver one report to its destination: the diagnostic stream for "-", the
 * named file otherwise. Returns the destination actually used so the console
 * summary names it.
 *
 * @param {string} target Requested destination.
 * @param {string} content Report text.
 * @returns {string} The destination the report reached.
 */
function deliverReport(target, content) {
  if (target === INTROSPECTION_STDERR_TARGET) {
    diagnosticStream.write(content);
    return target;
  }
  writeReportFile(target, content);
  return target;
}

/**
 * Mark every remediation in a scoring document blocked because a dry-run
 * records intent without executing anything: no fix the report proposes can
 * be applied by this run, so the loop must not try.
 *
 * @param {Object} scored Scoring document from scoreReflection, mutated in place.
 * @returns {void}
 */
export function blockRemediationsForDryRun(scored) {
  const remediations = Array.isArray(scored?.remediations)
    ? scored.remediations
    : [];
  for (const entry of remediations) {
    if (entry?.blocked === true) {
      continue;
    }
    entry.blocked = true;
    entry.blockedReason =
      "policy.dry-run: dry-run mode records intent without executing commands, so no fix can be applied by this run";
  }
}

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
export function emitIntrospectionReports(reflection, scored, options = {}) {
  const { reportPath, jsonPath } = resolveIntrospectionReportPaths(options);
  const markdown = renderIntrospectionMarkdown(reflection, scored, options);
  if (isDryRun) {
    diagnosticStream.write(`${markdown}\n`);
    return { reportTarget: undefined, jsonTarget: undefined, dryRun: true };
  }
  const reportTarget = deliverReport(reportPath, markdown);
  const jsonTarget = deliverReport(
    jsonPath,
    serializeReport(buildIntrospectionJson(reflection, scored, options)),
  );
  return { reportTarget, jsonTarget, dryRun: false };
}

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
export function printIntrospectionSummary(scored, delivery = {}) {
  const lines = [
    renderIntrospectionConsole(scored, {
      introspectReport: delivery.reportTarget,
      introspectJson: delivery.jsonTarget,
    }),
  ];
  if (delivery.dryRun) {
    lines.push(
      "Build introspection: dry-run mode produced the report above without writing any file\n",
    );
  }
  const summary = lines.join("");
  // Evidence collection re-enters postProcess with an enriched BOM, so a run
  // reflects more than once and the later verdict supersedes the earlier one.
  // The reports are rewritten each time; the summary is printed only when it
  // says something the reader has not already been told.
  if (summary === lastPrintedSummary) {
    return;
  }
  lastPrintedSummary = summary;
  diagnosticStream.write(summary);
}
