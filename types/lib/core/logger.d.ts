import { diagnosticStream } from "./syncFileWriter.js";
export { diagnosticStream };
/** True when thought/reasoning logging is enabled (CDXGEN_THOUGHT_LOG, CDXGEN_THINK_MODE, or verbose debug mode). */
export declare const THINK_MODE: any;
/** True when structured command/HTTP trace logging is enabled (CDXGEN_TRACE_LOG, CDXGEN_TRACE_ID, CDXGEN_TRACE_MODE, or verbose debug mode). */
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
 * Has no effect if THINK_MODE is not enabled, and emits the marker at most
 * once so an explicit call followed by the exit handler cannot produce two.
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
/**
 * Terminate the think block and close the log file descriptors.
 *
 * Readers tail these files as a live feed, so a run that ends without the
 * closing `</think>` marker leaves the consumer holding an unterminated block.
 * Registered on process exit and safe to call more than once.
 *
 * @returns {void}
 */
export declare function closeLogStreams(): void;
//# sourceMappingURL=logger.d.ts.map