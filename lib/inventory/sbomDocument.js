// Parsing of third-party SBOM documents that cdxgen did not produce.
//
// Two features consume documents from outside the build: PEP 770 SBOMs embedded
// under `<dist>.dist-info/sboms/`, and BOM artifacts retrieved from a
// Transparency Exchange API server. Both receive untrusted input over a channel
// cdxgen does not control, so both need the same handling: bound the size,
// refuse to parse anything that is not a recognised SBOM shape, and skip a bad
// document with a warning instead of failing the run.
//
// CycloneDX documents pass through unchanged. SPDX 3.x JSON-LD is converted by
// the shared converter; SPDX 2.x JSON is read directly from `packages[]` so an
// embedded 2.3 document is not silently dropped.

import { isSpdxJsonLd } from "./bomUtils.js";
import { toCycloneDxLikeBom } from "./spdxUtils.js";

// A document larger than this is not a plausible SBOM for a single
// distribution or artifact. The bound keeps a malicious or malformed archive
// from driving parsing into an out-of-memory failure.
export const MAX_SBOM_DOCUMENT_BYTES = 5 * 1024 * 1024;

function purlOfSpdxPackage(pkg) {
  return pkg?.externalRefs?.find((ref) => ref?.referenceType === "purl")
    ?.referenceLocator;
}

function componentsFromSpdx2(doc) {
  return doc.packages
    .filter((pkg) => pkg && (pkg.name || pkg.SPDXID))
    .map((pkg) => {
      const purl = purlOfSpdxPackage(pkg);
      return {
        type: "library",
        name: pkg.name || pkg.SPDXID,
        version: pkg.versionInfo,
        purl,
        "bom-ref": purl || pkg.SPDXID,
      };
    });
}

/**
 * Parse a third-party SBOM document into components and dependencies.
 *
 * Returns null — never throws — when the document is too large, is not JSON, is
 * not a recognised SBOM shape, or carries nothing worth merging. Every rejection
 * is reported once, naming the source, so a skipped document is visible rather
 * than silent.
 *
 * @param {string} text Raw document text
 * @param {Object} [input] Parse inputs
 * @param {string} [input.source] Provenance label used in warnings (path, entry name or URL)
 * @param {number} [input.maxBytes] Size bound. Defaults to `MAX_SBOM_DOCUMENT_BYTES`
 * @returns {{components: Object[], dependencies: Object[], format: string, rootRef: (string|undefined)}|null}
 */
export function parseSbomDocument(
  text,
  { source = "unknown", maxBytes = MAX_SBOM_DOCUMENT_BYTES } = {},
) {
  const content = typeof text === "string" ? text : "";
  if (!content.length) {
    return null;
  }
  if (Buffer.byteLength(content) > maxBytes) {
    console.warn(
      `cdxgen: skipping SBOM document at ${source} (exceeds ${maxBytes} bytes).`,
    );
    return null;
  }
  let doc;
  try {
    doc = JSON.parse(content);
  } catch (_err) {
    console.warn(`cdxgen: skipping SBOM document at ${source} (invalid JSON).`);
    return null;
  }
  if (!doc || typeof doc !== "object") {
    return null;
  }
  let parsed;
  if (doc.bomFormat === "CycloneDX") {
    if (!doc.specVersion) {
      console.warn(
        `cdxgen: skipping CycloneDX document at ${source} (no specVersion).`,
      );
      return null;
    }
    parsed = {
      components: Array.isArray(doc.components) ? doc.components : [],
      dependencies: Array.isArray(doc.dependencies) ? doc.dependencies : [],
      format: `cyclonedx-${doc.specVersion}`,
      rootRef: doc.metadata?.component?.["bom-ref"],
    };
  } else if (isSpdxJsonLd(doc)) {
    const like = toCycloneDxLikeBom(doc);
    parsed = {
      components: Array.isArray(like.components) ? like.components : [],
      dependencies: Array.isArray(like.dependencies) ? like.dependencies : [],
      format: doc.specVersion ? `spdx-${doc.specVersion}` : "spdx-3",
      rootRef: undefined,
    };
  } else if (Array.isArray(doc.packages)) {
    parsed = {
      components: componentsFromSpdx2(doc),
      dependencies: [],
      format: doc.spdxVersion ? `spdx-${doc.spdxVersion}` : "spdx-2",
      rootRef: undefined,
    };
  } else {
    console.warn(
      `cdxgen: skipping document at ${source} (not a recognised SBOM format).`,
    );
    return null;
  }
  if (!parsed.components.length && !parsed.dependencies.length) {
    return null;
  }
  return parsed;
}

/**
 * Attach provenance properties to every component of a parsed document. The
 * caller owns the property names so each provenance channel stays
 * distinguishable in the merged BOM.
 *
 * @param {Object[]} components Components from `parseSbomDocument`
 * @param {Array<{name: string, value: string}>} properties Properties to add
 * @returns {Object[]} The same array, with properties attached
 */
export function tagSbomComponents(components, properties) {
  for (const component of components || []) {
    if (!component || typeof component !== "object") {
      continue;
    }
    component.properties = Array.isArray(component.properties)
      ? component.properties
      : [];
    for (const property of properties) {
      if (property?.name && property?.value) {
        component.properties.push({
          name: property.name,
          value: String(property.value),
        });
      }
    }
  }
  return components;
}
