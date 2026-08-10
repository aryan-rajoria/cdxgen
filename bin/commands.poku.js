import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { describe, it } from "poku";

// Every command exposed on the `bin` field of package.json that takes
// arguments. `repl` is excluded: it is an interactive shell that treats
// `--help` and `--version` as unknown input and drops into its prompt.
const COMMANDS = [
  "audit",
  "cdxgen",
  "convert",
  "evinse",
  "hbom",
  "sign",
  "tracebom",
  "validate",
  "verify",
];

const binFor = (command) => join(process.cwd(), "bin", `${command}.js`);

function run(args, options = {}) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(process.argv0, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (status) =>
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      }),
    );
    child.on("error", (error) =>
      resolve({ status: 1, stdout: "", stderr: error.message }),
    );
  });
}

describe("bin entry points", () => {
  for (const command of COMMANDS) {
    it(`${command} --help exits 0 and describes its options`, async () => {
      const { status, stdout, stderr } = await run([binFor(command), "--help"]);
      assert.strictEqual(status, 0, `${command} --help exited ${status}`);
      const output = stdout + stderr;
      assert.ok(
        output.includes("--help") || output.includes("Options"),
        `${command} --help printed no usage text`,
      );
    });

    it(`${command} --version prints a version`, async () => {
      const { status, stdout, stderr } = await run([
        binFor(command),
        "--version",
      ]);
      assert.strictEqual(status, 0, `${command} --version exited ${status}`);
      assert.match(stdout + stderr, /\d+\.\d+\.\d+/);
    });
  }
});

// A committed CycloneDX 1.7 document, so these cases stay hermetic and do not
// pay for a full scan.
const BOM_FIXTURE = "test/data/bom-cbom-js-fixture.json";
const workDir = mkdtempSync(join(tmpdir(), "cdxgen-bin-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));

describe("bin commands over a CycloneDX document", () => {
  it("cdx-validate reports a verdict", async () => {
    const { status, stdout, stderr } = await run([
      binFor("validate"),
      "-i",
      BOM_FIXTURE,
      "--benchmark",
      "none",
    ]);
    assert.strictEqual(status, 0);
    assert.ok((stdout + stderr).length > 0);
  });

  it("cdx-convert exports an SPDX document", async () => {
    const spdxFile = join(workDir, "bom.spdx.json");
    const { status } = await run([
      binFor("convert"),
      "-i",
      BOM_FIXTURE,
      "-o",
      spdxFile,
    ]);
    assert.strictEqual(status, 0);
    const spdx = JSON.parse(readFileSync(spdxFile, "utf-8"));
    assert.ok(JSON.stringify(spdx).includes("spdx"));
  });

  it("cdx-convert downgrades a CycloneDX document to an older spec version", async () => {
    const outFile = join(workDir, "bom-1_6.json");
    const { status, stdout, stderr } = await run([
      binFor("convert"),
      "-i",
      BOM_FIXTURE,
      "--to",
      "1.6",
      "-o",
      outFile,
    ]);
    assert.strictEqual(status, 0, `cdx-convert --to 1.6 exited ${status}`);
    const bomJson = JSON.parse(readFileSync(outFile, "utf-8"));
    assert.strictEqual(bomJson.specVersion, "1.6");
    assert.strictEqual(bomJson.bomFormat, "CycloneDX");
    // 1.7-only root elements never reach a 1.6 document.
    assert.strictEqual(bomJson.citations, undefined);
    assert.ok(bomJson.components.length > 0);
    assert.match(stdout + stderr, /Successfully converted/);
  });

  it("cdx-convert refuses an unknown conversion target", async () => {
    const { status, stdout, stderr } = await run([
      binFor("convert"),
      "-i",
      BOM_FIXTURE,
      "--to",
      "parquet",
    ]);
    assert.notStrictEqual(status, 0);
    assert.match(stdout + stderr, /Unsupported conversion target/);
  });

  // cdx-audit's behaviour is covered by lib/stages/postgen/auditBom.poku.js.
  // Running it here would reach the network for every component and take over
  // a minute on a fixture of this size.

  it("cdx-sign signs a BOM that cdx-verify then accepts", async () => {
    const privateKey = join(workDir, "private.pem");
    const publicKey = join(workDir, "public.pem");
    const signedFile = join(workDir, "signed.json");
    execFileSync("openssl", ["genrsa", "-out", privateKey, "2048"], {
      stdio: "ignore",
    });
    execFileSync(
      "openssl",
      ["rsa", "-in", privateKey, "-pubout", "-out", publicKey],
      { stdio: "ignore" },
    );

    const signed = await run([
      binFor("sign"),
      "-i",
      BOM_FIXTURE,
      "-o",
      signedFile,
      "-k",
      privateKey,
    ]);
    assert.strictEqual(signed.status, 0);
    assert.ok(JSON.parse(readFileSync(signedFile, "utf-8")).signature);

    const verified = await run([
      binFor("verify"),
      "-i",
      signedFile,
      "--public-key",
      publicKey,
    ]);
    assert.strictEqual(verified.status, 0);
  });

  it("cdx-sign refuses to sign without a key", async () => {
    const { status } = await run([
      binFor("sign"),
      "-i",
      BOM_FIXTURE,
      "-o",
      join(workDir, "unsigned.json"),
    ]);
    assert.notStrictEqual(status, 0);
  });
});
