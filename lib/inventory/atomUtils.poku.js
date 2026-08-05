import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assert, it } from "poku";

import { dirNameStr } from "../core/paths.js";
import {
  ATOM_NATIVE_PACKAGES,
  buildAtomCommandEnv,
  executeAtom,
  filterAtomSlicesByExcludePatterns,
  getAtomCommand,
  globPatternsToAtomIgnoreRegex,
  isPathExcludedByGlobPatterns,
  resolveAtomProvider,
} from "./atomUtils.js";

it("converts cdxgen exclude globs to Scala-compatible regex", () => {
  const atomRegex = globPatternsToAtomIgnoreRegex([
    "**/*.spec.js",
    "src/**/fixtures/*.{js,ts}",
    "test/[!a-c]?.jsx",
    "packages/@(api|web)/**/*.test.ts",
  ]);
  const regex = new RegExp(atomRegex);
  assert.ok(regex.test("example.spec.js"));
  assert.ok(regex.test("src/example.spec.js"));
  assert.ok(regex.test("src\\example.spec.js"));
  assert.ok(regex.test("src/app/fixtures/demo.ts"));
  assert.ok(regex.test("test/z1.jsx"));
  assert.ok(regex.test("packages/api/src/foo.test.ts"));
  assert.ok(regex.test("packages/web/foo.test.ts"));
  assert.ok(!regex.test("src/app/fixtures/demo.py"));
  assert.ok(!regex.test("test/a1.jsx"));
  assert.ok(!regex.test("packages/mobile/foo.test.ts"));
  assert.ok(!regex.test("src/example.spec.jsx"));
});

it("treats escaped glob wildcards as literal characters", () => {
  const atomRegex = globPatternsToAtomIgnoreRegex(["src/escaped/\\*.js"]);
  const regex = new RegExp(atomRegex);
  assert.ok(regex.test("src/escaped/*.js"));
  assert.ok(!regex.test("src/escaped/index.js"));
});

it("matches paths against cdxgen exclude globs", () => {
  const patterns = ["**/*.spec.js", "src/generated/**"];
  assert.ok(isPathExcludedByGlobPatterns("src/foo.spec.js", patterns));
  assert.ok(isPathExcludedByGlobPatterns("src/generated/client.js", patterns));
  assert.ok(isPathExcludedByGlobPatterns("src\\foo.spec.js", patterns));
  assert.ok(!isPathExcludedByGlobPatterns("src/foo.test.js", patterns));
  assert.ok(!isPathExcludedByGlobPatterns("src/manual/client.js", patterns));
});

it("builds global Atom and JavaScript astgen exclude environment", () => {
  const originalAstgenIgnoreDirs = process.env.ASTGEN_IGNORE_DIRS;
  const originalAstgenIgnoreFilePattern =
    process.env.ASTGEN_IGNORE_FILE_PATTERN;
  const originalChenIgnoreDirs = process.env.CHEN_IGNORE_DIRS;
  try {
    delete process.env.ASTGEN_IGNORE_DIRS;
    delete process.env.ASTGEN_IGNORE_FILE_PATTERN;
    process.env.CHEN_IGNORE_DIRS = "vendor";
    const options = {
      exclude: [
        "**/ignored/**",
        "src/generated/**",
        "**/*.spec.js",
        "noxfile.py",
      ],
    };
    const env = buildAtomCommandEnv(options, "javascript");
    const chenIgnoreDirs = env.CHEN_IGNORE_DIRS.split(",");
    const astgenIgnoreDirs = env.ASTGEN_IGNORE_DIRS.split(",");
    assert.deepStrictEqual(Object.keys(env).sort(), [
      "ASTGEN_IGNORE_DIRS",
      "ASTGEN_IGNORE_FILE_PATTERN",
      "CHEN_IGNORE_DIRS",
    ]);
    assert.ok(chenIgnoreDirs.includes("vendor"));
    assert.ok(chenIgnoreDirs.includes("ignored"));
    assert.ok(chenIgnoreDirs.includes("generated"));
    assert.ok(chenIgnoreDirs.includes("noxfile.py"));
    assert.ok(!chenIgnoreDirs.includes("src"));
    assert.ok(astgenIgnoreDirs.includes("node_modules"));
    assert.ok(astgenIgnoreDirs.includes("ignored"));
    assert.ok(astgenIgnoreDirs.includes("generated"));
    assert.ok(!astgenIgnoreDirs.includes("noxfile.py"));
    assert.ok(!astgenIgnoreDirs.includes("src"));
    assert.ok(
      new RegExp(env.ASTGEN_IGNORE_FILE_PATTERN).test("src/foo.spec.js"),
    );

    const pythonEnv = buildAtomCommandEnv(options, "python");
    assert.deepStrictEqual(Object.keys(pythonEnv).sort(), ["CHEN_IGNORE_DIRS"]);
  } finally {
    if (originalAstgenIgnoreDirs === undefined) {
      delete process.env.ASTGEN_IGNORE_DIRS;
    } else {
      process.env.ASTGEN_IGNORE_DIRS = originalAstgenIgnoreDirs;
    }
    if (originalAstgenIgnoreFilePattern === undefined) {
      delete process.env.ASTGEN_IGNORE_FILE_PATTERN;
    } else {
      process.env.ASTGEN_IGNORE_FILE_PATTERN = originalAstgenIgnoreFilePattern;
    }
    if (originalChenIgnoreDirs === undefined) {
      delete process.env.CHEN_IGNORE_DIRS;
    } else {
      process.env.CHEN_IGNORE_DIRS = originalChenIgnoreDirs;
    }
  }
});

