import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, it } from "poku";

import {
  parseCargoAuditableData,
  parseCargoData,
  parseCargoDependencyData,
  parseCargoManifestDependencyData,
  parseCargoTomlData,
} from "./utils.js";

it("parse cargo lock", async () => {
  assert.deepStrictEqual(await parseCargoData(null), []);

  let dep_list = await parseCargoData("./test/Cargo.lock");
  assert.deepStrictEqual(dep_list.length, 225);
  assert.deepStrictEqual(dep_list[0], {
    type: "library",
    group: "",
    "bom-ref": "pkg:cargo/abscissa_core@0.5.2",
    purl: "pkg:cargo/abscissa_core@0.5.2",
    name: "abscissa_core",
    version: "0.5.2",
    hashes: [
      {
        alg: "SHA-256",
        content:
          "6a07677093120a02583717b6dd1ef81d8de1e8d01bd226c83f0f9bdf3e56bb3a",
      },
    ],
    evidence: {
      identity: {
        field: "purl",
        confidence: 0.6,
        methods: [
          {
            technique: "manifest-analysis",
            confidence: 0.6,
            value: "./test/Cargo.lock",
          },
        ],
      },
    },
    properties: [
      {
        name: "internal:SrcFile",
        value: "./test/Cargo.lock",
      },
    ],
  });

  dep_list = await parseCargoData("./test/data/Cargom.lock");
  assert.deepStrictEqual(dep_list.length, 243);
  assert.deepStrictEqual(dep_list[0], {
    type: "library",
    group: "",
    "bom-ref": "pkg:cargo/actix-codec@0.3.0",
    purl: "pkg:cargo/actix-codec@0.3.0",
    name: "actix-codec",
    version: "0.3.0",
    hashes: [
      {
        alg: "SHA-256",
        content:
          "78d1833b3838dbe990df0f1f87baf640cf6146e898166afe401839d1b001e570",
      },
    ],
    evidence: {
      identity: {
        field: "purl",
        confidence: 0.6,
        methods: [
          {
            technique: "manifest-analysis",
            confidence: 0.6,
            value: "./test/data/Cargom.lock",
          },
        ],
      },
    },
    properties: [
      {
        name: "internal:SrcFile",
        value: "./test/data/Cargom.lock",
      },
    ],
  });

  // The base64 package does not have an associated checksum. Make sure the
  // function does not accidentally insert an undefined hashsum value.
  const base64Package = dep_list.find((pkg) => pkg.name === "base64");
  assert.ok(base64Package.hashes);
});

it("parse cargo lock simple component representation", async () => {
  // If asking for a simple representation, we should skip any extended attributes.
  const componentList = await parseCargoData("./test/Cargo.lock", true);
  const firstPackage = componentList[0];
  assert.strictEqual(firstPackage.evidence, undefined);
});

it("parse cargo lock lists last package", async () => {
  // The implementation procedurally fills an object with the package
  // information line-by-line, considering a package's information "complete"
  // when the next package is found. This risks missing the last package in
  // the file, so this test case makes sure it is still found.
  const componentList = await parseCargoData("./test/data/Cargom.lock");
  assert.ok(componentList.find((pkg) => pkg.name === "yaml-rust"));
});

