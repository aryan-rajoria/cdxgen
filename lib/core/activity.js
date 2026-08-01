import path, { basename, extname, relative, resolve } from "node:path";
import process from "node:process";

import { createHttpClient, getDefaultHttpTimeoutMs } from "./httpClient.js";
import { traceLog } from "./logger.js";
import { CDXGEN_VERSION } from "./state.js";

// Debug mode flag
export const DEBUG_MODE =
  ["debug", "verbose"].includes(process.env.CDXGEN_DEBUG_MODE) ||
  process.env.SCAN_DEBUG_MODE === "debug";

export const isSecureMode =
  ["true", "1"].includes(process.env?.CDXGEN_SECURE_MODE) ||
  process.env?.NODE_OPTIONS?.includes("--permission");

// CLI dry-run must be detected during module initialization because some probes
// execute while modules are imported, before bin/cdxgen.js can thread options.
const hasDryRunArg = process.argv?.some(
  (arg) =>
    arg === "--dry-run" || arg === "--dry-run=true" || arg === "--dry-run=1",
);
export let isDryRun =
  ["true", "1"].includes(process.env?.CDXGEN_DRY_RUN) || hasDryRunArg;

export const DRY_RUN_ERROR_CODE = "CDXGEN_DRY_RUN";
const activityLedger = [];
let activityCounter = 0;
let currentActivityContext = {};
const dryRunReadTraceState =
  globalThis.__cdxgenDryRunReadTraceState ||
  (globalThis.__cdxgenDryRunReadTraceState = {
    environmentReads: new Map(),
    observations: new Map(),
    recordActivity: undefined,
    sensitiveFileReads: new Map(),
  });

const SENSITIVE_ENV_VAR_PATTERN =
  /(^|_)(?:token|key|secret|pass(?:word)?|credential(?:s)?|cred|auth|session|cookie|email|user)$/i;
