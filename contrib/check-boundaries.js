#!/usr/bin/env node
// check-boundaries.js — Cycle, layer, and barrel enforcement for cdxgen workspace.
//
// Capabilities:
//   1. Package-level cycle detection (actual import graph)
//   2. File-level cycle detection across lib/ (excludes lib/third-party/)
//      Parses static imports, dynamic import(), re-exports, and require().
//   3. Layer rule — each package declares "layer": 0..5; an edge from layer N
//      to layer M is legal only when M < N. Replaces per-package dependency lists.
//   4. Barrel ban — no file under lib/ may import a designated compat shim
//      (lib/ecosystems/utils.js).
//
// Usage:
//   node contrib/check-boundaries.js             // check, exit 1 on any cycle
//   node contrib/check-boundaries.js --strict    // also exit 1 on layer/barrel backlog
//   node contrib/check-boundaries.js --json      // JSON output
//   node contrib/check-boundaries.js --scan-root=<dir>  // scan custom dir (file cycles only)
//
// Exit codes:
//   0 — no cycles (layer/barrel backlog reported but tolerated without --strict)
//   1 — a cycle was found, or --strict and the backlog is non-empty
//   2 — internal error

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Configuration ───────────────────────────────────────────────────────────

// Designated barrel/compat shims — internal imports of these are banned.
// utils.js is a pure re-export barrel; importing it internally creates cycles
// and hides the real dependency on the leaf module.
const DESIGNATED_BARRELS = new Set([
  "lib/ecosystems/utils.js",
]);

// Package → directories and layer. An import from layer N may only reach a
// package whose layer is strictly lower. `layer: null` opts a package out of
// the layer rule (third-party code is vendored and not ours to order).
//
// These layers used to live in `packages/*/package.json`, read back at runtime.
// Those descriptors held nothing else the checker needed — the directory
// mapping was already here — so they were deleted and the numbers moved into
// this table. Keeping the two halves of one fact in one place is the point.
const PACKAGES = {
  core: { dirs: ["lib/core"], layer: 0 },
  parsers: { dirs: ["lib/parsers"], layer: 1 },
  inventory: { dirs: ["lib/inventory"], layer: 2 },
  ecosystems: { dirs: ["lib/ecosystems"], layer: 3 },
  helpers: { dirs: ["lib/helpers"], layer: 2 },
  managers: { dirs: ["lib/managers"], layer: 4 },
  stages: { dirs: ["lib/stages/postgen", "lib/stages/pregen"], layer: 4 },
  cli: { dirs: ["lib/cli"], layer: 5 },
  evinser: { dirs: ["lib/evinser"], layer: 5 },
  server: { dirs: ["lib/server"], layer: 6 },
  validator: { dirs: ["lib/validator"], layer: 5 },
  audit: { dirs: ["lib/audit"], layer: 6 },
  "third-party": { dirs: ["lib/third-party"], layer: null },
};

// Package → directory mapping, derived from the table above.
const PACKAGE_DIRS = Object.fromEntries(
  Object.entries(PACKAGES).map(([name, { dirs }]) => [name, dirs]),
);

const ROOT_DIRS = ["bin"];

// Directories excluded from file-level cycle detection.
const EXCLUDED_DIRS = ["lib/third-party"];

// ─── Import extraction ───────────────────────────────────────────────────────

// Matches static imports, dynamic import(), re-exports, and require().
const IMPORT_PATTERNS = [
  // ES module static imports: import ... from "..."
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?)["']([^"']+)["']/g,
  // Dynamic imports: import("...") — also catches await import("...")
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  // Re-exports: export * from "..." / export { x } from "..."
  /\bexport\s+(?:\*(?:\s+as\s+[$\w]+)?|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
  // CommonJS require("...")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function* walkJsFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkJsFiles(fullPath);
    } else if (
      (fullPath.endsWith(".js") || fullPath.endsWith(".cjs")) &&
      !fullPath.endsWith(".poku.js") &&
      !fullPath.endsWith(".config.js")
    ) {
      yield fullPath;
    }
  }
}

function extractRelativeImports(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const imports = new Set();

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      if (
        importPath.startsWith("./") ||
        importPath.startsWith("../") ||
        importPath.startsWith(".\\") ||
        importPath.startsWith("..\\")
      ) {
        imports.add(importPath);
      }
    }
  }

  return [...imports];
}

