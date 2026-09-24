import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

const writeBomFile = (bomFile, components = []) =>
  writeFileSync(
    bomFile,
    JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: 1.7,
      components,
    }),
  );

const nugetComponent = {
  type: "library",
  name: "Serilog",
  purl: "pkg:nuget/Serilog@3.1.1",
};

const cryptoComponent = {
  type: "cryptographic-asset",
  name: "sha-256",
  "bom-ref": "crypto/algorithm/sha-256@2.16.840.1.101.3.4.2.1",
};

const methodsSlice = (pad = 0) => ({
  Metadata: { Tool: "Dosai", SchemaVersion: "4.0.0" },
  Methods: [],
  Dependencies: [],
  PackageReachability: [],
  CallGraph: { Nodes: [], Edges: [] },
  Services: [],
  AiComponents: [],
  Notes: "x".repeat(pad),
});

const writeMethodsSlice = (slicesFile, pad = 0) =>
  writeFileSync(slicesFile, JSON.stringify(methodsSlice(pad)));

const loadEvinser = (dosaiStubs = {}, cbomutilsStubs = {}) =>
  esmock("./evinser.js", {
    "../inventory/dosai.js": dosaiStubs,
    "../inventory/cbomutils.js": cbomutilsStubs,
  });

describe("evinse options wiring", () => {
  it("forwards exclude and the resolved deps slices file", async () => {
    const { buildEvinseOptions } = await import("./evinser.js");
    const sourceDir = join(tmpdir(), "some-dotnet-project");
    const evinseOptions = buildEvinseOptions(
      {
        projectType: ["dotnet"],
        deep: true,
        exclude: ["Tests/**"],
        depsSlicesFile: "deps.slices.json",
        includeCrypto: true,
        specVersion: 1.7,
      },
      { _: [sourceDir] },
      join(tmpdir(), "bom.cdx.json"),
    );
    assert.deepStrictEqual(evinseOptions.exclude, ["Tests/**"]);
    assert.strictEqual(
      evinseOptions.depsSlicesFile,
      resolve(sourceDir, "deps.slices.json"),
    );
  });
});