const DIRECTORY_DISCOVERY_NAMES = new Set([
  ".cargo",
  ".docker",
  ".gem",
  ".github",
  ".m2",
  ".nuget",
  ".venv",
  ".yarn",
  "blobs",
  "extensions",
  "node_modules",
  "target",
  "vendor",
]);
const LOCKFILE_ACTIVITY_HINTS = new Map([
  [
    "bun.lock",
    { classification: "lockfile", ecosystem: "bun", label: "Bun lockfile" },
  ],
  [
    "cargo.lock",
    { classification: "lockfile", ecosystem: "cargo", label: "Cargo lockfile" },
  ],
  [
    "composer.lock",
    {
      classification: "lockfile",
      ecosystem: "composer",
      label: "Composer lockfile",
    },
  ],
  [
    "deno.lock",
    { classification: "lockfile", ecosystem: "deno", label: "Deno lockfile" },
  ],
  [
    "gemfile.lock",
    {
      classification: "lockfile",
      ecosystem: "rubygems",
      label: "Bundler lockfile",
    },
  ],
  [
    "package-lock.json",
    { classification: "lockfile", ecosystem: "npm", label: "npm lockfile" },
  ],
  [
    "packages.lock.json",
    { classification: "lockfile", ecosystem: "nuget", label: "NuGet lockfile" },
  ],
  [
    "pdm.lock",
    { classification: "lockfile", ecosystem: "python", label: "PDM lockfile" },
  ],
  [
    "pnpm-lock.yaml",
    { classification: "lockfile", ecosystem: "pnpm", label: "pnpm lockfile" },
  ],
  [
    "poetry.lock",
    {
      classification: "lockfile",
      ecosystem: "python",
      label: "Poetry lockfile",
    },
  ],
  [
    "podfile.lock",
    {
      classification: "lockfile",
      ecosystem: "cocoapods",
      label: "CocoaPods lockfile",
    },
  ],
  [
    "pylock.toml",
    {
      classification: "lockfile",
      ecosystem: "python",
      label: "PEP 751 lockfile",
    },
  ],
  [
    "uv.lock",
    { classification: "lockfile", ecosystem: "python", label: "uv lockfile" },
  ],
  [
    "yarn.lock",
    { classification: "lockfile", ecosystem: "yarn", label: "Yarn lockfile" },
  ],
]);
const MANIFEST_ACTIVITY_HINTS = new Map([
  [
    "cargo.toml",
    { classification: "manifest", ecosystem: "cargo", label: "Cargo manifest" },
  ],
  [
    "composer.json",
    {
      classification: "manifest",
      ecosystem: "composer",
      label: "Composer manifest",
    },
  ],
  [
    "deno.json",
    { classification: "manifest", ecosystem: "deno", label: "Deno manifest" },
  ],
  [
    "gemfile",
    {
      classification: "manifest",
      ecosystem: "rubygems",
      label: "Gem manifest",
    },
  ],
  [
    "package.json",
    { classification: "manifest", ecosystem: "npm", label: "package manifest" },
  ],
  [
    "pom.xml",
    { classification: "manifest", ecosystem: "maven", label: "Maven manifest" },
  ],
  [
    "pyproject.toml",
    {
      classification: "manifest",
      ecosystem: "python",
      label: "Python project manifest",
    },
  ],
  [
    "requirements.txt",
    {
      classification: "manifest",
      ecosystem: "python",
      label: "Python requirements manifest",
    },
  ],
  [
    "setup.py",
    {
      classification: "manifest",
      ecosystem: "python",
      label: "Python setup manifest",
    },
  ],
]);
const SENSITIVE_CONFIG_ACTIVITY_HINTS = [
  {
    matcher: (lowerPath, _baseName) =>
      lowerPath.includes("/.cargo/config.toml") ||
      lowerPath.endsWith("/.cargo/credentials") ||
      lowerPath.endsWith("/.cargo/credentials.toml"),
    metadata: {
      classification: "config",
      ecosystem: "cargo",
      label: "Cargo registry configuration",
      sensitive: true,
    },
  },
  {
    matcher: (lowerPath, baseName) =>
      lowerPath.includes("/.docker/config.json") ||
      (baseName === "config.json" && lowerPath.includes("/docker")),
    metadata: {
      classification: "credential",
      ecosystem: "oci",
      label: "Docker credential file",
      sensitive: true,
    },
  },
  {
    matcher: (lowerPath) => lowerPath.endsWith("/.gem/credentials"),
    metadata: {
      classification: "credential",
      ecosystem: "rubygems",
      label: "RubyGems credentials file",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) =>
      baseName === ".npmrc" || baseName === ".pnpmrc" || baseName === ".yarnrc",
    metadata: {
      classification: "config",
      ecosystem: "npm",
      label: "JavaScript package manager configuration",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) => baseName === ".yarnrc.yml",
    metadata: {
      classification: "config",
      ecosystem: "yarn",
      label: "Yarn configuration",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) =>
      baseName === ".pypirc" || baseName === "pip.conf",
    metadata: {
      classification: "config",
      ecosystem: "python",
      label: "Python package publishing configuration",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) =>
      baseName === "uv.toml" || baseName === "poetry.toml",
    metadata: {
      classification: "config",
      ecosystem: "python",
      label: "Python package manager configuration",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) => baseName === "nuget.config",
    metadata: {
      classification: "config",
      ecosystem: "nuget",
      label: "NuGet configuration",
      sensitive: true,
    },
  },
  {
    matcher: (_lowerPath, baseName) => baseName === "settings.xml",
    metadata: {
      classification: "config",
      ecosystem: "maven",
      label: "Maven settings.xml",
      sensitive: true,
    },
  },
];
const CERTIFICATE_FILE_EXTENSIONS = new Set([".crt", ".cer", ".pem"]);
const KEY_FILE_EXTENSIONS = new Set([
  ".key",
  ".jks",
  ".keystore",
  ".p12",
  ".pfx",
]);

const buildReadCountSuffix = (count) => (count > 1 ? ` (${count} times)` : "");

