/**
 * Measured comparison of the serial JS registry fetch against the batched Rust
 * one.
 *
 * No extrapolation: both paths are run against the same local registry double
 * with the same injected per-response latency, and the wall clock is reported.
 * Latency is injected rather than borrowed from a real registry because the
 * numbers have to be reproducible on a laptop and in CI — and because the thing
 * being measured is the serialisation, not npm's CDN.
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

async function timeRun({ packages, registryUrl, rustDisabled, cacheDir }) {
  const previous = {
    NPM_URL: process.env.NPM_URL,
    CDXGEN_RS_DISABLE: process.env.CDXGEN_RS_DISABLE,
    CDXGEN_CACHE_DIR: process.env.CDXGEN_CACHE_DIR,
    CDXGEN_CACHE_LOOPBACK: process.env.CDXGEN_CACHE_LOOPBACK,
  };
  process.env.NPM_URL = registryUrl;
  process.env.CDXGEN_CACHE_DIR = cacheDir;
  // The benchmark measures cache hits against a loopback registry double.
  // Loopback hosts are excluded from the cache by default; the override
  // re-enables caching so the warm-cache row is a real measurement.
  process.env.CDXGEN_CACHE_LOOPBACK = "1";
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
    const server = await startRegistry(args.latency);
    const cache = path.join(process.cwd(), `.bench-cache-js-${process.pid}`);
    try {
      const run = await timeRun({
        packages: args.packages,
        registryUrl: server.url,
        rustDisabled: true,
        cacheDir: cache,
      });
      rows.push({
        path: "JS serial (v12 shape)",
        ms: run.elapsedMs,
        requests: server.served,
        enriched: run.enriched,
      });
    } finally {
      await server.stop();
      rmSync(cache, { recursive: true, force: true });
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

  const js = rows.find((r) => r.path.startsWith("JS"));
  const rust = rows.find((r) => r.path.includes("cold"));
  if (js && rust) {
    console.log(
      `\nspeedup (cold cache): ${(js.ms / rust.ms).toFixed(1)}x  (${js.ms.toFixed(
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
