// Generates the build-fidelity rule fixtures next to this script.
// Each build-fidelity rule needs one BOM that makes it fire and one healthy
// BOM that makes it stay silent. Run from the repo root:
//   node test/data/fidelity-boms/generate-fixtures.mjs
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL(".", import.meta.url));

function hash() {
  return { alg: "SHA-256", content: "Zm9vYmFyYmF6cXV1eGZvb2JhcmJhemF1dWZvb2JhcmJhei41" };
}

function identity(bomRef) {
  return {
    identity: [
      {
        field: "purl",
        confidence: 0.8,
        concludedValue: bomRef,
        methods: [{ technique: "manifest-analysis", confidence: 0.8, value: bomRef }],
      },
    ],
  };
}

function comp(eco, index, opts = {}) {
  const name = `${eco}-pkg-${index}`;
  const version = opts.version ?? `1.${index}.0`;
  const purl = `pkg:${eco}/${name}@${version}`;
  const c = {
    type: "library",
    "bom-ref": opts.bomRef ?? purl,
    name,
    version,
    purl,
  };
  if (opts.hashes) {
    c.hashes = [hash()];
  }
  if (opts.evidence) {
    c.evidence = identity(c["bom-ref"]);
  }
  if (opts.props?.length) {
    c.properties = opts.props;
  }
  if (opts.noPurl) {
    delete c.purl;
  }
  if (opts.noVersion) {
    delete c.version;
  }
  return c;
}