it("parse cargo lock dependencies tests", async () => {
  const dependencyData = await parseCargoDependencyData(
    readFileSync("./test/Cargo.lock", { encoding: "utf-8" }),
  );
  const purlIsPackage = (purl, packageName) =>
    new RegExp(`^pkg:cargo/${packageName}@.+`).test(purl);

  assert.ok(dependencyData.length > 0);

  // Make sure some samples makes sense.
  // aho-corasick has a single dependency
  const ahoCorasick = dependencyData.find((dependency) =>
    purlIsPackage(dependency.ref, "aho-corasick"),
  );
  assert.deepStrictEqual(ahoCorasick.dependsOn.length, 1);
  assert.deepStrictEqual(
    purlIsPackage(ahoCorasick.dependsOn[0], "memchr"),
    true,
  );

  // First edge case is component with a dependency of a specific version.
  // winapi-util has a dependency on "winapi 0.3.8"
  const winapiUtil = dependencyData.find((dependency) =>
    purlIsPackage(dependency.ref, "winapi-util"),
  );
  assert.deepStrictEqual(
    purlIsPackage(winapiUtil.dependsOn[0], "winapi"),
    true,
  );
  assert.deepStrictEqual(winapiUtil.dependsOn[0], "pkg:cargo/winapi@0.3.8");

  // Second edge case is a component with a dependency of a specific version and a registry url.
  const base64 = dependencyData.find((dependency) =>
    purlIsPackage(dependency.ref, "base64"),
  );
  assert.deepStrictEqual(purlIsPackage(base64.dependsOn[0], "byteorder"), true);
  assert.deepStrictEqual(base64.dependsOn[0], "pkg:cargo/byteorder@1.3.1");

  // Make sure we respect packages specifying different versions of the same package.
  // kernel32-sys is dependent on a different version of winapi than winapi-util.
  const kernel32Sys = dependencyData.find((dependency) =>
    purlIsPackage(dependency.ref, "kernel32-sys"),
  );
  assert.deepStrictEqual(
    purlIsPackage(kernel32Sys.dependsOn[0], "winapi"),
    true,
  );
  assert.deepStrictEqual(kernel32Sys.dependsOn[0], "pkg:cargo/winapi@0.2.8");
});

it("parse dependency tree from cargo lock files without metadata footer", async () => {
  // CI tests revealed the function failed when applied to the Rust repo. It
  // fails because at least one Cargo.lock file did not have a metadata
  // section in the footer, making the regex trip up. This test is the
  // shortest form representing that case.
  const cargoFileContent = `# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 3

[[package]]
name = "package1"
version = "1.21.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "8a30b2e23b9e17a9f90641c7ab1549cd9b44f296d3ccbf309d2863cfe398a0cb"
`;
  const dependencyData = await parseCargoDependencyData(cargoFileContent);
  assert.ok(dependencyData);
  assert.deepStrictEqual(dependencyData.length, 1);
});

it("parse cargo lock dependencies tests for files on Windows", async () => {
  const fileContent = await readFileSync("./test/Cargo.lock", {
    encoding: "utf-8",
  });

  // Simulate Windows files by forcing CRLF line endings to the data we
  // attempt to parse.
  const crlfFileContent = fileContent.replace(/(\r\n|\n)/g, "\r\n");

  // The function's logic is tested by other test functions. This test will
  // serve as a smoke test for files on Windows, to make sure the function
  // handles both types of input.
  const dependencyData = parseCargoDependencyData(crlfFileContent);
  assert.ok(dependencyData);
  assert.ok(dependencyData.length > 1);
});

it("parse cargo lock dependencies tests with undefined dependency", async () => {
  // In case a package is listed as a dependency but is not defined as a
  // package in a file, the Cargo.lock-file is deemed broken. It has been
  // decided that such an occurence shouldn't fail the process, but continue
  // with a warning message.

  const cargoFileContent = `# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 3

[[package]]
name = "package1"
version = "1.21.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "8a30b2e23b9e17a9f90641c7ab1549cd9b44f296d3ccbf309d2863cfe398a0cb"
dependencies = ["does-not-exist"]
`;
  const dependencyData = await parseCargoDependencyData(cargoFileContent);
  assert.ok(dependencyData);
  assert.deepStrictEqual(dependencyData.length, 1);

  // The package for this test should have been skipped.
  assert.deepStrictEqual(dependencyData.dependsOn, undefined);
});

