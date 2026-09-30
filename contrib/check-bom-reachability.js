#!/usr/bin/env node
// check-bom-reachability.js — assert that every component of a BOM can be
// reached from metadata.component through the dependencies section.
//
// Lockfile parsers that model workspaces or dev dependencies as separate roots
// can leave whole subtrees disconnected from the project component. A count of
// components does not notice that; walking the graph does.
//
// Usage:
//   node contrib/check-bom-reachability.js <bom.json> [expectedComponentCount]
//
// Exit codes:
//   0 — every component is reachable (and the count matches, when given)
//   1 — an orphaned component or a count mismatch
//   2 — usage or read error

import { readFileSync } from "node:fs";

const [bomFile, expectedCount] = process.argv.slice(2);
if (!bomFile) {
  console.error(
    "Usage: node contrib/check-bom-reachability.js <bom.json> [expectedComponentCount]",
  );
  process.exit(2);
}
let bom;
try {
  bom = JSON.parse(readFileSync(bomFile, "utf8"));
} catch (err) {
  console.error(`Unable to read ${bomFile}: ${err.message}`);
  process.exit(2);
}
const components = bom.components || [];
const rootRef = bom.metadata?.component?.["bom-ref"];
const edges = new Map(
  (bom.dependencies || []).map((d) => [d.ref, d.dependsOn || []]),
);
const seen = new Set([rootRef]);
const stack = [rootRef];
while (stack.length) {
  for (const child of edges.get(stack.pop()) || []) {
    if (!seen.has(child)) {
      seen.add(child);
      stack.push(child);
    }
  }
}
const orphans = components
  .map((c) => c["bom-ref"])
  .filter((ref) => !seen.has(ref));
let failed = false;
if (expectedCount !== undefined && components.length !== Number(expectedCount)) {
  console.error(
    `Expected ${expectedCount} components, got ${components.length}`,
  );
  failed = true;
}
if (orphans.length) {
  console.error(
    `${orphans.length} component(s) are not reachable from ${rootRef}:\n  ${orphans.join("\n  ")}`,
  );
  failed = true;
}
if (failed) {
  process.exit(1);
}
console.log(
  `All ${components.length} components are reachable from ${rootRef}`,
);