it("filters Atom slices using exclude globs", () => {
  const sliceData = {
    objectSlices: [
      { fileName: "src/index.js", fullName: "src/index.js::program" },
      { fileName: "src/index.spec.js", fullName: "src/index.spec.js::program" },
    ],
    userDefinedTypes: [
      { fileName: "src/generated/client.js", name: "GeneratedClient" },
      { fileName: "src/model.js", name: "Model" },
    ],
    reachables: [
      { flows: [{ parentFileName: "src/index.js" }] },
      { flows: [{ parentFileName: "src/index.spec.js" }] },
    ],
  };
  const filtered = filterAtomSlicesByExcludePatterns(sliceData, [
    "**/*.spec.js",
    "src/generated/**",
  ]);
  assert.deepStrictEqual(
    filtered.objectSlices.map((slice) => slice.fileName),
    ["src/index.js"],
  );
  assert.deepStrictEqual(
    filtered.userDefinedTypes.map((slice) => slice.fileName),
    ["src/model.js"],
  );
  assert.strictEqual(filtered.reachables.length, 1);
});

it("resolves the atom provider kind for all eight published platform triples", () => {
  // Every (os, arch, libc) triple atom publishes a sub-package for, with the
  // kind atom assigns it. This is the parity surface against atom's own
  // NATIVE_PACKAGES set in @appthreat/atom/resolve.js.
  const cases = [
    {
      platform: "win32",
      arch: "x64",
      expectedPkg: "@appthreat/atom-windows-amd64",
      expectedKind: "native",
    },
    {
      platform: "win32",
      arch: "arm64",
      expectedPkg: "@appthreat/atom-windows-arm64",
      expectedKind: "jar",
    },
    {
      platform: "darwin",
      arch: "arm64",
      expectedPkg: "@appthreat/atom-darwin-arm64",
      expectedKind: "native",
    },
    {
      platform: "darwin",
      arch: "x64",
      expectedPkg: "@appthreat/atom-darwin-amd64",
      expectedKind: "jar",
    },
    {
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      expectedPkg: "@appthreat/atom-linux-amd64",
      expectedKind: "native",
    },
    {
      platform: "linux",
      arch: "x64",
      libc: "musl",
      expectedPkg: "@appthreat/atom-linux-amd64-musl",
      expectedKind: "native",
    },
    {
      platform: "linux",
      arch: "arm64",
      libc: "glibc",
      expectedPkg: "@appthreat/atom-linux-arm64",
      expectedKind: "native",
    },
    {
      platform: "linux",
      arch: "arm64",
      libc: "musl",
      expectedPkg: "@appthreat/atom-linux-arm64-musl",
      expectedKind: "jar",
    },
  ];
  for (const c of cases) {
    const resolved = resolveAtomProvider(c);
    assert.strictEqual(
      resolved.preferredPkg,
      c.expectedPkg,
      `pkg for ${c.platform}/${c.arch}/${c.libc || ""}`,
    );
    assert.strictEqual(
      resolved.kind,
      c.expectedKind,
      `kind for ${c.platform}/${c.arch}/${c.libc || ""}`,
    );
    assert.strictEqual(
      ATOM_NATIVE_PACKAGES.has(resolved.preferredPkg),
      resolved.kind === "native",
      `NATIVE_PACKAGES membership mismatch for ${resolved.preferredPkg}`,
    );
  }
});

