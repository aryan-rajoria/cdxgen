import fs from "node:fs";
import process from "node:process";
import { Writable } from "node:stream";
import { isMainThread } from "node:worker_threads";

// Stream contract: human-readable diagnostics default to stderr so stdout
// carries only the BOM payload. CDXGEN_LOG_STREAM=stdout restores the
// pre-v13 behaviour for callers that scraped cdxgen's stdout.

/**
 * The stream every human-readable diagnostic is written to.
 *
 * Also the fallback destination of {@link openSyncFileWriter} when a log path
 * cannot be opened, so an unwritable path keeps the records visible somewhere
 * instead of taking the run down.
 *
 * @type {NodeJS.WritableStream}
 */
export const diagnosticStream =
  process.env.CDXGEN_LOG_STREAM === "stdout" ? process.stdout : process.stderr;

// Log files are written synchronously rather than through
// `fs.createWriteStream`. A write stream buffers, so anything still queued when
// the process exits is lost, leaving readers that tail these files a truncated
// log. Writing through one shared descriptor per path also keeps concurrent
// writers from interleaving at independent file offsets.
const syncFileWriters = new Map();

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
export function openSyncFileWriter(
  filePath,
  fallbackStream = diagnosticStream,
) {
  const existing = syncFileWriters.get(filePath);
  if (existing) {
    return existing;
  }
  let fd;
  try {
    // Worker threads open the same path through their own instance of this
    // module, so the descriptor is opened in append mode: O_APPEND lands every
    // write at the end of the file no matter how many writers share it, where
    // a truncating open gives each writer its own offset and they punch holes
    // through each other's records. The main thread truncates once so a run
    // still starts from an empty log.
    if (isMainThread) {
      try {
        fs.truncateSync(filePath, 0);
      } catch {
        // No file yet: the append open below creates it.
      }
    }
    fd = fs.openSync(filePath, "a");
  } catch {
    return fallbackStream ?? undefined;
  }
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      if (fd !== undefined) {
        try {
          fs.writeSync(fd, chunk);
        } catch {
          // A full disk or a revoked descriptor must not abort BOM generation.
        }
      }
      callback();
    },
  });
  writer.closeSync = () => {
    if (fd === undefined) {
      return;
    }
    try {
      fs.closeSync(fd);
    } finally {
      fd = undefined;
      syncFileWriters.delete(filePath);
    }
  };
  syncFileWriters.set(filePath, writer);
  return writer;
}

/**
 * Close every synchronous file writer opened by {@link openSyncFileWriter}.
 * Safe to call more than once and after individual writers were closed.
 *
 * @returns {void}
 */
export function closeAllSyncFileWriters() {
  for (const writer of [...syncFileWriters.values()]) {
    writer.closeSync();
  }
}
