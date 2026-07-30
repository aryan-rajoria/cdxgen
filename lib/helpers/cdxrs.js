/**
 * cdxrs — JS bridge to the Rust-native CycloneDX BOM tooling binary.
 *
 * This module is the ONLY place that spawns the `cdxrs` binary. It enforces
 * the governing invariant: **no failure mode may abort SBOM generation.**
 * Every failure (missing binary, non-zero exit, timeout, malformed stdout,
 * version-major mismatch, CDXGEN_RS_DISABLE) logs once at `warn` and returns
 * a sentinel that makes the caller take the JS path.
 *
 * Protocol:
 *   cdxrs <subcommand> --input <file|-> --output <file|-> --format json
 *   stdin/stdout carry JSON; stderr carries newline-delimited JSON log records.
 *   Exit codes: 0 ok, 1 operational failure, 2 bad usage, 3 validation findings.
 *
 * See docs/v13/rust.md for the full specification.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";

import { getDefaultPluginRuntime, resolvePluginBinary } from "./plugins.js";
import { DEBUG_MODE, safeExistsSync } from "./utils.js";

/** Major version this bridge expects from the cdxrs binary. */
const CDXRS_VERSION_MAJOR = "3";

/** Default timeout for a cdxrs invocation. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Above this size, in-memory content is spilled to a temp file and passed by
 * path instead of through stdin, per the protocol in docs/v13/rust.md.
 */
const MAX_STDIN_BYTES = 32 * 1024 * 1024;

/** Sentinel returned when the Rust path is unavailable. Callers take JS path. */
export const CDXRS_FALLBACK = Object.freeze({
  ok: false,
  reason: "fallback",
  stdout: "",
  exitCode: null,
});

/** Subcommands supported by this bridge. */
const KNOWN_SUBCOMMANDS = new Set(["info"]);

/**
 * Determine whether a subcommand is disabled by env vars or the --no-rust alias.
 *
 * @param {string} subcommand The subcommand name (e.g. "info").
 * @returns {boolean} True when the Rust path should be skipped.
 */
export function cdxrsDisabled(subcommand) {
  const raw = process.env.CDXGEN_RS_DISABLE || "";
  if (
    process.env.CDXGEN_NO_RUST === "true" ||
    process.argv.includes("--no-rust")
  ) {
    return true;
  }
  if (raw === "all") {
    return true;
  }
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.includes(subcommand);
}

/**
 * Resolve the cdxrs binary path for the current platform.
 *
 * @returns {string|undefined} Path to the binary, or undefined if not found.
 */
export function cdxrsBinaryPath() {
  return resolvePluginBinary("cdxrs", getDefaultPluginRuntime());
}

/**
 * Check whether cdxrs may be used for a subcommand: it must not be disabled,
 * the binary must be present, and its major version must match.
 *
 * The disable check comes first and is deliberate. Callers gate on this function
 * to decide between the Rust and JS paths, so it has to honour
 * `CDXGEN_RS_DISABLE` / `--no-rust`; otherwise a disabled run still reports (and
 * would still select) Rust, and `--no-rust` becomes a no-op for every caller
 * that does not go through `runCdxrs`.
 *
 * @param {string} [subcommand] Subcommand to check, e.g. "info".
 * @returns {{ available: boolean, version?: string, reason?: string }}
 */
export function cdxrsAvailable(subcommand) {
  if (cdxrsDisabled(subcommand)) {
    return { available: false, reason: "disabled" };
  }
  const binPath = cdxrsBinaryPath();
  if (!binPath || !safeExistsSync(binPath)) {
    return { available: false, reason: "binary-not-found" };
  }
  const version = probeVersion(binPath);
  if (!version) {
    return { available: false, reason: "version-probe-failed" };
  }
  const major = version.split(".")[0];
  if (major !== CDXRS_VERSION_MAJOR) {
    return {
      available: false,
      version,
      reason: `version-mismatch: expected major ${CDXRS_VERSION_MAJOR}, got ${major}`,
    };
  }
  return { available: true, version };
}

/**
 * Run `cdxrs --version` synchronously and parse the output.
 *
 * @param {string} binPath Path to the cdxrs binary.
 * @returns {string|undefined} Version string like "3.0.0", or undefined on failure.
 */
