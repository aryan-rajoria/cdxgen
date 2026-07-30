#!/usr/bin/env node
// Fake cdxrs binary that sleeps longer than the timeout.
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("cdxrs 3.0.0\n");
  process.exit(0);
}

if (args[0] === "info") {
  // Sleep for 30 seconds — much longer than any test timeout.
  setTimeout(() => {
    process.exit(0);
  }, 30_000);
} else {
  process.exit(0);
}
