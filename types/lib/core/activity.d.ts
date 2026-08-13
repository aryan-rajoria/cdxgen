/** True when CDXGEN_DEBUG_MODE or SCAN_DEBUG_MODE requests debug/verbose output. */
export declare const DEBUG_MODE: boolean;
/** True when cdxgen runs in secure/permission-restricted mode (CDXGEN_SECURE_MODE or Node.js --permission). */
export declare const isSecureMode: any;
/** Mutable flag indicating dry-run mode; when true, filesystem, network, and process activity is blocked and recorded instead of executed. */
export declare let isDryRun: any;
/** Error code string attached to errors raised when an operation is blocked by dry-run mode. */
export declare const DRY_RUN_ERROR_CODE = "CDXGEN_DRY_RUN";
/** @param {number} count Number of times an activity was observed. @returns {string} Suffix string indicating repeat count, or empty string. */
declare const buildReadCountSuffix: (count: number) => string;
/**
 * Classify a filesystem path into an activity metadata object describing its
 * classification (lockfile, manifest, certificate, key, cache, etc.), ecosystem,
 * label, and whether it is sensitive.
 *
 * @param {string} filePath File path to classify.
 * @returns {Object|undefined} Metadata object, or undefined when the path does not match a known pattern.
 */
declare function classifyActivityPath(filePath: string): Object | undefined;
/**
 * Classify a discovery glob pattern into a discovery type and human-readable label.
 *
 * @param {string|string[]} pattern Glob pattern (or array of patterns) used for discovery.
 * @returns {{discoveryType: string, label: string}} Discovery metadata with a `discoveryType` and `label`.
 */
declare function classifyDiscoveryPattern(pattern: string | string[]): {
    discoveryType: string;
    label: string;
};
/**
 * Tests whether an environment variable name matches sensitive patterns
 * (token, key, secret, password, credential, auth, session, cookie, etc.).
 *
 * @param {string} varName Environment variable name to test.
 * @returns {boolean} True when the name matches a sensitive pattern.
 */
export declare function isSensitiveEnvironmentVariableName(varName: string): boolean;
/**
 * Record a deduplicated observed activity entry (filesystem, environment, or
 * discovery). No-op unless dry-run or debug mode is active.
 *
 * @param {string} kind Activity kind (e.g. "inspect", "discover", "decision").
 * @param {string} target Activity target (path, host, or identifier).
 * @param {Object} [options] Optional metadata including `status`, `reason`, `reasonBuilder`, `metadata`, `traceKey`, and `traceDetail`.
 * @returns {Object|undefined} The recorded activity entry, or undefined.
 */
export declare function recordObservedActivity(kind: string, target: string, options?: Object): Object | undefined;
/** @param {string} target Activity target. @param {Object} [options] Options forwarded to recordObservedActivity. @returns {Object|undefined} Recorded activity entry. */
export declare function recordDecisionActivity(target: string, options?: Object): Object | undefined;
/** @param {string} target Activity target. @param {Object} [options] Options forwarded to recordObservedActivity. @returns {Object|undefined} Recorded activity entry. */
export declare function recordDiscoveryActivity(target: string, options?: Object): Object | undefined;
/** @param {string} target Activity target. @param {Object} [options] Options forwarded to recordObservedActivity. @returns {Object|undefined} Recorded activity entry. */
export declare function recordPolicyActivity(target: string, options?: Object): Object | undefined;
/**
 * Record a symlink resolution outcome, normalizing both paths relative to an
 * optional base path.
 *
 * @param {string} sourcePath The symlink source path.
 * @param {string} resolvedPath The resolved target path.
 * @param {Object} [options] Options including `basePath`, `status`, `reason`, `errorCode`, and `metadata`.
 * @returns {Object|undefined} Recorded activity entry, or undefined.
 */
export declare function recordSymlinkResolution(sourcePath: string, resolvedPath: string, options?: Object): Object | undefined;
/**
 * Record a deduplicated environment-variable read, flagging names that match
 * sensitive patterns.
 *
 * @param {string} varName Environment variable name that was read.
 * @param {Object} [options] Options including `source`, `sensitive`, `status`, and `reason`.
 * @returns {Object|undefined} Recorded activity entry, or undefined.
 */
export declare function recordEnvironmentRead(varName: string, options?: Object): Object | undefined;
/**
 * Record a sensitive-file read, deriving classification metadata from the path.
 *
 * @param {string} filePath Path of the sensitive file that was read.
 * @param {Object} [options] Options including `kind`, `label`, `status`, and `reason`.
 * @returns {Object|undefined} Recorded activity entry, or undefined.
 */
