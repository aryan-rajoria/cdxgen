/**
 * Inspect the environment for security risks and return a list of findings.
 *
 * Checks include Node.js `NODE_OPTIONS`/`CDXGEN_NODE_OPTIONS` code-execution
 * and permission flags, TLS bypass indicators, proxy interception, suspicious
 * credential-naming variables, JVM agent injection (for JVM project types),
 * root/Deno permission elevation, and debug exposure.
 *
 * @param {Object} [env=process.env] The environment record to audit.
 * @param {Object} [options={}] CLI options used to scope JVM checks.
 * @returns {Object[]} Security findings describing detected risks.
 */
export declare function auditEnvironment(env?: Object, options?: Object): Object[];
//# sourceMappingURL=envAudit.d.ts.map