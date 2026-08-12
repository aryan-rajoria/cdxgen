#!/usr/bin/env node
// check-lib-paths.js — resolve every reference to a lib/ module made from
// outside lib/ itself.
//
// Module moves inside lib/ are caught immediately by the test suite, because a
// stale relative import throws at load. References from test/, contrib/, bin/,
// .github/ and docs/ are not: some live in YAML strings, some in markdown, and
// some are assembled with path.join(REPO_ROOT, "lib", "x", "y.js"), which no
// grep for "lib/x/" will find. Every one of those has broken at least once
// during the v13 reorganisation.
//
// Usage:
//   node contrib/check-lib-paths.js          // exit 1 if any path is unresolved
//   node contrib/check-lib-paths.js --json
//
// Exit codes:
//   0 — every referenced lib/ path exists
//   1 — at least one is unresolved
//   2 — internal error

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Roots scanned for references. lib/ is deliberately absent: it is covered by
// the test suite, which loads every module.
const SCAN_ROOTS = ["test", "contrib", "bin", ".github", "docs", "packages"];

const SCANNED_EXTENSIONS = /\.(?:js|cjs|mjs|ts|sh|ya?ml|md)$/;

const SKIP_DIRS = new Set(["node_modules", ".git", "bomresults"]);

// test/data holds third-party lockfiles and manifests that legitimately mention
// their own lib/ paths (e.g. npm packages shipping lib/cli.js). Those are
// fixture content, not references to cdxgen's own modules.
// This file's own doc comment and regexes contain example paths.
const SKIP_PATHS = [
  path.join("test", "data"),
  path.join("contrib", "check-lib-paths.js"),
  path.join("contrib", "vendor-arborist.mjs"),
];

// "lib/helpers/utils.js", "./lib/core/fs.js", "../../lib/ecosystems/purl.js"
const LITERAL_PATH = /((?:\.{1,2}\/)*lib\/[A-Za-z0-9_\-/.]+\.js)/g;
// path.join(REPO_ROOT, "lib", "ecosystems", "utils.js")
const JOINED_PATH = /"lib"\s*,\s*"([A-Za-z0-9_-]+)"\s*,\s*"([A-Za-z0-9_.-]+\.js)"/g;

// Placeholders used in prose, not real paths.
const PLACEHOLDER = /[<>*]/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (SCANNED_EXTENSIONS.test(entry)) {
      yield full;
    }
  }
}

function isSkipped(relFile) {
  return SKIP_PATHS.some(
    (p) => relFile === p || relFile.startsWith(p + path.sep),
  );
}

function collectUnresolved() {
  const unresolved = [];

  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(REPO_ROOT, root);
    if (!existsSync(absRoot)) {
      continue;
    }
    for (const file of walk(absRoot)) {
      const relFile = path.relative(REPO_ROOT, file);
      if (isSkipped(relFile)) {
        continue;
      }
      const text = readFileSync(file, "utf-8");

      for (const match of text.matchAll(LITERAL_PATH)) {
        const spec = match[1];
        if (PLACEHOLDER.test(spec)) {
          continue;
        }
        // In JS a relative specifier resolves against the referencing file. In
        // YAML and markdown it does not: the inline scripts in the workflows are
        // piped to node with the repo root as cwd, so "./lib/x.js" there means
        // the repo root. Accept either origin for those, and the file-relative
        // one only for real modules.
        const isCode = /\.(?:js|cjs|mjs|ts)$/.test(file);
        const candidates = spec.startsWith(".")
          ? isCode
            ? [path.resolve(path.dirname(file), spec)]
            : [path.resolve(path.dirname(file), spec), path.join(REPO_ROOT, spec)]
          : [path.join(REPO_ROOT, spec)];
        if (!candidates.some((c) => existsSync(c))) {
          unresolved.push({ file: relFile, reference: spec });
        }
      }

      for (const match of text.matchAll(JOINED_PATH)) {
        const spec = `lib/${match[1]}/${match[2]}`;
        if (!existsSync(path.join(REPO_ROOT, spec))) {
          unresolved.push({ file: relFile, reference: spec, form: "path.join" });
        }
      }
    }
  }

  return unresolved;
}

function main() {
  const asJson = process.argv.includes("--json");
  const unresolved = collectUnresolved();

  if (asJson) {
    console.log(JSON.stringify({ unresolved, total: unresolved.length }, null, 2));
  } else if (unresolved.length) {
    console.error(
      `✗ ${unresolved.length} reference(s) to lib/ modules do not resolve:\n`,
    );
    for (const u of unresolved) {
      console.error(
        `  ${u.file}: ${u.reference}${u.form ? ` (${u.form} form)` : ""}`,
      );
    }
    console.error(
      "\nA module was moved without updating its callers outside lib/.",
    );
  } else {
    console.log("✓ All lib/ references outside lib/ resolve.");
  }

  process.exit(unresolved.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error("check-lib-paths failed:", err);
  process.exit(2);
}
