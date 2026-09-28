#!/usr/bin/env node
// Fake cdxrs binary that writes a single valid JSON document of just over
// 1 MB to stdout. Small enough to stay well under V8's string limit (so the
// same fake can also prove an under-the-ceiling run succeeds), large enough
// to cross a lowered CDXGEN_RS_MAX_STDOUT_BYTES mid-stream.
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("cdxrs 4.0.0\n");
  process.exit(0);
}

if (args[0] === "info") {
  // EPIPE is expected when the bridge kills this fake after its stdout
  // crosses the configured ceiling; it must not print a stack trace.
  process.stdout.on("error", () => process.exit(1));
  process.stdout.write('{"bomFormat":"CycloneDX","specVersion":"1.6","padding":"');
  const chunk = "x".repeat(64 * 1024);
  for (let written = 0; written < 1024 * 1024; written += chunk.length) {
    process.stdout.write(chunk);
  }
  // Exit from the drain callback: process.exit() right after queued writes
  // to a pipe can drop the tail of the payload.
  process.stdout.end('"}\n', () => process.exit(0));
} else {
  process.exit(0);
}
