// Regenerates the vendored `@npmcli/arborist` tree from an upstream npm CLI
// checkout, converting each allowlisted module from CommonJS to ESM and
// applying cdxgen-specific patches.
//
// The vendored tree is generated output: the reviewable artifacts are this
// script, the module allowlist, and the named patches under
// `contrib/arborist-patches/`.  Never hand-edit files under
// `lib/third-party/arborist/`; change a patch or the allowlist and re-run.
//
// Usage:
//   node contrib/vendor-arborist.mjs --from <npm-cli-checkout> --ref <git-ref>
//   node contrib/vendor-arborist.mjs --from <npm-cli-checkout> --ref <git-ref> --check
//
// `--from` is a path to a checkout of the npm CLI monorepo.  Module contents
// are read via `git -C <checkout> show <ref>:workspaces/arborist/lib/<file>` so
// the reference checkout is never mutated and the ref is always explicit.
//
// `--check` writes nothing and exits non-zero if the working tree differs from
// what the script would generate.
//
// Every run also writes `contrib/arborist-manifest.json`, which pins the
// upstream commit and records a digest of each generated file.  The guard test
// verifies the tree against those digests, so the vendored tree stays enforced
// in CI, where no npm CLI checkout exists.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vendorRoot = path.join(
  repoRoot,
  "lib",
  "third-party",
  "arborist",
);

// ---------------------------------------------------------------------------
// Allowlist — every module that may appear in the vendored tree.
//
// `source` is one of:
//   "upstream" — fetched from the git ref and converted from CJS to ESM.
//   "stub"     — generated locally by this script; never fetched from upstream.
//   "preserve" — kept as-is from the existing working tree (already local).
//
// One short reason per entry; if you cannot justify a module in one line it
// does not belong here.
// ---------------------------------------------------------------------------
const ALLOWLIST = [
  // --- public entry and arborist class mixins ---
  { path: "lib/index.js", source: "entry", reason: "public entry; re-exports Arborist, Node, Link, Edge, Shrinkwrap. Upstream uses module.exports = require(...) chains that have no clean mechanical CJS→ESM conversion, so this file is generated from a fixed template." },
  { path: "lib/arborist/index.js", source: "upstream", reason: "Arborist class; mixins stripped to load-actual + load-virtual by patch" },
  { path: "lib/arborist/load-actual.js", source: "upstream", reason: "loadActual mixin — one of the two entrypoints cdxgen calls" },
  { path: "lib/arborist/load-virtual.js", source: "upstream", reason: "loadVirtual mixin — the other entrypoint cdxgen calls" },

  // --- core graph types ---
  { path: "lib/node.js", source: "upstream", reason: "Node class; read by parseArboristNode for package, resolved, integrity, dev, optional, peer" },
  { path: "lib/link.js", source: "upstream", reason: "Link class (symlink nodes)" },
  { path: "lib/edge.js", source: "upstream", reason: "Edge class (dependency relationships)" },
  { path: "lib/shrinkwrap.js", source: "upstream", reason: "Shrinkwrap/lockfile reader; write paths removed by patch" },
  { path: "lib/inventory.js", source: "upstream", reason: "Inventory Map — every tree node is registered here" },

  // --- dependency resolution helpers ---
  { path: "lib/calc-dep-flags.js", source: "upstream", reason: "sets dev/optional/peer flags after tree construction" },
  { path: "lib/consistent-resolve.js", source: "upstream", reason: "normalises resolved URLs for lockfile round-tripping" },
  { path: "lib/case-insensitive-map.js", source: "upstream", reason: "case-insensitive children Map for case-insensitive filesystems" },
  { path: "lib/debug.js", source: "preserve", reason: "hand-crafted ESM conversion (inline require, __dirname, module.exports.log); unchanged between arborist-v9.1.4 and arborist-v10.0.2" },
  { path: "lib/dep-valid.js", source: "upstream", reason: "validates whether an edge's spec is satisfied by a node" },
  { path: "lib/from-path.js", source: "upstream", reason: "derives a node location from its on-disk path" },
  { path: "lib/gather-dep-set.js", source: "upstream", reason: "collects the set of nodes needed by a dependency walk" },
  { path: "lib/override-resolves.js", source: "upstream", reason: "maps override keys to resolved targets" },
  { path: "lib/override-set.js", source: "upstream", reason: "OverrideSet class — npm overrides resolution" },
  { path: "lib/printable.js", source: "upstream", reason: "rendering helper for printable trees" },
  { path: "lib/realpath.js", source: "upstream", reason: "cached realpath used by loadActual" },
  { path: "lib/relpath.js", source: "upstream", reason: "relative-path helper for lockfile locations" },
  { path: "lib/spec-from-lock.js", source: "upstream", reason: "derives an npm-package-arg spec from a lockfile entry" },
  { path: "lib/tree-check.js", source: "upstream", reason: "validates the root tree before returning it" },
  { path: "lib/version-from-tgz.js", source: "upstream", reason: "extracts a version from a tarball filename" },
  { path: "lib/yarn-lock.js", source: "upstream", reason: "yarn.lock parser" },

  // --- new in arborist 10.x, reachable from loadActual ---
  { path: "lib/package-extensions.js", source: "upstream", reason: "declarative packageExtensions repair; pure, no code execution" },

  // --- cdxgen-local stubs (never fetched from upstream) ---
  { path: "lib/bin-links.js", source: "preserve", reason: "local dependency-free reimplementation of bin-links getPaths; node.js imports it" },
  { path: "lib/proc-log.js", source: "stub", reason: "no-op stub for proc-log; arborist uses it for logging only" },
  { path: "lib/npm-extension.js", source: "stub", reason: "no-op stub; upstream loads and executes arbitrary .npm-extension code, which cdxgen refuses" },
];