describe("analyzeProject() dotnet slice reuse", () => {
  it("reuses the deps slice for usages instead of running dosai twice", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-reuse-"));
    try {
      const depsSlicesFile = join(tmpDir, "deps.slices.json");
      writeMethodsSlice(depsSlicesFile, 2048);
      const bomFile = join(tmpDir, "bom.cdx.json");
      writeBomFile(bomFile, [nugetComponent]);
      const createDosaiMethodsSlice = sinon.stub();
      const { analyzeProject } = await loadEvinser({ createDosaiMethodsSlice });
      const sliceArtefacts = await analyzeProject(
        {},
        {
          _: [tmpDir],
          language: ["dotnet"],
          input: bomFile,
          depsSlicesFile,
        },
      );
      sinon.assert.notCalled(createDosaiMethodsSlice);
      assert.strictEqual(sliceArtefacts.usagesSlicesFile, depsSlicesFile);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prefers the user's usages slices file over the deps slice", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-usages-"));
    try {
      const usagesSlicesFile = join(tmpDir, "usages.slices.json");
      writeMethodsSlice(usagesSlicesFile, 2048);
      const depsSlicesFile = join(tmpDir, "deps.slices.json");
      writeMethodsSlice(depsSlicesFile, 2048);
      const bomFile = join(tmpDir, "bom.cdx.json");
      writeBomFile(bomFile, [nugetComponent]);
      const createDosaiMethodsSlice = sinon.stub();
      const { analyzeProject } = await loadEvinser({ createDosaiMethodsSlice });
      const sliceArtefacts = await analyzeProject(
        {},
        {
          _: [tmpDir],
          language: ["dotnet"],
          input: bomFile,
          usagesSlicesFile,
          depsSlicesFile,
        },
      );
      sinon.assert.notCalled(createDosaiMethodsSlice);
      assert.strictEqual(sliceArtefacts.usagesSlicesFile, usagesSlicesFile);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs dosai methods once with the exclude patterns when no deps slice exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-fresh-"));
    try {
      const bomFile = join(tmpDir, "bom.cdx.json");
      writeBomFile(bomFile, [nugetComponent]);
      const createDosaiMethodsSlice = sinon
        .stub()
        .callsFake((_src, outputFile) => {
          writeMethodsSlice(outputFile);
          return true;
        });
      const { analyzeProject } = await loadEvinser({ createDosaiMethodsSlice });
      const sliceArtefacts = await analyzeProject(
        {},
        {
          _: [tmpDir],
          language: ["dotnet"],
          input: bomFile,
          exclude: ["Tests/**", "Build/**"],
        },
      );
      sinon.assert.calledOnce(createDosaiMethodsSlice);
      assert.deepStrictEqual(
        createDosaiMethodsSlice.firstCall.args[2].exclude,
        ["Tests/**", "Build/**"],
      );
      assert.ok(sliceArtefacts.usagesSlicesFile);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reruns dosai when the deps slice is too small to be usable", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-tiny-"));
    try {
      const depsSlicesFile = join(tmpDir, "deps.slices.json");
      writeMethodsSlice(depsSlicesFile);
      const bomFile = join(tmpDir, "bom.cdx.json");
      writeBomFile(bomFile, [nugetComponent]);
      const createDosaiMethodsSlice = sinon
        .stub()
        .callsFake((_src, outputFile) => {
          writeMethodsSlice(outputFile);
          return true;
        });
      const { analyzeProject } = await loadEvinser({ createDosaiMethodsSlice });
      await analyzeProject(
        {},
        {
          _: [tmpDir],
          language: ["dotnet"],
          input: bomFile,
          depsSlicesFile,
        },
      );
      sinon.assert.calledOnce(createDosaiMethodsSlice);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("analyzeProject() dotnet crypto", () => {
  it("does not duplicate crypto components already present in the input BOM", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-crypto-"));
    try {
      const bomFile = join(tmpDir, "bom.cdx.json");
      const outFile = join(tmpDir, "bom.evinse.json");
      writeFileSync(
        bomFile,
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: 1.7,
          metadata: {},
          components: [nugetComponent, cryptoComponent],
        }),
      );
      const newCrypto = {
        ...cryptoComponent,
        name: "aes",
        "bom-ref": "crypto/algorithm/aes@2.16.840.1.101.3.4.1",
      };
      const { createEvinseFile } = await import("./evinser.js");
      const bomJson = await createEvinseFile(
        {
          purlLocationMap: {},
          dataFlowFrames: {},
          cryptoComponents: [{ ...cryptoComponent }, newCrypto],
        },
        { input: bomFile, output: outFile },
      );
      assert.deepStrictEqual(
        bomJson.components
          .filter((comp) => comp.type === "cryptographic-asset")
          .map((comp) => comp["bom-ref"]),
        [cryptoComponent["bom-ref"], newCrypto["bom-ref"]],
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still collects dosai crypto components during evinse", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cdxgen-evinse-crypto-new-"));
    try {
      const bomFile = join(tmpDir, "bom.cdx.json");
      writeBomFile(bomFile, [nugetComponent]);
      const collectDosaiCryptoComponents = sinon
        .stub()
        .resolves([{ ...cryptoComponent }]);
      const { analyzeProject } = await loadEvinser(
        {},
        {
          collectDosaiCryptoComponents,
        },
      );
      const sliceArtefacts = await analyzeProject(
        {},
        {
          _: [tmpDir],
          language: ["dotnet"],
          input: bomFile,
          includeCrypto: true,
        },
      );
      sinon.assert.calledOnce(collectDosaiCryptoComponents);
      assert.deepStrictEqual(sliceArtefacts.cryptoComponents, [
        { ...cryptoComponent },
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
