/**
 * Per-host rate policy for batched registry fetches.
 *
 * This is the single source of truth for the JS transport's concurrency and
 * minimum-interval decisions. The numbers are shared with the Rust transport
 * (`cdxgen-plugins-bin/thirdparty/cdxrs/src/fetch/rate.rs`); a change to one
 * side must be reflected in the other, and `fetchRate.poku.js` pins them so a
 * drift is visible.
 *
 * Why a per-host table rather than a single global interval: a single-registry
 * project — which is to say, almost every npm project — has exactly one host,
 * so a conservative per-host cap *is* the global cap. Applying crates.io's
 * 250 ms to every host caps an npm run at 4 requests per second, which is
 * slower than the serial JS path once connection reuse is taken into account.
 * Hosts that publish a limit get an interval; hosts that do not are bounded by
 * the per-host concurrency cap alone, and by whatever `Retry-After` they send.
 */

import { readEnvironmentVariable } from "../core/activity.js";

/**
 * Whether a credential will be sent to the host.
 *
 * GitHub is the reason this exists: 60 requests an hour anonymously against
 * 5000 with a token is not a difference of degree. Applying the anonymous
 * budget to a token-bearing client throws away the point of having set
 * `GITHUB_TOKEN`.
 *
 * @typedef {("anonymous"|"authenticated")} Credentials
 */

/**
 * The policy for one host: the minimum gap between two requests and the
 * maximum number in flight.
 *
 * @typedef {Object} HostPolicy
 * @property {number} minInterval Minimum gap between requests, in milliseconds.
 * @property {number} maxConcurrency Maximum requests in flight to this host.
 */

/**
 * Hosts that publish a rate limit, and what they publish.
 *
 * Columns: host, anonymous interval (ms), anonymous concurrency, authenticated
 * interval (ms), authenticated concurrency. A host whose limit does not change
 * with a credential repeats the same pair.
 *
 * Suffix match is used so `index.crates.io` inherits `crates.io`.
 */
const HOST_POLICIES = [
  // crates.io's published budget is per IP and does not improve with a token.
  {
    host: "crates.io",
    anonInterval: 250,
    anonConcurrency: 4,
    authInterval: 250,
    authConcurrency: 4,
  },
  // GitHub: 60 req/h anonymous, 5000 req/h authenticated. The limit is an
  // hourly budget rather than a rate, so a batch of a few hundred lookups is
  // well inside it once a token is present.
  {
    host: "api.github.com",
    anonInterval: 250,
    anonConcurrency: 4,
    authInterval: 0,
    authConcurrency: 8,
  },
  {
    host: "github.com",
    anonInterval: 250,
    anonConcurrency: 4,
    authInterval: 0,
    authConcurrency: 8,
  },
  // GitLab: 2000 req/min authenticated against 500 unauthenticated.
  {
    host: "gitlab.com",
    anonInterval: 250,
    anonConcurrency: 4,
    authInterval: 0,
    authConcurrency: 8,
  },
  {
    host: "pkg.go.dev",
    anonInterval: 250,
    anonConcurrency: 4,
    authInterval: 250,
    authConcurrency: 4,
  },
];

/**
 * Concurrency allowed for a host with no published limit. Registries that are
 * CDN-fronted document store fronts (npm, PyPI, RubyGems, NuGet, pub.dev) sit
 * here; the global cap is what bounds them.
 */
export const DEFAULT_HOST_CONCURRENCY = 16;

/**
 * Global cap on in-flight requests across every host. Per-host caps cannot
 * sum past this; a 16-way global batch saturates a large npm run without
 * putting any single host above its published allowance.
 */
export const DEFAULT_GLOBAL_CONCURRENCY = 16;

/**
 * Resolve the credential class for a host based on the environment.
 *
 * Only token presence is considered, never its value. A host we hold no token
 * for keeps the anonymous budget even if some other host has one. Today only
 * GitHub tokens are honoured, matching the Rust client.
 *
 * @param {string} host The hostname to classify.
 * @returns {Credentials}
 */
