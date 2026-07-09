export declare const THINK_MODE: any;
export declare const TRACE_MODE: any;
/**
 * Logs a thought message to the think logger if THINK_MODE is enabled.
 * Automatically appends a period to the message if it lacks terminal punctuation.
 *
 * @param {string} s The thought message to log
 * @param {Object} [args] Optional additional arguments to log alongside the message
 * @returns {void}
 */
export declare function thoughtLog(s: string, args?: Object): void;
/**
 * Closes the think log group by emitting the closing `</think>` marker.
 * Has no effect if THINK_MODE is not enabled.
 *
 * @returns {void}
 */
export declare function thoughtEnd(): void;
/**
 * Log trace messages
 *
 * @param {String} traceType Trace type
 * @param {Object} args Additional arguments
 */
export declare function traceLog(traceType: string, args: Object): void;
//# sourceMappingURL=logger.d.ts.map