function probeVersion(binPath) {
  try {
    const result = spawnSync(binPath, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    if (result.status !== 0 || !result.stdout) {
      return undefined;
    }
    const match = result.stdout
      .toString()
      .trim()
      .match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Spawn the cdxrs binary, collect stdout/stderr, enforce a timeout, and
 * kill the process group if the child hangs.
 *
 * Every failure mode logs once at `warn` and returns the CDXRS_FALLBACK
 * sentinel so the caller can take the JS path.
 *
 * Pass BOM data one of two ways:
 *   - `content`: an in-memory string/Buffer, fed to the child over stdin with
 *     `--input -`. Content larger than 32 MB is spilled to a temp file and
 *     passed by path instead, per the protocol; the file is always removed.
 *   - `input`: a path to a file already on disk.
 *
 * Passing `content` is the normal case, since cdxgen holds BOMs in memory.
 *
 * @param {string} subcommand The subcommand to run (e.g. "info").
 * @param {Object} opts
 * @param {string|Buffer} [opts.content] BOM data to feed over stdin.
 * @param {string} [opts.input] Input file path. Defaults to "-" (stdin), which
 *   requires `content`.
 * @param {string[]} [opts.args] Extra arguments to pass.
 * @param {number} [opts.timeoutMs] Timeout in milliseconds.
 * @returns {Promise<{ok: boolean, stdout: string, exitCode: number|null, reason?: string}>}
 */
export async function runCdxrs(subcommand, opts = {}) {
  const {
    content,
    input = "-",
    args = [],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  // Guard the easiest way to misuse this function. `--input` is a *path*; a
  // caller that passes BOM JSON there would have it interpreted as a filename
  // (typically surfacing as ENAMETOOLONG from the child), so catch it here
  // rather than letting it look like a cdxrs failure.
  if (input !== "-" && (input.includes("\n") || input.length > 4096)) {
    console.warn(
      "cdxrs: `input` must be a file path; pass in-memory BOM data as `content`. Falling back to JS path.",
    );
    return { ...CDXRS_FALLBACK, reason: "bad-input-arg" };
  }
  if (input === "-" && content === undefined) {
    console.warn(
      "cdxrs: no `content` supplied for stdin input, falling back to JS path.",
    );
    return { ...CDXRS_FALLBACK, reason: "no-input" };
  }

  if (!KNOWN_SUBCOMMANDS.has(subcommand)) {
    console.warn(
      `cdxrs: unknown subcommand "${subcommand}", falling back to JS path.`,
    );
    return { ...CDXRS_FALLBACK, reason: "unknown-subcommand" };
  }

  if (cdxrsDisabled(subcommand)) {
    if (DEBUG_MODE) {
      console.log(
        `cdxrs: subcommand "${subcommand}" disabled via CDXGEN_RS_DISABLE.`,
      );
    }
    return { ...CDXRS_FALLBACK, reason: "disabled" };
  }

  const binPath = cdxrsBinaryPath();
  if (!binPath || !safeExistsSync(binPath)) {
    console.warn("cdxrs: binary not found, falling back to JS path.");
    return { ...CDXRS_FALLBACK, reason: "binary-not-found" };
  }

  const version = probeVersion(binPath);
  if (!version) {
    console.warn("cdxrs: version probe failed, falling back to JS path.");
    return { ...CDXRS_FALLBACK, reason: "version-probe-failed" };
  }
  const major = version.split(".")[0];
  if (major !== CDXRS_VERSION_MAJOR) {
    console.warn(
      `cdxrs: version mismatch (expected major ${CDXRS_VERSION_MAJOR}, got ${version}), falling back to JS path.`,
    );
    return { ...CDXRS_FALLBACK, reason: "version-mismatch" };
  }

  // Resolve how the child will actually receive its input. Content over
  // MAX_STDIN_BYTES goes via a temp file so we never hold a huge payload in a
  // pipe buffer; `spillDir` is cleaned up in the `close`/`error` handlers.
  let effectiveInput = input;
  let stdinContent = content;
  let spillDir;
  if (content !== undefined) {
    const byteLength = Buffer.byteLength(content);
    if (byteLength > MAX_STDIN_BYTES) {
      try {
        spillDir = mkdtempSync(join(tmpdir(), "cdxgen-cdxrs-"));
        const spillPath = join(spillDir, "input.json");
        writeFileSync(spillPath, content);
        effectiveInput = spillPath;
        stdinContent = undefined;
        if (DEBUG_MODE) {
          console.log(
            `cdxrs: input is ${byteLength} bytes (> ${MAX_STDIN_BYTES}), spilled to ${spillPath}.`,
          );
        }
      } catch (err) {
        console.warn(
          `cdxrs: could not spill oversized input to disk (${err.message}), falling back to JS path.`,
        );
        return { ...CDXRS_FALLBACK, reason: "spill-failed" };
      }
    }
  }

  const cleanupSpill = () => {
    if (!spillDir) {
      return;
    }
    try {
      rmSync(spillDir, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp dir must never fail a BOM run.
    }
    spillDir = undefined;
  };

  const fullArgs = [subcommand, "--input", effectiveInput, ...args];
  if (DEBUG_MODE) {
    console.log(`cdxrs: spawning ${binPath} ${fullArgs.join(" ")}`);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timedOut = false;
    const stdoutChunks = [];
    const stderrChunks = [];

    const pluginRuntime = getDefaultPluginRuntime();
    const env = { ...process.env };
    if (
      pluginRuntime.extraNMBinPath &&
      !env.PATH?.includes(pluginRuntime.extraNMBinPath)
    ) {
      env.PATH = `${pluginRuntime.extraNMBinPath}${delimiter}${env.PATH}`;
    }

    const child = spawn(binPath, fullArgs, {
      // stdin is a pipe only when we have content to write; otherwise the child
      // reads from a file path and an open stdin would just be a way to hang.
      stdio: [stdinContent === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env,
      // detached: true creates a new process group so we can kill the
      // entire group on timeout, preventing a hung child from outliving us.
      detached: true,
    });

    if (stdinContent !== undefined) {
      // EPIPE is expected if the child exits before draining stdin (e.g. bad
      // usage); it must not become an unhandled error.
      child.stdin.on("error", () => {
        // Intentionally ignored.
      });
      child.stdin.end(stdinContent);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (DEBUG_MODE) {
        console.warn(
          `cdxrs: timeout after ${timeoutMs}ms, killing process group.`,
        );
      }
      try {
        // Kill the process group (-pid) so any child processes of cdxrs die too.
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Process may have already exited; fall through to error handling.
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk);
      // Forward NDJSON log records to cdxgen's logger at appropriate levels.
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        forwardLogRecord(line);
      }
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanupSpill();
      console.warn(
        `cdxrs: spawn error: ${err.message}, falling back to JS path.`,
      );
      resolve({ ...CDXRS_FALLBACK, reason: "spawn-error" });
    });

    child.on("close", (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanupSpill();

      if (timedOut) {
        console.warn("cdxrs: timed out, falling back to JS path.");
        resolve({ ...CDXRS_FALLBACK, reason: "timeout" });
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();

      if (code !== 0) {
        console.warn(
          `cdxrs: non-zero exit ${code} (signal ${signal}), falling back to JS path.`,
        );
        resolve({ ...CDXRS_FALLBACK, reason: `non-zero-exit:${code}` });
        return;
      }

      // Validate that stdout is parseable JSON for subcommands that produce JSON.
      if (subcommand === "info" || subcommand === "schema-version") {
        try {
          JSON.parse(stdout);
        } catch {
          console.warn(
            "cdxrs: malformed stdout (not valid JSON), falling back to JS path.",
          );
          resolve({ ...CDXRS_FALLBACK, reason: "malformed-stdout" });
          return;
        }
      }

      if (DEBUG_MODE) {
        console.log(`cdxrs: "${subcommand}" completed (exit ${code}).`);
      }

      resolve({
        ok: true,
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}

/**
 * Forward a stderr NDJSON log record from the cdxrs binary to cdxgen's logger.
 *
 * @param {string} line A single line of stderr output.
 */
function forwardLogRecord(line) {
  try {
    const record = JSON.parse(line);
    const msg = record.msg || record.message || "";
    const level = record.level || "info";
    if (level === "warn" || level === "error") {
      console.warn(`cdxrs: ${msg}`);
    } else if (DEBUG_MODE) {
      console.log(`cdxrs: ${msg}`);
    }
  } catch {
    // Not a JSON log record — ignore (the protocol says stderr carries NDJSON only,
    // but be resilient if a build has a bug).
    if (DEBUG_MODE) {
      console.log(`cdxrs stderr: ${line}`);
    }
  }
}