const buildEnvironmentReadReason = (varName, count, sensitive) =>
  `Read ${sensitive ? "sensitive " : ""}environment variable ${varName}${buildReadCountSuffix(count)}.`;

const buildSensitiveFileReadReason = (filePath, count, label) =>
  `Read ${label} ${filePath}${buildReadCountSuffix(count)}.`;

function emitActivity(activity) {
  if (typeof dryRunReadTraceState.recordActivity !== "function") {
    return undefined;
  }
  return dryRunReadTraceState.recordActivity(activity);
}

function classifyActivityPath(filePath) {
  if (typeof filePath !== "string" || !filePath.length) {
    return undefined;
  }
  const normalizedPath = filePath.replaceAll("\\", "/");
  const lowerPath = normalizedPath.toLowerCase();
  const baseName = basename(lowerPath);
  if (LOCKFILE_ACTIVITY_HINTS.has(baseName)) {
    return LOCKFILE_ACTIVITY_HINTS.get(baseName);
  }
  if (MANIFEST_ACTIVITY_HINTS.has(baseName)) {
    return MANIFEST_ACTIVITY_HINTS.get(baseName);
  }
  for (const { matcher, metadata } of SENSITIVE_CONFIG_ACTIVITY_HINTS) {
    if (matcher(lowerPath, baseName)) {
      return metadata;
    }
  }
  if (
    lowerPath.includes("/cache/") ||
    lowerPath.includes("/.cache/") ||
    lowerPath.includes("/caches/")
  ) {
    return {
      classification: "cache",
      label: "cache path",
    };
  }
  if (
    CERTIFICATE_FILE_EXTENSIONS.has(extname(baseName)) ||
    baseName === "cert.pem"
  ) {
    return {
      classification: "certificate",
      label: "certificate file",
      sensitive: true,
    };
  }
  if (
    KEY_FILE_EXTENSIONS.has(extname(baseName)) ||
    baseName === "key.pem" ||
    baseName.startsWith("id_")
  ) {
    return {
      classification: "key",
      label: "private key file",
      sensitive: true,
    };
  }
  const trimmedPath = normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
  const directoryName = basename(trimmedPath.toLowerCase());
  if (DIRECTORY_DISCOVERY_NAMES.has(directoryName)) {
    return {
      classification: "directory",
      label: "directory discovery path",
    };
  }
  return undefined;
}

function classifyDiscoveryPattern(pattern) {
  const patternValue = Array.isArray(pattern)
    ? pattern.join(",")
    : String(pattern);
  const lowerPattern = patternValue.toLowerCase();
  if (
    lowerPattern.includes("package-lock.json") ||
    lowerPattern.includes("pnpm-lock.yaml") ||
    lowerPattern.includes("yarn.lock") ||
    lowerPattern.includes("poetry.lock") ||
    lowerPattern.includes("uv.lock") ||
    lowerPattern.includes("cargo.lock") ||
    lowerPattern.includes("gemfile.lock")
  ) {
    return {
      discoveryType: "lockfile-discovery",
      label: "lockfile discovery",
    };
  }
  if (
    lowerPattern.includes("package.json") ||
    lowerPattern.includes("pom.xml") ||
    lowerPattern.includes("pyproject.toml") ||
    lowerPattern.includes("cargo.toml") ||
    lowerPattern.includes("composer.json")
  ) {
    return {
      discoveryType: "manifest-discovery",
      label: "manifest discovery",
    };
  }
  return {
    discoveryType: "directory-enumeration",
    label: "directory enumeration",
  };
}

function recordDeduplicatedRead(traceMap, traceKey, activity, createReason) {
  const existingTrace = traceMap.get(traceKey);
  if (existingTrace) {
    existingTrace.count += 1;
    if (existingTrace.entry) {
      existingTrace.entry.count = existingTrace.count;
      existingTrace.entry.reason = createReason(existingTrace.count);
    }
    return existingTrace.entry;
  }
  const entry = emitActivity({
    ...activity,
    reason: createReason(1),
  });
  if (entry) {
    entry.count = 1;
  }
  traceMap.set(traceKey, {
    count: 1,
    entry,
  });
  return entry;
}

