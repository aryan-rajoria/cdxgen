import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Independent RFC 8785 canonicalizer, used to build documents the way a third
// party would rather than through cdxgen's own signer.
function jcs(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(jcs).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`)
    .join(",")}}`;
}

describe("JSF signing and verification commands", () => {
  const signingDir = mkdtempSync(join(tmpdir(), "cdxgen-jsf-"));
  process.on("exit", () =>
    rmSync(signingDir, { recursive: true, force: true }),
  );
  const file = (name) => join(signingDir, name);
  const writeKeyPair = (name, type, options = {}) => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync(type, {
      ...options,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeFileSync(file(`${name}-public.pem`), publicKey);
    writeFileSync(file(`${name}-private.pem`), privateKey);
    return { publicKey, privateKey };
  };
  const rsa = writeKeyPair("rsa", "rsa", { modulusLength: 2048 });
  writeKeyPair("ed25519", "ed25519");
  writeFileSync(file("hmac.secret"), crypto.randomBytes(48));
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [
      {
        type: "library",
        name: "left-pad",
        version: "1.3.0",
        purl: "pkg:npm/left-pad@1.3.0",
      },
    ],
  };
  writeFileSync(file("bom.json"), JSON.stringify(bom));
  const sign = (output, ...args) =>
    run([binFor("sign"), "-i", file("bom.json"), "-o", file(output), ...args]);
  const verify = (input, ...args) =>
    run([binFor("verify"), "-i", file(input), ...args]);

  it("cdx-verify rejects an HS256 signature keyed with the public key", async () => {
    const forged = structuredClone(bom);
    forged.components.push({ type: "library", name: "backdoor" });
    forged.signature = { algorithm: "HS256", keyId: "release" };
    forged.signature.value = crypto
      .createHmac("sha256", rsa.publicKey)
      .update(jcs(forged))
      .digest("base64url");
    writeFileSync(file("forged.json"), JSON.stringify(forged));
    const { status, stdout } = await verify(
      "forged.json",
      "--public-key",
      file("rsa-public.pem"),
    );
    assert.strictEqual(status, 1);
    assert.match(stdout, /BOM signature is invalid!/);
    assert.match(stdout, /Algorithm HS256 requires a shared secret/);

    const validated = await run([
      binFor("validate"),
      "-i",
      file("forged.json"),
      "--public-key",
      file("rsa-public.pem"),
      "--require-signature",
      "--benchmark",
      "none",
    ]);
    assert.strictEqual(validated.status, 4);
    assert.match(validated.stderr, /requires a shared secret/);
  });

  it("cdx-sign refuses an algorithm that does not match the key", async () => {
    const { status, stderr } = await sign(
      "mislabelled.json",
      "-k",
      file("rsa-private.pem"),
      "-a",
      "Ed25519",
    );
    assert.notStrictEqual(status, 0);
    assert.match(
      stderr,
      /Algorithm Ed25519 requires an ed25519 key, but the key is rsa/,
    );
  });

  it("verifies HMAC signatures only through --secret-key", async () => {
    const signed = await sign(
      "hmac.json",
      "-k",
      file("hmac.secret"),
      "-a",
      "HS384",
    );
    assert.strictEqual(signed.status, 0, signed.stderr);
    const withSecret = await verify(
      "hmac.json",
      "--secret-key",
      file("hmac.secret"),
    );
    assert.strictEqual(withSecret.status, 0, withSecret.stdout);
    assert.match(withSecret.stdout, /Signature is valid!/);

    const asPublicKey = await verify(
      "hmac.json",
      "--public-key",
      file("hmac.secret"),
    );
    assert.strictEqual(asPublicKey.status, 1);
    assert.match(asPublicKey.stdout, /Unable to use/);

    const both = await verify(
      "hmac.json",
      "--public-key",
      file("rsa-public.pem"),
      "--secret-key",
      file("hmac.secret"),
    );
    assert.strictEqual(both.status, 1);
    assert.match(both.stdout, /either --public-key or --secret-key/);

    const publicKeyAsSecret = await verify(
      "hmac.json",
      "--secret-key",
      file("rsa-public.pem"),
    );
    assert.strictEqual(publicKeyAsSecret.status, 1);
    assert.match(
      publicKeyAsSecret.stdout,
      /looks like a public or private key/,
    );

    const validated = await run([
      binFor("validate"),
      "-i",
      file("hmac.json"),
      "--secret-key",
      file("hmac.secret"),
      "--require-signature",
      "--benchmark",
      "none",
    ]);
    assert.notStrictEqual(validated.status, 4, validated.stderr);
  });

  it("appends a chain entry without breaking the builder signature", async () => {
    const built = await sign(
      "chain.json",
      "-k",
      file("rsa-private.pem"),
      "-a",
      "RS512",
      "--key-id",
      "builder",
    );
    assert.strictEqual(built.status, 0, built.stderr);
    const approved = await run([
      binFor("sign"),
      "-i",
      file("chain.json"),
      "-k",
      file("ed25519-private.pem"),
      "-a",
      "Ed25519",
      "--key-id",
      "approver",
      "--mode",
      "chain",
    ]);
    assert.strictEqual(approved.status, 0, approved.stderr);
    const chained = JSON.parse(readFileSync(file("chain.json"), "utf-8"));
    assert.deepStrictEqual(
      chained.signature.chain.map((entry) => entry.keyId),
      ["builder", "approver"],
    );

    const builder = await verify(
      "chain.json",
      "--public-key",
      file("rsa-public.pem"),
    );
    assert.strictEqual(builder.status, 0, builder.stdout);
    assert.match(builder.stdout, /Matched KeyId: 'builder'/);
    const approver = await verify(
      "chain.json",
      "--public-key",
      file("ed25519-public.pem"),
      "--no-deep",
    );
    assert.strictEqual(approver.status, 0, approver.stdout);
    assert.match(approver.stdout, /Matched KeyId: 'approver'/);

    chained.signature.chain.reverse();
    writeFileSync(file("reordered.json"), JSON.stringify(chained));
    const reordered = await verify(
      "reordered.json",
      "--public-key",
      file("ed25519-public.pem"),
      "--no-deep",
    );
    assert.strictEqual(reordered.status, 1);
  });

  it("cdx-sign refuses to re-sign nested elements while appending", async () => {
    const built = await sign("nested.json", "-k", file("rsa-private.pem"));
    assert.strictEqual(built.status, 0, built.stderr);
    const before = readFileSync(file("nested.json"), "utf-8");
    const { status, stderr } = await run([
      binFor("sign"),
      "-i",
      file("nested.json"),
      "-k",
      file("ed25519-private.pem"),
      "-a",
      "Ed25519",
      "--mode",
      "signers",
      "--sign-components",
    ]);
    assert.notStrictEqual(status, 0);
    assert.match(
      stderr,
      /changes content covered by the existing root signature/,
    );
    assert.strictEqual(readFileSync(file("nested.json"), "utf-8"), before);
  });

  it("cdx-verify asks for BOMs signed by earlier releases to be re-signed", async () => {
    // Earlier releases signed the content without the signature metadata.
    const old = structuredClone(bom);
    old.signature = {
      algorithm: "RS512",
      value: crypto
        .sign("sha512", Buffer.from(jcs(bom)), rsa.privateKey)
        .toString("base64url"),
    };
    writeFileSync(file("old.json"), JSON.stringify(old));
    const { status, stdout } = await verify(
      "old.json",
      "--public-key",
      file("rsa-public.pem"),
    );
    assert.strictEqual(status, 1);
    assert.match(stdout, /re-sign it with this version of cdx-sign/);
  });
});
