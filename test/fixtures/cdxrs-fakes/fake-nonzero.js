#!/usr/bin/env node
// Fake cdxrs binary that exits non-zero on info subcommand.
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("cdxrs 3.0.0\n");
  process.exit(0);
}

if (args[0] === "info") {
  process.stderr.write(JSON.stringify({ level: "error", msg: "parse failure" }) + "\n");
  process.exit(1);
}

process.exit(0);