function resolveImport(fromFile, importPath) {
  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  if (!resolved.endsWith(".js") && !resolved.endsWith(".cjs")) {
    const withJs = resolved + ".js";
    try {
      statSync(withJs);
      return withJs;
    } catch {
      const indexJs = path.join(resolved, "index.js");
      try {
        statSync(indexJs);
        return indexJs;
      } catch {
        // File might not exist — return resolved path for error reporting
      }
    }
  }

  return resolved;
}

// ─── Package classification ──────────────────────────────────────────────────

function fileToPackage(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");

  for (const [pkgName, dirs] of Object.entries(PACKAGE_DIRS)) {
    for (const dir of dirs) {
      if (rel.startsWith(dir + "/")) {
        return pkgName;
      }
    }
  }

  for (const dir of ROOT_DIRS) {
    if (rel.startsWith(dir + "/")) {
      return "root";
    }
  }

  if (!rel.includes("/")) {
    return "root";
  }

  return null;
}

function fileToRel(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function isExcluded(filePath) {
  const rel = fileToRel(filePath);
  return EXCLUDED_DIRS.some((d) => rel.startsWith(d + "/"));
}

// ─── Layer declarations ──────────────────────────────────────────────────────

function loadLayers() {
  const layers = {};
  for (const [pkgName, { layer }] of Object.entries(PACKAGES)) {
    if (typeof layer === "number") {
      layers[pkgName] = layer;
    }
  }
  return layers;
}

// ─── File-level graph builder + cycle detection ──────────────────────────────

function buildFileGraph(scanRoots, opts = {}) {
  const graph = new Map(); // filePath → Set<filePath>
  const edges = []; // { from, to, importSpecifier }
  const checkedFiles = new Set();

  for (const scanDir of scanRoots) {
    for (const file of walkJsFiles(scanDir)) {
      if (checkedFiles.has(file)) continue;
      checkedFiles.add(file);

      if (opts.excludeCheck && opts.excludeCheck(file)) continue;

      const relFile = fileToRel(file);
      if (!graph.has(file)) graph.set(file, new Set());

      const imports = extractRelativeImports(file);
      for (const imp of imports) {
        const resolvedTarget = resolveImport(file, imp);

        // Only track edges to files that exist within our scan scope
        try {
          statSync(resolvedTarget);
        } catch {
          continue;
        }

        const targetRel = fileToRel(resolvedTarget);
        if (opts.excludeCheck && opts.excludeCheck(resolvedTarget)) continue;

        graph.get(file).add(resolvedTarget);
        edges.push({
          from: relFile,
          to: targetRel,
          import: imp,
        });

        if (!graph.has(resolvedTarget)) graph.set(resolvedTarget, new Set());
      }
    }
  }

  return { graph, edges };
}

// DFS-based cycle detection using three-color marking.
// Returns array of cycles, each represented as an array of file paths
// forming the cycle (first node repeated at end).
function detectFileCycles(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const cycles = [];

  for (const node of graph.keys()) {
    color.set(node, WHITE);
  }

  const stack = [];

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;

      const c = color.get(neighbor);
      if (c === GRAY) {
        // Back-edge found: extract the cycle from the current stack.
        const startIdx = stack.indexOf(neighbor);
        if (startIdx !== -1) {
          const cycleFiles = stack.slice(startIdx);
          cycles.push(normalizeCycle(cycleFiles));
        }
      } else if (c === WHITE) {
        dfs(neighbor);
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  // Sort nodes for deterministic traversal order.
  const sortedNodes = [...graph.keys()].sort();
  for (const node of sortedNodes) {
    if (color.get(node) === WHITE) {
      dfs(node);
    }
  }

  // Deduplicate by normalized cycle key.
  const seen = new Set();
  const unique = [];
  for (const cycle of cycles) {
    const key = cycle.join("→");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

// Normalize a cycle so it starts from its lexicographically smallest member.
function normalizeCycle(nodes) {
  if (nodes.length === 0) return nodes;
  const relNodes = nodes.map((f) =>
    typeof f === "string" && f.startsWith("/") ? fileToRel(f) : f,
  );
  let minIdx = 0;
  for (let i = 1; i < relNodes.length; i++) {
    if (relNodes[i] < relNodes[minIdx]) minIdx = i;
  }
  const rotated = [
    ...relNodes.slice(minIdx),
    ...relNodes.slice(0, minIdx),
    relNodes[minIdx],
  ];
  return rotated;
}

// ─── Package-level graph builder + cycle detection ───────────────────────────

function buildPackageGraph(fileGraph) {
  const pkgGraph = new Map(); // packageName → Set<packageName>

  for (const [srcFile, targets] of fileGraph) {
    const srcPkg = fileToPackage(srcFile);
    if (!srcPkg || srcPkg === "root" || srcPkg === "third-party") continue;

    if (!pkgGraph.has(srcPkg)) pkgGraph.set(srcPkg, new Set());

    for (const targetFile of targets) {
      const tgtPkg = fileToPackage(targetFile);
      if (!tgtPkg || tgtPkg === "root" || tgtPkg === "third-party") continue;
      if (tgtPkg === srcPkg) continue; // same package
      pkgGraph.get(srcPkg).add(tgtPkg);
    }
  }

  return pkgGraph;
}

function detectPackageCycles(pkgGraph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const cycles = [];

  for (const node of pkgGraph.keys()) {
    color.set(node, WHITE);
  }

  const stack = [];

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);

    const neighbors = pkgGraph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;

      const c = color.get(neighbor);
      if (c === GRAY) {
        const startIdx = stack.indexOf(neighbor);
        if (startIdx !== -1) {
          const cyclePkgs = stack.slice(startIdx);
          cycles.push(normalizeCycle(cyclePkgs));
        }
      } else if (c === WHITE) {
        dfs(neighbor);
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  const sortedNodes = [...pkgGraph.keys()].sort();
  for (const node of sortedNodes) {
    if (color.get(node) === WHITE) {
      dfs(node);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const cycle of cycles) {
    const key = cycle.join("→");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

// ─── Layer rule checker ──────────────────────────────────────────────────────

function checkLayerRule(fileGraph, layers) {
  const violations = [];

  for (const [srcFile, targets] of fileGraph) {
    const srcPkg = fileToPackage(srcFile);
    if (!srcPkg || srcPkg === "root" || srcPkg === "third-party") continue;

    const srcLayer = layers[srcPkg];
    if (srcLayer === undefined) continue;

    for (const targetFile of targets) {
      const tgtPkg = fileToPackage(targetFile);
      if (!tgtPkg || tgtPkg === "root" || tgtPkg === "third-party") continue;
      if (tgtPkg === srcPkg) continue;

      const tgtLayer = layers[tgtPkg];
      if (tgtLayer === undefined) continue;

      // Edge from layer N to layer M is legal only when M < N.
      if (tgtLayer >= srcLayer) {
        violations.push({
          file: fileToRel(srcFile),
          target: fileToRel(targetFile),
          sourcePackage: srcPkg,
          targetPackage: tgtPkg,
          sourceLayer: srcLayer,
          targetLayer: tgtLayer,
          rule: `layer ${srcLayer} package "${srcPkg}" may not import from layer ${tgtLayer} package "${tgtPkg}" (requires target layer < source layer)`,
        });
      }
    }
  }

  return violations;
}

// ─── Barrel ban checker ──────────────────────────────────────────────────────

function checkBarrelBan(edges) {
  const violations = [];

  for (const edge of edges) {
    // Only ban internal imports (files under lib/). Entry points in bin/
    // are external consumers that may legitimately use the barrel.
    if (!edge.from.startsWith("lib/")) continue;

    if (DESIGNATED_BARRELS.has(edge.to)) {
      violations.push({
        file: edge.from,
        import: edge.import,
        target: edge.to,
        rule: `internal import of designated barrel "${edge.to}" is banned — import from the leaf module directly`,
      });
    }
  }

  return violations;
}

// ─── Main check runner ───────────────────────────────────────────────────────

function runAllChecks(options = {}) {
  const scanRootPaths = options.scanRoot
    ? [path.resolve(options.scanRoot)]
    : [
        ...Object.values(PACKAGE_DIRS).flat(),
        ...ROOT_DIRS,
      ].map((d) => path.join(REPO_ROOT, d));

  // Verify mapped directories exist (only for default scan, not custom scan-root).
  if (!options.scanRoot) {
    const missingDirs = Object.entries(PACKAGE_DIRS)
      .flatMap(([pkgName, dirs]) => dirs.map((d) => [pkgName, d]))
      .filter(([, d]) => {
        try {
          return !statSync(path.join(REPO_ROOT, d)).isDirectory();
        } catch {
          return true;
        }
      });
    if (missingDirs.length > 0) {
      console.error(
        "✗ check-boundaries.js is out of date — these mapped directories do not exist:",
      );
      for (const [pkgName, d] of missingDirs) {
        console.error(`    ${d}  (mapped to @cdxgen/internal-${pkgName})`);
      }
      console.error(
        "\nUpdate PACKAGES in contrib/check-boundaries.js to match the tree.",
      );
      process.exit(2);
    }
  }

  const { graph, edges } = buildFileGraph(scanRootPaths, {
    excludeCheck: (f) => isExcluded(f),
  });

  // File-level cycle detection
  const fileCycles = detectFileCycles(graph);

  // Package-level cycle detection
  const pkgGraph = buildPackageGraph(graph);
  const packageCycles = detectPackageCycles(pkgGraph);

  // Layer rule (only if layers are declared)
  const layers = loadLayers();
  const layerViolations = checkLayerRule(graph, layers);

  // Barrel ban (skip for custom scan-root — fixture may not match package paths)
  const barrelViolations = options.scanRoot ? [] : checkBarrelBan(edges);

  return {
    fileCycles: fileCycles.map((c) => ({
      cycle: c,
      length: c.length - 1,
    })),
    packageCycles: packageCycles.map((c) => ({
      cycle: c,
      length: c.length - 1,
    })),
    layerViolations,
    barrelViolations,
    get total() {
      return (
        this.fileCycles.length +
        this.packageCycles.length +
        this.layerViolations.length +
        this.barrelViolations.length
      );
    },
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  const wantJson = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const scanRootArg = process.argv
    .find((a) => a.startsWith("--scan-root="))
    ?.split("=")[1];

  const results = runAllChecks({ scanRoot: scanRootArg });

  if (wantJson) {
    const output = {
      fileCycles: results.fileCycles,
      packageCycles: results.packageCycles,
      layerViolations: results.layerViolations,
      barrelViolations: results.barrelViolations,
      total: results.total,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    const sections = [
      ["file-level cycles", results.fileCycles, (v) => `  ${v.cycle.join(" → ")}`],
      ["package-level cycles", results.packageCycles, (v) => `  ${v.cycle.join(" → ")}`],
      ["layer violations", results.layerViolations, (v) => `  ${v.file}: ${v.rule}`],
      ["barrel violations", results.barrelViolations, (v) => `  ${v.file} imports ${v.target}`],
    ];

    let printed = false;
    for (const [label, items, fmt] of sections) {
      if (items.length > 0) {
        printed = true;
        console.error(`✗ ${items.length} ${label}:\n`);
        for (const v of items) {
          console.error(fmt(v));
        }
        console.error();
      }
    }

    if (!printed) {
      console.log("✓ All boundary checks pass (zero cycles, zero violations).");
    }
  }

  // Cycles are a hard failure: they are the invariant this checker exists to
  // protect and there is no budget for them. Layer and barrel violations are a
  // shrinking backlog tracked as a ratchet in lib/boundaries.poku.js, so they are
  // reported but do not fail the run unless --strict is passed. Without this
  // split the script exits non-zero on a tree that satisfies every invariant,
  // which makes it useless as a CI gate and trains people to ignore it.
  const cycleCount = results.fileCycles.length + results.packageCycles.length;
  const backlogCount =
    results.layerViolations.length + results.barrelViolations.length;
  if (cycleCount > 0) {
    process.exit(1);
  }
  if (strict && backlogCount > 0) {
    process.exit(1);
  }
  if (backlogCount > 0) {
    console.error(
      `\nNote: ${backlogCount} non-cyclic violation(s) remain (layer + barrel). ` +
        "These are ratcheted in lib/boundaries.poku.js and may only decrease. " +
        "Pass --strict to fail on them.",
    );
  }
  process.exit(0);
}

// ─── Exports for testing ─────────────────────────────────────────────────────

export {
  buildFileGraph,
  buildPackageGraph,
  detectFileCycles,
  detectPackageCycles,
  checkLayerRule,
  checkBarrelBan,
  normalizeCycle,
  runAllChecks,
  DESIGNATED_BARRELS,
  PACKAGES,
  PACKAGE_DIRS,
};