function bom(components, dependencies, opts = {}) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:00000000-0000-0000-0000-${String(
      Math.abs(opts.serial ?? 1),
    ).padStart(12, "0")}`,
    version: 1,
    metadata: {
      lifecycles: opts.lifecycles ?? [{ phase: "pre-build" }],
      component: {
        type: "application",
        "bom-ref": opts.rootRef ?? "root",
        name: opts.appName ?? "fixture-app",
        version: "1.0.0",
        purl: opts.parentPurl ?? "pkg:npm/fixture-app@1.0.0",
        ...(opts.parentProps ? { properties: opts.parentProps } : {}),
      },
    },
    components,
    dependencies,
  };
}

// A npm graph where the root connects to every component and two components
// branch further, so coverage, graph depth, versions, purls, and hashes are
// all healthy.
function healthyNpm({ count = 12, hashes = true } = {}) {
  const comps = Array.from({ length: count }, (_, i) =>
    comp("npm", i, { hashes }),
  );
  const deps = [
    { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
    { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
    { ref: comps[3]["bom-ref"], dependsOn: [comps[4]["bom-ref"]] },
    ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
  ];
  return bom(comps, deps, { hashes });
}

// A graph of `eco` components with depth (two branching nodes) and full
// coverage, optionally with hashes, evidence, and properties per component.
function healthyGraph(eco, { count = 12, hashes = false, evidence = false, props = null, versions = null } = {}) {
  const comps = Array.from({ length: count }, (_, i) =>
    comp(eco, i, {
      hashes,
      evidence,
      props: props ? props(i) : undefined,
      version: versions ? versions(i) : undefined,
    }),
  );
  const deps = [
    { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
    { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
    { ref: comps[3]["bom-ref"], dependsOn: [comps[4]["bom-ref"]] },
    ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
  ];
  return bom(comps, deps, { parentPurl: `pkg:${eco}/fixture-app@1.0.0` });
}

// A flat graph: one node per component, no dependsOn anywhere.
function flatGraph(eco, { count = 12, hashes = false } = {}) {
  const comps = Array.from({ length: count }, (_, i) =>
    comp(eco, i, { hashes }),
  );
  const deps = comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] }));
  return bom(comps, deps, { parentPurl: `pkg:${eco}/fixture-app@1.0.0` });
}

function mavenResolved({ count = 10 } = {}) {
  const comps = Array.from({ length: count }, (_, i) =>
    comp("maven", i, { evidence: true }),
  );
  const deps = [
    { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
    { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
    ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
  ];
  return bom(comps, deps, { parentPurl: "pkg:maven/com.example:fixture-app@1.0.0" });
}

const FIXTURES = {
  // BF-GEN-001: helm components are a graph-coverage ecosystem; with no
  // dependencies[] at all every component is uncovered.
  "BF-GEN-001.fires": (() => {
    const comps = Array.from({ length: 12 }, (_, i) => comp("helm", i));
    return bom(comps, [], { parentPurl: "pkg:helm/fixture-app@1.0.0" });
  })(),
  "BF-GEN-001.passes": healthyNpm(),

  "BF-GEN-002.fires": (() => {
    const f = healthyNpm();
    f.components.forEach((c) => delete c.version);
    return f;
  })(),
  "BF-GEN-002.passes": healthyNpm(),

  "BF-GEN-003.fires": (() => {
    const f = healthyNpm();
    f.components.slice(0, 4).forEach((c, i) => {
      delete c.purl;
      c["bom-ref"] = `npm-unnamed-${i}`;
    });
    return f;
  })(),
  "BF-GEN-003.passes": healthyNpm(),

  // JS-001 always co-fires here: an npm BOM without hashes is BF-JS-001's
  // exact condition.
  "BF-GEN-004.fires": healthyNpm({ hashes: false }),
  "BF-GEN-004.passes": healthyNpm({ hashes: true }),

  "BF-GEN-005.fires": (() => {
    const comps = Array.from({ length: 12 }, (_, i) =>
      comp("npm", i, { hashes: true }),
    );
    const deps = [{ ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) }];
    return bom(comps, deps, { lifecycles: [{ phase: "post-build" }] });
  })(),
  "BF-GEN-005.passes": (() => {
    const comps = Array.from({ length: 12 }, (_, i) =>
      comp("npm", i, { hashes: true, evidence: true }),
    );
    const deps = [
      { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
      { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
      { ref: comps[3]["bom-ref"], dependsOn: [comps[4]["bom-ref"]] },
      ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ];
    return bom(comps, deps, { lifecycles: [{ phase: "post-build" }] });
  })(),

  "BF-GEN-006.fires": bom([], [], { parentPurl: "pkg:maven/com.example:fixture-app@1.0.0" }),
  "BF-GEN-006.passes": healthyNpm(),

  "BF-GEN-007.fires": (() => {
    const comps = Array.from({ length: 12 }, (_, i) => comp("golang", i));
    const deps = [
      { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
      ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ];
    return bom(comps, deps, { parentPurl: "pkg:golang/fixture-app@1.0.0" });
  })(),
  "BF-GEN-007.passes": healthyNpm(),

  // GEN-001 co-fires: a maven component set with no dependency entries is by
  // definition also uncovered.
  "BF-JVM-001.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) =>
      comp("maven", i, { evidence: true }),
    );
    return bom(comps, [], { parentPurl: "pkg:maven/com.example:fixture-app@1.0.0" });
  })(),
  "BF-JVM-001.passes": mavenResolved(),

  "BF-JVM-002.fires": (() => {
    const comps = Array.from({ length: 8 }, (_, i) =>
      comp("maven", i, { evidence: true }),
    );
    const deps = [
      { ref: "root", dependsOn: comps.slice(0, 3).map((c) => c["bom-ref"]) },
      ...comps.slice(0, 3).map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ];
    return bom(comps, deps, { parentPurl: "pkg:maven/com.example:fixture-app@1.0.0" });
  })(),
  "BF-JVM-002.passes": mavenResolved(),

  // JVM-001 and GEN-001 co-fire: this is also an evidence-less, graph-less
  // maven component set.
  "BF-JVM-003.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) => comp("maven", i));
    return bom(comps, [], { parentPurl: "pkg:maven/com.example:fixture-app@1.0.0" });
  })(),
  "BF-JVM-003.passes": mavenResolved(),

  "BF-JVM-004.fires": healthyNpm({
    hashes: true,
  }),
  "BF-JVM-004.passes": mavenResolved(),

  "BF-JS-001.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) =>
      comp("npm", i, { evidence: true }),
    );
    const deps = [
      { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
      { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
      ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ];
    return bom(comps, deps);
  })(),
  "BF-JS-001.passes": healthyNpm({ hashes: true }),

  "BF-JS-002.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) =>
      comp("npm", i, { hashes: true, version: i < 6 ? "^1.%d.0".replace("%d", String(i)) : undefined }),
    );
    const deps = [
      { ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) },
      { ref: comps[0]["bom-ref"], dependsOn: [comps[1]["bom-ref"], comps[2]["bom-ref"]] },
      ...comps.map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ];
    return bom(comps, deps);
  })(),
  "BF-JS-002.passes": healthyNpm({ hashes: true }),

  "BF-JS-003.fires": (() => {
    const comps = Array.from({ length: 12 }, (_, i) =>
      comp("npm", i, { hashes: true }),
    );
    const deps = [{ ref: "root", dependsOn: comps.map((c) => c["bom-ref"]) }];
    return bom(comps, deps, {
      parentProps: [{ name: "cdx:npm:isWorkspace", value: "true" }],
    });
  })(),
  "BF-JS-003.passes": (() => {
    const f = healthyNpm({ hashes: true });
    f.metadata.component.properties = [
      { name: "cdx:npm:isWorkspace", value: "true" },
    ];
    return f;
  })(),

  "BF-PY-001.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) =>
      comp("pypi", i, { props: [{ name: "cdx:pypi:manifestSource", value: "requirements.txt" }] }),
    );
    return bom(comps, [], { parentPurl: "pkg:pypi/fixture-app@1.0.0" });
  })(),
  "BF-PY-001.passes": healthyGraph("pypi", { props: () => [{ name: "cdx:pypi:manifestSource", value: "poetry.lock" }] }),

  "BF-PY-002.fires": (() => {
    const comps = Array.from({ length: 10 }, (_, i) => comp("pypi", i));
    return bom(comps, [], { parentPurl: "pkg:pypi/fixture-app@1.0.0" });
  })(),
  "BF-PY-002.passes": healthyGraph("pypi"),

  "BF-PY-003.fires": healthyGraph("pypi", {
    props: () => [{ name: "cdx:pypi:manifestSource", value: "pyproject.toml" }],
    versions: (i) => (i < 6 ? "^2.0.0" : undefined),
  }),
  "BF-PY-003.passes": healthyGraph("pypi"),

  "BF-GO-001.fires": flatGraph("golang"),
  "BF-GO-001.passes": healthyGraph("golang"),

  "BF-RB-001.fires": flatGraph("gem"),
  "BF-RB-001.passes": healthyGraph("gem"),

  "BF-RS-001.fires": flatGraph("cargo", { hashes: true }),
  "BF-RS-001.passes": healthyGraph("cargo", { hashes: true }),

  "BF-CS-001.fires": flatGraph("nuget"),
  "BF-CS-001.passes": healthyGraph("nuget"),

  "BF-SWIFT-001.fires": (() => {
    const comps = Array.from({ length: 5 }, (_, i) => comp("swift", i));
    return bom(comps, [], { parentPurl: "pkg:swift/fixture-app@1.0.0" });
  })(),
  "BF-SWIFT-001.passes": healthyGraph("swift", { count: 5 }),

  // The healthy JVM graph doubles as BF-JVM-004's firing fixture base: the
  // gradle marker sits on the parent while no maven component exists.
};
FIXTURES["BF-JVM-004.fires"] = (() => {
  const f = healthyNpm({ hashes: true });
  f.metadata.component.properties = [
    { name: "cdx:gradle:GradleRootPath", value: "/repo" },
  ];
  return f;
})();

const written = [];
for (const [name, content] of Object.entries(FIXTURES)) {
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
  written.push(name);
}
const existing = readdirSync(OUT_DIR).filter(
  (f) => f.endsWith(".fires.json") || f.endsWith(".passes.json"),
);
for (const file of existing) {
  const base = file.replace(/\.json$/, "");
  if (!FIXTURES[base]) {
    throw new Error(`Stale fixture on disk with no generator entry: ${file}`);
  }
}
console.log(`Wrote ${written.length} fixtures to ${OUT_DIR}`);