export function credentialsFor(host) {
  const lower = host.toLowerCase();
  const isGitHub =
    lower === "api.github.com" ||
    lower === "github.com" ||
    lower.endsWith(".github.com");
  if (isGitHub && readEnvironmentVariable("GITHUB_TOKEN")) {
    return "authenticated";
  }
  return "anonymous";
}

/**
 * Resolve the published policy for a host, or the CDN default.
 *
 * @param {string} host The hostname.
 * @param {Credentials} [credentials] Credential class; defaults to what the
 *   environment would actually send to this host.
 * @returns {HostPolicy}
 */
export function policyFor(host, credentials) {
  const lower = (host || "").toLowerCase();
  const cred = credentials || credentialsFor(host);
  for (const candidate of HOST_POLICIES) {
    const matches =
      lower === candidate.host || lower.endsWith(`.${candidate.host}`);
    if (!matches) {
      continue;
    }
    if (cred === "authenticated") {
      return {
        minInterval: candidate.authInterval,
        maxConcurrency: candidate.authConcurrency,
      };
    }
    return {
      minInterval: candidate.anonInterval,
      maxConcurrency: candidate.anonConcurrency,
    };
  }
  return { minInterval: 0, maxConcurrency: DEFAULT_HOST_CONCURRENCY };
}

/**
 * The table of published policies, exposed for the parity test. The shape is
 * stable: changing an entry is a policy change that must be mirrored in
 * `rate.rs`.
 */
export const PUBLISHED_HOST_POLICIES = HOST_POLICIES.map((entry) => ({
  ...entry,
}));

/**
 * Create a minimum-interval gate for one host.
 *
 * `wait()` queues the caller so that successive calls are at least
 * `minInterval` apart. `externalDelay()` pushes the gate out by a server-side
 * back-off (`Retry-After`, `X-RateLimit-Reset`) and is counted.
 */
export class RateLimiter {
  /**
   * @param {number} minInterval Minimum gap between requests, in milliseconds.
   */
  constructor(minInterval) {
    this._minInterval = minInterval;
    this._nextAvailable = 0;
    this._externalDelays = 0;
  }

  /**
   * Wait until this host's gate opens, then reserve the next slot. Callers
   * that arrive while the gate is closed queue up rather than all being
   * released together.
   *
   * @returns {Promise<void>}
   */
  async wait() {
    const now = Date.now();
    // The slot is reserved synchronously, before any await, so concurrent
    // callers each take a distinct slot instead of all reading the same gate.
    const slot = Math.max(this._nextAvailable, now);
    this._nextAvailable = slot + this._minInterval;
    const delay = slot - now;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Record a server-imposed delay and push the gate out to at least now plus
   * the delay. The caller is still responsible for actually waiting before it
   * retries; recording alone does not sleep.
   *
   * @param {number} delayMs Delay in milliseconds.
   */
  externalDelay(delayMs) {
    this._externalDelays += 1;
    const target = Date.now() + delayMs;
    if (target > this._nextAvailable) {
      this._nextAvailable = target;
    }
  }

  /** @returns {number} How many times this host asked us to slow down. */
  get externalDelayCount() {
    return this._externalDelays;
  }
}

/**
 * Create a counting semaphore with a FIFO wait queue. Used both for the global
 * concurrency cap and the per-host cap.
 *
 * @param {number} limit Maximum simultaneous holders.
 * @returns {{acquire: () => Promise<() => void>}} An `acquire` function that
 *   resolves once a slot is free, with a `release` function as its value.
 */
export function makeSemaphore(limit) {
  let available = Math.max(1, limit);
  const waiters = [];
  return {
    async acquire() {
      if (available > 0) {
        available -= 1;
        return release;
      }
      await new Promise((resolve) => waiters.push(resolve));
      return release;
    },
  };
  function release() {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      available += 1;
    }
  }
}
