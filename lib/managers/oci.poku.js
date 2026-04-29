import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

async function loadOciModule({ getAllFiles, getTmpDir, safeSpawnSync }) {
  return esmock("./oci.js", {
    "../helpers/utils.js": {
      getAllFiles,
      getTmpDir,
      isWin: false,
      safeSpawnSync,
    },
  });
}

describe("getBomWithOras()", () => {
  it("pulls the newest digest-only SBOM referrer", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdxgen-oci-poku-"));
    const bomFile = path.join(tmpDir, "sbom-oci-image.cdx.json");
    const bomJson = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      signature: {
        algorithm: "RS512",
        value: "signed",
      },
    };
    const safeSpawnSync = sinon.stub();
    const getAllFiles = sinon.stub();
    try {
      writeFileSync(bomFile, JSON.stringify(bomJson), "utf8");
      safeSpawnSync
        .onCall(0)
        .returns({
          status: 0,
          stdout: JSON.stringify({
            referrers: [
              {
                digest: "sha256:older",
                annotations: {
                  "org.opencontainers.image.created": "2026-04-29T01:26:38Z",
                },
              },
              {
                digest: "sha256:newer",
                annotations: {
                  "org.opencontainers.image.created": "2026-04-29T02:00:20Z",
                },
              },
            ],
          }),
        })
        .onCall(1)
        .returns({
          status: 0,
          stdout: "",
        });
      getAllFiles.withArgs(tmpDir, "**/*.{bom,cdx}.json").returns([bomFile]);
      const { getBomWithOras } = await loadOciModule({
        getAllFiles,
        getTmpDir: sinon.stub().returns(tmpDir),
        safeSpawnSync,
      });
      const result = getBomWithOras("ghcr.io/cdxgen/alpine-python313:master");
      assert.deepStrictEqual(result, bomJson);
      sinon.assert.calledWith(
        safeSpawnSync,
        "oras",
        ["pull", "ghcr.io/cdxgen/alpine-python313@sha256:newer", "-o", tmpDir],
        { shell: false },
      );
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("falls back to bom.json when oras pulls a plain BOM filename", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdxgen-oci-poku-"));
    const bomFile = path.join(tmpDir, "bom.json");
    const bomJson = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      signature: {
        algorithm: "RS512",
        value: "signed",
      },
    };
    const safeSpawnSync = sinon.stub();
    const getAllFiles = sinon.stub();
    try {
      writeFileSync(bomFile, JSON.stringify(bomJson), "utf8");
      safeSpawnSync
        .onCall(0)
        .returns({
          status: 0,
          stdout: JSON.stringify({
            manifests: [
              {
                reference: "ghcr.io/cdxgen/demo@sha256:latest",
              },
            ],
          }),
        })
        .onCall(1)
        .returns({
          status: 0,
          stdout: "",
        });
      getAllFiles.withArgs(tmpDir, "**/*.{bom,cdx}.json").returns([]);
      getAllFiles.withArgs(tmpDir, "**/bom.json").returns([bomFile]);
      const { getBomWithOras } = await loadOciModule({
        getAllFiles,
        getTmpDir: sinon.stub().returns(tmpDir),
        safeSpawnSync,
      });
      const result = getBomWithOras("ghcr.io/cdxgen/demo:master");
      assert.deepStrictEqual(result, bomJson);
      sinon.assert.calledWith(
        safeSpawnSync,
        "oras",
        ["pull", "ghcr.io/cdxgen/demo@sha256:latest", "-o", tmpDir],
        { shell: false },
      );
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });
});
