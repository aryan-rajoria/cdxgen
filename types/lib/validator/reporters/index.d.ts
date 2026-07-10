/**
 * Reporter registry — dispatches to the requested reporter.
 *
 * Reporters are intentionally kept as independent modules so they can also be
 * consumed by the BOM audit engine or future validators.
 */
import * as annotations from "./annotations.js";
import * as consoleReporter from "./console.js";
import * as json from "./json.js";
import * as sarif from "./sarif.js";
/**
 * Map of reporter name → module.
 */
export declare const reporters: {
    console: typeof consoleReporter;
    json: typeof json;
    sarif: typeof sarif;
    annotations: typeof annotations;
};
/**
 * Render a validation report using the named reporter.
 *
 * @param {string} name   Reporter identifier.
 * @param {object} report Output of validateBomAdvanced().
 * @param {object} [opts] Reporter-specific options.
 * @returns {string}
 */
export declare function render(name: string, report: object, opts?: object): string;
export { annotations, consoleReporter as console, json, sarif };
//# sourceMappingURL=index.d.ts.map