it("agrees with atom's own resolver for every platform triple", async () => {
  // The drift guard. The assertions above only compare cdxgen's table against
  // itself; this one compares it against @appthreat/atom's resolve.js, which is
  // the thing that actually decides which payload is loaded at runtime. atom is
  // an optional dependency, so skip rather than fail when it is absent.
  // atom's package.json declares `"exports": "./index.js"` (a bare string), so
  // the `@appthreat/atom/resolve.js` subpath is not importable by specifier.
  // Load it by path instead.
  const resolveJs = join(
    dirNameStr,
    "node_modules",
    "@appthreat",
    "atom",
    "resolve.js",
  );
  if (!existsSync(resolveJs)) {
    console.log(
      "@appthreat/atom not installed; skipping resolver parity test.",
    );
    return;
  }
  const atomResolve = await import(pathToFileURL(resolveJs).href);
  const triples = [
    { platform: "win32", arch: "x64" },
    { platform: "win32", arch: "arm64" },
    { platform: "darwin", arch: "arm64" },
    { platform: "darwin", arch: "x64" },
    { platform: "linux", arch: "x64", libc: "glibc" },
    { platform: "linux", arch: "x64", libc: "musl" },
    { platform: "linux", arch: "arm64", libc: "glibc" },
    { platform: "linux", arch: "arm64", libc: "musl" },
    { platform: "freebsd", arch: "x64" },
  ];
  for (const triple of triples) {
    const ours = resolveAtomProvider(triple);
    const theirs = atomResolve.resolveAtomProvider(triple);
    const label = `${triple.platform}/${triple.arch}/${triple.libc || ""}`;
    assert.strictEqual(
      ours.preferredPkg,
      theirs.preferredPkg,
      `package disagrees with atom for ${label}`,
    );
    assert.strictEqual(
      ours.kind,
      theirs.kind,
      `kind disagrees with atom for ${label}`,
    );
  }
});

it("falls back to the jar package for an unmapped triple", () => {
  const resolved = resolveAtomProvider({
    platform: "freebsd",
    arch: "x64",
  });
  assert.strictEqual(resolved.preferredPkg, "@appthreat/atom-jar");
  assert.strictEqual(resolved.kind, "jar");
});

it("reports a non-zero atom exit as failure (stub atom exits 1 with no output)", () => {
  const originalAtomCmd = process.env.ATOM_CMD;
  const stubPath = join(tmpdir(), `atom-stub-exit1-${process.pid}.js`);
  writeFileSync(stubPath, "process.exit(1);\n");
  try {
    process.env.ATOM_CMD = `${process.execPath} ${stubPath}`;
    const ok = executeAtom(process.cwd(), ["--help"], {});
    assert.strictEqual(
      ok,
      false,
      "a stub atom exiting 1 must be reported as failure",
    );
    assert.strictEqual(getAtomCommand().includes(stubPath), true);
  } finally {
    if (originalAtomCmd === undefined) {
      delete process.env.ATOM_CMD;
    } else {
      process.env.ATOM_CMD = originalAtomCmd;
    }
    try {
      unlinkSync(stubPath);
    } catch {
      // ignore
    }
  }
});

it("reports an unsupported language as failure (stub atom prints the unsupported banner)", () => {
  const originalAtomCmd = process.env.ATOM_CMD;
  const stubPath = join(tmpdir(), `atom-stub-unsupported-${process.pid}.js`);
  writeFileSync(
    stubPath,
    'console.log("No language frontend supported for language: foo");\n',
  );
  try {
    process.env.ATOM_CMD = `${process.execPath} ${stubPath}`;
    const ok = executeAtom(process.cwd(), ["usages", "-l", "foo"], {});
    assert.strictEqual(
      ok,
      false,
      "a stub atom printing the unsupported banner must be reported as failure",
    );
  } finally {
    if (originalAtomCmd === undefined) {
      delete process.env.ATOM_CMD;
    } else {
      process.env.ATOM_CMD = originalAtomCmd;
    }
    try {
      unlinkSync(stubPath);
    } catch {
      // ignore
    }
  }
});
