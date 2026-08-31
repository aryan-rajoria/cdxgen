import { Writable } from "node:stream";
/**
 * The stream every human-readable diagnostic is written to.
 *
 * Also the fallback destination of {@link openSyncFileWriter} when a log path
 * cannot be opened, so an unwritable path keeps the records visible somewhere
 * instead of taking the run down.
 *
 * @type {NodeJS.WritableStream}
 */
export declare const diagnosticStream: NodeJS.WritableStream;
/**
 * Open a synchronous writer for a log file path, or return the writer already
 * open for that path.
 *
 * `Console` requires a real stream, so this is a `Writable` whose `_write`
 * completes synchronously: bytes reach the descriptor as each record is
 * written, and nothing is left queued for an event loop turn that a process
 * exit may never take.
 *
 * @param {string} filePath Destination path
 * @param {NodeJS.WritableStream|null} [fallbackStream] Stream returned when the path cannot be opened; defaults to the diagnostic stream. Pass `null` to get `undefined` instead, for callers that must never let data records spill into a diagnostic stream.
 * @returns {Writable|NodeJS.WritableStream|undefined} Writer for the path, the fallback stream, or `undefined` when the path cannot be opened and no fallback was requested
 */
export declare function openSyncFileWriter(filePath: string, fallbackStream?: NodeJS.WritableStream | null): Writable | NodeJS.WritableStream | undefined;
/**
 * Close every synchronous file writer opened by {@link openSyncFileWriter}.
 * Safe to call more than once and after individual writers were closed.
 *
 * @returns {void}
 */
export declare function closeAllSyncFileWriters(): void;
//# sourceMappingURL=syncFileWriter.d.ts.map