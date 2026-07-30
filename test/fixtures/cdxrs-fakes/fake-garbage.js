#!/usr/bin/env node
// Fake cdxrs binary that writes garbage (non-JSON) to stdout.
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("cdxrs 3.0.0\n");
  process.exit(0);
}

if (args[0] === "info") {
  process.stdout.write("this is not valid JSON {{{\n");
  process.exit(0);
}

process.exit(0);
