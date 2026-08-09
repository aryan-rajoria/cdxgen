import { join } from "node:path";

import { assert, describe, it } from "poku";

import {
  getZigGlobalCacheDir,
  isValidZigHash,
  resolveZigGraph,
} from "./zigResolver.js";

const FIXTURES = join(process.cwd(), "test", "data", "zig-resolution");

const KNOWN_FOLDERS_HASH =
  "known_folders-0.0.0-Fy-PJiDLAAB98m3uYUzatrTb2mO2fpvwx2zpSroEtfbO";

/**
 * Run a body with `ZIG_GLOBAL_CACHE_DIR` pointed at a fixture cache, restoring
 * the previous value afterwards. `HOME` is redirected too so a miss cannot
 * silently fall through to the developer's real Zig cache and pass for the
 * wrong reason.
 */
async function withCacheDir(cacheDir, body) {
  const prevCache = process.env.ZIG_GLOBAL_CACHE_DIR;
  const prevHome = process.env.HOME;
  if (cacheDir) {
    process.env.ZIG_GLOBAL_CACHE_DIR = cacheDir;
  } else {
    delete process.env.ZIG_GLOBAL_CACHE_DIR;
  }
  process.env.HOME = join(FIXTURES, "_no_such_home");
  try {
    return await body();
  } finally {
    if (prevCache === undefined) {
      delete process.env.ZIG_GLOBAL_CACHE_DIR;
    } else {
      process.env.ZIG_GLOBAL_CACHE_DIR = prevCache;
    }
    process.env.HOME = prevHome;
  }
}

/** Look up a component's outgoing edge by name. */
function edgeFor(result, name) {
  const pkg = result.pkgList.find((p) => p.name === name);
  assert.ok(pkg, `${name} must be a component`);
  const edge = result.dependencies.find((d) => d.ref === pkg["bom-ref"]);
  assert.ok(edge, `${name} must have a dependency edge`);
  return edge;
}

describe("isValidZigHash", () => {
  it("accepts the 0.14+ name-version-base64 form", () => {
    assert.ok(isValidZigHash(KNOWN_FOLDERS_HASH));
    assert.ok(
      isValidZigHash(
        "clap-0.12.0-oBajB2LpAQD1BQpAukHcuwhIUoHWYNy2DzU6lDW2v2N8",
      ),
    );
    assert.ok(
      isValidZigHash(
        "httpz-0.0.0-PNVzrMPnCAAWJqhMEZR8gDZeg1CQObCEMTEf8zDh-u-j",
      ),
    );
  });

  it("accepts pre-0.14 hex multihashes", () => {
    assert.ok(
      isValidZigHash(
        "1220c7e77f2e8e4a8b6f8b1c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a",
      ),
    );
  });

  it("rejects path traversal attempts without touching the filesystem", () => {
    assert.ok(!isValidZigHash("../etc/passwd"));
    assert.ok(!isValidZigHash("foo/../../bar"));
    assert.ok(!isValidZigHash("..\\windows\\system32"));
    assert.ok(!isValidZigHash("evil/../escape"));
    // Traversal disguised as a legal 0.14+ hash apart from the separators.
    assert.ok(!isValidZigHash("pkg-1.0-..%2f..%2fetc"));
    assert.ok(!isValidZigHash(`pkg-1.0-abc${"/"}..`));
  });

  it("rejects empty, null, and non-string values", () => {
    assert.ok(!isValidZigHash(""));
    assert.ok(!isValidZigHash(null));
    assert.ok(!isValidZigHash(undefined));
    assert.ok(!isValidZigHash(123));
  });

  it("rejects hashes containing spaces or shell metacharacters", () => {
    assert.ok(!isValidZigHash("foo bar"));
    assert.ok(!isValidZigHash("foo;rm -rf /"));
    assert.ok(!isValidZigHash("pkg-1.0-abc\0def"));
  });
});

describe("getZigGlobalCacheDir", () => {
  it("prefers ZIG_GLOBAL_CACHE_DIR over every derived location", async () => {
    await withCacheDir("/tmp/explicit-zig-cache", () => {
      assert.strictEqual(getZigGlobalCacheDir(), "/tmp/explicit-zig-cache");
    });
  });

  it("falls back to a zig subdirectory of the user cache", async () => {
    await withCacheDir(null, () => {
      const dir = getZigGlobalCacheDir();
      if (dir) {
        assert.ok(dir.endsWith("/zig") || dir.endsWith("\\zig"));
      }
    });
  });
});