export function isSensitiveEnvironmentVariableName(varName) {
  return typeof varName === "string" && SENSITIVE_ENV_VAR_PATTERN.test(varName);
}

export function recordObservedActivity(kind, target, options = {}) {
  if (!(isDryRun || DEBUG_MODE) || !kind || !target) {
    return undefined;
  }
  const status = options.status || "completed";
  const traceKey =
    options.traceKey ||
    `${kind}:${status}:${target}:${options.traceDetail || ""}`;
  const metadata = options.metadata || {};
  const reasonBuilder =
    options.reasonBuilder ||
    ((count) =>
      options.reason
        ? `${options.reason}${buildReadCountSuffix(count)}`
        : `Recorded ${kind} activity for ${target}${buildReadCountSuffix(count)}.`);
  return recordDeduplicatedRead(
    dryRunReadTraceState.observations,
    traceKey,
    {
      kind,
      status,
      target,
      ...metadata,
    },
    reasonBuilder,
  );
}

export function recordDecisionActivity(target, options = {}) {
  return recordObservedActivity(options.kind || "decision", target, options);
}

export function recordDiscoveryActivity(target, options = {}) {
  return recordObservedActivity(options.kind || "discover", target, options);
}

export function recordPolicyActivity(target, options = {}) {
  return recordObservedActivity(options.kind || "policy", target, options);
}

function normalizeRecordedPathForComparison(
  candidatePath,
  basePath = undefined,
) {
  if (typeof candidatePath !== "string" || !candidatePath.length) {
    return undefined;
  }
  let normalizedPath = candidatePath.replaceAll("\\", "/");
  if (basePath && path.isAbsolute(candidatePath)) {
    const resolvedBasePath = resolve(basePath);
    const normalizedBasePath = resolvedBasePath.replaceAll("\\", "/");
    const isWithinBasePath = (candidate) => {
      const normalizedCandidate = candidate.replaceAll("\\", "/");
      return (
        normalizedCandidate === normalizedBasePath ||
        normalizedCandidate.startsWith(`${normalizedBasePath}/`)
      );
    };

    const resolvedCandidatePath = resolve(candidatePath);
    if (isWithinBasePath(resolvedCandidatePath)) {
      normalizedPath = relative(
        resolvedBasePath,
        resolvedCandidatePath,
      ).replaceAll("\\", "/");
    } else {
      const rebasedCandidatePath = resolve(
        resolvedBasePath,
        candidatePath.replace(/^([A-Za-z]:)?[\\/]+/, ""),
      );
      if (isWithinBasePath(rebasedCandidatePath)) {
        normalizedPath = relative(
          resolvedBasePath,
          rebasedCandidatePath,
        ).replaceAll("\\", "/");
      }
    }
  }
  return normalizedPath;
}

export function recordSymlinkResolution(
  sourcePath,
  resolvedPath,
  options = {},
) {
  const normalizedSourcePath = normalizeRecordedPathForComparison(
    sourcePath,
    options.basePath,
  );
  const normalizedResolvedPath = normalizeRecordedPathForComparison(
    resolvedPath,
    options.basePath,
  );
  const status = options.status || "completed";
  if (
    !normalizedSourcePath ||
    (status === "completed" &&
      (!normalizedResolvedPath ||
        normalizedSourcePath === normalizedResolvedPath))
  ) {
    return undefined;
  }
  const metadata = {
    capability: "symlink-resolution",
    ...(normalizedResolvedPath ? { resolvedPath: normalizedResolvedPath } : {}),
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
    ...(options.metadata || {}),
  };
  return recordObservedActivity("symlink-resolution", normalizedSourcePath, {
    metadata,
    reason:
      options.reason ||
      (status === "failed"
        ? `Failed to resolve symlink ${normalizedSourcePath}.`
        : `Resolved symlink ${normalizedSourcePath} to ${normalizedResolvedPath}.`),
    status,
  });
}

