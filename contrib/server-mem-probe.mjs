/**
 * Preloaded into the cdxgen server child (node --import) by
 * server-abort-poc.mjs, so it can look inside the server process without
 * editing lib/. Opens a probe HTTP server on CDXGEN_PROBE_PORT with:
 *   GET /mem       -> process.memoryUsage() + v8.getHeapStatistics()
 *   GET /gc        -> forces full GC (needs --expose-gc), returns /mem after
 *   GET /snapshot  -> writes a .heapsnapshot, returns its path
 * The probe server is unref'd so it never keeps the process alive on its own.
 */
import http from "node:http";
import path from "node:path";
import process from "node:process";
import v8 from "node:v8";

const port = Number(process.env.CDXGEN_PROBE_PORT || 0);
const outDir = process.env.CDXGEN_PROBE_DIR || ".";

function snapshotStats() {
  return {
    rss: process.memoryUsage.rss(),
    ...process.memoryUsage(),
    heap: v8.getHeapStatistics(),
    spaces: v8.getHeapSpaceStatistics(),
  };
}

function forceGc() {
  if (typeof globalThis.gc !== "function") return false;
  // Several passes: one major GC does not always finish off everything that
  // became unreachable during the previous pass.
  for (let i = 0; i < 4; i++) {
    globalThis.gc();
  }
  return true;
}

if (port) {
  const probe = http.createServer((req, res) => {
    const url = new URL(req.url, "http://probe");
    const json = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/mem") return json(snapshotStats());
    if (url.pathname === "/gc") {
      const ok = forceGc();
      return json({ gc: ok, ...snapshotStats() });
    }
    if (url.pathname === "/snapshot") {
      if (url.searchParams.get("gc") !== "0") forceGc();
      const file = path.join(
        outDir,
        `${url.searchParams.get("tag") || "snap"}.heapsnapshot`,
      );
      v8.writeHeapSnapshot(file);
      return json({ file, ...snapshotStats() });
    }
    res.writeHead(404).end();
  });
  probe.listen(port, "127.0.0.1", () => {
    console.log(`probe listening on ${port}`);
  });
  probe.unref();
}
