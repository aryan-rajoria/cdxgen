/**
 * Which transport a batch is dispatched to.
 *
 * The cdxrs envelope types a result body as JSON, so a batch asking for text
 * or bytes has to run on the JS pool even when the binary is available. These
 * tests stub the bridge so both branches can be observed without a real
 * binary on disk.
 *
 * They live in their own file, and inside an awaited `describe`, because they
 * mutate CDXGEN_RS_DISABLE and GITHUB_TOKEN and reset the memoized availability
 * probe. poku fires `it` calls as fire-and-forget promises, so without both
 * they would leak into each other and into the other fetchBatch suites.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import process from "node:process";

import esmock from "esmock";
import { describe, it } from "poku";

async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Load fetchBatch with the cdxrs bridge stubbed out as available, recording
 * every subprocess invocation it would make.
 */
async function loadWithStubbedCdxrs(calls) {
  return await esmock("./fetchBatch.js", {
    "./cdxrs.js": {
      cdxrsAvailable: () => ({ available: true }),
      cdxrsDisabled: () => false,
      runCdxrs: async (subcommand, opts) => {
        calls.push({ subcommand, opts });
        return { ok: true, stdout: JSON.stringify({ results: [] }) };
      },
    },
  });
}

describe("batch transport selection", async () => {
  await it("a text batch bypasses cdxrs and is served by the JS pool", async () => {
    const previous = process.env.CDXGEN_RS_DISABLE;
    delete process.env.CDXGEN_RS_DISABLE;
    const { server, base } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>hello</html>");
    });
    const calls = [];
    try {
      const mod = await loadWithStubbedCdxrs(calls);
      mod.resetBatchFetchAvailability();
      assert.equal(mod.batchFetchAvailable(), true);
      const fetched = await mod.prefetchJson([
        { responseType: "text", url: `${base}/page` },
      ]);
      // The subprocess was never asked, and the body arrived unparsed.
      assert.equal(calls.length, 0);
      assert.equal(fetched.get(`${base}/page`).body, "<html>hello</html>");
    } finally {
      server.close();
      if (previous === undefined) {
        delete process.env.CDXGEN_RS_DISABLE;
      } else {
        process.env.CDXGEN_RS_DISABLE = previous;
      }
    }
  });

  await it("a JSON batch still goes to cdxrs when the binary is available", async () => {
    const previous = process.env.CDXGEN_RS_DISABLE;
    delete process.env.CDXGEN_RS_DISABLE;
    const calls = [];
    try {
      const mod = await loadWithStubbedCdxrs(calls);
      mod.resetBatchFetchAvailability();
      await mod.prefetchJson([{ url: "https://registry.invalid/left-pad" }]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].subcommand, "fetch");
    } finally {
      if (previous === undefined) {
        delete process.env.CDXGEN_RS_DISABLE;
      } else {
        process.env.CDXGEN_RS_DISABLE = previous;
      }
    }
  });

  await it("a batch carrying its own credential bypasses cdxrs and keeps that credential", async () => {
    const previousDisable = process.env.CDXGEN_RS_DISABLE;
    const previousToken = process.env.GITHUB_TOKEN;
    delete process.env.CDXGEN_RS_DISABLE;
    process.env.GITHUB_TOKEN = "ambient-token-that-must-not-win";
    const seen = [];
    const { server, base } = await startServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const calls = [];
    try {
      const mod = await loadWithStubbedCdxrs(calls);
      mod.resetBatchFetchAvailability();
      await mod.prefetchJson([
        { headers: { Authorization: "Bearer caller-token" }, url: `${base}/x` },
      ]);
      // cdxrs has no field for a caller-supplied credential and derives its own
      // from GITHUB_TOKEN, so it must not be handed this request at all.
      assert.equal(calls.length, 0);
      assert.deepEqual(seen, ["Bearer caller-token"]);
    } finally {
      server.close();
      for (const [name, value] of [
        ["CDXGEN_RS_DISABLE", previousDisable],
        ["GITHUB_TOKEN", previousToken],
      ]) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
