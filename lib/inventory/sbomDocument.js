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

import { build, Purl } from "@cdxgen/cdx-purl";

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
  for (const component of parsed.components) {
    repairPurl(component);
  }
  return parsed;
}

/**
 * Percent-encode semver build metadata in a purl version.
 *
 * Cargo versions carry it (`1.1.3+spec-1.1.0`), and `+` is not a character a
 * purl version may hold unescaped.
 *
 * @param {string} purl Purl to rewrite
 * @returns {string} The purl with an escaped version
 */
function encodeVersionBuildMetadata(purl) {
  // Only the part before the qualifiers holds the version, and a qualifier
  // value may itself contain an `@`.
  const cut = purl.indexOf("?");
  const head = cut === -1 ? purl : purl.slice(0, cut);
  const tail = cut === -1 ? "" : purl.slice(cut);
  const at = head.lastIndexOf("@");
  if (at === -1 || !head.slice(at + 1).includes("+")) {
    return purl;
  }
  return `${head.slice(0, at + 1)}${head.slice(at + 1).replaceAll("+", "%2B")}${tail}`;
}

/**
 * Split a purl into its components without requiring it to be well-formed.
 *
 * `Purl.parse` rejects a purl whose parts are not already escaped, which is the
 * case this exists to handle. The separators (`:`, `/`, `@`, `?`, `#`, `&`,
 * `=`) are structural and are read positionally; everything between them is
 * decoded and handed back raw, ready for `build` to escape correctly.
 *
 * @param {string} purl Purl to split
 * @returns {{type: string, namespace: (string|null), name: string, version: (string|null), qualifiers: (Object|null), subpath: (string|null)}|null} Parts, or null when the purl has no type and name
 */
function splitPurl(purl) {
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  let rest = purl.slice("pkg:".length).replace(/^\/+/, "");
  let subpath = null;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    subpath = decode(rest.slice(hash + 1)) || null;
    rest = rest.slice(0, hash);
  }
  let qualifiers = null;
  const query = rest.indexOf("?");
  if (query !== -1) {
    qualifiers = {};
    for (const pair of rest.slice(query + 1).split("&")) {
      const equals = pair.indexOf("=");
      if (equals <= 0) {
        continue;
      }
      qualifiers[pair.slice(0, equals)] = decode(pair.slice(equals + 1));
    }
    if (!Object.keys(qualifiers).length) {
      qualifiers = null;
    }
    rest = rest.slice(0, query);
  }
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const type = rest.slice(0, slash);
  let path = rest.slice(slash + 1);
  let version = null;
  const at = path.lastIndexOf("@");
  if (at > 0) {
    version = decode(path.slice(at + 1)) || null;
    path = path.slice(0, at);
  }
  const segments = path.split("/").filter(Boolean).map(decode);
  const name = segments.pop();
  if (!name) {
    return null;
  }
  return {
    type,
    namespace: segments.length ? segments.join("/") : null,
    name,
    version,
    qualifiers,
    subpath,
  };
}

/**
 * Repair the purl of a component read from a third-party document.
 *
 * Producers write a `download_url` as a bare URL, but a purl qualifier value is
 * percent-encoded, so an unescaped `://` makes the whole purl unparseable. A
 * `file:` URL is dropped instead of escaped: it names a path on the machine
 * that built the document, so it identifies nothing for a reader of the BOM.
 * Versions are escaped for build metadata in either case.
 *
 * A purl that is still unparseable afterwards is split on its separators and
 * rebuilt, which escapes any remaining reserved character wherever it sits —
 * a shared-library name such as `libstdc++.so.6`, for instance.
 *
 * @param {object} component Component whose purl is rewritten in place
 */
export function repairPurl(component) {
  const purl = component?.purl;
  if (typeof purl !== "string" || !purl.startsWith("pkg:")) {
    return;
  }
  repairDownloadUrl(component, purl);
  const repaired = component.purl;
  try {
    Purl.parse(repaired);
    return;
  } catch {
    // Fall through to the structural rebuild below.
  }
  const parts = splitPurl(repaired);
  if (!parts) {
    return;
  }
  try {
    component.purl = build(parts).toString();
  } catch {
    // Nothing more can be recovered; the caller reports the invalid purl.
  }
}

/**
 * Rewrite the `download_url` qualifier of a purl, in place on the component.
 *
 * @param {object} component Component whose purl is rewritten in place
 * @param {string} purl The component's current purl
 */
function repairDownloadUrl(component, purl) {
  if (!purl.includes("download_url=")) {
    component.purl = encodeVersionBuildMetadata(purl);
    return;
  }
  const [base, query] = purl.split("?");
  const kept = [];
  let downloadUrl;
  for (const pair of query.split("&")) {
    if (!pair.startsWith("download_url=")) {
      kept.push(pair);
      continue;
    }
    const raw = pair.slice("download_url=".length);
    let value;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    if (!/^file:/i.test(value)) {
      downloadUrl = value;
    }
  }
  const stripped = kept.length ? `${base}?${kept.join("&")}` : base;
  if (!downloadUrl) {
    component.purl = encodeVersionBuildMetadata(stripped);
    return;
  }
  // Rebuilt rather than re-encoded by hand: a purl escapes the separators in a
  // qualifier value but not the scheme colon, and only `build` knows the rule.
  try {
    const parts = Purl.parse(stripped);
    component.purl = build({
      type: parts.type,
      namespace: parts.namespace || null,
      name: parts.name,
      version: parts.version || null,
      qualifiers: { ...(parts.qualifiers || {}), download_url: downloadUrl },
      subpath: parts.subpath || null,
    }).toString();
  } catch {
    component.purl = stripped;
  }
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
