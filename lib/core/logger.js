import { Console } from "node:console";
import fs from "node:fs";
import process from "node:process";
import { Writable } from "node:stream";
import { isMainThread } from "node:worker_threads";

// Environment variables here are read with raw `process.env` rather than
// `readEnvironmentVariable`: that helper lives in activity.js, which imports
// this module, so routing these through it would form an import cycle.

// Stream contract: human-readable diagnostics default to stderr so stdout
// carries only the BOM payload. CDXGEN_LOG_STREAM=stdout restores the
// pre-v13 behaviour for callers that scraped cdxgen's stdout.
const logStream =
  process.env.CDXGEN_LOG_STREAM === "stdout" ? process.stdout : process.stderr;

// Custom lightweight colors formatting helper replacing yoctocolors
const colors = {
  cyanBright: (text) => `\x1b[96m${text}\x1b[39m`,
  dim: (text) => `\x1b[2m${text}\x1b[22m`,
};

/** True when thought/reasoning logging is enabled (CDXGEN_THOUGHT_LOG, CDXGEN_THINK_MODE, or verbose debug mode). */
export const THINK_MODE =
  process.env.CDXGEN_THOUGHT_LOG ||
  ["true", "1"].includes(process.env.CDXGEN_THINK_MODE) ||
  process.env.CDXGEN_DEBUG_MODE === "verbose";

// Log files are written synchronously rather than through
// `fs.createWriteStream`. A write stream buffers, so anything still queued when
// the process exits is lost, leaving readers that tail these files a truncated
// log with no closing `</think>` marker. Writing through one shared descriptor
// per path also keeps the two Console channels from interleaving at
// independent file offsets.
const syncFileWriters = new Map();

/**
 * Open a synchronous writer for a log file path.
 *
 * `Console` requires a real stream, so this is a `Writable` whose `_write`
 * completes synchronously: bytes reach the descriptor as each record is
 * logged, and nothing is left queued for an event loop turn that a process
 * exit may never take.
 *
 * @param {string} filePath Destination path
 * @returns {Writable} Writer, or the diagnostic stream when the path is unwritable
 */
