export declare const DEBUG_MODE: boolean;
export declare const isSecureMode: any;
export declare let isDryRun: any;
export declare const DRY_RUN_ERROR_CODE = "CDXGEN_DRY_RUN";
declare const buildReadCountSuffix: (count: any) => string;
declare function classifyActivityPath(filePath: any): {
    classification: string;
    ecosystem: string;
    label: string;
} | {
    classification: string;
    label: string;
    sensitive?: undefined;
} | {
    classification: string;
    label: string;
    sensitive: boolean;
} | undefined;
declare function classifyDiscoveryPattern(pattern: any): {
    discoveryType: string;
    label: string;
};
export declare function isSensitiveEnvironmentVariableName(varName: any): boolean;
export declare function recordObservedActivity(kind: any, target: any, options?: {}): any;
export declare function recordDecisionActivity(target: any, options?: {}): any;
export declare function recordDiscoveryActivity(target: any, options?: {}): any;
export declare function recordPolicyActivity(target: any, options?: {}): any;
export declare function recordSymlinkResolution(sourcePath: any, resolvedPath: any, options?: {}): any;
export declare function recordEnvironmentRead(varName: any, options?: {}): any;
export declare function recordSensitiveFileRead(filePath: any, options?: {}): any;
export declare function readEnvironmentVariable(varName: any, options?: {}): any;
export declare function setDryRunMode(enabled: any): void;
export declare function createDryRunError(action: any, target: any, reason: any): Error;
export declare function isDryRunError(error: any): boolean;
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
export declare function setActivityContext(context?: {}): void;
export declare function resetActivityContext(): void;
export declare function recordActivity(activity: any): any;
export declare function getRecordedActivities(): any[];
export declare function resetRecordedActivities(): void;
declare function recordFilesystemActivity(kind: any, target: any, status: any, reason?: undefined, metadata?: {}): any;
export declare const remoteHostsAccessed: Set<any>;
export declare function isAllowedHttpHost(hostname: any, allowedHostsEnv?: any): boolean;
/**
 * Checks for dangerous Unicode characters that could enable homograph attacks
 *
 * @param {string} str String to check
 * @returns {boolean} true if dangerous Unicode is found
 */
export declare function hasDangerousUnicode(str: string): boolean;
export declare const cdxgenAgent: Function;
export { buildReadCountSuffix, classifyActivityPath, classifyDiscoveryPattern, recordFilesystemActivity, };
//# sourceMappingURL=activity.d.ts.map