export function recordEnvironmentRead(varName, options = {}) {
  // Read tracing intentionally mirrors the activity ledger's dry-run/debug behavior.
  if (!(isDryRun || DEBUG_MODE) || !varName) {
    return undefined;
  }
  const source = options.source || "process.env";
  const sensitive =
    options.sensitive ?? isSensitiveEnvironmentVariableName(varName);
  const status = options.status || "completed";
  const traceKey = `${source}:${varName}:${status}`;
  const target = `${source}:${varName}`;
  return recordDeduplicatedRead(
    dryRunReadTraceState.environmentReads,
    traceKey,
    {
      kind: "env",
      redacted: sensitive,
      secretCategory: sensitive ? "environment-variable" : undefined,
      sensitive,
      status,
      target,
    },
    (count) =>
      options.reason || buildEnvironmentReadReason(varName, count, sensitive),
  );
}

export function recordSensitiveFileRead(filePath, options = {}) {
  // Read tracing intentionally mirrors the activity ledger's dry-run/debug behavior.
  if (!(isDryRun || DEBUG_MODE) || !filePath) {
    return undefined;
  }
  const kind = options.kind || "read";
  const pathMetadata = classifyActivityPath(filePath) || {};
  const label = options.label || pathMetadata.label || "sensitive file";
  const status = options.status || "completed";
  const traceKey = `${kind}:${status}:${filePath}`;
  return recordDeduplicatedRead(
    dryRunReadTraceState.sensitiveFileReads,
    traceKey,
    {
      classification: pathMetadata.classification,
      ecosystem: pathMetadata.ecosystem,
      kind,
      redacted: pathMetadata.sensitive ?? true,
      secretCategory:
        pathMetadata.classification === "key"
          ? "private-key"
          : pathMetadata.classification === "certificate"
            ? "certificate"
            : "credential-file",
      status,
      target: filePath,
    },
    (count) =>
      options.reason || buildSensitiveFileReadReason(filePath, count, label),
  );
}

export function readEnvironmentVariable(varName, options = {}) {
  recordEnvironmentRead(varName, options);
  return process.env[varName];
}

export function setDryRunMode(enabled) {
  isDryRun = !!enabled;
  if (enabled) {
    process.env.CDXGEN_DRY_RUN = "true";
    return;
  }
  delete process.env.CDXGEN_DRY_RUN;
}

export function createDryRunError(action, target, reason) {
  const message =
    reason || `Dry run mode blocked the attempted ${action} operation.`;
  const error = new Error(message);
  error.code = DRY_RUN_ERROR_CODE;
  error.name = "DryRunError";
  error.action = action;
  error.target = target;
  error.dryRun = true;
  return error;
}

export function isDryRunError(error) {
  return !!(error?.dryRun || error?.code === DRY_RUN_ERROR_CODE);
}

export const BLOCKED_HOST_ERROR_CODE = "CDXGEN_HOST_BLOCKED";

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
export function createBlockedHostError(target, reason) {
  const error = new Error(reason);
  error.code = BLOCKED_HOST_ERROR_CODE;
  error.name = "BlockedHostError";
  error.target = target;
  error.blockedHost = true;
  return error;
}

export function setActivityContext(context = {}) {
  currentActivityContext = {
    ...currentActivityContext,
    ...context,
  };
}

export function resetActivityContext() {
  currentActivityContext = {};
}

export function recordActivity(activity) {
  if (!(isDryRun || DEBUG_MODE)) {
    return undefined;
  }
  const identifier = `ACT-${String(++activityCounter).padStart(4, "0")}`;
  const entry = {
    identifier,
    ...currentActivityContext,
    timestamp: new Date().toISOString(),
    ...activity,
  };
  activityLedger.push(entry);
  traceLog("activity", entry);
  return entry;
}

