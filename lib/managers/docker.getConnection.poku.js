import { existsSync } from "node:fs";
import { userInfo as _userInfo } from "node:os";
import process from "node:process";

import { assert, it, log } from "poku";

import { getConnection, isWin } from "./docker.js";

// These rows talk to a real podman rootless socket, so they are gated on one
// being present. The gate registers no tests rather than calling poku's
// skip(), which marks the whole file skipped and would suppress any
// assertion added to this file later.
const uid = _userInfo().uid;
const podmanSock = `/run/user/${uid}/podman/podman.sock`;
const onUnsupportedCi =
  process.env.CI === "true" && (isWin || process.platform === "darwin");
const hasPodmanSocket = !isWin && !onUnsupportedCi && existsSync(podmanSock);

if (!hasPodmanSocket) {
  log(
    onUnsupportedCi
      ? "podman detection is not exercised on Windows and Mac CI"
      : `no podman rootless socket at ${podmanSock}`,
  );
} else {
  // Remove DOCKER_HOST to force auto-detection through the fallback chain.
  // Without the fix, getDefaultOptions sets podmanPrefixUrl and
  // podmanRootlessPrefixUrl on its return object, but getConnection's
  // Object.assign only copies standard got properties into opts. The fallback
  // code then reads opts.podmanRootlessPrefixUrl which is undefined, causing
  // got to receive an invalid URL and the detection to silently fail.
  const origDockerHost = process.env.DOCKER_HOST;
  delete process.env.DOCKER_HOST;

  try {
    await it("should detect podman rootless via auto-detection", async () => {
      const conn = await getConnection({}, false);
      assert.ok(
        conn,
        "getConnection must return a connection when podman rootless socket exists, got undefined",
      );
    });

    await it("should return a functional connection that can ping", async () => {
      const conn = await getConnection({}, false);
      assert.ok(conn, "getConnection must return a connection");
      // conn.request() resolves to the response body; non-JSON responses (like
      // the ping endpoints) come back as a Buffer.
      const pingBody = async (path) => {
        const body = await conn.request(path, { method: "GET" });
        return Buffer.isBuffer(body) ? body.toString("utf-8") : body;
      };
      // podman responds to both compat and native ping endpoints
      let pingOk = false;
      try {
        pingOk = (await pingBody("_ping")) === "OK";
      } catch (_err) {
        // fall through to libpod endpoint
      }
      if (!pingOk) {
        pingOk = (await pingBody("libpod/_ping")) === "OK";
      }
      assert.ok(
        pingOk,
        "connection must be able to ping the container runtime",
      );
    });
  } finally {
    if (origDockerHost !== undefined) {
      process.env.DOCKER_HOST = origDockerHost;
    } else {
      delete process.env.DOCKER_HOST;
    }
  }
}
