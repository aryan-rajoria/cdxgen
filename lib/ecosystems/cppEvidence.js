// C/C++ evidence collection.
//
// This lives in lib/ecosystems/ rather than lib/inventory/evidenceUtils.js
// because every branch of it is C/C++-specific: vcpkg manifests, CMakeLists,
// and the C usage slices produced by atom. Keeping it here lets it import
// parsers-misc directly instead of having the two parsers threaded in as
// injected helpers from the CLI.

import { readFileSync } from "node:fs";
import {
  sep as _sep,
  basename,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";

import { build } from "@cdxgen/cdx-purl";

import { DEBUG_MODE } from "../core/activity.js";
import { safeExistsSync } from "../core/fs.js";
import { CPP_STD_MODULES } from "../core/state.js";
import { findAppModules } from "../inventory/atomUtils.js";
import { getOSPackageForFile } from "../inventory/osPackageResolver.js";
import { locateGenericPackage } from "../inventory/purl.js";
import { parseCmakeLikeFile, parseCUsageSlice } from "./parsers-misc.js";

/**
 * Method to find c/c++ modules by collecting usages with atom
 *
 * @param {string} src directory
 * @param {object} options Command line options
 * @param {array} osPkgsList Array of OS pacakges represented as components
 * @param {array} epkgList Existing packages list
 */
export function getCppModules(src, options, osPkgsList, epkgList) {
  // Generic is the type to use where the package registry could not be located
  const pkgType = "generic";
  const pkgList = [];
  const pkgAddedMap = {};
  let sliceData;
  const epkgMap = {};
  let parentComponent;
  const dependsOn = new Set();

  (epkgList || []).forEach((p) => {
    epkgMap[`${p.group}/${p.name}`] = p;
  });
  // Let's look for any vcpkg.json file to tell us about the directory we're scanning
  // users can use this file to give us a clue even if they do not use vcpkg library manager
  if (safeExistsSync(join(src, "vcpkg.json"))) {
    const vcPkgData = JSON.parse(
      readFileSync(join(src, "vcpkg.json"), { encoding: "utf-8" }),
    );
    if (vcPkgData && Object.keys(vcPkgData).length && vcPkgData.name) {
      const parentPurl = build({
        type: pkgType,
        namespace: "" || null,
        name: vcPkgData.name,
        version: vcPkgData.version || "" || null,
      });
      parentComponent = {
        name: vcPkgData.name,
        version: vcPkgData.version || "",
        description: vcPkgData.description,
        license: vcPkgData.license,
        purl: parentPurl,
        type: "application",
        "bom-ref": decodeURIComponent(parentPurl),
      };
      if (vcPkgData.homepage) {
        parentComponent.homepage = { url: vcPkgData.homepage };
      }
      // Are there any dependencies declared in vcpkg.json
      if (vcPkgData.dependencies && Array.isArray(vcPkgData.dependencies)) {
        for (const avcdep of vcPkgData.dependencies) {
          let avcpkgName;
          let scope;
          if (typeof avcdep === "string" || avcdep instanceof String) {
            avcpkgName = avcdep;
          } else if (Object.keys(avcdep).length && avcdep.name) {
            avcpkgName = avcdep.name;
            if (avcdep.host) {
              scope = "optional";
            }
          }
          // Is this a dependency we haven't seen before including the all lower and upper case version?
          if (
            avcpkgName &&
            !epkgMap[`/${avcpkgName}`] &&
            !epkgMap[`/${avcpkgName.toLowerCase()}`] &&
            !epkgMap[`/${avcpkgName.toUpperCase()}`]
          ) {
            const pkgPurl = build({
              type: pkgType,
              namespace: "" || null,
              name: avcpkgName,
              version: "" || null,
            });
            const apkg = {
              group: "",
              name: avcpkgName,
              type: pkgType,
              version: "",
              purl: pkgPurl,
              scope,
              "bom-ref": decodeURIComponent(pkgPurl),
              evidence: {
                identity: {
                  field: "purl",
                  confidence: 0.5,
                  methods: [
                    {
                      technique: "source-code-analysis",
                      confidence: 0.5,
                      value: `Filename ${join(src, "vcpkg.json")}`,
                    },
                  ],
                },
              },
            };
            if (!pkgAddedMap[avcpkgName]) {
              pkgList.push(apkg);
              dependsOn.add(apkg["bom-ref"]);
              pkgAddedMap[avcpkgName] = true;
            }
          }
        }
      }
    } // if
  } else if (safeExistsSync(join(src, "CMakeLists.txt"))) {
    const retMap = parseCmakeLikeFile(join(src, "CMakeLists.txt"), pkgType);
    if (retMap.parentComponent && Object.keys(retMap.parentComponent).length) {
      parentComponent = retMap.parentComponent;
    }
  } else if (options.projectName && options.projectVersion) {
    parentComponent = {
      group: options.projectGroup || "",
      name: options.projectName || "",
      version: `${options.projectVersion}` || "latest",
      type: "application",
    };
    const parentPurl = build({
      type: pkgType,
      namespace: parentComponent.group || null,
      name: parentComponent.name,
      version: parentComponent.version || null,
    });
    parentComponent.purl = parentPurl;
    parentComponent["bom-ref"] = decodeURIComponent(parentPurl);
  }
  if (options.usagesSlicesFile && safeExistsSync(options.usagesSlicesFile)) {
    sliceData = JSON.parse(
      readFileSync(options.usagesSlicesFile, { encoding: "utf-8" }),
    );
    if (DEBUG_MODE) {
      console.log("Re-using existing slices file", options.usagesSlicesFile);
    }
  } else {
    sliceData = findAppModules(
      src,
      options.deep ? "c" : "h",
      "usages",
      options.usagesSlicesFile,
      options,
    );
  }
  const usageData = parseCUsageSlice(sliceData);
  for (let afile of Object.keys(usageData)) {
    // Normalize windows separator
    afile = afile.replace("..\\", "").replace(/\\/g, "/");
    const fileName = basename(afile);
    if (!fileName?.length) {
      continue;
    }
    const extn = extname(fileName);
    let group = dirname(afile);
    if (
      group.startsWith(".") ||
      group.startsWith(_sep) ||
      safeExistsSync(resolve(afile)) ||
      safeExistsSync(resolve(src, afile))
    ) {
      group = "";
    }
    const version = "";
    // We need to resolve the name to an os package here
    const name = fileName.replace(extn, "");
    // Logic here if name matches the standard library of cpp
    // we skip it
    // Load the glibc-stdlib.json file, which contains std lib for cpp
    if (CPP_STD_MODULES.includes(name)) {
      continue;
    }
    let apkg = getOSPackageForFile(afile, osPkgsList) ||
      epkgMap[`${group}/${name}`] || {
        name,
        group,
        version: "",
        type: pkgType,
      };
    // If this is a relative file, there is a good chance we can reuse the project group
    if (!afile.startsWith(_sep) && !group.length) {
      group = options.projectGroup || "";
    }
    if (!apkg.purl) {
      apkg.purl = build({
        type: pkgType,
        namespace: group || null,
        name: name,
        version: version || null,
        subpath: afile || null,
      });
      apkg.evidence = {
        identity: {
          field: "purl",
          confidence: 0,
          methods: [
            {
              technique: "source-code-analysis",
              confidence: 0,
              value: `Filename ${afile}`,
            },
          ],
        },
      };
      apkg["bom-ref"] = decodeURIComponent(apkg["purl"]);
    }
    if (usageData[afile]) {
      const usymbols = Array.from(usageData[afile])
        .filter(
          (v) =>
            !v.startsWith("<") &&
            !v.startsWith("__") &&
            v !== "main" &&
            !v.includes("anonymous_") &&
            !v.includes(afile),
        )
        .map((v) => v.split(":")[0])
        .sort();
      if (!apkg["properties"] && usymbols.length) {
        apkg["properties"] = [
          { name: "ImportedSymbols", value: usymbols.join("|") },
        ];
      } else {
        apkg["properties"] = [];
      }
      const newProps = [];
      let symbolsPropertyFound = false;
      for (const prop of apkg["properties"]) {
        if (prop.name === "ImportedSymbols") {
          symbolsPropertyFound = true;
          let existingSymbols = prop.value.split("|");
          existingSymbols = existingSymbols.concat(usymbols);
          prop.value = Array.from(new Set(existingSymbols)).sort().join("|");
        }
        newProps.push(prop);
      }
      if (!symbolsPropertyFound && usymbols.length) {
        apkg["properties"].push({
          name: "ImportedSymbols",
          value: usymbols.join("|"),
        });
      }
      apkg["properties"] = newProps;
    }
    // At this point, we have a package but we don't know what it's called
    // So let's try to locate this generic package using some heuristics
    apkg = locateGenericPackage(apkg);
    if (!pkgAddedMap[name]) {
      pkgList.push(apkg);
      dependsOn.add(apkg["bom-ref"]);
      pkgAddedMap[name] = true;
    }
  }
  const dependenciesList =
    dependsOn.size && parentComponent
      ? [
          {
            ref: parentComponent["bom-ref"],
            dependsOn: [...dependsOn].sort(),
          },
        ]
      : [];
  return {
    parentComponent,
    pkgList: pkgList.sort((a, b) => a.purl.localeCompare(b.purl)),
    dependenciesList,
  };
}
