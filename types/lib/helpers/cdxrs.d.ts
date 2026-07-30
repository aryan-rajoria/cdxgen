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
/** Sentinel returned when the Rust path is unavailable. Callers take JS path. */
export declare const CDXRS_FALLBACK: Readonly<{
    ok: false;
    reason: "fallback";
    stdout: "";
    exitCode: null;
}>;
/**
 * Determine whether a subcommand is disabled by env vars or the --no-rust alias.
 *
 * @param {string} subcommand The subcommand name (e.g. "info").
 * @returns {boolean} True when the Rust path should be skipped.
 */
export declare function cdxrsDisabled(subcommand: string): boolean;
/**
 * Resolve the cdxrs binary path for the current platform.
 *
 * @returns {string|undefined} Path to the binary, or undefined if not found.
 */
export declare function cdxrsBinaryPath(): string | undefined;
/**
 * Check whether the cdxrs binary is present and its major version matches.
 *
 * @param {string} [_subcommand] Unused for now; future subcommands may probe `--help`.
 * @returns {{ available: boolean, version?: string, reason?: string }}
 */
export declare function cdxrsAvailable(_subcommand?: string): {
    available: boolean;
    version?: string;
    reason?: string;
};
/**
 * Spawn the cdxrs binary, collect stdout/stderr, enforce a timeout, and
 * kill the process group if the child hangs.
 *
 * Every failure mode logs once at `warn` and returns the CDXRS_FALLBACK
 * sentinel so the caller can take the JS path.
 *
 * @param {string} subcommand The subcommand to run (e.g. "info").
 * @param {Object} opts
 * @param {string} [opts.input] Input file path ("-" for stdin, default "-").
 * @param {string[]} [opts.args] Extra arguments to pass.
 * @param {number} [opts.timeoutMs] Timeout in milliseconds.
 * @returns {Promise<{ok: boolean, stdout: string, exitCode: number|null, reason?: string}>}
 */
export declare function runCdxrs(subcommand: string, opts?: {
    input?: string;
    args?: string[];
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    stdout: string;
    exitCode: number | null;
    reason?: string;
}>;
//# sourceMappingURL=cdxrs.d.ts.map