// JavaScript/TypeScript evidence collection.
//
// This lives in lib/ecosystems/ rather than lib/inventory/evidenceUtils.js
// because it is npm-specific throughout: node_modules resolution, package.json
// parsing, and the `cdx:npm:bin/` import convention. Keeping it here lets it
// import parsers-js directly instead of having parsePkgJson threaded in as an
// injected helper from the CLI.

import { join, resolve } from "node:path";

import { DEBUG_MODE } from "../core/activity.js";
import { safeExistsSync } from "../core/fs.js";
import { createOccurrenceEvidence } from "../inventory/evidenceUtils.js";
import { parsePkgJson } from "./parsers-js.js";

const NPM_BIN_IMPORT_PREFIX = "cdx:npm:bin/";

function getNpmBinPropertyValues(pkg, propertyName) {
  if (!Array.isArray(pkg?.properties)) {
    return [];
  }
  return pkg.properties
    .filter((property) => property.name === propertyName && property.value)
    .map((property) => String(property.value));
}

function splitNpmBinPropertyList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getNpmPackageBinCommandNames(pkg) {
  const binNames = new Set();
  if (pkg?.bin && typeof pkg.bin === "object") {
    for (const binName of Object.keys(pkg.bin)) {
      binNames.add(binName);
    }
  } else if (typeof pkg?.bin === "string") {
    binNames.add(pkg.name);
  }
  for (const binValue of getNpmBinPropertyValues(pkg, "cdx:npm:bin")) {
    for (const binName of splitNpmBinPropertyList(binValue)) {
      binNames.add(binName);
    }
  }
  for (const binPathValue of getNpmBinPropertyValues(pkg, "cdx:npm:binPaths")) {
    for (const binPath of splitNpmBinPropertyList(binPathValue)) {
      const normalizedBinPath = binPath.replaceAll("\\", "/");
      const binName = normalizedBinPath.split("/").filter(Boolean).pop();
      if (binName) {
        binNames.add(binName);
      }
    }
  }
  return binNames;
}

function getNpmBinCommandEvidenceKeys(allImports, pkg) {
  const binCommandNames = getNpmPackageBinCommandNames(pkg);
  if (!binCommandNames.size) {
    return [];
  }
  return Object.keys(allImports || {}).filter(
    (importName) =>
      importName.startsWith(NPM_BIN_IMPORT_PREFIX) &&
      binCommandNames.has(importName.slice(NPM_BIN_IMPORT_PREFIX.length)),
  );
}

function applyNpmBinCommandEvidence(pkg, allImports) {
  const binEvidenceKeys = getNpmBinCommandEvidenceKeys(allImports, pkg);
  if (!binEvidenceKeys.length) {
    return;
  }
  pkg.scope = "required";
  const seenOccurrenceLocations = new Set(
    (pkg.evidence?.occurrences || []).map(
      (occurrence) =>
        `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`,
    ),
  );
  for (const binEvidenceKey of binEvidenceKeys) {
    for (const evidence of allImports[binEvidenceKey] || []) {
      if (!evidence?.fileName) {
        continue;
      }
      const occurrence = createOccurrenceEvidence(evidence.fileName, {
        ...(evidence.lineNumber ? { line: evidence.lineNumber } : {}),
      });
      if (!occurrence) {
        continue;
      }
      const occurrenceLocation = `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`;
      if (seenOccurrenceLocations.has(occurrenceLocation)) {
        continue;
      }
      pkg.evidence = pkg.evidence || {};
      pkg.evidence.occurrences = pkg.evidence.occurrences || [];
      pkg.evidence.occurrences.push(occurrence);
      seenOccurrenceLocations.add(occurrenceLocation);
    }
  }
}

