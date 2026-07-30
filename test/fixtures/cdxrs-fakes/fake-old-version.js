#!/usr/bin/env node
// Fake cdxrs binary that reports version 2.x — a major-version mismatch.
import process from "node:process";

if (process.argv.slice(2).includes("--version")) {
  process.stdout.write("cdxrs 2.6.0\n");
  process.exit(0);
}

process.exit(0);
