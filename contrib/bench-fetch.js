/**
 * Measured comparison of the serial JS registry fetch against the batched JS
 * and Rust transports.
 *
 * No extrapolation: every path is run against the same local registry double
 * with the same injected per-response latency, and the wall clock is reported.
 * Latency is injected rather than borrowed from a real registry because the
 * numbers have to be reproducible on a laptop and in CI — and because the thing
 * being measured is the serialisation, not npm's CDN.
 *
 * Three rows are measured when the cdxrs binary is available (two when it is
 * not):
 *
 *   JS serial  — `CDXGEN_CASSETTE_REPLAY` forces `prefetchEnabled()` off, so
 *                every `cdxgenAgent.get` is awaited in a for-loop body. This is
 *                what every cdxgen user gets today when the binary is absent.
 *   JS batched — the JS pool from `lib/inventory/fetchBatch.js`, concurrency
 *                bounded by the shared per-host policy. This is what this round
 *                ships as the no-binary path.
 *   Rust batched — `cdxrs fetch`, cold and warm cache, for comparison.
 *
 * Usage:
 *   node contrib/bench-fetch.js                 # default: 200 pkgs, 50ms RTT
 *   node contrib/bench-fetch.js --packages 500 --latency 100
 *   node contrib/bench-fetch.js --packages 2000 --latency 100 --skip-js
 *
 * `--skip-js` exists because the serial path at 2000 packages x 100 ms takes
 * several minutes by construction; that is the finding, not a reason to wait for
 * it on every run.
 */

import { rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { packages: 200, latency: 50, skipJs: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--packages") {
      args.packages = Number.parseInt(argv[++i], 10);
    } else if (arg === "--latency") {
      args.latency = Number.parseInt(argv[++i], 10);
    } else if (arg === "--skip-js") {
      args.skipJs = true;
    }
  }
  return args;
}

