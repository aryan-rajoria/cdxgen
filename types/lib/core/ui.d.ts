/**
 * Live-region CLI UI controller.
 *
 * Layer 0: imports nothing outside `lib/core`. The mechanism is a single live
 * region: a block of lines rewritten in place by rewinding only by the previous
 * frame's height. The block never ends with a newline until `stop()`, so every
 * update is a single `write` and a crashed process can never leave a torn frame
 * on screen.
 *
 * The UX layer on top is the phase model: `ui.phase(label)` returns a handle
 * whose `detail`/`progress`/`succeed`/`fail`/`skip` calls drive the region. In
 * non-interactive mode the same calls emit at most one plain line per state
 * transition, so callers never branch on `ui.interactive`.
 */
/**
 * Resolve a capability snapshot for the live region. Re-runs cleanly when given
 * `overrides` (used by tests with a fake stream and a captive env object).
 *
 * `FORCE_COLOR` non-empty wins over `isatty()`; `TERM` in {dumb, unknown}
 * forces non-interactive; `NO_COLOR` non-empty disables color but not the live
 * region; `CDXGEN_NO_PROGRESS` and `CI=true` disable the live region. A worker
 * thread needs no special case: its stdio is a pipe, so `isTTY` is undefined.
 *
 * @param {object} [overrides] Overrides for stream, env, and resolved flags
 * @returns {{stream: object, interactive: boolean, color: boolean, unicode: boolean, glyphs: object, columns: () => number, rows: () => number}} Capability snapshot
 */
export declare function detectCapabilities(overrides?: object): {
    stream: object;
    interactive: boolean;
    color: boolean;
    unicode: boolean;
    glyphs: object;
    columns: () => number;
    rows: () => number;
};
/**
 * Create a live-region controller.
 *
 * @param {object} [options] Controller options
 * @param {object} [options.stream] Writable stream (default `process.stderr`)
 * @param {number|string} [options.level] Verbosity ladder 0..3
 * @param {("text"|"json")} [options.format] Log serialization format
 * @param {boolean} [options.noProgress] Force-disable the live region
 * @param {boolean} [options.color] Force color on or off
 * @param {boolean} [options.interactive] Force the live region on or off
 * @param {() => number} [options.now] Clock, injectable for tests
 * @returns {object} Controller
 */
export declare function createUi(options?: {
    stream?: object;
    level?: number | string;
    format?: ("text" | "json");
    noProgress?: boolean;
    color?: boolean;
    interactive?: boolean;
    now?: () => number;
}): object;
/**
 * Process-wide default live-region UI controller instance. Library code imports
 * this directly; the CLI reconfigures it once flags are parsed.
 *
 * @type {Object}
 */
export declare const ui: Object;
/**
 * Convenience facade exposing leveled log methods (`error`, `warn`, `info`,
 * `debug`) that delegate to the default controller instance.
 *
 * @type {Object}
 */
export declare const log: Object;
/**
 * Install a global `console` shim routing `log`/`info`/`warn`/`error`/`debug`/
 * `trace` through the controller. This converts every existing `console.*` call
 * site to land on the diagnostic stream above the live region without editing
 * any of them. Unknown members delegate to the real console.
 *
 * @param {object} [uiInstance] Controller to route through
 * @returns {() => void} Function that restores the original console
 */
export declare function installConsoleShim(uiInstance?: object): () => void;
/**
 * Restore the console captured by {@link installConsoleShim}. Safe to call when
 * no shim is installed.
 */
export declare function restoreConsole(): void;
//# sourceMappingURL=ui.d.ts.map