dryRunReadTraceState.recordActivity = recordActivity;

export function getRecordedActivities() {
  return [...activityLedger];
}

export function resetRecordedActivities() {
  activityLedger.length = 0;
  activityCounter = 0;
  dryRunReadTraceState.environmentReads.clear();
  dryRunReadTraceState.observations.clear();
  dryRunReadTraceState.sensitiveFileReads.clear();
}

function recordFilesystemActivity(
  kind,
  target,
  status,
  reason = undefined,
  metadata = {},
) {
  return recordActivity({
    kind,
    ...metadata,
    reason,
    status,
    target,
  });
}

export const remoteHostsAccessed = new Set();

export function isAllowedHttpHost(
  hostname,
  allowedHostsEnv = readEnvironmentVariable("CDXGEN_ALLOWED_HOSTS"),
) {
  if (!allowedHostsEnv) {
    return true;
  }
  if (!hostname || hasDangerousUnicode(hostname)) {
    return false;
  }
  const normalizedHostname = hostname.toLowerCase();
  const allow_hosts = allowedHostsEnv
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const ahost of allow_hosts) {
    if (normalizedHostname === ahost) {
      return true;
    }
    // wildcard support
    if (
      ahost.startsWith("*.") &&
      normalizedHostname.length > ahost.length - 1 &&
      normalizedHostname.endsWith(`.${ahost.slice(2)}`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks for dangerous Unicode characters that could enable homograph attacks
 *
 * @param {string} str String to check
 * @returns {boolean} true if dangerous Unicode is found
 */
// biome-ignore-start lint/suspicious/noControlCharactersInRegex: validation
export function hasDangerousUnicode(str) {
  // Check for bidirectional control characters
  const bidiChars = /[\u202A-\u202E\u2066-\u2069]/;
  if (bidiChars.test(str)) {
    return true;
  }

  // Check for zero-width characters that could be used for obfuscation
  const zeroWidthChars = /[\u200B-\u200D\uFEFF]/;
  if (zeroWidthChars.test(str)) {
    return true;
  }

  // Check for control characters (except common ones like \n, \r, \t)
  const controlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  return controlChars.test(str);
}
// biome-ignore-end lint/suspicious/noControlCharactersInRegex: validation

function hostnameMatches(hostname, candidateHost) {
  return hostname === candidateHost || hostname.endsWith(`.${candidateHost}`);
}

function inferNetworkIntent(requestUrl) {
  const hostname = requestUrl?.hostname?.toLowerCase() || "";
  const pathname = requestUrl?.pathname?.toLowerCase() || "";
  if (pathname.includes("/api/v1/bom")) {
    return "sbom-submit";
  }
  if (pathname.includes("/manifests/")) {
    return "oci-manifest-access";
  }
  if (pathname.includes("/blobs/")) {
    return "oci-layer-access";
  }
  if (
    pathname.includes("license") ||
    hostnameMatches(hostname, "spdx.org") ||
    hostnameMatches(hostname, "opensource.org")
  ) {
    return "license-fetch";
  }
  if (
    hostnameMatches(hostname, "registry.npmjs.org") ||
    hostnameMatches(hostname, "pypi.org") ||
    hostnameMatches(hostname, "rubygems.org") ||
    hostnameMatches(hostname, "repo.maven.apache.org") ||
    hostnameMatches(hostname, "repo1.maven.org") ||
    hostnameMatches(hostname, "crates.io") ||
    hostnameMatches(hostname, "pub.dev") ||
    hostnameMatches(hostname, "nuget.org")
  ) {
    return "registry-lookup";
  }
  if (hostnameMatches(hostname, "github.com") && pathname.endsWith(".git")) {
    return "git-fetch";
  }
  return "metadata-fetch";
}

// Custom user-agent for cdxgen
export const cdxgenAgent = createHttpClient({
  headers: {
    "user-agent": `@CycloneDX/cdxgen ${CDXGEN_VERSION}`,
  },
  // Bound every request so an unresponsive host cannot hang a scan. Overridable
  // via CDXGEN_HTTP_TIMEOUT_MS; individual calls may pass a smaller `timeout`.
  timeout: getDefaultHttpTimeoutMs(),
  retry: {
    limit: 0,
  },
  followRedirect: !isSecureMode,
  hooks: {
    beforeRequest: [
      (options) => {
        const networkIntent =
          options.context?.activityIntent || inferNetworkIntent(options.url);
        const allowedHostsEnv = readEnvironmentVariable("CDXGEN_ALLOWED_HOSTS");
        const hostAllowed = isAllowedHttpHost(
          options.url.hostname,
          allowedHostsEnv,
        );
        options.context = {
          ...options.context,
          activityIntent: networkIntent,
          activityTarget: options.url.toString(),
        };
        if (allowedHostsEnv) {
          recordPolicyActivity(options.url.hostname, {
            metadata: {
              allowed: hostAllowed,
              allowlist: allowedHostsEnv,
              networkIntent,
              policyType: "host-allowlist",
            },
            reason: `${hostAllowed ? "Allowed" : "Blocked"} host ${options.url.hostname} against CDXGEN_ALLOWED_HOSTS.`,
            status: hostAllowed ? "completed" : "blocked",
            traceDetail: "host-allowlist",
          });
        }
        if (isDryRun) {
          const error = createDryRunError(
            "network",
            options.url.toString(),
            `Dry run mode blocks outbound network access (${networkIntent}).`,
          );
          recordActivity({
            kind: "network",
            networkIntent,
            reason: error.message,
            status: "blocked",
            target: options.url.toString(),
          });
          options.context.activityBlocked = true;
          throw error;
        }
        if (!hostAllowed) {
          console.log(
            `Access to the remote host '${options.url.hostname}' is not permitted.`,
          );
          recordActivity({
            kind: "network",
            networkIntent,
            reason: "The remote host is not permitted.",
            status: "blocked",
            target: options.url.toString(),
          });
          options.context.activityBlocked = true;
          throw createBlockedHostError(
            options.url.toString(),
            `The remote host '${options.url.hostname}' is not permitted by CDXGEN_ALLOWED_HOSTS.`,
          );
        }
        // Only allow https protocol in secure mode
        if (isSecureMode && options.url.protocol !== "https:") {
          console.log(
            `Access to the remote host '${options.url.hostname}' is not permitted via the '${options.url.protocol}' protocol.`,
          );
          recordActivity({
            kind: "network",
            networkIntent,
            reason: `The '${options.url.protocol}' protocol is not permitted in secure mode.`,
            status: "blocked",
            target: options.url.toString(),
          });
          options.context.activityBlocked = true;
          throw createBlockedHostError(
            options.url.toString(),
            `The '${options.url.protocol}' protocol is not permitted in secure mode.`,
          );
        }
        remoteHostsAccessed.add(options.url.hostname);
        traceLog("http", {
          protocol: options.url.protocol,
          pathname: options.url.pathname,
          host: options.url.host,
        });
      },
    ],
    afterResponse: [
      (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return response;
        }
        const activityTarget =
          response.request.options.context?.activityTarget ||
          response.request.options.url?.toString() ||
          response.url;
        recordActivity({
          kind: "network",
          networkIntent: response.request.options.context?.activityIntent,
          status: "completed",
          target: activityTarget,
        });
        return response;
      },
    ],
    beforeError: [
      (error) => {
        if (error.options?.context?.activityBlocked) {
          return error;
        }
        recordActivity({
          kind: "network",
          networkIntent: error.options?.context?.activityIntent,
          reason: error.message,
          status: "failed",
          target:
            error.options?.context?.activityTarget ||
            error.options?.url?.toString(),
        });
        return error;
      },
    ],
  },
});

export {
  buildReadCountSuffix,
  classifyActivityPath,
  classifyDiscoveryPattern,
  recordFilesystemActivity,
};