function openSyncFileWriter(filePath) {
  const existing = syncFileWriters.get(filePath);
  if (existing) {
    return existing;
  }
  let fd;
  try {
    // Worker threads log to the same path through their own instance of this
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
    // An unwritable path must not take the whole run down: fall back to the
    // diagnostic stream so the records stay visible somewhere.
    return logStream;
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

const thinkOutput = process.env.CDXGEN_THOUGHT_LOG
  ? openSyncFileWriter(process.env.CDXGEN_THOUGHT_LOG)
  : logStream;
const thinkErrorOutput = process.env.CDXGEN_THOUGHT_LOG
  ? thinkOutput
  : process.stderr;
const thinkLogger = new Console({
  stdout: thinkOutput,
  stderr: thinkErrorOutput,
  colorMode: process.env.CDXGEN_THOUGHT_LOG ? false : "auto",
});

/** True when structured command/HTTP trace logging is enabled (CDXGEN_TRACE_LOG, CDXGEN_TRACE_ID, CDXGEN_TRACE_MODE, or verbose debug mode). */
export const TRACE_MODE =
  process.env.CDXGEN_TRACE_LOG ||
  process.env.CDXGEN_TRACE_ID ||
  ["true", "1"].includes(process.env.CDXGEN_TRACE_MODE) ||
  process.env.CDXGEN_DEBUG_MODE === "verbose";

const traceOutput = process.env.CDXGEN_TRACE_LOG
  ? openSyncFileWriter(process.env.CDXGEN_TRACE_LOG)
  : logStream;
const traceErrorOutput = process.env.CDXGEN_TRACE_LOG
  ? traceOutput
  : process.stderr;
const traceLogger = new Console({
  stdout: traceOutput,
  stderr: traceErrorOutput,
  colorMode: process.env.CDXGEN_TRACE_LOG ? false : "auto",
});

if (THINK_MODE) {
  thinkLogger.group(colorizeText("<think>"));
}
/**
 * Logs a thought message to the think logger if THINK_MODE is enabled.
 * Automatically appends a period to the message if it lacks terminal punctuation.
 *
 * @param {string} s The thought message to log
 * @param {Object} [args] Optional additional arguments to log alongside the message
 * @returns {void}
 */
export function thoughtLog(s, args) {
  if (!THINK_MODE) {
    return;
  }
  if (!s?.endsWith(".") && !s?.endsWith("?") && !s?.endsWith("!")) {
    s = `${s}.`;
  }
  s = s.replaceAll("'.'", "'<project dir>'");
  if (args) {
    thinkLogger.log(colorizeText(`${s}`), args);
  } else {
    thinkLogger.log(colorizeText(`${s}`));
  }
}
let thoughtBlockClosed = false;

/**
 * Closes the think log group by emitting the closing `</think>` marker.
 * Has no effect if THINK_MODE is not enabled, and emits the marker at most
 * once so an explicit call followed by the exit handler cannot produce two.
 *
 * @returns {void}
 */
export function thoughtEnd() {
  if (THINK_MODE && !thoughtBlockClosed) {
    thoughtBlockClosed = true;
    thinkLogger.groupEnd();
    thinkLogger.log(colorizeText("</think>"));
  }
}

function colorizeText(s) {
  // Only colorize for an interactive terminal stream; piped/CI/file output
  // stays free of escape bytes so the diagnostic stream is grep-safe.
  if (process.env.CDXGEN_THOUGHT_LOG || !logStream.isTTY) {
    return s;
  }
  s = s.replace(/(\d+)/g, colors.cyanBright("$1"));
  return colors.dim(s);
}

// Fields serialized for each trace type. The allow-list is per-type because a
// single shared list either drops the fields a type exists to carry or leaks
// unbounded caller objects into the stream: `activity` and `phase` records
// carry no field in common with `spawn` and `http`.
const TRACE_FIELDS = {
  activity: [
    "identifier",
    "kind",
    "status",
    "target",
    "reason",
    "networkIntent",
    "command",
    "cwd",
  ],
  phase: ["phase", "state", "detail", "note", "done", "total", "elapsedMs"],
};

const DEFAULT_TRACE_FIELDS = [
  "command",
  "cwd",
  "protocol",
  "host",
  "path",
  "pathname",
];

/**
 * Log trace messages
 *
 * @param {String} traceType Trace type
 * @param {Object} args Additional arguments
 */
export function traceLog(traceType, args) {
  if (!TRACE_MODE || !traceType || !args) {
    return;
  }
  const traceId = process.env.CDXGEN_TRACE_ID;
  const message = {};
  if (traceId) {
    message.traceId = traceId;
  }
  message["timestamp"] = new Date().toISOString();
  if (traceType) {
    message.type = traceType;
  }
  if (args) {
    for (const k of TRACE_FIELDS[traceType] || DEFAULT_TRACE_FIELDS) {
      // Numeric progress counters are meaningful at zero, so presence is
      // tested rather than truthiness.
      if (args[k] !== undefined && args[k] !== null && args[k] !== "") {
        message[k] = args[k];
      }
    }
  }
  if (Object.keys(message).length) {
    traceLogger.log(JSON.stringify(message, null, null));
  }
}

let logStreamsClosed = false;

/**
 * Terminate the think block and close the log file descriptors.
 *
 * Readers tail these files as a live feed, so a run that ends without the
 * closing `</think>` marker leaves the consumer holding an unterminated block.
 * Registered on process exit and safe to call more than once.
 *
 * @returns {void}
 */
export function closeLogStreams() {
  if (logStreamsClosed) {
    return;
  }
  logStreamsClosed = true;
  thoughtEnd();
  for (const writer of [...syncFileWriters.values()]) {
    writer.closeSync();
  }
}

// The writers are synchronous, so this handler only has to emit the terminator
// and release the descriptors — work that is legal during `exit`.
process.on("exit", closeLogStreams);
