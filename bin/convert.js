#!/usr/bin/env node

import fs from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  retrieveCdxgenVersion,
  safeExistsSync,
  safeMkdirSync,
  safeWriteSync,
} from "../lib/ecosystems/utils.js";
import {
  deriveSpdxOutputPath,
  deriveSpecVersionOutputPath,
} from "../lib/helpers/exportUtils.js";
import {
  getNonCycloneDxErrorMessage,
  isCycloneDxBom,
  toCycloneDxSpecVersionString,
} from "../lib/inventory/bomUtils.js";
import {
  importProtobomModule,
  isProtoBomPath,
} from "../lib/inventory/protobomLoader.js";
import { sortBomCollections } from "../lib/stages/postgen/sortBom.js";
import { convertCycloneDxToSpdx } from "../lib/stages/postgen/spdxConverter.js";
import {
  applySpecVersionCompatibility,
  collectFieldPaths,
} from "../lib/stages/postgen/specVersionCompat.js";
import { validateBom, validateSpdx } from "../lib/validator/bomValidator.js";

// cdxgen bundles CycloneDX JSON schemas for these versions only, so a
// conversion to any other version is written without a schema check.
const VALIDATABLE_SPEC_VERSIONS = new Set(["1.6", "1.7", "2.0"]);

const _yargs = yargs(hideBin(process.argv));

const args = _yargs
  .option("input", {
    alias: "i",
    default: "bom.json",
    description: "Input CycloneDX BOM JSON or protobuf file.",
  })
  .option("output", {
    alias: "o",
    description:
      "Output file. Defaults to <input>.spdx.json, or <input>-<to>.<ext> when --to names a CycloneDX version.",
  })
  .option("to", {
    default: "spdx",
    description:
      "Conversion target. 'spdx' exports SPDX 3.0.1 JSON-LD. A CycloneDX spec version (1.5, 1.6, 1.7) cross-converts the BOM to that version instead.",
  })
  .option("validate", {
    type: "boolean",
    default: true,
    description:
      "Validate the converted output against its schema. Pass --no-validate to skip.",
  })
  .option("json-pretty", {
    type: "boolean",
    default: false,
    description: "Pretty-print generated JSON output.",
  })
  .completion("completion", "Generate bash/zsh completion")
  .epilogue("for documentation, visit https://cdxgen.github.io/cdxgen")
  .scriptName("cdx-convert")
  .version(retrieveCdxgenVersion())
  .help()
  .wrap(Math.min(120, yargs().terminalWidth())).argv;

const loadCycloneDxBom = async (inputPath) => {
  if (!safeExistsSync(inputPath)) {
    console.error(`Input file '${inputPath}' not found.`);
    process.exit(1);
  }
  const isProtoInput = isProtoBomPath(inputPath);
  try {
    if (isProtoInput) {
      const { readBinary } = await importProtobomModule(
        "cdx-convert",
        "protobuf BOM input",
      );
      return readBinary(inputPath, true);
    }
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch (error) {
    const inputType = isProtoInput ? "protobuf" : "JSON";
    console.error(
      `Failed to parse '${inputPath}' as CycloneDX ${inputType}: ${error.message}`,
    );
    process.exit(1);
  }
};

const ensureOutputParent = (outputPath) => {
  const outputParent = dirname(outputPath);
  if (outputParent && outputParent !== "." && !safeExistsSync(outputParent)) {
    safeMkdirSync(outputParent, { recursive: true });
  }
};

const targetSpecVersion = toCycloneDxSpecVersionString(args.to);
const isSpdxTarget = `${args.to}`.trim().toLowerCase() === "spdx";
if (!isSpdxTarget && !targetSpecVersion) {
  console.error(
    `Unsupported conversion target '${args.to}'. Pass --to spdx for an SPDX 3.0.1 export, or a CycloneDX spec version such as 1.5, 1.6, or 1.7.`,
  );
  process.exit(1);
}

const bomJson = await loadCycloneDxBom(args.input);

if (!isCycloneDxBom(bomJson)) {
  console.error(getNonCycloneDxErrorMessage(bomJson, "cdx-convert"));
  process.exit(1);
}
const cdxSpecVersion = toCycloneDxSpecVersionString(bomJson?.specVersion);

if (isSpdxTarget) {
  if (!["1.6", "1.7"].includes(cdxSpecVersion)) {
    console.error(
      `Unsupported CycloneDX specVersion '${bomJson?.specVersion}'. cdx-convert currently supports CycloneDX 1.6 or 1.7 input and exports SPDX 3.0.1.`,
    );
    process.exit(1);
  }

  const spdxJson = convertCycloneDxToSpdx(bomJson, args);
  if (!spdxJson) {
    console.error("Conversion failed: unable to generate SPDX output.");
    process.exit(1);
  }

  if (args.validate && !validateSpdx(spdxJson)) {
    console.error("SPDX validation failed for the converted output.");
    process.exit(1);
  }

  const outputPath = args.output || deriveSpdxOutputPath(args.input);
  ensureOutputParent(outputPath);
  safeWriteSync(
    outputPath,
    JSON.stringify(spdxJson, null, args.jsonPretty ? 2 : null),
  );
  console.log(`Successfully converted '${args.input}' to '${outputPath}'.`);
} else {
  const outputPath =
    args.output || deriveSpecVersionOutputPath(args.input, targetSpecVersion);
  if (outputPath === args.input) {
    console.error(
      `Refusing to overwrite the input BOM '${args.input}'. Pass an explicit -o.`,
    );
    process.exit(1);
  }

  // The same normalizer the postgen stage applies to freshly generated BOMs, so
  // `cdx-convert --to 1.6` and `cdxgen --spec-version 1.6` agree on the result.
  const sourceFieldPaths = collectFieldPaths(bomJson);
  const convertedBomJson = applySpecVersionCompatibility(bomJson, {
    specVersion: targetSpecVersion,
  });
  sortBomCollections(convertedBomJson);

  const retainedFieldPaths = collectFieldPaths(convertedBomJson);
  const removedFieldPaths = [...sourceFieldPaths]
    .filter((fieldPath) => !retainedFieldPaths.has(fieldPath))
    .sort();
  if (removedFieldPaths.length) {
    console.warn(
      `Converting to CycloneDX ${targetSpecVersion} dropped ${removedFieldPaths.length} field path(s) that version does not define:`,
    );
    for (const fieldPath of removedFieldPaths) {
      console.warn(`  - ${fieldPath}`);
    }
  }

  if (args.validate) {
    if (VALIDATABLE_SPEC_VERSIONS.has(targetSpecVersion)) {
      if (!(await validateBom(convertedBomJson))) {
        console.error(
          `CycloneDX ${targetSpecVersion} validation failed for the converted output.`,
        );
        process.exit(1);
      }
    } else {
      console.warn(
        `Skipping schema validation: cdxgen bundles CycloneDX schemas for ${[...VALIDATABLE_SPEC_VERSIONS].join(", ")} only.`,
      );
    }
  }

  ensureOutputParent(outputPath);
  if (isProtoBomPath(outputPath)) {
    const { writeBinary } = await importProtobomModule(
      "cdx-convert",
      "protobuf BOM output",
    );
    writeBinary(convertedBomJson, outputPath, targetSpecVersion);
  } else {
    safeWriteSync(
      outputPath,
      JSON.stringify(convertedBomJson, null, args.jsonPretty ? 2 : null),
    );
  }
  console.log(
    `Successfully converted '${args.input}' from CycloneDX ${cdxSpecVersion} to CycloneDX ${targetSpecVersion} at '${outputPath}'.`,
  );
}
