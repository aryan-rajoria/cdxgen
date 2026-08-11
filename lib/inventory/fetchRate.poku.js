import process from "node:process";

import { assert, describe, it } from "poku";

import {
  credentialsFor,
  DEFAULT_GLOBAL_CONCURRENCY,
  DEFAULT_HOST_CONCURRENCY,
  makeSemaphore,
  PUBLISHED_HOST_POLICIES,
  policyFor,
  RateLimiter,
} from "./fetchRate.js";

/**
 * Pin the shared policy numbers so a change to the JS side is visible against
 * the Rust side (`cdxgen-plugins-bin/thirdparty/cdxrs/src/fetch/rate.rs`).
 * Where the two would disagree, they are wrong; these constants are the
 * contract between the two transports.
 */
describe("fetchRate policy parity with rate.rs", () => {
  it("exposes the default host and global concurrency caps", () => {
    assert.strictEqual(DEFAULT_HOST_CONCURRENCY, 16);
    assert.strictEqual(DEFAULT_GLOBAL_CONCURRENCY, 16);
  });

  it("matches the Rust HOST_POLICIES table", () => {
    // Columns in rate.rs: (host, anon_ms, anon_conc, auth_ms, auth_conc).
    const expected = [
      {
        host: "crates.io",
        anonInterval: 250,
        anonConcurrency: 4,
        authInterval: 250,
        authConcurrency: 4,
      },
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
    assert.deepStrictEqual(
      PUBLISHED_HOST_POLICIES,
      expected,
      "HOST_POLICIES drifted from rate.rs — update both sides",
    );
  });

  it("applies crates.io's published per-IP budget", () => {
    const p = policyFor("crates.io", "anonymous");
    assert.strictEqual(p.minInterval, 250);
    assert.strictEqual(p.maxConcurrency, 4);
  });

  it("applies suffix match so index.crates.io inherits crates.io", () => {
    const p = policyFor("index.crates.io", "anonymous");
    assert.strictEqual(p.minInterval, 250);
  });

  it("gives an authenticated GitHub client more concurrency than anonymous", () => {
    // 60 req/h anonymous against 5000 with a token: applying the anonymous
    // budget to a token-bearing client throws away the point of the token.
    const anon = policyFor("api.github.com", "anonymous");
    const auth = policyFor("api.github.com", "authenticated");
    assert.strictEqual(anon.maxConcurrency, 4);
    assert.strictEqual(anon.minInterval, 250);
    assert.strictEqual(auth.maxConcurrency, 8);
    assert.strictEqual(auth.minInterval, 0);
  });

  it("leaves crates.io unchanged when authenticated (per-IP, not per-token)", () => {
    assert.deepStrictEqual(
      policyFor("crates.io", "authenticated"),
      policyFor("crates.io", "anonymous"),
    );
  });

  it("does not throttle CDN-fronted registries", () => {
    for (const host of ["registry.npmjs.org", "pypi.org", "rubygems.org"]) {
      const p = policyFor(host, "anonymous");
      assert.strictEqual(p.minInterval, 0, `${host} got an interval`);
      assert.strictEqual(p.maxConcurrency, DEFAULT_HOST_CONCURRENCY);
    }
  });

  it("does not match a host that merely contains a published substring", () => {
    // A registry that impersonates crates.io by containing its name must not
    // inherit its budget. This is the trap that suffix-match-on-substring
    // falls into; the dot-prefixed suffix match avoids it.
    assert.strictEqual(
      policyFor("crates.io.evil.example", "anonymous").minInterval,
      0,
    );
  });
});

describe("credentialsFor", () => {
  const previousToken = process.env.GITHUB_TOKEN;
  it("classifies GitHub hosts as authenticated only when a token is present", () => {
    delete process.env.GITHUB_TOKEN;
    assert.strictEqual(credentialsFor("api.github.com"), "anonymous");
    assert.strictEqual(credentialsFor("github.com"), "anonymous");
    assert.strictEqual(credentialsFor("crates.io"), "anonymous");
    process.env.GITHUB_TOKEN = "ghp_test";
    try {
      assert.strictEqual(credentialsFor("api.github.com"), "authenticated");
      assert.strictEqual(credentialsFor("github.com"), "authenticated");
      assert.strictEqual(credentialsFor("sub.github.com"), "authenticated");
      // A GitHub token must not raise anyone else's budget.
      assert.strictEqual(credentialsFor("crates.io"), "anonymous");
    } finally {
      if (previousToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousToken;
      }
    }
  });
});

describe("RateLimiter", () => {
  it("spreads successive waits by minInterval", async () => {
    const limiter = new RateLimiter(40);
    const started = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    // First is free; the next two are 40 ms apart, so >= 60 ms with slack.
    assert.ok(
      Date.now() - started >= 60,
      `interval not enforced: ${Date.now() - started} ms`,
    );
  });

  it("does not sleep when minInterval is zero", async () => {
    const limiter = new RateLimiter(0);
    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      await limiter.wait();
    }
    assert.ok(Date.now() - started < 50, "unthrottled limiter slept");
  });

  it("records and applies an external delay", async () => {
    const limiter = new RateLimiter(0);
    limiter.externalDelay(80);
    assert.strictEqual(limiter.externalDelayCount, 1);
    const started = Date.now();
    await limiter.wait();
    assert.ok(
      Date.now() - started >= 60,
      "external delay did not push the gate",
    );
  });
});

describe("makeSemaphore", () => {
  it("bounds concurrent holders and queues the rest", async () => {
    const sem = makeSemaphore(2);
    let inFlight = 0;
    let peak = 0;
    const task = async () => {
      const release = await sem.acquire();
      inFlight += 1;
      if (inFlight > peak) {
        peak = inFlight;
      }
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      release();
    };
    await Promise.all(Array.from({ length: 8 }, task));
    assert.strictEqual(peak, 2, "semaphore leaked past its limit");
  });

  it("clamps a zero limit to one rather than deadlocking", async () => {
    const sem = makeSemaphore(0);
    const release = await sem.acquire();
    release();
    // Reaching this line means acquire resolved rather than hanging forever.
    assert.ok(true);
  });
});