it("parse cargo toml", async () => {
  assert.deepStrictEqual(await parseCargoTomlData(null), []);
  let dep_list = await parseCargoTomlData("./test/data/Cargo1.toml");
  assert.ok(dep_list.length >= 6);
  assert.strictEqual(dep_list[0].name, "unwind");
  const coreDep = dep_list.find((pkg) => pkg.name === "core");
  assert.ok(coreDep);
  assert.strictEqual(coreDep.version, "path+../core");
  assert.strictEqual(
    coreDep.properties.find((property) => property.name === "cdx:cargo:path")
      ?.value,
    "../core",
  );
  assert.strictEqual(
    coreDep.properties.find(
      (property) => property.name === "cdx:cargo:dependencyKind",
    )?.value,
    "runtime",
  );
  const libcDep = dep_list.find((pkg) => pkg.name === "libc");
  assert.ok(libcDep);
  assert.strictEqual(
    libcDep.properties.find(
      (property) => property.name === "cdx:cargo:defaultFeatures",
    )?.value,
    "false",
  );
  assert.strictEqual(
    libcDep.properties.find(
      (property) => property.name === "cdx:cargo:dependencyFeatures",
    )?.value,
    '["rustc-dep-of-std"]',
  );
  const ccDep = dep_list.find((pkg) => pkg.name === "cc");
  assert.ok(ccDep);
  assert.strictEqual(
    ccDep.properties.find(
      (property) => property.name === "cdx:cargo:dependencyKind",
    )?.value,
    "build",
  );
  dep_list = await parseCargoTomlData("./test/data/Cargo2.toml");
  assert.deepStrictEqual(dep_list.length, 4);
  assert.strictEqual(dep_list[0].name, "quiche-fuzz");
  const quicheDep = dep_list.find((pkg) => pkg.name === "quiche");
  assert.ok(quicheDep);
  assert.strictEqual(quicheDep.version, "path+../quiche");
  assert.strictEqual(
    quicheDep.properties.find((property) => property.name === "cdx:cargo:path")
      ?.value,
    "../quiche",
  );
  assert.strictEqual(
    quicheDep.properties.find(
      (property) => property.name === "cdx:cargo:dependencyFeatures",
    )?.value,
    '["fuzzing"]',
  );
  const libfuzzerDep = dep_list.find((pkg) => pkg.name === "libfuzzer-sys");
  assert.ok(libfuzzerDep);
  assert.strictEqual(
    libfuzzerDep.properties.find(
      (property) => property.name === "cdx:cargo:git",
    )?.value,
    "https://github.com/rust-fuzz/libfuzzer-sys.git",
  );
  dep_list = await parseCargoTomlData("./test/data/Cargo3.toml", true);
  assert.ok(dep_list.length >= 10);
});