describe("resolveZigGraph", () => {
  it("walks in-tree zig-pkg/ transitively, not just the direct deps", async () => {
    const projectRoot = join(FIXTURES, "project-016");
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );

    // 3 direct (httpz, known_folders, clap) + 2 reached only through httpz.
    assert.deepStrictEqual(
      result.pkgList.map((p) => p.name).sort(),
      ["clap", "httpz", "known_folders", "metrics", "websocket"],
      "metrics and websocket are reachable only by resolving httpz's hash",
    );
    assert.strictEqual(result.unresolvedCount, 0);

    const httpz = edgeFor(result, "httpz");
    assert.strictEqual(
      httpz.dependsOn.length,
      2,
      "httpz declares exactly metrics and websocket",
    );

    const rootEdge = result.dependencies.find(
      (d) => d.ref === result.parentComponent["bom-ref"],
    );
    assert.ok(rootEdge, "the parent component must anchor the graph");
    assert.strictEqual(rootEdge.dependsOn.length, 3);
  });

  it("emits a graph with no dangling refs", async () => {
    const projectRoot = join(FIXTURES, "project-016");
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    const known = new Set(result.pkgList.map((p) => p["bom-ref"]));
    known.add(result.parentComponent["bom-ref"]);
    const dangling = [];
    for (const edge of result.dependencies) {
      if (!known.has(edge.ref)) {
        dangling.push(edge.ref);
      }
      for (const ref of edge.dependsOn) {
        if (!known.has(ref)) {
          dangling.push(ref);
        }
      }
    }
    assert.deepStrictEqual(dangling, []);
  });

  it("gives every component exactly one edge entry", async () => {
    const projectRoot = join(FIXTURES, "project-016");
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    const refs = result.dependencies.map((d) => d.ref);
    assert.strictEqual(
      refs.length,
      new Set(refs).size,
      "a repeated ref would make consumers pick one edge set arbitrarily",
    );
    assert.strictEqual(refs.length, result.pkgList.length + 1);
  });

  it("resolves 0.14 extracted-cache-directory manifests", async () => {
    const projectRoot = join(FIXTURES, "project-014");
    const result = await withCacheDir(join(FIXTURES, "cache-014"), () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    assert.deepStrictEqual(
      result.pkgList.map((p) => p.name),
      ["known_folders"],
    );
    assert.strictEqual(result.unresolvedCount, 0);
    assert.deepStrictEqual(edgeFor(result, "known_folders").dependsOn, []);
  });

  it("reads build.zig.zon out of a .tar.gz cache archive", async () => {
    const projectRoot = join(FIXTURES, "project-archive");
    const result = await withCacheDir(join(FIXTURES, "cache-016"), () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    // The archive is the only container holding clap's manifest: there is no
    // zig-pkg/ tree and no extracted cache directory for this hash.
    assert.strictEqual(
      result.unresolvedCount,
      0,
      "clap's hash must resolve through the archive",
    );
    assert.deepStrictEqual(edgeFor(result, "clap").dependsOn, []);
  });

  it("counts an unresolvable hash and still emits the component", async () => {
    const projectRoot = join(FIXTURES, "project-014");
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    assert.strictEqual(result.pkgList.length, 1);
    assert.strictEqual(result.unresolvedCount, 1);
    assert.deepStrictEqual(edgeFor(result, "known_folders").dependsOn, []);
  });

  it("terminates on a manifest cycle", async () => {
    const projectRoot = join(FIXTURES, "project-cycle");
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(projectRoot, "build.zig.zon"), projectRoot, {}),
    );
    assert.deepStrictEqual(
      result.pkgList.map((p) => p.name).sort(),
      ["alpha", "beta"],
      "alpha -> beta -> alpha must be walked once, not forever",
    );
    assert.strictEqual(edgeFor(result, "alpha").dependsOn.length, 1);
  });

  it("returns an empty graph for an unreadable manifest", async () => {
    const result = await withCacheDir(null, () =>
      resolveZigGraph(join(FIXTURES, "no-such-file.zon"), FIXTURES, {}),
    );
    assert.deepStrictEqual(result.pkgList, []);
    assert.strictEqual(result.unresolvedCount, 0);
  });
});

describe("resolveZigGraph — manifest fields", () => {
  const synthetic = join(
    FIXTURES,
    "manifests",
    "synthetic-lazy-path-fingerprint.zon",
  );

  it("maps .lazy = true to scope:optional and cdx:zig:lazy", async () => {
    const result = await withCacheDir(null, () =>
      resolveZigGraph(synthetic, FIXTURES, {}),
    );
    const zap = result.pkgList.find((p) => p.name === "zap");
    assert.ok(zap);
    assert.strictEqual(zap.scope, "optional");
    assert.ok(zap.properties.some((p) => p.name === "cdx:zig:lazy"));

    const eager = result.pkgList.find((p) => p.name === "known_folders");
    assert.strictEqual(eager.scope, "required");
    assert.ok(!eager.properties.some((p) => p.name === "cdx:zig:lazy"));
  });

  it("captures .fingerprint on the parent component", async () => {
    const result = await withCacheDir(null, () =>
      resolveZigGraph(synthetic, FIXTURES, {}),
    );
    const fp = result.parentComponent.properties?.find(
      (p) => p.name === "cdx:zig:fingerprint",
    );
    assert.ok(fp);
    assert.strictEqual(fp.value, "0x1234567890abcdef");
  });

  it("keys a .path dependency's bom-ref on its normalised path", async () => {
    const result = await withCacheDir(null, () =>
      resolveZigGraph(synthetic, FIXTURES, {}),
    );
    const localLib = result.pkgList.find((p) => p.name === "local_lib");
    assert.ok(localLib);
    assert.strictEqual(localLib["bom-ref"], "library:local_lib:libs/local");
    // The path is an identity key, not a release: it must not masquerade as a
    // version in either the component or its purl.
    assert.strictEqual(localLib.version, undefined);
    assert.strictEqual(localLib.purl, "pkg:generic/local_lib");
  });
});