export declare function recordSensitiveFileRead(filePath: string, options?: Object): Object | undefined;
/**
 * Read an environment variable while recording the read for activity tracing.
 *
 * @param {string} varName Environment variable name to read.
 * @param {Object} [options] Options forwarded to recordEnvironmentRead.
 * @returns {string|undefined} The variable value, or undefined when unset.
 */
export declare function readEnvironmentVariable(varName: string, options?: Object): string | undefined;
/**
 * Toggle dry-run mode on or off and keep the CDXGEN_DRY_RUN environment variable in sync.
 *
 * @param {boolean} enabled True to enable dry-run mode, false to disable.
 * @returns {void}
 */
export declare function setDryRunMode(enabled: boolean): void;
/**
 * Construct an Error tagged as a dry-run-blocked operation.
 *
 * @param {string} action Action that was blocked (e.g. "network", "execute").
 * @param {string} target Target of the blocked action.
 * @param {string} [reason] Optional human-readable reason; defaults to a generic message.
 * @returns {Error} Error with `code`, `action`, `target`, and `dryRun` properties set.
 */
export declare function createDryRunError(action: string, target: string, reason?: string): Error;
/**
 * Returns true when the given error was produced by dry-run blocking.
 *
 * @param {Error} error Error to inspect.
 * @returns {boolean} True when the error carries the dry-run code or flag.
 */
export declare function isDryRunError(error: Error): boolean;
/** Error code string attached to errors raised when a request is blocked by the host allow-list or secure-mode policy. */
export declare const BLOCKED_HOST_ERROR_CODE = "CDXGEN_HOST_BLOCKED";
/**
 * Create an error used to abort a request to a host that policy disallows
 * (CDXGEN_ALLOWED_HOSTS or the secure-mode https-only restriction). The
 * beforeRequest hook must throw this so the request is actually aborted;
 * returning does not stop the request.
 *
 * @param {string} target The blocked request URL.
 * @param {string} reason Human readable reason for the block.
 * @returns {Error} Error carrying the blocked-host code.
 */
export declare function createBlockedHostError(target: string, reason: string): Error;
/**
 * Merge context metadata into the current activity context applied to every recorded activity.
 *
 * @param {Object} [context] Context properties to merge.
 * @returns {void}
 */
export declare function setActivityContext(context?: Object): void;
/** Clear the current activity context. @returns {void} */
export declare function resetActivityContext(): void;
/**
 * Append a timestamped activity entry to the ledger and emit a trace log.
 * No-op unless dry-run or debug mode is active.
 *
 * @param {Object} activity Activity properties to record.
 * @returns {Object|undefined} The recorded, identified entry, or undefined when recording is inactive.
 */
export declare function recordActivity(activity: Object): Object | undefined;
/** @returns {Object[]} Shallow copy of the recorded activity ledger. */
export declare function getRecordedActivities(): Object[];
/** Clear the activity ledger and all dedup maps. @returns {void} */
export declare function resetRecordedActivities(): void;
/**
 * Record a filesystem activity entry with the given kind, target, and status.
 *
 * @param {string} kind Activity kind (e.g. "write", "mkdir", "cleanup").
 * @param {string} target Filesystem target path.
 * @param {string} status Activity status (e.g. "completed", "blocked").
 * @param {string} [reason] Optional human-readable reason.
 * @param {Object} [metadata] Optional additional metadata.
 * @returns {Object|undefined} Recorded activity entry, or undefined.
 */
declare function recordFilesystemActivity(kind: string, target: string, status: string, reason?: string, metadata?: Object): Object | undefined;
/** Set accumulating hostnames of remote hosts contacted during a scan. */
export declare const remoteHostsAccessed: Set<any>;
/**
 * Test a hostname against the CDXGEN_ALLOWED_HOSTS allow-list, supporting exact
 * matches and `*.suffix` wildcards. When no allow-list is configured, all hosts are allowed.
 *
 * @param {string} hostname Hostname to test.
 * @param {string} [allowedHostsEnv] Comma-separated allow-list string; defaults to the CDXGEN_ALLOWED_HOSTS env var.
 * @returns {boolean} True when the hostname is permitted.
 */
export declare function isAllowedHttpHost(hostname: string, allowedHostsEnv?: string): boolean;
/**
 * Checks for dangerous Unicode characters that could enable homograph attacks
 *
 * @param {string} str String to check
 * @returns {boolean} true if dangerous Unicode is found
 */
export declare function hasDangerousUnicode(str: string): boolean;
/** The shared got-compatible HTTP client for all outbound requests, enforcing dry-run, host-allow-list, and secure-mode policies via beforeRequest/afterResponse/beforeError hooks. */
export declare const cdxgenAgent: Function;
export { buildReadCountSuffix, classifyActivityPath, classifyDiscoveryPattern, recordFilesystemActivity, };
//# sourceMappingURL=activity.d.ts.map