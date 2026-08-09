import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

import { resetRecordedActivities, setDryRunMode } from "../ecosystems/utils.js";
import { auditBom } from "../stages/postgen/auditBom.js";
import { postProcess } from "../stages/postgen/postgen.js";
import {
  buildMinimalCliEnv,
  cargoCacheFixtureDir,
  cargoFixtureDir,
  repoDir,
} from "./bomTestHelpers.poku.js";
import { createBom } from "./index.js";
import { createRustBom } from "./nativeBom.js";

describe("nativeBom", () => {
  describe("createCocoaBom()", () => {
    it("should skip missing Podfile.lock when failOnError is false", async () => {
      const { createCocoaBom } = await import("./index.js");
      const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-cocoa-"));
      const podFile = join(tempDir, "Podfile");
      writeFileSync(
        podFile,
        "platform :ios, '14.0'\n\ntarget 'TestApp' do\nend\n",
        "utf-8",
      );
      const consoleLogStub = sinon.stub(console, "log");
      try {
        const bomData = await createCocoaBom(tempDir, {
          deep: false,
          failOnError: false,
          installDeps: false,
          multiProject: false,
        });
        assert.equal(bomData, undefined);
        sinon.assert.calledWithMatch(
          consoleLogStub,
          sinon.match("No 'Podfile.lock' found"),
        );
      } finally {
        consoleLogStub.restore();
        rmSync(tempDir, { force: true, recursive: true });
      }
    });

    it("should not warn or exit for deep mode when Podfile.lock exists", async () => {
      const { createCocoaBom } = await import("./index.js");
      const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-cocoa-deep-"));
      const podFile = join(tempDir, "Podfile");
      const lockFile = join(tempDir, "Podfile.lock");
      writeFileSync(
        podFile,
        "platform :ios, '14.0'\n\ntarget 'TestApp' do\nend\n",
        "utf-8",
      );
      writeFileSync(lockFile, "PODS: []\nDEPENDENCIES: []\n", "utf-8");
      const processExitStub = sinon.stub(process, "exit");
      try {
        await createCocoaBom(tempDir, {
          deep: true,
          failOnError: true,
          installDeps: false,
          multiProject: false,
        });
        sinon.assert.notCalled(processExitStub);
      } finally {
        processExitStub.restore();
        rmSync(tempDir, { force: true, recursive: true });
      }
    });
  });

  describe("createBom() cargo cache support", () => {
    it("catalogs cached cargo crate archives via the cargo-cache project type", async () => {
      const originalCargoCacheDir = process.env.CARGO_CACHE_DIR;
      try {
        process.env.CARGO_CACHE_DIR = cargoCacheFixtureDir;
        const bomNSData = await createBom(cargoCacheFixtureDir, {
          deep: false,
          failOnError: true,
          installDeps: false,
          multiProject: false,
          projectType: ["cargo-cache"],
          specVersion: 1.6,
        });
        const bomJson = bomNSData?.bomJson || {};
        const components = bomJson.components || [];
        const serdeComponent = components.find(
          (component) => component.name === "serde",
        );
        assert.ok(serdeComponent);
        assert.strictEqual(serdeComponent.version, "1.0.217");
        assert.strictEqual(
          serdeComponent.properties.find(
            (property) => property.name === "cdx:cargo:cacheSource",
          )?.value,
          "registry-cache",
        );
      } finally {
        if (originalCargoCacheDir === undefined) {
          delete process.env.CARGO_CACHE_DIR;
        } else {
          process.env.CARGO_CACHE_DIR = originalCargoCacheDir;
        }
      }
    });

    it("creates a Cargo workspace BOM with workflow signals and matching audit findings", async () => {
      const options = {
        bomAudit: true,
        bomAuditCategories: "package-integrity",
        bomAuditMinSeverity: "low",
        failOnError: true,
        includeFormulation: true,
        installDeps: false,
        multiProject: true,
        projectType: ["cargo", "github"],
        specVersion: 1.7,
      };
      const bomNSData = await createBom(cargoFixtureDir, options);
      const processedBomNSData = postProcess(
        bomNSData,
        options,
        cargoFixtureDir,
      );
      const bomJson = processedBomNSData?.bomJson || {};
      const coreComponent = (bomJson.components || []).find(
        (component) =>
          component.name === "core" &&
          component.properties?.some(
            (property) =>
              property.name === "cdx:cargo:workspaceDependencyResolved" &&
              property.value === "true",
          ),
      );
      const buildHelperComponent = (bomJson.components || []).find(
        (component) =>
          component.name === "build-helper" &&
          component.properties?.some(
            (property) =>
              property.name === "cdx:cargo:workspaceDependencyResolved" &&
              property.value === "true",
          ),
      );
      const cargoToolchainComponent = (bomJson.components || []).find(
        (component) =>
          component.properties?.some(
            (property) =>
              property.name === "cdx:github:action:role" &&
              property.value === "toolchain",
          ),
      );
      const cargoRunComponent = (bomJson.components || []).find((component) =>
        component.properties?.some(
          (property) =>
            property.name === "cdx:github:step:usesCargo" &&
            property.value === "true",
        ),
      );
      assert.strictEqual(
        coreComponent?.properties?.find(
          (property) =>
            property.name === "cdx:cargo:workspaceDependencyResolved",
        )?.value,
        "true",
      );
      assert.strictEqual(
        buildHelperComponent?.properties?.find(
          (property) => property.name === "cdx:cargo:dependencyKind",
        )?.value,
        "build",
      );
      assert.strictEqual(
        buildHelperComponent?.properties?.find(
          (property) => property.name === "cdx:cargo:resolvedWorkspaceMember",
        )?.value,
        "build-helper",
      );
      assert.strictEqual(
        cargoToolchainComponent?.properties?.find(
          (property) => property.name === "cdx:github:action:ecosystem",
        )?.value,
        "cargo",
      );
      assert.strictEqual(
        cargoRunComponent?.properties?.find(
          (property) => property.name === "cdx:github:step:cargoSubcommands",
        )?.value,
        "build,test",
      );
      const findings = await auditBom(bomJson, {
        bomAuditCategories: "package-integrity",
        bomAuditMinSeverity: "low",
      });
      assert.ok(findings.some((finding) => finding.ruleId === "INT-012"));
      assert.ok(findings.some((finding) => finding.ruleId === "INT-013"));
    });

    it("nests only manifest package components under the Rust parent component", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-rust-parent-"));
      const helperDir = join(tmpDir, "crates", "helper");
      mkdirSync(helperDir, { recursive: true });
      writeFileSync(
        join(tmpDir, "Cargo.toml"),
        `[package]
name = "demo-app"
version = "1.0.0"

[workspace]
members = ["crates/helper"]

[dependencies]
helper = { path = "crates/helper" }
serde = "1.0.0"
`,
      );
      writeFileSync(
        join(helperDir, "Cargo.toml"),
        `[package]
name = "helper"
version = "0.1.0"

[dependencies]
serde = "1.0.0"
`,
      );
      writeFileSync(
        join(tmpDir, "Cargo.lock"),
        `version = 3

[[package]]
name = "demo-app"
version = "1.0.0"
dependencies = ["helper", "serde"]

[[package]]
name = "helper"
version = "0.1.0"
dependencies = ["serde"]

[[package]]
name = "serde"
version = "1.0.0"
checksum = "${"a".repeat(64)}"
`,
      );
      try {
        const bomData = await createRustBom(tmpDir, {
          installDeps: false,
          multiProject: true,
          specVersion: 1.7,
        });
        const parentComponent = bomData.parentComponent;
        const nestedComponentNames = parentComponent.components.map(
          (component) => component.name,
        );
        assert.strictEqual(parentComponent.name, "demo-app");
        assert.deepStrictEqual(nestedComponentNames, ["helper"]);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });
  });

  if (process.platform !== "win32") {
    describe("HBOM support", () => {
      it("delegates hbom project types to the hbom helper", async () => {
        const actualHbomHelpers = await import("../inventory/hbom.js");
        const createHbomDocument = sinon.stub().resolves({
          bomFormat: "CycloneDX",
          components: [],
          metadata: {
            component: {
              name: "Demo Board",
              type: "device",
              version: "rev-a",
            },
          },
          specVersion: "1.7",
        });
        const { createBom: createBomMocked } = await esmock("./index.js", {
          "../inventory/hbom.js": {
            ...actualHbomHelpers,
            createHbomDocument,
          },
        });

        const bomNSData = await createBomMocked(repoDir, {
          projectType: ["hbom"],
          specVersion: 1.7,
        });

        sinon.assert.calledOnce(createHbomDocument);
        assert.strictEqual(
          bomNSData?.bomJson?.metadata?.component?.name,
          "Demo Board",
        );
        assert.strictEqual(bomNSData?.parentComponent?.type, "device");
      });

      it("supports dry-run mode for hbom project types in the main CLI flow", async () => {
        setDryRunMode(true);
        resetRecordedActivities();

        try {
          const bomNSData = await createBom(repoDir, {
            projectType: ["hbom"],
            specVersion: 1.7,
          });

          assert.strictEqual(bomNSData?.bomJson?.bomFormat, "CycloneDX");
          assert.strictEqual(bomNSData?.bomJson?.specVersion, "1.7");
          assert.ok(Array.isArray(bomNSData?.bomJson?.components));
          assert.ok(bomNSData?.bomJson?.components.length >= 1);
          assert.ok(Array.isArray(bomNSData?.dependencies));
        } finally {
          setDryRunMode(false);
          resetRecordedActivities();
        }
      });

      it("shows dedicated hbom command help", () => {
        const result = spawnSync(
          process.execPath,
          [join(repoDir, "bin", "hbom.js"), "--help"],
          {
            cwd: repoDir,
            encoding: "utf8",
            env: buildMinimalCliEnv(),
          },
        );
        const output = `${result.stdout}${result.stderr}`;

        assert.strictEqual(result.status, 0);
        assert.match(output, /Output file\.\s+Default\s+hbom\.json/u);
        assert.match(output, /--include-runtime/u);
        assert.match(output, /--privileged/u);
        assert.match(output, /diagnostics/u);
      });

      it("uses the invoked hbom binary name in help output", () => {
        const tempDir = mkdtempSync(join(repoDir, ".cdxgen-hbom-help-name-"));
        try {
          const slimScript = join(tempDir, "hbom-slim");
          copyFileSync(join(repoDir, "bin", "hbom.js"), slimScript);
          const result = spawnSync(process.execPath, [slimScript, "--help"], {
            cwd: tempDir,
            encoding: "utf8",
            env: buildMinimalCliEnv(),
          });
          const output = `${result.stdout}${result.stderr}`;

          assert.strictEqual(result.status, 0);
          assert.match(output, /hbom-slim \[command\] \[options\]/u);
        } finally {
          rmSync(tempDir, { force: true, recursive: true });
        }
      });

      it("fails early when hbom include-runtime lacks osquery support", () => {
        const emptyPluginsDir = mkdtempSync(
          join(tmpdir(), "cdxgen-empty-plugins-"),
        );
        try {
          const result = spawnSync(
            process.execPath,
            [join(repoDir, "bin", "hbom.js"), "--include-runtime"],
            {
              cwd: repoDir,
              encoding: "utf8",
              env: buildMinimalCliEnv({
                CDXGEN_PLUGINS_DIR: emptyPluginsDir,
              }),
            },
          );
          const output = `${result.stdout}${result.stderr}`;

          assert.strictEqual(result.status, 1);
          assert.match(output, /--include-runtime/u);
          assert.match(output, /cdxgen-plugins-bin/u);
          assert.match(
            output,
            /'hbom' is the bundled option required for '--include-runtime' support/u,
          );
          assert.doesNotMatch(output, /About to generate OBOM/u);
        } finally {
          rmSync(emptyPluginsDir, { force: true, recursive: true });
        }
      });

      it("guides hbom-slim users to the standard binary for include-runtime", () => {
        const tempDir = mkdtempSync(
          join(repoDir, ".cdxgen-hbom-runtime-check-"),
        );
        const emptyPluginsDir = mkdtempSync(
          join(tmpdir(), "cdxgen-empty-plugins-"),
        );
        try {
          const slimScript = join(tempDir, "hbom-slim");
          copyFileSync(join(repoDir, "bin", "hbom.js"), slimScript);
          const result = spawnSync(
            process.execPath,
            [slimScript, "--include-runtime"],
            {
              cwd: tempDir,
              encoding: "utf8",
              env: buildMinimalCliEnv({
                CDXGEN_PLUGINS_DIR: emptyPluginsDir,
              }),
            },
          );
          const output = `${result.stdout}${result.stderr}`;

          assert.strictEqual(result.status, 1);
          assert.match(output, /'hbom-slim' is hardware-only by default/u);
          assert.match(
            output,
            /Use 'hbom' for bundled '--include-runtime' support/u,
          );
        } finally {
          rmSync(tempDir, { force: true, recursive: true });
          rmSync(emptyPluginsDir, { force: true, recursive: true });
        }
      });

      it("supports the hbom diagnostics subcommand for existing BOM files", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-hbom-diagnostics-"));
        try {
          const inputFile = join(tempDir, "hbom.json");
          writeFileSync(
            inputFile,
            JSON.stringify({
              bomFormat: "CycloneDX",
              components: [],
              metadata: {
                component: {
                  name: "demo-host",
                  properties: [
                    { name: "cdx:hbom:platform", value: "linux" },
                    { name: "cdx:hbom:architecture", value: "amd64" },
                  ],
                  type: "device",
                },
              },
              properties: [
                { name: "cdx:hbom:collectorProfile", value: "linux-amd64-v1" },
                {
                  name: "cdx:hbom:evidence:commandDiagnosticCount",
                  value: "2",
                },
                {
                  name: "cdx:hbom:evidence:commandDiagnostic",
                  value: JSON.stringify({
                    command: "lsusb",
                    installHint:
                      "Command not found: install the Linux package providing lsusb (commonly `usbutils`).",
                    issue: "missing-command",
                    message: "lsusb failed with missing-command",
                  }),
                },
                {
                  name: "cdx:hbom:evidence:commandDiagnostic",
                  value: JSON.stringify({
                    command: "drm_info",
                    issue: "permission-denied",
                    message: "drm_info failed with permission-denied",
                    privilegeHint:
                      "Retry with --privileged to allow a non-interactive sudo attempt for permission-sensitive Linux commands.",
                  }),
                },
              ],
              specVersion: "1.7",
              version: 1,
            }),
          );
          const result = spawnSync(
            process.execPath,
            [
              join(repoDir, "bin", "hbom.js"),
              "diagnostics",
              "--input",
              inputFile,
            ],
            {
              cwd: tempDir,
              encoding: "utf8",
              env: buildMinimalCliEnv(),
            },
          );
          const output = `${result.stdout}${result.stderr}`;

          assert.strictEqual(result.status, 0);
          assert.match(output, /HBOM diagnostics summary/u);
          assert.match(output, /Missing commands:\n- lsusb/u);
          assert.match(output, /Permission-sensitive enrichments:/u);
          assert.match(output, /--privileged/u);
        } finally {
          rmSync(tempDir, { force: true, recursive: true });
        }
      });

      it("supports dry-run mode in the dedicated hbom command", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-hbom-dry-run-"));
        try {
          const outputFile = join(tempDir, "hbom.json");
          const result = spawnSync(
            process.execPath,
            [join(repoDir, "bin", "hbom.js"), "--dry-run"],
            {
              cwd: tempDir,
              encoding: "utf8",
              env: buildMinimalCliEnv(),
            },
          );
          const output = `${result.stdout}${result.stderr}`;

          assert.strictEqual(result.status, 0);
          assert.match(output, /cdxgen dry-run activity summary/u);
          assert.strictEqual(existsSync(outputFile), false);
        } finally {
          rmSync(tempDir, { force: true, recursive: true });
        }
      });

      it("rejects mixed hbom and sbom project types in the main CLI", () => {
        const result = spawnSync(
          process.execPath,
          [
            join(repoDir, "bin", "cdxgen.js"),
            "-t",
            "hbom",
            "-t",
            "js",
            "--no-banner",
          ],
          {
            cwd: repoDir,
            encoding: "utf8",
            env: buildMinimalCliEnv(),
          },
        );
        const output = `${result.stdout}${result.stderr}`;

        assert.strictEqual(result.status, 1);
        assert.match(output, /HBOM project types cannot be mixed/u);
      });
    });
  }

  describe("createBom() CMake cache and submodule resolution", () => {
    it("strips unresolved ${VAR} from purls when no CMakeCache is available", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-cmake-"));
      writeFileSync(
        join(tempDir, "CMakeLists.txt"),
        'project(boost_algorithm VERSION "${BOOST_SUPERPROJECT_VERSION}" LANGUAGES CXX)\nfind_package(Boost ${BOOST_SUPERPROJECT_VERSION} REQUIRED)\n',
        "utf-8",
      );
      try {
        const bomData = await createBom(tempDir, {
          projectType: ["c-cpp"],
          deep: false,
          failOnError: false,
          installDeps: false,
          multiProject: false,
        });
        const bom = bomData?.bomJson;
        assert.ok(bom, "BOM should be generated");
        const json = JSON.stringify(bom);
        assert.ok(
          !json.includes("%24%7B"),
          "no percent-encoded ${...} should appear in any purl",
        );
        assert.ok(
          !json.includes("${"),
          "no literal ${...} should appear in any purl or version",
        );
        const pc = bom.metadata?.component;
        assert.ok(pc.version === "" || !pc.version?.includes("$"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
