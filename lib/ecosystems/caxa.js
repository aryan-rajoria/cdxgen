import { readFileSync } from "node:fs";

import { shouldFetchPackageMetadata } from "../core/env.js";
import { sanitizeIngestedPurl } from "../inventory/purl.js";
import { getNpmMetadata } from "./ecosystems.js";

/**
 * Parse caxa self-extracting executable metadata.
 *
 * @param {string} mfile Path to the caxa metadata file.
 * @returns {Promise<Object>} Parsed metadata object.
 */
export async function parseCaxaMetadata(mfile) {
  let mdata;
  try {
    mdata = JSON.parse(readFileSync(mfile));
  } catch (_e) {
    return {};
  }
  if (!mdata?.components) {
    return {};
  }
  const { parentComponent } = mdata;
  if (parentComponent) {
    parentComponent.properties = parentComponent.properties || [];
    parentComponent.properties.push({
      name: "internal:is_executable",
      value: "true",
    });
    // These purls are authored by @cdxgen/caxa, not by cdxgen. Older caxa
    // releases emitted arch/platform qualifiers that the generic purl type does
    // not allow, so anything invalid is repaired or dropped here rather than
    // being copied into the output and failing validation later.
    sanitizeIngestedPurl(parentComponent);
    for (const child of parentComponent.components || []) {
      sanitizeIngestedPurl(child);
    }
  }
  for (const comp of mdata.components) {
    comp.scope = "required";
    comp.properties = comp.properties || [];
    sanitizeIngestedPurl(comp);
    for (const child of comp.components || []) {
      sanitizeIngestedPurl(child);
    }
    // Guard the string check: a component from external metadata may have no
    // purl at all, and `.startsWith` on undefined throws.
    if (comp.purl?.startsWith("pkg:generic/node@")) {
      comp.properties.push({
        name: "internal:is_executable",
        value: "true",
      });
    }
    // The binary-analysis method names the executable the component was found
    // in, which only a parent component can supply. Any `*metadata.json` in
    // the scanned tree reaches this parser, so a document with components and
    // no parent is ordinary input rather than a broken caxa build.
    const methods = [];
    if (parentComponent?.name) {
      methods.push({
        technique: "binary-analysis",
        confidence: 1,
        value: parentComponent.name,
      });
    }
    comp.evidence = {
      identity: {
        field: "purl",
        confidence: 1,
        methods: [
          ...methods,
          {
            technique: "manifest-analysis",
            confidence: 1,
            value: mfile,
          },
        ],
      },
    };
  }
  if (shouldFetchPackageMetadata()) {
    mdata.components = await getNpmMetadata(mdata.components);
  }
  return mdata;
}
