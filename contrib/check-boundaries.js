#!/usr/bin/env node
// check-boundaries.js — Import boundary enforcement for cdxgen workspace packages.
//
// This script validates that every relative import between lib/ subdirectories
// (and from bin/ into lib/) respects the declared dependency graph defined in
// the workspace package.json files under packages/.
//
// An import is a violation when the source file's workspace package does not
// declare a dependency on the target file's workspace package.
//
// Usage:
//   node contrib/check-boundaries.js           // check, exit 1 on violation
//   node contrib/check-boundaries.js --json    // JSON output for CI integration
//
// Exit codes:
//   0 — all imports respect boundaries
//   1 — one or more boundary violations found
//   2 — internal error

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Package → directory mapping ─────────────────────────────────────────────
// Each workspace package maps to one or more lib/ subdirectories.
// The boundary check uses this to determine which package a file belongs to.

const PACKAGE_DIRS = {
  helpers: ["lib/helpers"],
  parsers: ["lib/parsers"],
  managers: ["lib/managers"],
  stages: ["lib/stages/postgen", "lib/stages/pregen"],
  cli: ["lib/cli"],
  evinser: ["lib/evinser"],
  server: ["lib/server"],
  validator: ["lib/validator"],
  audit: ["lib/audit"],
  "third-party": ["lib/third-party"],
};

// bin/ is treated as part of the root package — it may import from any lib/
// subdirectory. We track it separately but don't enforce boundaries on it.
const ROOT_DIRS = ["bin"];

// ─── Load declared dependencies from workspace packages ──────────────────────

function loadDeclaredDependencies() {
  const declarations = {};
  for (const pkgName of Object.keys(PACKAGE_DIRS)) {
    const pkgJsonPath = path.join(
      REPO_ROOT,
      "packages",
      pkgName,
      "package.json",
    );
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      declarations[pkgName] = new Set(
        Object.keys(pkg.dependencies || {}).map((d) =>
          d.replace("@cdxgen/internal-", ""),
        ),
      );
    } catch {
      declarations[pkgName] = new Set();
    }
  }
  return declarations;
}

// ─── Determine which package a file belongs to ───────────────────────────────

function fileToPackage(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");

  // Check if it's in a known package directory
  for (const [pkgName, dirs] of Object.entries(PACKAGE_DIRS)) {
    for (const dir of dirs) {
      if (rel.startsWith(dir + "/")) {
        return pkgName;
      }
    }
  }

  // bin/ files are root-level entry points — no boundary restrictions
  for (const dir of ROOT_DIRS) {
    if (rel.startsWith(dir + "/")) {
      return "root";
    }
  }

  // Root-level files (*.js) are root package
  if (!rel.includes("/")) {
    return "root";
  }

  return null;
}

// ─── Scan files and extract relative imports ─────────────────────────────────

const IMPORT_PATTERNS = [
  // ES module static imports: import ... from "..."
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?)["']([^"']+)["']/g,
  // Dynamic imports: import("...")
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  // Re-exports: export { x } from "..." / export * from "..." /
  // export * as ns from "...". These are real dependency edges and are not
  // matched by the `import` patterns above, so without this a barrel file can
  // cross any boundary undetected.
  /\bexport\s+(?:\*(?:\s+as\s+[$\w]+)?|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
  // CommonJS require("...") — lib/ is ESM today, but .cjs files are scanned.
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
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
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
  // Use a Set to deduplicate — the static-import regex can also match
  // the string inside a dynamic import("..."), producing duplicates.
  const imports = new Set();

  for (const pattern of IMPORT_PATTERNS) {
    // Reset regex lastIndex (patterns have /g flag)
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      // Only relative imports (start with . or ..)
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

  // Try with .js extension if not present
  if (!resolved.endsWith(".js") && !resolved.endsWith(".cjs")) {
    const withJs = resolved + ".js";
    try {
      statSync(withJs);
      return withJs;
    } catch {
      // try as directory with index.js
      const indexJs = path.join(resolved, "index.js");
      try {
        statSync(indexJs);
        return indexJs;
      } catch {
        // File might not exist — return resolved path anyway for error reporting
      }
    }
  }

  return resolved;
}

// ─── Main boundary check ─────────────────────────────────────────────────────

function checkBoundaries() {
  const declared = loadDeclaredDependencies();
  const violations = [];

  // A directory that has been renamed or removed would otherwise make this
  // check silently pass by scanning nothing, so fail loudly instead.
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
      "\nUpdate PACKAGE_DIRS in contrib/check-boundaries.js to match the tree.",
    );
    process.exit(2);
  }

  const scanDirs = [
    ...Object.values(PACKAGE_DIRS).flat(),
    ...ROOT_DIRS,
  ].map((d) => path.join(REPO_ROOT, d));

  const checkedFiles = new Set();

  for (const scanDir of scanDirs) {
    for (const file of walkJsFiles(scanDir)) {
      if (checkedFiles.has(file)) continue;
      checkedFiles.add(file);

      const sourcePackage = fileToPackage(file);
      if (!sourcePackage) continue;

      // root (bin/, top-level) can import from anything — skip
      if (sourcePackage === "root") continue;

      const imports = extractRelativeImports(file);
      for (const imp of imports) {
        const resolvedTarget = resolveImport(file, imp);
        const targetPackage = fileToPackage(resolvedTarget);

        // Skip if target is outside lib/ (e.g., node_modules)
        if (!targetPackage) continue;

        // Same package — always OK
        if (targetPackage === sourcePackage) continue;

        // Check declared dependency
        const allowed = declared[sourcePackage]?.has(targetPackage);
        if (!allowed) {
          const relFile = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
          const relTarget = path
            .relative(REPO_ROOT, resolvedTarget)
            .replace(/\\/g, "/");
          violations.push({
            file: relFile,
            import: imp,
            target: relTarget,
            sourcePackage,
            targetPackage,
            rule: `@cdxgen/internal-${sourcePackage} must not import from @cdxgen/internal-${targetPackage}`,
          });
        }
      }
    }
  }

  return violations;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const wantJson = process.argv.includes("--json");
const violations = checkBoundaries();

if (wantJson) {
  console.log(JSON.stringify({ violations, count: violations.length }, null, 2));
} else if (violations.length === 0) {
  console.log("✓ All imports respect workspace package boundaries.");
} else {
  console.error(`✗ ${violations.length} boundary violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    import: ${v.import}`);
    console.error(`    resolves to: ${v.target}`);
    console.error(`    ${v.rule}\n`);
  }
}

process.exit(violations.length > 0 ? 1 : 0);
