#!/usr/bin/env node
// Fake cdxrs binary that reports the previous major (3.x) — a major-version mismatch.
import process from "node:process";

if (process.argv.slice(2).includes("--version")) {
  process.stdout.write("cdxrs 3.0.0\n");
  process.exit(0);
}

process.exit(0);
