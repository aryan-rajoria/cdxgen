// Security guard for the vendored arborist tree.
//
// This test enforces the four security invariants that make the vendored copy
// safe for cdxgen's read-only use:
//
//   1. No lifecycle scripts — no imports of @npmcli/run-script, child_process.
//   2. No network — no imports of pacote, npm-registry-fetch, make-fetch-happen,
//      cacache, undici, http/https.
//   3. No git resolution — no imports of @npmcli/git.
//   4. No writes — no calls to writeFile, mkdir, rm, rename, symlink, unlink.
//
// It also asserts that the files on disk match the allowlist declared in
// contrib/vendor-arborist.mjs, so neither can drift from the other.
//
// The test is data-driven: adding a specifier or pattern to the FORBIDDEN_* arrays
// immediately extends coverage. A legitimate hit that cannot be removed goes in
// the EXCEPTIONS array with a one-line justification — not in a comment.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const VENDOR_ROOT = path.resolve(__dirname, "arborist", "lib");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENDOR_SCRIPT = path.join(REPO_ROOT, "contrib", "vendor-arborist.mjs");
const MANIFEST_PATH = path.join(REPO_ROOT, "contrib", "arborist-manifest.json");

// ---------------------------------------------------------------------------
// Forbidden import specifiers — any static or dynamic import matching one of
// these makes the vendored tree capable of something cdxgen forbids.
// ---------------------------------------------------------------------------
const FORBIDDEN_IMPORTS = [
  "@npmcli/run-script",
  "node:child_process",
  "child_process",
  "pacote",
  "npm-registry-fetch",
  "make-fetch-happen",
  "cacache",
  "undici",
  "node:http",
  "node:https",
  "http",
  "https",
  "@npmcli/git",
  "@npmcli/metavuln-calculator",
  "bin-links",
  "proggy",
];