export async function addEvidenceForImports(
  pkgList,
  allImports,
  allExports,
  deep,
) {
  const impPkgs = Object.keys(allImports);
  const exportedPkgs = Object.keys(allExports);
  for (const pkg of pkgList) {
    if (impPkgs?.length) {
      // Assume that all packages are optional until we see an evidence
      pkg.scope = "optional";
    }
    const { group, name } = pkg;
    // Evidence belonging to a type must be associated with the package
    if (group === "@types") {
      continue;
    }
    const aliases = group?.length
      ? [name, `${group}/${name}`, `@${group}/${name}`]
      : [name];
    // Deno jsr packages are published under the `@jsr` npm-compat scope
    // (e.g. `@jsr/std__assert`) but are imported in source using their
    // original jsr specifier (e.g. `@std/assert`). Match occurrence evidence
    // against that specifier too, recovered from the `cdx:deno:jsrKey`
    // property recorded during deno.lock parsing.
    const jsrKey = (pkg.properties || []).find(
      (p) => p.name === "cdx:deno:jsrKey",
    )?.value;
    if (jsrKey) {
      const atIndex = jsrKey.lastIndexOf("@");
      const jsrSpecifier = atIndex > 0 ? jsrKey.substring(0, atIndex) : jsrKey;
      if (jsrSpecifier && !aliases.includes(jsrSpecifier)) {
        aliases.push(jsrSpecifier);
      }
    }
    let isImported = false;
    for (const alias of aliases) {
      const isWasmAlias = /\.wasm([?#].*)?$/i.test(alias);
      const all_includes = impPkgs.filter(
        (find_pkg) =>
          find_pkg.startsWith(alias) &&
          (find_pkg.length === alias.length || find_pkg[alias.length] === "/"),
      );
      const all_exports = exportedPkgs.filter((find_pkg) =>
        find_pkg.startsWith(alias),
      );
      if (all_exports?.length) {
        let exportedModules = new Set(isWasmAlias ? [] : all_exports);
        pkg.properties = pkg.properties || [];
        for (const subevidence of all_exports) {
          const evidences = allExports[subevidence];
          for (const evidence of evidences) {
            if (evidence && Object.keys(evidence).length) {
              if (isWasmAlias) {
                for (const wasmImportedModule of evidence.importedModules ||
                  []) {
                  if (wasmImportedModule?.length) {
                    exportedModules.add(wasmImportedModule);
                  }
                }
              }
              if (evidence.exportedModules.length > 1) {
                for (const aexpsubm of evidence.exportedModules) {
                  // Be selective on the submodule names
                  if (
                    !evidence.importedAs
                      .toLowerCase()
                      .includes(aexpsubm.toLowerCase()) &&
                    !alias.endsWith(aexpsubm)
                  ) {
                    // Store both the short and long form of the exported sub modules
                    if (aexpsubm.length > 3) {
                      exportedModules.add(aexpsubm);
                    }
                    exportedModules.add(
                      `${evidence.importedAs.replace("./", "")}/${aexpsubm}`,
                    );
                  }
                }
              }
            }
          }
        }
        exportedModules = Array.from(exportedModules);
        if (exportedModules.length) {
          pkg.properties.push({
            name: "ExportedModules",
            value: exportedModules.join(","),
          });
        }
      }
      // Identify all the imported modules of a component
      if (impPkgs.includes(alias) || all_includes.length) {
        isImported = true;
        let importedModules = new Set();
        let wasmExportedModules = new Set();
        const seenOccurrenceLocations = new Set();
        pkg.scope = "required";
        for (const subevidence of all_includes) {
          const evidences = allImports[subevidence];
          for (const evidence of evidences) {
            if (evidence && Object.keys(evidence).length && evidence.fileName) {
              const occurrence = createOccurrenceEvidence(evidence.fileName, {
                ...(evidence.lineNumber ? { line: evidence.lineNumber } : {}),
              });
              if (occurrence) {
                pkg.evidence = pkg.evidence || {};
                pkg.evidence.occurrences = pkg.evidence.occurrences || [];
                const occurrenceLocation = `${occurrence.location}${occurrence.line ? `#${occurrence.line}` : ""}`;
                if (!seenOccurrenceLocations.has(occurrenceLocation)) {
                  pkg.evidence.occurrences.push(occurrence);
                  seenOccurrenceLocations.add(occurrenceLocation);
                }
              }
              importedModules.add(evidence.importedAs);
              for (const importedSm of evidence.importedModules || []) {
                if (!importedSm) {
                  continue;
                }
                if (isWasmAlias) {
                  wasmExportedModules.add(importedSm);
                }
                // Store both the short and long form of the imported sub modules
                if (importedSm.length > 3) {
                  importedModules.add(importedSm);
                }
                importedModules.add(`${evidence.importedAs}/${importedSm}`);
              }
            }
          }
        }
        importedModules = Array.from(importedModules);
        wasmExportedModules = Array.from(wasmExportedModules);
        if (importedModules.length) {
          pkg.properties = pkg.properties || [];
          pkg.properties.push({
            name: "ImportedModules",
            value: importedModules.join(","),
          });
        }
        if (isWasmAlias && wasmExportedModules.length) {
          pkg.properties = pkg.properties || [];
          if (!pkg.properties.some((p) => p.name === "ExportedModules")) {
            pkg.properties.push({
              name: "ExportedModules",
              value: wasmExportedModules.join(","),
            });
          }
        }
        break;
      }
      if (
        impPkgs?.length > 0 &&
        !isImported &&
        DEBUG_MODE &&
        pkg?.scope !== "optional"
      ) {
        console.debug(
          `\x1b[1;35mNotice: Package ${pkg.name} has no usage in code. Check if it is needed.\x1b[0m`,
        );
      }
      // Capture metadata such as description from local node_modules in deep mode
      if (deep && !pkg.description && pkg.properties) {
        let localNodeModulesPath;
        for (const aprop of pkg.properties) {
          if (aprop.name === "LocalNodeModulesPath") {
            localNodeModulesPath = resolve(join(aprop.value, "package.json"));
            break;
          }
        }
        if (localNodeModulesPath && safeExistsSync(localNodeModulesPath)) {
          const lnmPkgList = await parsePkgJson(localNodeModulesPath, true);
          if (lnmPkgList && lnmPkgList.length === 1) {
            const lnmMetadata = lnmPkgList[0];
            if (lnmMetadata && Object.keys(lnmMetadata).length) {
              pkg.description = lnmMetadata.description;
              pkg.author = lnmMetadata.author;
              pkg.license = lnmMetadata.license;
              pkg.homepage = lnmMetadata.homepage;
              pkg.repository = lnmMetadata.repository;
            }
          }
        }
      }
    } // for alias
    // Trim the properties
    applyNpmBinCommandEvidence(pkg, allImports);
    pkg.properties = pkg.properties.filter(
      (p) => p.name !== "LocalNodeModulesPath",
    );
  } // for pkg
  return pkgList;
}