/** An npm registry double that delays every response by `latencyMs`. */
async function startRegistry(latencyMs) {
  let served = 0;
  const server = createServer((req, res) => {
    served++;
    const name = decodeURIComponent(req.url.slice(1));
    const body = {
      name,
      description: `Package ${name}`,
      license: "MIT",
      homepage: `https://example.com/${name}`,
      repository: { url: `git+https://github.com/example/${name}.git` },
      versions: {
        "1.0.0": {
          name,
          version: "1.0.0",
          description: `Package ${name}`,
          license: "MIT",
          dist: {
            tarball: `https://example.com/${name}/-/${name}-1.0.0.tgz`,
            shasum: "a".repeat(40),
          },
        },
      },
    };
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }, latencyMs);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    get served() {
      return served;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function timeRun({ packages, registryUrl, rustDisabled, cacheDir, forceSerial }) {
  const previous = {
    NPM_URL: process.env.NPM_URL,
    CDXGEN_RS_DISABLE: process.env.CDXGEN_RS_DISABLE,
    CDXGEN_CACHE_DIR: process.env.CDXGEN_CACHE_DIR,
    CDXGEN_CACHE_LOOPBACK: process.env.CDXGEN_CACHE_LOOPBACK,
    CDXGEN_CASSETTE_REPLAY: process.env.CDXGEN_CASSETTE_REPLAY,
  };
  process.env.NPM_URL = registryUrl;
  process.env.CDXGEN_CACHE_DIR = cacheDir;
  // The benchmark measures cache hits against a loopback registry double.
  // Loopback hosts are excluded from the cache by default; the override
  // re-enables caching so the warm-cache row is a real measurement.
  process.env.CDXGEN_CACHE_LOOPBACK = "1";
  if (forceSerial) {
    // `CDXGEN_CASSETTE_REPLAY` is the single switch `prefetchEnabled()` checks
    // to decide whether batching runs at all. Setting it without installing a
    // cassette interceptor leaves HTTP untouched — the only effect is that
    // every caller falls back to its own serial `cdxgenAgent.get`. That is the
    // pre-D27 no-binary path, measured here as the baseline.
    process.env.CDXGEN_CASSETTE_REPLAY = "true";
  } else {
    delete process.env.CDXGEN_CASSETTE_REPLAY;
  }
  if (rustDisabled) {
    process.env.CDXGEN_RS_DISABLE = "fetch";
  } else {
    delete process.env.CDXGEN_RS_DISABLE;
  }
  try {
    const { resetBatchFetchAvailability, lastBatchStats } = await import(
      path.join(REPO_ROOT, "lib", "inventory", "fetchBatch.js")
    );
    resetBatchFetchAvailability();
    // Fresh module instance, so the in-memory metadata_cache cannot carry
    // results from one run of the comparison into the other.
    const mod = await import(
      `${path.join(REPO_ROOT, "lib", "ecosystems", "ecosystems.js")}?t=${Math.random()}`
    );
    const pkgList = Array.from({ length: packages }, (_, i) => ({
      name: `pkg-${i}`,
      version: "1.0.0",
    }));
    const started = process.hrtime.bigint();
    const result = await mod.getNpmMetadata(pkgList);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      elapsedMs,
      enriched: result.filter((p) => p.license).length,
      stats: lastBatchStats(),
    };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { cdxrsAvailable } = await import(
    path.join(REPO_ROOT, "lib", "inventory", "cdxrs.js")
  );
  const availability = cdxrsAvailable("fetch");

  console.log("=== registry fetch benchmark ===");
  console.log(
    `packages=${args.packages} injected latency=${args.latency}ms node=${process.version} platform=${process.platform}/${process.arch}`,
  );
  console.log(
    `cdxrs fetch: ${
      availability.available
        ? `available (${availability.version})`
        : `unavailable (${availability.reason})`
    }\n`,
  );

  const rows = [];

  if (!args.skipJs) {
    // JS serial: the baseline that every no-binary user pays today. Forced by
    // telling `prefetchEnabled()` to stay off, so getNpmMetadata awaits every
    // cdxgenAgent.get in a for-loop body.
    const serialServer = await startRegistry(args.latency);
    const serialCache = path.join(
      process.cwd(),
      `.bench-cache-serial-${process.pid}`,
    );
    try {
      const run = await timeRun({
        packages: args.packages,
        registryUrl: serialServer.url,
        rustDisabled: true,
        cacheDir: serialCache,
        forceSerial: true,
      });
      rows.push({
        path: "JS serial (no batch)",
        ms: run.elapsedMs,
        requests: serialServer.served,
        enriched: run.enriched,
      });
    } finally {
      await serialServer.stop();
      rmSync(serialCache, { recursive: true, force: true });
    }

    // JS batched: the pool this round ships. Rust is disabled; the JS batcher
    // runs every request through cdxgenAgent with the shared per-host policy.
    const jsServer = await startRegistry(args.latency);
    const jsCache = path.join(process.cwd(), `.bench-cache-js-${process.pid}`);
    try {
      const run = await timeRun({
        packages: args.packages,
        registryUrl: jsServer.url,
        rustDisabled: true,
        cacheDir: jsCache,
        forceSerial: false,
      });
      rows.push({
        path: "JS batched (pool)",
        ms: run.elapsedMs,
        requests: jsServer.served,
        enriched: run.enriched,
        peak: run.stats?.peakConcurrency,
      });
    } finally {
      await jsServer.stop();
      rmSync(jsCache, { recursive: true, force: true });
    }
  }

  if (availability.available) {
    const server = await startRegistry(args.latency);
    const cache = path.join(
      process.cwd(),
      `.bench-cache-rust-${process.pid}-${Date.now()}`,
    );
    try {
      const cold = await timeRun({
        packages: args.packages,
        registryUrl: server.url,
        rustDisabled: false,
        cacheDir: cache,
      });
      rows.push({
        path: "Rust batched (cold cache)",
        ms: cold.elapsedMs,
        requests: server.served,
        enriched: cold.enriched,
        peak: cold.stats?.peakConcurrency,
      });
      const afterCold = server.served;
      const warm = await timeRun({
        packages: args.packages,
        registryUrl: server.url,
        rustDisabled: false,
        cacheDir: cache,
      });
      rows.push({
        path: "Rust batched (warm cache)",
        ms: warm.elapsedMs,
        requests: server.served - afterCold,
        enriched: warm.enriched,
        cacheHits: warm.stats?.cacheHits,
      });
    } finally {
      await server.stop();
      rmSync(cache, { recursive: true, force: true });
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad("path", 28)}${pad("wall ms", 12)}${pad("requests", 10)}${pad("enriched", 10)}notes`,
  );
  for (const row of rows) {
    const notes = [
      row.peak !== undefined ? `peak concurrency ${row.peak}` : "",
      row.cacheHits !== undefined ? `${row.cacheHits} cache hits` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `${pad(row.path, 28)}${pad(row.ms.toFixed(0), 12)}${pad(row.requests, 10)}${pad(row.enriched, 10)}${notes}`,
    );
  }

  const serial = rows.find((r) => r.path.includes("serial"));
  const jsBatched = rows.find((r) => r.path === "JS batched (pool)");
  const rust = rows.find((r) => r.path.includes("cold"));
  if (serial && jsBatched) {
    console.log(
      `\nspeedup JS batched vs serial: ${(serial.ms / jsBatched.ms).toFixed(
        1,
      )}x  (${serial.ms.toFixed(0)} ms -> ${jsBatched.ms.toFixed(0)} ms)`,
    );
  }
  if (jsBatched && rust) {
    console.log(
      `speedup Rust cold vs JS batched: ${(jsBatched.ms / rust.ms).toFixed(
        1,
      )}x  (${jsBatched.ms.toFixed(0)} ms -> ${rust.ms.toFixed(0)} ms)`,
    );
  }
  if (serial && rust) {
    console.log(
      `speedup Rust cold vs JS serial: ${(serial.ms / rust.ms).toFixed(1)}x  (${serial.ms.toFixed(
        0,
      )} ms -> ${rust.ms.toFixed(0)} ms)`,
    );
  }
  // Every path must have enriched the same number of packages, or the
  // comparison is between different amounts of work.
  const enrichedCounts = new Set(rows.map((r) => r.enriched));
  if (enrichedCounts.size > 1) {
    console.error(
      `\nWARNING: paths enriched different package counts (${[
        ...enrichedCounts,
      ]}) — the comparison is not like-for-like`,
    );
    return 1;
  }
  // The warm-cache row must actually have hit the cache. A blanket loopback
  // exclusion silently reduces it to a second cold run, making the benchmark
  // that justifies the whole cache measure nothing while printing a plausible
  // number. Fail loudly if this regresses.
  const warmRow = rows.find((r) => r.path.includes("warm"));
  if (warmRow && !(warmRow.cacheHits > 0)) {
    console.error(
      `\nFAIL: the warm-cache row reported ${warmRow.cacheHits} cache hits. ` +
        "The benchmark is not measuring a cached run — check CDXGEN_CACHE_LOOPBACK and the loopback exclusion.",
    );
    return 1;
  }
  return 0;
}

process.exit(await main());