it("parse cargo toml target and dev dependency metadata", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cargo-"));
  const cargoTomlFile = path.join(tmpDir, "Cargo.toml");
  writeFileSync(
    cargoTomlFile,
    `[package]
name = "demo"
version = "1.0.0"

[dependencies]
serde = { version = "1.0.0", optional = true }

[dev-dependencies]
insta = "1.0.0"

[target.'cfg(target_os = "linux")'.dependencies]
nix = "0.29.0"

[target.'cfg(target_os = "linux")'.build-dependencies]
bindgen = { version = "0.70.0", default-features = false }
`,
  );
  try {
    const depList = await parseCargoTomlData(cargoTomlFile);
    const serdeDep = depList.find((pkg) => pkg.name === "serde");
    const instaDep = depList.find((pkg) => pkg.name === "insta");
    const bindgenDep = depList.find((pkg) => pkg.name === "bindgen");
    assert.strictEqual(serdeDep.scope, "optional");
    assert.strictEqual(
      serdeDep.properties.find(
        (property) => property.name === "cdx:cargo:optional",
      )?.value,
      "true",
    );
    assert.strictEqual(instaDep.scope, "excluded");
    assert.strictEqual(
      bindgenDep.properties.find(
        (property) => property.name === "cdx:cargo:dependencyKind",
      )?.value,
      "build",
    );
    assert.strictEqual(
      bindgenDep.properties.find(
        (property) => property.name === "cdx:cargo:target",
      )?.value,
      'cfg(target_os = "linux")',
    );
    assert.strictEqual(
      bindgenDep.properties.find(
        (property) => property.name === "cdx:cargo:defaultFeatures",
      )?.value,
      "false",
    );
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

it("parse cargo toml captures git dependency metadata", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cargo-git-"));
  const cargoTomlFile = path.join(tmpDir, "Cargo.toml");
  writeFileSync(
    cargoTomlFile,
    `[package]
name = "demo"
version = "1.0.0"

[dependencies]
git-crate = { git = "https://github.com/acme/git-crate.git", branch = "main" }
`,
  );
  try {
    const depList = await parseCargoTomlData(cargoTomlFile);
    const gitDep = depList.find((pkg) => pkg.name === "git-crate");
    assert.ok(gitDep);
    assert.strictEqual(
      gitDep.version,
      "git+https://github.com/acme/git-crate.git",
    );
    assert.strictEqual(
      gitDep.properties.find((property) => property.name === "cdx:cargo:git")
        ?.value,
      "https://github.com/acme/git-crate.git",
    );
    assert.strictEqual(
      gitDep.properties.find(
        (property) => property.name === "cdx:cargo:gitBranch",
      )?.value,
      "main",
    );
    assert.strictEqual(
      gitDep.properties.find(
        (property) => property.name === "cdx:cargo:dependencyKind",
      )?.value,
      "runtime",
    );
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

it("parse cargo virtual workspace with inherited package and dependency metadata", async () => {
  const workspaceDir = "./test/data/cargo-workspace-repotest";
  const workspaceToml = path.join(workspaceDir, "Cargo.toml");
  const normalizePathForAssertion = (value) => value?.replaceAll("\\", "/");
  const depList = await parseCargoTomlData(workspaceToml);
  assert.strictEqual(depList[0].name, "cargo-workspace-repotest");
  assert.strictEqual(depList[0].version, "workspace");
  assert.strictEqual(
    depList[0].properties.find(
      (property) => property.name === "cdx:cargo:manifestMode",
    )?.value,
    "virtual-workspace",
  );
  const memberPackage = depList.find((pkg) => pkg.name === "cli");
  assert.ok(memberPackage);
  assert.strictEqual(memberPackage.version, "1.2.3");
  assert.strictEqual(memberPackage.license, "Apache-2.0");
  assert.strictEqual(
    memberPackage.repository?.url,
    "https://github.com/example/cargo-workspace-repotest",
  );
  const coreDep = depList.find(
    (pkg) =>
      pkg.name === "core" &&
      pkg.properties.some(
        (property) => property.name === "cdx:cargo:workspaceDependency",
      ),
  );
  assert.ok(coreDep);
  assert.strictEqual(coreDep.version, "path+crates/core");
  assert.strictEqual(
    coreDep.properties.find(
      (property) => property.name === "cdx:cargo:workspaceDependency",
    )?.value,
    "true",
  );
  assert.strictEqual(
    coreDep.properties.find(
      (property) => property.name === "cdx:cargo:workspaceDependencyResolved",
    )?.value,
    "true",
  );
  assert.strictEqual(
    coreDep.properties.find(
      (property) => property.name === "cdx:cargo:resolvedWorkspaceMember",
    )?.value,
    "core",
  );
  assert.ok(
    normalizePathForAssertion(
      coreDep.properties.find(
        (property) => property.name === "cdx:cargo:resolvedMemberPath",
      )?.value,
    )?.endsWith("/test/data/cargo-workspace-repotest/crates/core/Cargo.toml"),
  );
  const buildHelperDep = depList.find(
    (pkg) =>
      pkg.name === "build-helper" &&
      pkg.properties.some(
        (property) => property.name === "cdx:cargo:workspaceDependency",
      ),
  );
  assert.ok(buildHelperDep);
  assert.strictEqual(buildHelperDep.version, "path+crates/build-helper");
  assert.strictEqual(
    buildHelperDep.properties.find(
      (property) => property.name === "cdx:cargo:dependencyKind",
    )?.value,
    "build",
  );
  assert.strictEqual(
    buildHelperDep.properties.find(
      (property) => property.name === "cdx:cargo:workspaceDependencyResolved",
    )?.value,
    "true",
  );
  assert.strictEqual(
    buildHelperDep.properties.find(
      (property) => property.name === "cdx:cargo:resolvedWorkspaceMember",
    )?.value,
    "build-helper",
  );
  assert.ok(
    normalizePathForAssertion(
      buildHelperDep.properties.find(
        (property) => property.name === "cdx:cargo:resolvedMemberPath",
      )?.value,
    )?.endsWith(
      "/test/data/cargo-workspace-repotest/crates/build-helper/Cargo.toml",
    ),
  );
  const ccDep = depList.find((pkg) => pkg.name === "cc");
  assert.ok(ccDep);
  assert.strictEqual(ccDep.version, "1.2.0");
});

it("normalize visited cargo manifest paths across relative and absolute inputs", async () => {
  const workspaceToml = "./test/data/cargo-workspace-repotest/Cargo.toml";
  const absoluteWorkspaceToml = path.resolve(workspaceToml);
  const parsedPackages = await parseCargoTomlData(
    absoluteWorkspaceToml,
    false,
    {},
    {
      visitedCargoTomlFiles: new Set([workspaceToml]),
    },
  );
  assert.deepStrictEqual(parsedPackages, []);
  const dependencyGraph = parseCargoManifestDependencyData(
    absoluteWorkspaceToml,
    {
      visitedCargoTomlDependencyGraphFiles: new Set([workspaceToml]),
    },
  );
  assert.deepStrictEqual(dependencyGraph, []);
});

it("build cargo workspace manifest dependency graph with member-to-member edges", () => {
  const tmpDir = mkdtempSync(
    path.join(tmpdir(), "cdxgen-cargo-workspace-graph-"),
  );
  const workspaceToml = path.join(tmpDir, "Cargo.toml");
  const coreDir = path.join(tmpDir, "crates", "core");
  const cliDir = path.join(tmpDir, "crates", "cli");
  mkdirSync(coreDir, { recursive: true });
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(
    workspaceToml,
    `[workspace]
members = ["crates/*"]

[workspace.package]
version = "1.2.3"

[workspace.dependencies]
core = { path = "crates/core" }
`,
  );
  writeFileSync(
    path.join(coreDir, "Cargo.toml"),
    `[package]
name = "core"
version.workspace = true
`,
  );
  writeFileSync(
    path.join(cliDir, "Cargo.toml"),
    `[package]
name = "cli"
version.workspace = true

[dependencies]
core = { workspace = true }
`,
  );

  try {
    const dependencyGraph = parseCargoManifestDependencyData(workspaceToml);
    const workspaceRef = `pkg:cargo/${path.basename(tmpDir)}@workspace`;
    const cliRef = "pkg:cargo/cli@1.2.3";
    const coreRef = "pkg:cargo/core@1.2.3";
    const workspaceNode = dependencyGraph.find(
      (dependency) => dependency.ref === workspaceRef,
    );
    const cliNode = dependencyGraph.find(
      (dependency) => dependency.ref === cliRef,
    );
    assert.ok(workspaceNode);
    assert.deepStrictEqual(workspaceNode.dependsOn, [cliRef, coreRef]);
    assert.ok(cliNode);
    assert.deepStrictEqual(cliNode.dependsOn, [coreRef]);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

it("parse cargo auditable data", async () => {
  assert.deepStrictEqual(await parseCargoAuditableData(null), []);
  const dep_list = await parseCargoAuditableData(
    readFileSync("./test/data/cargo-auditable.txt", { encoding: "utf-8" }),
  );
  assert.deepStrictEqual(dep_list.length, 32);
  assert.deepStrictEqual(dep_list[0], {
    group: "",
    name: "adler",
    version: "1.0.2",
  });
});

it("parse cargo lock integrity using matching sha256 and sha384 hash algorithms", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cdxgen-cargo-lock-"));
  const cargoLockFile = path.join(tmpDir, "Cargo.lock");
  writeFileSync(
    cargoLockFile,
    `version = 3

[[package]]
name = "sha256-demo"
version = "1.0.0"
checksum = "${"a".repeat(64)}"

[[package]]
name = "sha384-demo"
version = "2.0.0"
checksum = "${"b".repeat(96)}"
`,
  );
  try {
    const depList = await parseCargoData(cargoLockFile, true);
    const sha256Demo = depList.find((pkg) => pkg.name === "sha256-demo");
    const sha384Demo = depList.find((pkg) => pkg.name === "sha384-demo");
    assert.deepStrictEqual(sha256Demo.hashes, [
      {
        alg: "SHA-256",
        content: "a".repeat(64),
      },
    ]);
    assert.deepStrictEqual(sha384Demo.hashes, [
      {
        alg: "SHA-384",
        content: "b".repeat(96),
      },
    ]);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});
