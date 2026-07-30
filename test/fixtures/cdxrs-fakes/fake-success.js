#!/usr/bin/env node
// Fake cdxrs binary that reports version 3.x.x and succeeds on info.
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("cdxrs 3.0.0\n");
  process.exit(0);
}

if (args[0] === "info") {
  process.stderr.write(JSON.stringify({ level: "info", msg: "reading BOM" }) + "\n");
  process.stdout.write(JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    componentCount: 1,
    dependencyCount: 0,
    serviceCount: 0,
    vulnerabilityCount: 0,
    hasEvidence: false,
    cdxrsVersion: "3.0.0",
  }) + "\n");
  process.exit(0);
}

if (args[0] === "schema-version") {
  process.stdout.write(JSON.stringify({ supportedSpecVersions: ["1.6", "1.7"] }) + "\n");
  process.exit(0);
}

process.exit(0);
