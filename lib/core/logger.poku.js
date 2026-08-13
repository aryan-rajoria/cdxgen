import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { assert, it } from "poku";

it("writes trace records to a log file and terminates the think block", async () => {
  // A separate process: the log destinations are resolved once at module load,
  // and this asserts on what survives an exit, which is what a consumer tailing
  // the file sees.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdxgen-logger-"));
  const tracePath = path.join(dir, "trace.jsonl");
  const thoughtPath = path.join(dir, "think.log");
  const { execFileSync } = await import("node:child_process");

  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { traceLog, thoughtLog } from "${new URL("./logger.js", import.meta.url).href}";
         thoughtLog("Scanning the project");
         traceLog("spawn", { command: "npm install", cwd: "/tmp" });
         traceLog("http", { protocol: "https:", host: "registry.npmjs.org", pathname: "/express" });
         traceLog("phase", { phase: "Generating BOM", state: "progress", done: 0, total: 9 });
         process.exit(0);`,
      ],
      {
        env: {
          ...process.env,
          CDXGEN_TRACE_LOG: tracePath,
          CDXGEN_THOUGHT_LOG: thoughtPath,
          CDXGEN_THINK_MODE: "true",
        },
      },
    );

    const records = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.strictEqual(records.length, 3, "every record must reach the file");

    const [spawn, http, phase] = records;
    assert.strictEqual(spawn.command, "npm install");
    assert.strictEqual(http.host, "registry.npmjs.org");
    assert.strictEqual(phase.phase, "Generating BOM");
    // Zero is a meaningful count, so it must not be dropped as falsy.
    assert.strictEqual(phase.done, 0);
    assert.strictEqual(phase.total, 9);

    const thoughts = fs.readFileSync(thoughtPath, "utf8");
    assert.ok(thoughts.includes("<think>"), "think block must be opened");
    assert.ok(
      thoughts.trimEnd().endsWith("</think>"),
      "think block must be terminated on exit",
    );
    assert.ok(!thoughts.includes("\0"), "log must not contain sparse holes");
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

it("verifies thought log colorizer formatting", async () => {
  // Set environment variables before dynamically importing logger.js
  process.env.CDXGEN_THINK_MODE = "true";
  delete process.env.CDXGEN_THOUGHT_LOG;

  const { thoughtLog } = await import("./logger.js");

  const originalWrite = process.stderr.write;
  const originalIsTTY = process.stderr.isTTY;
  let loggedMessage = "";
  process.stderr.write = (chunk) => {
    loggedMessage += chunk;
  };
  // colorizeText only emits ANSI for an interactive stream, so force TTY for
  // this assertion.
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: true,
  });

  try {
    thoughtLog("test 123");
    // The numbers should be cyanBright (\x1b[96m123\x1b[39m)
    // The entire string should be dim (\x1b[2m...\x1b[22m)
    assert.ok(
      loggedMessage.includes("\x1b[96m123\x1b[39m"),
      "Should format numbers as cyanBright",
    );
    assert.ok(
      loggedMessage.includes("\x1b[2m"),
      "Should contain dim escape sequence",
    );
    assert.ok(
      loggedMessage.includes("\x1b[22m"),
      "Should contain dim reset sequence",
    );
  } finally {
    // Restore
    process.stderr.write = originalWrite;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }
});
