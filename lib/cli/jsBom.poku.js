import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

import {
  createComposerNodeModulesFixture,
  createJarNodeModulesFixture,
  fixtureDir,
  getProp,
  loadStubbedCreateJarBom,
} from "./bomTestHelpers.poku.js";
import { createChromeExtensionBom, createNodejsBom } from "./jsBom.js";
import { createPHPBom } from "./managedBom.js";

describe("jsBom", () => {
  describe("createChromeExtensionBom()", () => {
    it("should catalog a directly provided extension and its node dependencies", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "cdxgen-chrome-ext-cli-"));
      const extensionId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const extensionIdDir = join(tempRoot, extensionId);
      const extensionVersionDir = join(extensionIdDir, "1.2.3");
      try {
        mkdirSync(extensionVersionDir, { recursive: true });
        writeFileSync(
          join(extensionVersionDir, "manifest.json"),
          JSON.stringify({
            manifest_version: 3,
            name: "CLI Test Extension",
            description: "Direct path test",
            version: "1.2.3",
          }),
          "utf-8",
        );
        writeFileSync(
          join(extensionVersionDir, "package.json"),
          JSON.stringify({
            name: "chrome-extension-cli-test",
            version: "1.2.3",
            dependencies: {
              "left-pad": "1.3.0",
            },
          }),
          "utf-8",
        );
        writeFileSync(
          join(extensionVersionDir, "package-lock.json"),
          JSON.stringify({
            name: "chrome-extension-cli-test",
            version: "1.2.3",
            lockfileVersion: 3,
            requires: true,
            packages: {
              "": {
                name: "chrome-extension-cli-test",
                version: "1.2.3",
                dependencies: {
                  "left-pad": "1.3.0",
                },
              },
              "node_modules/left-pad": {
                version: "1.3.0",
              },
            },
          }),
          "utf-8",
        );
        const bomData = await createChromeExtensionBom(extensionIdDir, {
          projectType: ["chrome-extension"],
          multiProject: false,
        });
        const components = bomData?.bomJson?.components || [];
        assert.ok(
          components.some(
            (component) =>
              component.purl === `pkg:chrome-extension/${extensionId}@1.2.3`,
          ),
        );
        assert.ok(
          components.some(
            (component) =>
              component.name === "left-pad" &&
              component.purl?.startsWith("pkg:npm/left-pad@1.3.0"),
          ),
        );
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it("should parse an AI-targeted community extension manifest from direct version path", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "cdxgen-chrome-ext-cli-ai-"));
      const extensionId = "llllllllllllllllllllllllllllllll";
      const extensionVersion = "1.0.0";
      const extensionVersionDir = join(tempRoot, extensionId, extensionVersion);
      try {
        mkdirSync(extensionVersionDir, { recursive: true });
        writeFileSync(
          join(extensionVersionDir, "manifest.json"),
          readFileSync(
            join(fixtureDir, "chrome-copilottts-manifest.json"),
            "utf-8",
          ),
          "utf-8",
        );
        const bomData = await createChromeExtensionBom(extensionVersionDir, {
          projectType: ["chrome-extension"],
          multiProject: false,
        });
        const extensionComponent = (bomData?.bomJson?.components || []).find(
          (component) =>
            component.purl ===
            `pkg:chrome-extension/${extensionId}@${extensionVersion}`,
        );
        assert.ok(extensionComponent, "expected direct extension component");
        const properties = extensionComponent.properties || [];
        assert.ok(
          properties.some(
            (prop) =>
              prop.name === "cdx:chrome-extension:permissions" &&
              prop.value.includes("scripting"),
          ),
        );
        assert.ok(
          properties.some(
            (prop) =>
              prop.name === "cdx:chrome-extension:capability:codeInjection" &&
              prop.value === "true",
          ),
        );
        assert.ok(
          properties.some(
            (prop) =>
              prop.name === "cdx:chrome-extension:hostPermissions" &&
              prop.value.includes("https://github.com/copilot/tasks/*"),
          ),
        );
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it("should not scan installed browser locations without explicit extension project type", async () => {
      const discoverChromiumExtensionDirs = sinon.stub().returns([
        {
          browser: "Google Chrome",
          channel: "stable",
          dir: join(tmpdir(), "fake-browser-dir"),
        },
      ]);
      const collectInstalledChromeExtensions = sinon.stub().returns([
        {
          type: "application",
          name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          version: "1.0.0",
          purl: "pkg:chrome-extension/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@1.0.0",
          "bom-ref":
            "pkg:chrome-extension/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@1.0.0",
        },
      ]);
      const { createChromeExtensionBom: createChromeExtensionBomMocked } =
        await esmock("./jsBom.js", {
          "../ecosystems/chromextutils.js": {
            CHROME_EXTENSION_PURL_TYPE: "chrome-extension",
            collectChromeExtensionsFromPath: sinon
              .stub()
              .returns({ components: [], extensionDirs: [] }),
            collectInstalledChromeExtensions,
            discoverChromiumExtensionDirs,
          },
        });
      const bomData = await createChromeExtensionBomMocked(
        join(tmpdir(), "generic-project"),
        {
          deep: true,
          multiProject: false,
          projectType: ["js"],
        },
      );
      assert.deepStrictEqual(bomData?.bomJson?.components || [], []);
      sinon.assert.notCalled(discoverChromiumExtensionDirs);
      sinon.assert.notCalled(collectInstalledChromeExtensions);
    });
  });

  describe("createVscodeExtensionBom()", () => {
    it("should not scan installed IDE locations without explicit extension project type", async () => {
      const discoverIdeExtensionDirs = sinon.stub().returns([
        {
          name: "VS Code",
          dir: join(tmpdir(), "fake-ide-dir"),
        },
      ]);
      const collectInstalledExtensions = sinon.stub().returns([
        {
          type: "application",
          name: "sample.publisher",
          version: "1.0.0",
          purl: "pkg:vscode-extension/sample/publisher@1.0.0",
          "bom-ref": "pkg:vscode-extension/sample/publisher@1.0.0",
        },
      ]);
      const { createVscodeExtensionBom: createVscodeExtensionBomMocked } =
        await esmock("./jsBom.js", {
          "../helpers/vsixutils.js": {
            cleanupTempDir: sinon.stub(),
            collectInstalledExtensions,
            discoverIdeExtensionDirs,
            extractVsixToTempDir: sinon.stub(),
            parseVsixFile: sinon.stub(),
            VSCODE_EXTENSION_PURL_TYPE: "vscode-extension",
          },
        });
      const bomData = await createVscodeExtensionBomMocked(
        join(tmpdir(), "generic-project"),
        {
          deep: true,
          multiProject: false,
          projectType: ["js"],
        },
      );
      assert.deepStrictEqual(bomData?.bomJson?.components || [], []);
      sinon.assert.notCalled(discoverIdeExtensionDirs);
      sinon.assert.notCalled(collectInstalledExtensions);
    });

    it("should scan installed IDE locations when explicitly requested", async () => {
      const discoverIdeExtensionDirs = sinon.stub().returns([
        {
          name: "VS Code",
          dir: join(tmpdir(), "fake-ide-dir"),
        },
      ]);
      const collectInstalledExtensions = sinon.stub().returns([
        {
          type: "application",
          name: "sample.publisher",
          version: "1.0.0",
          purl: "pkg:vscode-extension/sample/publisher@1.0.0",
          "bom-ref": "pkg:vscode-extension/sample/publisher@1.0.0",
        },
      ]);
      const { createVscodeExtensionBom: createVscodeExtensionBomMocked } =
        await esmock("./jsBom.js", {
          "../helpers/vsixutils.js": {
            cleanupTempDir: sinon.stub(),
            collectInstalledExtensions,
            discoverIdeExtensionDirs,
            extractVsixToTempDir: sinon.stub(),
            parseVsixFile: sinon.stub(),
            VSCODE_EXTENSION_PURL_TYPE: "vscode-extension",
          },
        });
      const bomData = await createVscodeExtensionBomMocked(
        join(tmpdir(), "generic-project"),
        {
          deep: true,
          multiProject: false,
          projectType: ["ide-extension"],
        },
      );
      const components = bomData?.bomJson?.components || [];
      assert.ok(
        components.some(
          (component) =>
            component.purl === "pkg:vscode-extension/sample/publisher@1.0.0",
        ),
      );
      sinon.assert.calledOnce(discoverIdeExtensionDirs);
      sinon.assert.calledOnce(collectInstalledExtensions);
    });
  });

  describe("node_modules multi-ecosystem filtering", () => {
    it("ignores composer manifests in node_modules during mixed npm/php scans", () => {
      const tmpDir = createComposerNodeModulesFixture();
      try {
        const bomData = createPHPBom(tmpDir, {
          installDeps: false,
          multiProject: true,
          projectType: ["js", "php"],
          specVersion: 1.7,
        });
        assert.deepStrictEqual(bomData, {});
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows explicit php scans to inspect composer manifests in node_modules", () => {
      const tmpDir = createComposerNodeModulesFixture();
      try {
        const bomData = createPHPBom(tmpDir, {
          installDeps: false,
          multiProject: true,
          projectType: ["php"],
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows direct php scans without projectType to inspect composer manifests in node_modules", () => {
      const tmpDir = createComposerNodeModulesFixture();
      try {
        const bomData = createPHPBom(tmpDir, {
          installDeps: false,
          multiProject: true,
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows explicit php alias combinations to inspect composer manifests in node_modules", () => {
      const tmpDir = createComposerNodeModulesFixture();
      try {
        const bomData = createPHPBom(tmpDir, {
          installDeps: false,
          multiProject: true,
          projectType: ["php", "composer"],
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("ignores jar artifacts in node_modules during mixed npm/jar scans", async () => {
      const tmpDir = createJarNodeModulesFixture();
      try {
        const createJarBom = await loadStubbedCreateJarBom();
        const bomData = await createJarBom(tmpDir, {
          multiProject: true,
          projectType: ["js", "jar"],
          specVersion: 1.7,
        });
        assert.strictEqual(bomData?.bomJson?.components?.length || 0, 0);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows explicit jar scans to inspect node_modules artifacts", async () => {
      const tmpDir = createJarNodeModulesFixture();
      try {
        const createJarBom = await loadStubbedCreateJarBom();
        const bomData = await createJarBom(tmpDir, {
          multiProject: true,
          projectType: ["jar"],
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows direct jar scans without projectType to inspect node_modules artifacts", async () => {
      const tmpDir = createJarNodeModulesFixture();
      try {
        const createJarBom = await loadStubbedCreateJarBom();
        const bomData = await createJarBom(tmpDir, {
          multiProject: true,
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });

    it("still allows explicit jar alias combinations to inspect node_modules artifacts", async () => {
      const tmpDir = createJarNodeModulesFixture();
      try {
        const createJarBom = await loadStubbedCreateJarBom();
        const bomData = await createJarBom(tmpDir, {
          multiProject: true,
          projectType: ["jar", "war"],
          specVersion: 1.7,
        });
        assert.ok(bomData?.bomJson?.components?.length);
      } finally {
        rmSync(tmpDir, { force: true, recursive: true });
      }
    });
  });

  describe("createNodejsBom() npm scope and scripts", () => {
    const angularCliScriptsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "angular-cli-scripts-repotest",
    );
    const angularCssConfigDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "angular-css-config-repotest",
    );
    const vueRepoDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "vue-repotest",
    );
    const pnpmGitSshRepoDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "pnpm-git-ssh-repotest",
    );
    const pnpmNestedLocksRepoDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "pnpm-nested-locks-repotest",
    );

    const bunRepoDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "data",
      "bun",
    );

    const baseOptions = {
      installDeps: false,
      multiProject: false,
      specVersion: 1.7,
    };

    it("parses a bun.lock project via createNodejsBom", async () => {
      const result = await createNodejsBom(bunRepoDir, baseOptions);
      const comps = result.bomJson?.components || [];
      assert.strictEqual(comps.length, 5);
      const find = (group, name) =>
        comps.find((c) => c.group === group && c.name === name);
      const parser = find("@babel", "parser");
      const leftPad = find("", "left-pad");
      const typescript = find("", "typescript");
      const fsevents = find("", "fsevents");
      // Registry dependency carries a distribution external reference.
      assert.ok(
        parser?.externalReferences?.some((ref) => ref.type === "distribution"),
      );
      // left-pad is a production dependency (no optional scope).
      assert.strictEqual(leftPad?.scope, undefined);
      // typescript is a devDependency -> optional.
      assert.strictEqual(typescript?.scope, "optional");
      // fsevents is an optionalDependency -> optional.
      assert.strictEqual(fsevents?.scope, "optional");
      // The parent component (bun-fixture) is wired into the dependency tree.
      const parentRef = result.bomJson?.metadata?.component?.["bom-ref"];
      const rootDeps = (result.bomJson?.dependencies || []).find(
        (d) => d.ref === parentRef,
      );
      assert.ok(rootDeps?.dependsOn?.includes("pkg:npm/@babel/parser@7.29.7"));
    });

    it("marks script-referenced packages required in Angular CLI scripts app", async () => {
      const result = await createNodejsBom(angularCliScriptsDir, baseOptions);
      const comps = result.bomJson?.components || [];
      const find = (group, name) =>
        comps.find((c) => c.group === group && c.name === name);
      const angularCli = find("@angular", "cli");
      const angularCore = find("@angular", "core");
      const licenseReport = find("", "license-report");
      const leftPad = find("", "left-pad");

      // @angular/cli is referenced via "ng" command in build script
      assert.strictEqual(angularCli?.scope, "required");
      // @angular/core is imported in src/main.ts
      assert.strictEqual(angularCore?.scope, "required");
      // license-report is invoked via "npx license-report" in npm scripts
      assert.strictEqual(licenseReport?.scope, "required");
      // left-pad is not referenced anywhere in source or scripts
      assert.strictEqual(leftPad?.scope, "optional");
    });

    it("marks CSS/asset-only packages required via angular.json configuration", async () => {
      const result = await createNodejsBom(angularCssConfigDir, baseOptions);
      const comps = result.bomJson?.components || [];
      const find = (group, name) =>
        comps.find((c) => c.group === group && c.name === name);

      // Packages referenced in angular.json styles/assets/includePaths
      assert.strictEqual(
        find("@fortawesome", "fontawesome-free")?.scope,
        "required",
      );
      assert.strictEqual(find("", "bootstrap")?.scope, "required");
      assert.strictEqual(find("", "flag-icons")?.scope, "required");
      assert.strictEqual(find("", "angular-i18n")?.scope, "required");
      // Package imported via @use/@import in styles.scss
      assert.strictEqual(find("", "material-symbols")?.scope, "required");
      // left-pad is not referenced anywhere
      assert.strictEqual(find("", "left-pad")?.scope, "optional");
    });

    it("correctly scopes devDependencies vs runtime deps in a Vue app", async () => {
      const result = await createNodejsBom(vueRepoDir, baseOptions);
      const comps = result.bomJson?.components || [];
      const find = (group, name) =>
        comps.find((c) => c.group === group && c.name === name);

      // Runtime deps imported in source files
      assert.strictEqual(find("", "vue")?.scope, "required");
      assert.strictEqual(find("", "vue-router")?.scope, "required");
      assert.strictEqual(find("", "pinia")?.scope, "required");
      assert.strictEqual(find("", "axios")?.scope, "required");
      // devDependency: vite is a build tool, but imported in vite.config.js
      // (now parsed since vite.config.js is excluded from IGNORE_FILE_PATTERN)
      assert.strictEqual(find("", "vite")?.scope, "required");
      // devDependency: plugin imported in vite.config.js, now detected as required
      assert.strictEqual(find("@vitejs", "plugin-vue")?.scope, "required");
    });

    it("emits cdx:npm:buildScripts property for packages with build scripts", async () => {
      const result = await createNodejsBom(angularCliScriptsDir, baseOptions);
      const parentComp = result.bomJson?.metadata?.component;
      const buildScripts = getProp(parentComp, "cdx:npm:buildScripts");
      assert.ok(
        buildScripts?.includes("build"),
        "expected 'build' in cdx:npm:buildScripts",
      );
    });

    it("emits cdx:npm:buildScripts for Vue app with vite build script", async () => {
      const result = await createNodejsBom(vueRepoDir, baseOptions);
      const parentComp = result.bomJson?.metadata?.component;
      const buildScripts = getProp(parentComp, "cdx:npm:buildScripts");
      assert.ok(
        buildScripts?.includes("build"),
        "expected 'build' in cdx:npm:buildScripts",
      );
    });

    it("creates a BOM for pnpm-git-ssh-repotest with private git dependency", async () => {
      const registryEnvKey = "NPM_CONFIG_@group:registry";
      const previousRegistry = process.env[registryEnvKey];
      process.env[registryEnvKey] =
        "https://private-registry.example.com/api/v4/packages/npm/";
      try {
        const result = await createNodejsBom(pnpmGitSshRepoDir, {
          ...baseOptions,
          projectType: ["pnpm"],
        });
        const comps = result.bomJson?.components || [];
        const gitPkg = comps.find((pkg) => pkg.name === "my_project");
        assert.ok(gitPkg, "git+ssh dependency should be present in components");
        assert.strictEqual(gitPkg.group, "@group");
        assert.strictEqual(gitPkg.version, "1.0.6");
        assert.ok(
          gitPkg["bom-ref"].includes("vcs_url="),
          "git dependency purl should include vcs_url qualifier",
        );
      } finally {
        if (previousRegistry === undefined) {
          delete process.env[registryEnvKey];
        } else {
          process.env[registryEnvKey] = previousRegistry;
        }
      }
    });

    it("keeps nested non-workspace pnpm lockfiles in a pnpm workspace", async () => {
      // The root is a pnpm workspace (root pnpm-lock.yaml + pnpm-workspace.yaml).
      // Independent nested projects that are NOT declared workspace members keep
      // their own committed lockfile and must still be parsed (see #4224), while
      // the redundant lockfile inside a declared workspace member is dropped.
      const result = await createNodejsBom(pnpmNestedLocksRepoDir, {
        ...baseOptions,
        multiProject: true,
        projectType: ["pnpm"],
      });
      const comps = result.bomJson?.components || [];
      const names = comps.map((c) => c.name);
      // Root workspace dependency.
      assert.ok(names.includes("is-odd"), "expected root dependency is-odd");
      // Dependency that lives only in an independent nested lockfile.
      assert.ok(
        names.includes("left-pad"),
        "expected nested independent project dependency left-pad to be kept",
      );
      // Dependency that lives only in a nested lockfile under a dot-directory
      // (eg: .github/scripts) - discovery must include hidden paths.
      assert.ok(
        names.includes("dot-dir-only"),
        "expected dot-directory nested lockfile dependency to be discovered",
      );
      // The lockfile inside the declared workspace member is redundant and must
      // not be parsed - its stray-only package should be absent.
      assert.ok(
        !names.includes("member-stray-only"),
        "redundant workspace-member lockfile should be discarded",
      );
    });
  });
});