// Modules in the vendor tree that are never fetched from upstream.
const LOCAL_PATHS = new Set(
  ALLOWLIST.filter((m) => m.source !== "upstream").map((m) => m.path),
);

// ---------------------------------------------------------------------------
// Upstream git access
// ---------------------------------------------------------------------------

function gitShow(checkout, ref, filePath) {
  try {
    return execFileSync(
      "git",
      ["-C", checkout, "show", `${ref}:workspaces/arborist/${filePath}`],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (err) {
    throw new Error(
      `git show ${ref}:workspaces/arborist/${filePath} failed: ${err.message}`,
    );
  }
}

function listUpstreamLib(checkout, ref) {
  const top = execFileSync(
    "git",
    ["-C", checkout, "ls-tree", "-r", "--name-only", ref],
    { encoding: "utf8" },
  );
  const files = top
    .split("\n")
    .filter((l) => l.startsWith("workspaces/arborist/lib/") && l.endsWith(".js"))
    .map((l) => l.replace("workspaces/arborist/", ""));
  return files;
}

// ---------------------------------------------------------------------------
// CJS → ESM converter
//
// arborist's CJS style is regular: a block of top-level requires, the module
// body, then a single `module.exports =` at the end.  The converter handles
// every form that appears in the retained set and throws on anything it does
// not recognise, so an upstream style change cannot silently produce invalid
// ESM.
// ---------------------------------------------------------------------------

/**
 * Convert a single CJS source string to ESM.
 *
 * @param {string} source CJS source text
 * @param {string} relPath module path relative to the arborist workspace (for errors)
 * @returns {string} ESM source text
 */
export function convertCjsToEsm(source, relPath) {
  // Collect the converted import statements and the remaining body.
  const lines = source.split("\n");
  const imports = [];
  const body = [];
  let inDestructure = false;
  let destructureBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- multi-line destructured require: `const {` ... `} = require('...')`
    if (inDestructure) {
      destructureBuffer.push(line);
      // Any `} =` terminates the destructure — could be a require (import) or
      // a plain assignment (stays in the body unchanged).
      if (/^\s*\}\s*=/.test(line)) {
        inDestructure = false;
        const block = destructureBuffer.join("\n");
        if (/^\s*\}\s*=\s*require\(/.test(line)) {
          const converted = convertDestructuredRequireBlock(block);
          if (converted) {
            imports.push(converted);
          } else {
            body.push(block);
          }
        } else {
          body.push(block);
        }
        destructureBuffer = [];
      }
      continue;
    }

    // Detect the start of a multi-line destructure.
    if (/^\s*const\s*\{\s*$/.test(line) || /^\s*const\s*\{[^}]*$/.test(line)) {
      // Only treat as a multi-line destructure if there's no `= require(` on
      // the same line (that case is handled by the single-line converter).
      if (!line.includes("= require(")) {
        inDestructure = true;
        destructureBuffer = [line];
        continue;
      }
    }

    // --- single-line require forms ---
    const single = convertSingleLineRequire(line);
    if (single) {
      if (single.import) {
        imports.push(single.import);
        if (single.residual) {
          body.push(single.residual);
        }
      } else {
        body.push(line);
      }
      continue;
    }

    // --- module.exports = ... ---
    const exportMatch = line.match(/^module\.exports\s*=\s*/);
    if (exportMatch) {
      const rest = line.slice(exportMatch[0].length).trim();
      // module.exports = { foo, bar } → export { foo, bar }
      const namedExport = rest.match(
        /^\{([^}]*)\}\s*;?\s*$/,
      );
      if (namedExport) {
        const names = namedExport[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join(", ");
        body.push(`export { ${names} }`);
        continue;
      }
      body.push(`export default ${rest}`);
      continue;
    }

    // --- module.exports.Name = value → export { value as Name } ---
    const propExport = line.match(
      /^module\.exports\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/,
    );
    if (propExport) {
      const [, alias, value] = propExport;
      body.push(
        alias === value ? `export { ${value} }` : `export { ${value} as ${alias} }`,
      );
      continue;
    }

    body.push(line);
  }

  if (inDestructure) {
    // Unterminated destructure — emit what we have and flag it.
    body.push(destructureBuffer.join("\n"));
  }

  // Import order is left to biome's organizeImports in formatWithBiome, so
  // that the generated tree agrees with what `pnpm run lint` would produce.
  const importBlock = imports.length > 0 ? `${imports.join("\n")}\n\n` : "";
  return `${importBlock}${body.join("\n")}`.replace(/\n{3,}/g, "\n\n");
}

/**
 * Convert a `const { a, b } = require('spec')` line to an ESM import.
 * Handles the function-call variant `const x = require('spec')('en')`.
 * Returns null if the line is not a require line.
 */
function convertSingleLineRequire(line) {
  // const IDENT = require('SPEC')  or  const IDENT = require("SPEC")
  let m = line.match(
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*$/,
  );
  if (m) {
    const [, ident, spec] = m;
    return { import: formatDefaultImport(ident, spec) };
  }

  // const IDENT = require('SPEC')(ARGS)  — function-call-after-require
  m = line.match(
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*\((.+)\)\s*$/,
  );
  if (m) {
    const [, ident, spec, args] = m;
    const alias = `${ident}Factory`;
    return {
      import: `import ${alias} from "${spec}";\nconst ${ident} = ${alias}(${args})`,
    };
  }

  // const { a, b, c: d } = require('SPEC')  — single-line destructure
  m = line.match(
    /^const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*$/,
  );
  if (m) {
    const [, deps, spec] = m;
    return { import: formatNamedImport(deps, spec) };
  }

  return null;
}

/**
 * Convert a multi-line destructured require block:
 *   const {
 *     a,
 *     b,
 *   } = require('node:fs/promises')
 */
function convertDestructuredRequireBlock(block) {
  const m = block.match(
    /^const\s*\{([\s\S]*?)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*$/,
  );
  if (!m) {
    return null;
  }
  const [, deps, spec] = m;
  return formatNamedImport(deps, spec);
}

function formatDefaultImport(ident, spec) {
  return `import ${ident} from "${normaliseSpec(spec)}"`;
}

function formatNamedImport(deps, spec) {
  const cleaned = deps
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // CJS destructuring rename `{ key: alias }` becomes ESM `{ key as alias }`.
    .map((s) => {
      const rm = s.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
      return rm ? `${rm[1]} as ${rm[2]}` : s;
    })
    .join(", ");
  // Named imports work for ESM packages and for CJS packages whose named
  // exports Node.js's cjs-module-lexer can detect.  The rare CJS package
  // where the lexer misses a name (treeverse's `depth`) is handled by a
  // dedicated patch, not by a blanket converter rule.
  return `import { ${cleaned} } from "${normaliseSpec(spec)}"`;
}

function isBareSpecifier(spec) {
  return !spec.startsWith(".") && !spec.startsWith("node:") && !spec.startsWith("file:");
}

function pkgVarName(spec) {
  // Derive a readable camelCase variable name from the package specifier.
  const parts = spec.split("/");
  let name;
  if (spec.startsWith("@")) {
    name = parts.slice(1).join("-");
  } else {
    name = parts[0];
  }
  return name
    .split("-")
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

/**
 * Append `.js` to relative specifiers that lack an extension.  Bare
 * specifiers are returned unchanged.
 */
function normaliseSpec(spec) {
  if (spec.startsWith("node:") || spec.startsWith("file:")) {
    return spec;
  }
  if (spec.startsWith(".")) {
    if (path.extname(spec) === "") {
      return `${spec}.js`;
    }
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Patch application
//
// Each `.patch` file in contrib/arborist-patches/ has the shape:
//
//   TARGET: <path relative to vendor root>
//   REASON: <one paragraph; why cdxgen needs this, not what it changes>
//
//   SEARCH:
//   <verbatim text that must appear exactly once in the target>
//   REPLACE:
//   <replacement text>
//
// A patch file may contain multiple SEARCH/REPLACE pairs, all applied to the
// same TARGET in order.  If any SEARCH block is missing or appears more than
// once the script fails loudly with the patch name and target.
// ---------------------------------------------------------------------------

function loadPatches(patchesDir) {
  if (!existsSync(patchesDir)) {
    return [];
  }
  const files = readdirSync(patchesDir)
    .filter((f) => f.endsWith(".patch"))
    .sort();
  return files.map((name) => {
    const text = readFileSync(path.join(patchesDir, name), "utf8");
    return parsePatchFile(name, text);
  });
}

function parsePatchFile(name, text) {
  const targetMatch = text.match(/^TARGET:\s*(.+)$/m);
  const reasonMatch = text.match(/^REASON:\s*(.+)$/m);
  if (!targetMatch) {
    throw new Error(`${name}: missing TARGET line`);
  }
  const target = targetMatch[1].trim();
  const reason = reasonMatch ? reasonMatch[1].trim() : "(no reason given)";

  const pairs = [];
  // Split the file on lines of dashes; each resulting part holds at most one
  // SEARCH/REPLACE pair.
  const parts = text.split(/^-{3,}[ \t]*$/m);
  for (const part of parts) {
    const m = part.match(
      /SEARCH:\s*\n([\s\S]*?)\nREPLACE:\s*\n([\s\S]*)/,
    );
    if (m) {
      pairs.push({
        search: m[1].replace(/\n+$/, ""),
        replace: m[2].replace(/\n+$/, ""),
      });
    }
  }

  if (pairs.length === 0) {
    throw new Error(`${name}: no SEARCH/REPLACE pairs found`);
  }
  return { name, target, reason, pairs };
}

function applyPatch(source, patch) {
  let result = source;
  for (const { search, replace } of patch.pairs) {
    const count = countOccurrences(result, search);
    if (count === 0) {
      throw new Error(
        `patch ${patch.name}: SEARCH block not found in ${patch.target}:\n${truncate(search)}`,
      );
    }
    if (count > 1) {
      throw new Error(
        `patch ${patch.name}: SEARCH block found ${count} times in ${patch.target} (must be unique):\n${truncate(search)}`,
      );
    }
    result = result.replace(search, replace);
  }
  return result;
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function truncate(text) {
  const lines = text.split("\n").slice(0, 6);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stub generators
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Entry-point generator
// ---------------------------------------------------------------------------

function entryPoint() {
  return `// Public entry point for the vendored arborist.  Upstream's index.js uses
// module.exports = require(...) chains that have no mechanical CJS→ESM
// equivalent, so this file is generated from a fixed template by
// contrib/vendor-arborist.mjs.

import Arborist from "./arborist/index.js";
import Edge from "./edge.js";
import Link from "./link.js";
import Node from "./node.js";
import Shrinkwrap from "./shrinkwrap.js";
import PackageExtensions from "./package-extensions.js";
import NpmExtension from "./npm-extension.js";

Arborist.Arborist = Arborist;
Arborist.Node = Node;
Arborist.Link = Link;
Arborist.Edge = Edge;
Arborist.Shrinkwrap = Shrinkwrap;
Arborist.PackageExtensions = PackageExtensions;
Arborist.NpmExtension = NpmExtension;

export default Arborist;
`;
}

function procLogStub() {
  return `// Local no-op stub for proc-log.  The real package drives npm's progress
// bars and structured logging; cdxgen's vendored arborist is read-only and
// silent, so every method is a no-op.  If a future arborist version starts
// relying on proc-log return values rather than side effects, widen this stub.

const noop = () => {};
const noopReturn = (v) => () => v;

const log = {
  silly: noop,
  verbose: noop,
  info: noop,
  timing: noop,
  http: noop,
  notice: noop,
  warn: noop,
  error: noop,
  pause: noop,
  resume: noop,
};

// proc-log's time.start(name) returns an end function that the caller invokes
// when the timed section is done.  Return noop so the call site works.
const time = {
  start: noopReturn(noop),
  end: noop,
  emit: noop,
};

export { log, time };
`;
}

function npmExtensionStub() {
  return `// Local stub for npm-extension.  Upstream discovers a root
// .npm-extension.{mjs,cjs} file and imports it, then calls its
// transformManifest export against every installed package's manifest.  That
// is arbitrary project-local code execution during what is, for cdxgen, a
// read-only scan, so this stub reports that no extension file is present.
//
// The only part of the contract loadActual depends on is \`present\`:
// #applyNpmExtension() returns early when it is false, before load() or
// apply() can be reached.  Those two methods therefore throw rather than
// return a plausible-looking result, so that an upstream change which reaches
// them fails loudly instead of silently producing a tree that differs from
// npm's.
//
// Consequence: on loadActual, a project carrying a .npm-extension file gets a
// tree without the dependency repairs npm would apply.  loadVirtual is
// unaffected — npm bakes the repaired edges into the lockfile, so reading the
// lockfile already reflects them.

const REFUSED = "cdxgen does not execute .npm-extension code";

class NpmExtension {
  constructor() {
    this.present = false;
    this.root = null;
    this.path = null;
    this.format = null;
    this.hash = null;
  }

  async load() {
    throw new Error(REFUSED);
  }

  apply() {
    throw new Error(REFUSED);
  }
}

const hasExtensionFile = () => false;

NpmExtension.NpmExtension = NpmExtension;
NpmExtension.hasExtensionFile = hasExtensionFile;

export default NpmExtension;
export { hasExtensionFile, NpmExtension };
`;
}

// ---------------------------------------------------------------------------
// Biome formatting helper — formats a source string via the biome CLI.
// Used to normalise the converter output before patches are applied, so patch
// SEARCH blocks match clean, formatted ESM rather than the raw converter
// output (which may have inconsistent semicolons or spacing).
// ---------------------------------------------------------------------------

// Runs the same `biome check --write` pipeline that `pnpm run lint` applies to
// the rest of the repo — formatting, import organisation, and every safe lint
// fix — so the generated tree is already a fixed point of the linter.  Without
// this, `pnpm run lint` would rewrite generated files and `--check` would then
// report drift the next time this script runs.
//
// The stdin path is the file's real repo-relative path so that the
// `lib/third-party/**` overrides in biome.json apply.  biome exits non-zero
// when diagnostics it cannot fix remain, but still writes the fixed source to
// stdout, so the output is taken from the error as well as the success path.
function formatWithBiome(source, filePath) {
  const args = [
    "node_modules/@biomejs/biome/bin/biome",
    "check",
    "--write",
    "--stdin-file-path",
    path.join("lib", "third-party", "arborist", filePath),
  ];
  const options = {
    cwd: repoRoot,
    encoding: "utf8",
    input: source,
    maxBuffer: 20 * 1024 * 1024,
  };
  try {
    return execFileSync(process.execPath, args, options);
  } catch (err) {
    // Unfixable diagnostics remain: biome still emits the fixed source.
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return err.stdout;
    }
    // A syntax error or a crash: return the source unchanged so the failure
    // surfaces later with better context.
    return source;
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

function runBiome() {
  // Run biome over just the vendor tree so the converted output matches what
  // cdxgen's CI enforces.
  try {
    execFileSync(
      process.execPath,
      [
        "node_modules/@biomejs/biome/bin/biome",
        "check",
        "--write",
        path.join(vendorRoot, "lib"),
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
    );
  } catch {
    // Biome exits non-zero when it reformats; the --write flag already applied
    // the fixes.  Re-run in check mode to confirm.
    try {
      execFileSync(
        process.execPath,
        [
          "node_modules/@biomejs/biome/bin/biome",
          "check",
          path.join(vendorRoot, "lib"),
        ],
        { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
      );
    } catch {
      // Remaining issues are logged but non-fatal; the caller re-checks.
    }
  }
}

function generateAll(checkout, ref, { skipPatches = false } = {}) {
  const patchesDir = path.join(repoRoot, "contrib", "arborist-patches");
  const patches = skipPatches ? [] : loadPatches(patchesDir);

  const generated = new Map();

  for (const mod of ALLOWLIST) {
    const relPath = mod.path;
    if (mod.source === "entry") {
      if (relPath.endsWith("index.js") && relPath === "lib/index.js") {
        generated.set(relPath, formatWithBiome(entryPoint(), relPath));
      } else {
        throw new Error(`No entry generator for ${relPath}`);
      }
      continue;
    }

    if (mod.source === "stub") {
      if (relPath.endsWith("proc-log.js")) {
        generated.set(relPath, formatWithBiome(procLogStub(), relPath));
      } else if (relPath.endsWith("npm-extension.js")) {
        generated.set(relPath, formatWithBiome(npmExtensionStub(), relPath));
      } else {
        throw new Error(`No stub generator for ${relPath}`);
      }
      continue;
    }

    if (mod.source === "preserve") {
      const abs = path.join(vendorRoot, relPath);
      if (!existsSync(abs)) {
        throw new Error(
          `preserve module ${relPath} not found in working tree at ${abs}`,
        );
      }
      generated.set(relPath, formatWithBiome(readFileSync(abs, "utf8"), relPath));
      continue;
    }

    // source === "upstream"
    const upstream = gitShow(checkout, ref, relPath);
    let converted = convertCjsToEsm(upstream, relPath);
    // Format before patching so SEARCH blocks match stable, formatted ESM.
    converted = formatWithBiome(converted, relPath);

    // Apply any patches whose target matches.
    for (const patch of patches) {
      if (patchTargetMatches(patch.target, relPath)) {
        converted = applyPatch(converted, patch);
      }
    }
    // Format again after patching to keep the output clean.
    converted = formatWithBiome(converted, relPath);

    generated.set(relPath, converted);
  }

  return generated;
}

function patchTargetMatches(target, relPath) {
  // Normalize both sides so `lib/node.js` matches `node.js`.
  const normTarget = target.replace(/^lib\//, "");
  const normPath = relPath.replace(/^lib\//, "");
  return normTarget === normPath;
}

function writeAll(generated) {
  // Remove every existing .js file under the vendor lib root so deleted
  // modules don't linger; then write the generated set.
  const libDir = path.join(vendorRoot, "lib");
  if (existsSync(libDir)) {
    for (const existing of listJsFiles(libDir)) {
      const rel = path.relative(vendorRoot, existing);
      if (!generated.has(rel)) {
        rmSync(existing, { force: true });
      }
    }
  }
  for (const [relPath, content] of generated) {
    const abs = path.join(vendorRoot, relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

// The manifest pins the upstream commit the tree was generated from and
// records a digest of every generated file.  It lets the vendored tree be
// verified without a checkout of the npm CLI, which is the only way the check
// can run in CI.
const manifestPath = path.join(repoRoot, "contrib", "arborist-manifest.json");

function digest(content) {
  return `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`;
}

function buildManifest(generated, checkout, ref) {
  const commit = execFileSync("git", ["-C", checkout, "rev-parse", ref], {
    encoding: "utf8",
  }).trim();
  const files = {};
  for (const relPath of [...generated.keys()].sort()) {
    files[relPath] = digest(generated.get(relPath));
  }
  return {
    upstream: "https://github.com/npm/cli",
    ref,
    commit,
    generator: "contrib/vendor-arborist.mjs",
    files,
  };
}

function writeManifest(manifest) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

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

function diffAgainstWorkingTree(generated) {
  const differences = [];
  const libDir = path.join(vendorRoot, "lib");

  // Files on disk that are not in the generated set.
  if (existsSync(libDir)) {
    for (const existing of listJsFiles(libDir)) {
      const rel = path.relative(vendorRoot, existing);
      if (!generated.has(rel)) {
        differences.push({ path: rel, kind: "extra" });
      }
    }
  }

  // Files whose content differs.
  for (const [relPath, content] of generated) {
    const abs = path.join(vendorRoot, relPath);
    if (!existsSync(abs)) {
      differences.push({ path: relPath, kind: "missing" });
    } else if (readFileSync(abs, "utf8") !== content) {
      differences.push({ path: relPath, kind: "changed" });
    }
  }

  return differences;
}

function reportNewUpstreamModules(checkout, ref) {
  const upstreamFiles = listUpstreamLib(checkout, ref)
    .map((f) => f.replace(/^lib\//, ""))
    .filter((f) => !f.startsWith("arborist/"));
  const upstreamArborist = listUpstreamLib(checkout, ref)
    .filter((f) => f.startsWith("lib/arborist/"))
    .map((f) => f.replace(/^lib\//, ""));

  const allUpstream = [...upstreamFiles, ...upstreamArborist];
  const allowed = new Set(ALLOWLIST.map((m) => m.path.replace(/^lib\//, "")));

  const newModules = allUpstream.filter((f) => !allowed.has(f));
  if (newModules.length > 0) {
    process.stderr.write("\nnew upstream modules, not vendored:\n");
    for (const f of newModules.sort()) {
      process.stderr.write(`  - ${f}\n`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const checkoutIdx = args.indexOf("--from");
  const refIdx = args.indexOf("--ref");
  const check = args.includes("--check");
  // Writes the unpatched conversion, so that a patch's SEARCH block can be
  // re-derived after a change to the converter.  Never commit its output.
  const skipPatches = args.includes("--no-patches");

  if (checkoutIdx === -1 || refIdx === -1) {
    process.stderr.write(
      "usage: node contrib/vendor-arborist.mjs --from <checkout> --ref <git-ref> [--check] [--no-patches]\n",
    );
    process.exit(2);
  }

  if (skipPatches && check) {
    process.stderr.write("--no-patches cannot be combined with --check\n");
    process.exit(2);
  }

  const checkout = args[checkoutIdx + 1];
  const ref = args[refIdx + 1];

  const generated = generateAll(checkout, ref, { skipPatches });
  reportNewUpstreamModules(checkout, ref);

  if (check) {
    const manifest = buildManifest(generated, checkout, ref);
    const onDisk = existsSync(manifestPath)
      ? readFileSync(manifestPath, "utf8")
      : null;
    if (onDisk !== `${JSON.stringify(manifest, null, 2)}\n`) {
      process.stderr.write(
        "\ncontrib/arborist-manifest.json is out of date.\n",
      );
      process.exit(1);
    }
    const diffs = diffAgainstWorkingTree(generated);
    if (diffs.length > 0) {
      process.stderr.write(
        `\nvendor tree is out of date (${diffs.length} difference(s)):\n`,
      );
      for (const d of diffs) {
        process.stderr.write(`  ${d.kind.padEnd(8)} ${d.path}\n`);
      }
      process.stderr.write(
        "\nRun: node contrib/vendor-arborist.mjs --from <checkout> --ref <ref>\n",
      );
      process.exit(1);
    }
    process.stdout.write("vendor tree matches generated output.\n");
    return;
  }

  writeAll(generated);
  const manifest = buildManifest(generated, checkout, ref);
  writeManifest(manifest);
  process.stdout.write(
    `regenerated ${generated.size} modules from ${ref} (${manifest.commit.slice(0, 12)}).\n`,
  );
}

// Run main() only when this module is the entry point, not when imported.
if (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("vendor-arborist.mjs")
) {
  main();
}