// ---------------------------------------------------------------------------
// Forbidden source patterns — dynamic code loading, and calls that mutate the
// filesystem or spawn processes. Read-only fs calls (readFile, readdir, lstat,
// realpath) are expected and allowed.
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
  // Upstream arborist has exactly two code-execution sites, both in
  // npm-extension.js, which cdxgen replaces with a stub. FORBIDDEN_IMPORTS
  // cannot catch them: it matches import specifiers, and the vector is
  // import(<variable>). Matching the call shapes is what stops a future
  // upstream bump from reintroducing execution unnoticed.
  { pattern: /\bimport\s*\(/, label: "import(" },
  { pattern: /\brequire\s*\(/, label: "require(" },
  { pattern: /\beval\s*\(/, label: "eval(" },
  { pattern: /new\s+Function\s*\(/, label: "new Function(" },
  { pattern: /spawn\s*\(/, label: "spawn(" },
  { pattern: /execFile\s*\(/, label: "execFile(" },
  { pattern: /(?<![\w.])exec\s*\(/, label: "exec(" },
  { pattern: /writeFile/, label: "writeFile" },
  { pattern: /mkdir/, label: "mkdir" },
  { pattern: /rmdir/, label: "rmdir" },
  { pattern: /rm\s*\(/, label: "rm(" },
  { pattern: /rename\s*\(/, label: "rename(" },
  { pattern: /symlink/, label: "symlink" },
  { pattern: /unlink/, label: "unlink" },
];

// ---------------------------------------------------------------------------
// Per-file exceptions — each entry must name the file, the pattern/specifier
// it exempts, and a one-line justification. An exception that cannot be
// justified is how this invariant dies.
// ---------------------------------------------------------------------------
const EXCEPTIONS = [
  {
    file: "edge.js",
    pattern: "symlink",
    reason:
      "String literal in a TypeError message ('workspace edges must be a symlink'); not a filesystem call.",
  },
];

function isExempt(relFile, specifierOrLabel) {
  return EXCEPTIONS.some(
    (e) =>
      (relFile === e.file || relFile.endsWith(`/${e.file}`)) &&
      specifierOrLabel === e.pattern,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...listJsFiles(p));
    } else if (name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

function collectVendorFiles() {
  return listJsFiles(VENDOR_ROOT).map((f) => ({
    abs: f,
    rel: path.relative(VENDOR_ROOT, f),
    source: readFileSync(f, "utf8"),
  }));
}

function extractImportSpecifiers(source) {
  const specs = [];
  // Static: import ... from "x"
  const staticRe =
    /(?:^|[;\s])import\s+(?:[\s\S]*?\s+from\s+|)(["'])([^"']+)\1/g;
  let m;
  while ((m = staticRe.exec(source)) !== null) {
    specs.push(m[2]);
  }
  // Dynamic: import("x")
  const dynRe = /import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?(["'])([^"']+)\1\s*\)/g;
  while ((m = dynRe.exec(source)) !== null) {
    specs.push(m[2]);
  }
  return specs;
}

/**
 * Remove // line comments and /* block comments so the forbidden-pattern
 * check only inspects actual code, not prose that happens to mention
 * "symlink" or "writeFile".
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Allowlist extraction — reads the ALLOWLIST array from vendor-arborist.mjs
// and extracts the `path` values, stripping the leading `lib/`.
// ---------------------------------------------------------------------------
function extractAllowlist() {
  const script = readFileSync(VENDOR_SCRIPT, "utf8");
  const match = script.match(/const ALLOWLIST = \[([\s\S]*?)\n\];/);
  if (!match) {
    throw new Error("Could not find ALLOWLIST in vendor-arborist.mjs");
  }
  const body = match[1];
  const pathRe = /path:\s*"([^"]+)"/g;
  const paths = [];
  let pm;
  while ((pm = pathRe.exec(body)) !== null) {
    paths.push(pm[1].replace(/^lib\//, ""));
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("arborist vendored security guard", () => {
  const files = collectVendorFiles();

  it("has no forbidden import specifiers", () => {
    const violations = [];
    for (const file of files) {
      const specs = extractImportSpecifiers(file.source);
      for (const spec of specs) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          if (
            (spec === forbidden || spec.startsWith(`${forbidden}/`)) &&
            !isExempt(file.rel, forbidden)
          ) {
            violations.push(
              `${file.rel}:${spec} imports forbidden specifier '${forbidden}'`,
            );
          }
        }
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      violations.length > 0
        ? `Forbidden imports found:\n${violations.join("\n")}`
        : "",
    );
  });

  it("has no forbidden source patterns (writes, spawns)", () => {
    const violations = [];
    for (const file of files) {
      const lines = stripComments(file.source).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, label } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line) && !isExempt(file.rel, label)) {
            violations.push(
              `${file.rel}:${i + 1}:${label}: ${line.trim().slice(0, 80)}`,
            );
          }
        }
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      violations.length > 0
        ? `Forbidden source patterns found:\n${violations.join("\n")}`
        : "",
    );
  });

  it("files on disk match the allowlist in vendor-arborist.mjs", () => {
    const allowlist = extractAllowlist().sort();
    const onDisk = files.map((f) => f.rel).sort();
    const missing = allowlist.filter((f) => !onDisk.includes(f));
    const extra = onDisk.filter((f) => !allowlist.includes(f));
    assert.deepStrictEqual(
      { missing, extra },
      { missing: [], extra: [] },
      missing.length > 0 || extra.length > 0
        ? `Allowlist drift:\n  missing: ${missing.join(", ")}\n  extra: ${extra.join(", ")}`
        : "",
    );
  });

  // Regenerating the tree requires a checkout of the npm CLI, which CI does not
  // have. The manifest carries a digest of every generated file, so the tree
  // can still be verified byte-for-byte against what was committed.
  it("files on disk match the digests in arborist-manifest.json", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const drift = [];
    for (const file of files) {
      const key = `lib/${file.rel}`;
      const expected = manifest.files[key];
      if (!expected) {
        drift.push(`${file.rel}: not in manifest`);
        continue;
      }
      const actual = `sha256-${createHash("sha256").update(file.source, "utf8").digest("base64")}`;
      if (actual !== expected) {
        drift.push(`${file.rel}: digest mismatch`);
      }
    }
    for (const rel of Object.keys(manifest.files)) {
      if (!files.some((f) => `lib/${f.rel}` === rel)) {
        drift.push(`${rel}: in manifest but not on disk`);
      }
    }
    assert.deepStrictEqual(
      drift,
      [],
      drift.length > 0
        ? `Vendored tree does not match contrib/arborist-manifest.json:\n${drift.join("\n")}\nRegenerate with contrib/vendor-arborist.mjs.`
        : "",
    );
  });
});
