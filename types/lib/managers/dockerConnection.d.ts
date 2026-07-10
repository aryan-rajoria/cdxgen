/**
 * undici-backed connection helper for talking to the local Docker / Podman
 * daemon (over a unix socket) or a remote daemon (over TCP/TLS). This replaces
 * cdxgen's previous use of `got` for daemon communication.
 *
 * @module dockerConnection
 */
export declare const DAEMON_RETRY_OPTIONS: {
    maxRetries: number;
    methods: string[];
    statusCodes: number[];
};
/**
 * Parse a got-style Docker daemon `prefixUrl` into the pieces undici needs.
 * Unix socket URLs use the form `http://unix:/path/to/socket:`; anything else
 * is treated as a regular TCP/TLS base URL.
 *
 * @param {string} prefixUrl got-style prefix URL for the daemon endpoint.
 * @returns {{socketPath: (string|undefined), baseUrl: string}} The unix socket
 *   path (when applicable) and the origin to use as the undici base URL.
 */
export declare const parseDaemonPrefixUrl: (prefixUrl: string) => {
    socketPath: (string | undefined);
    baseUrl: string;
};
/**
 * Create a connection to the Docker / Podman daemon backed by undici. The
 * returned object mimics the small slice of the got client that cdxgen relies
 * on: a `request()` method returning a parsed body and a synchronous `stream()`
 * method returning a readable image tar stream.
 *
 * @param {string} prefixUrl got-style daemon prefix URL (unix socket or TCP).
 * @param {Object} [headers] Default headers (e.g. `X-Registry-Auth`) to send.
 * @param {Object} [https] TLS material for remote daemons
 *   (`{ certificate, key, rejectUnauthorized }`).
 * @returns {Object} Connection object with `request`, `stream`, `close`,
 *   `prefixUrl` and `baseUrl`.
 */
export declare const createDaemonConnection: (prefixUrl: string, headers?: Object, https?: Object) => Object;
//# sourceMappingURL=dockerConnection.d.ts.map