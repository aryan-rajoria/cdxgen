import { readFileSync } from "node:fs";

import { dirNameStr, getAllFiles } from "../../lib/helpers/utils.js";

let datasetDir = dirNameStr;
const argv = process.argv.slice(2);
if (argv.length > 1) {
  datasetDir = argv[1];
}

const jsonlFiles = getAllFiles(datasetDir, "**/*.jsonl");
const failures = {};
for (const jf of jsonlFiles) {
  const failedLines = [];
  const lines = readFileSync(jf, "utf-8");
  for (const ajson of lines.split("\n")) {
    try {
      const aline = JSON.parse(ajson);
      if (!aline.messages || !Array.isArray(aline.messages) || aline.messages.length !== 2 || aline.messages[0].role !== "user" || aline.messages[1].role !== "assistant") {
        failedLines.push(ajson);
      }
    } catch (e) {
      failedLines.push(ajson);
    }
  }
  if (failedLines.length) {
    failures[jf] = failedLines;
  } else {
    console.log(jf, "is valid!");
  }
}

if (Object.keys(failures).length) {
  console.log("=== VALIDATION FAILED ===");
  console.log(failures);
}
