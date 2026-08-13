import { getDistroInfo } from "./osinfo.js";
import { tryBuildPurl } from "./purl.js";

/**
 * Derive a version value from an osquery result row.
 *
 * Falls back through alternate row fields (e.g. `hotfix_id`, `port`, `pid`)
 * that carry version-like values for the given query category.
 *
 * @param {Object} res osquery result row
 * @returns {string|undefined} First present version-like field value
 */
export function deriveOsQueryVersion(res) {
  return (
    res.version ||
    res.hotfix_id ||
    res.hardware_version ||
    res.port ||
    res.pid ||
    res.subject_key_id ||
    res.interface ||
    res.instance_id
  );
}

/**
 * Derive a name value from an osquery result row.
 *
 * @param {Object} res osquery result row
 * @param {boolean} singleResult Whether the query returned exactly one row
 * @param {string} queryName Query name used as a fallback name for single-result queries
 * @returns {string|undefined} First present name-like field value
 */
export function deriveOsQueryName(res, singleResult, queryName) {
  let name =
    res.name ||
    res.device_id ||
    res.hotfix_id ||
    res.uuid ||
    res.serial ||
    res.pid ||
    res.address ||
    res.ami_id ||
    res.interface ||
    res.client_app_id;
  if (!name && singleResult && queryName) {
    name = queryName;
  }
  return name;
}

/**
 * Derive a publisher value from an osquery result row.
 *
 * @param {Object} res osquery result row
 * @returns {string} Publisher-like value, or an empty string when absent or literal `"null"`
 */
export function deriveOsQueryPublisher(res) {
  const publisher =
    res.publisher ||
    res.maintainer ||
    res.creator ||
    res.manufacturer ||
    res.provider ||
    "";
  return publisher === "null" ? "" : publisher;
}

/**
 * Derive a description value from an osquery result row.
 *
 * @param {Object} res osquery result row
 * @returns {string} First present description-like field value, or an empty string
 */
export function deriveOsQueryDescription(res) {
  return (
    res.description ||
    res.summary ||
    res.arguments ||
    res.device ||
    res.codename ||
    res.section ||
    res.status ||
    res.identifier ||
    res.components ||
    ""
  );
}

/**
 * Sanitize an identity string for use in component names and references.
 *
 * @param {string} value Raw identity value
 * @returns {string} Value with spaces mapped to `+`, `:`/`%` mapped to `-`, and `@`/brace delimiters trimmed
 */
export function sanitizeOsQueryIdentity(value) {
  return String(value || "")
    .replace(/ /g, "+")
    .replace(/[:%]/g, "-")
    .replace(/^[@{]/g, "")
    .replace(/[}]$/g, "");
}

/**
 * Sanitize a value for safe use inside a `bom-ref`.
 *
 * @param {string} value Raw value
 * @param {string} [fallback="unknown"] Value returned when the input is empty or `"null"`
 * @returns {string} Whitespace-collapsed value with bom-ref delimiters replaced by `-`
 */
export function sanitizeOsQueryBomRefValue(value, fallback = "unknown") {
  const normalizedValue = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedValue || normalizedValue === "null") {
    return fallback;
  }
  return normalizedValue.replace(/[:@#\[\]=]/g, "-");
}

/**
 * Build a deterministic fallback `bom-ref` for an osquery-derived component.
 *
 * @param {string} queryCategory Osquery category (e.g. `deb_packages`)
 * @param {string} componentType CycloneDX component type
 * @param {string|undefined} name Component name
 * @param {string|undefined} version Component version
 * @param {string|undefined} identityField Row field used to distinguish the component's identity
 * @param {string|undefined} identityValue Value of the identity field
 * @returns {string} BOM ref of the form `osquery:<category>:<type>:<name>@<version>[<field>=<value>]`
 */
export function createOsQueryFallbackBomRef(
  queryCategory,
  componentType,
  name,
  version,
  identityField,
  identityValue,
) {
  const categoryRef = sanitizeOsQueryBomRefValue(queryCategory, "component");
  const componentTypeRef = sanitizeOsQueryBomRefValue(
    componentType,
    "component",
  );
  const nameRef = sanitizeOsQueryBomRefValue(
    name || queryCategory,
    "component",
  );
  const versionRef = sanitizeOsQueryBomRefValue(version, "unknown");
  const baseBomRef = `osquery:${categoryRef}:${componentTypeRef}:${nameRef}@${versionRef}`;
  if (!identityField || !identityValue) {
    return baseBomRef;
  }
  const identityFieldRef = sanitizeOsQueryBomRefValue(
    identityField,
    "identity",
  );
  const identityValueRef = sanitizeOsQueryBomRefValue(identityValue, "unknown");
  return `${baseBomRef}[${identityFieldRef}=${identityValueRef}]`;
}

/**
 * Determine whether an osquery-derived component type may carry a purl.
 *
 * @param {string} componentType CycloneDX component type
 * @returns {boolean} `false` for `cryptographic-asset`, `data`, `device`, and `information`
 */
export function shouldCreateOsQueryPurl(componentType) {
  return !["cryptographic-asset", "data", "device", "information"].includes(
    componentType || "",
  );
}

// Purl types whose type rules require a namespace. For OS package types the
// namespace is the distro vendor (`pkg:deb/debian/...`, `pkg:rpm/redhat/...`),
// which osquery does not report but /etc/os-release does.
const NAMESPACE_REQUIRED_TYPES = new Set([
  "deb",
  "rpm",
  "apk",
  "alpm",
  "ebuild",
]);

/**
 * Construct a purl string for an osquery-derived component.
 *
 * Builds through `tryBuildPurl`, so an invalid combination yields `null`
 * instead of throwing. Derives a swid `tag_id` qualifier when missing and a
 * distro namespace from `/etc/os-release` for OS package types that require one.
 *
 * @param {string} purlType Purl type (e.g. `deb`, `rpm`, `generic`)
 * @param {string|null} group Purl namespace or group
 * @param {string} name Component name
 * @param {string} version Component version
 * @param {Object|null} qualifiers Purl qualifiers
 * @param {string|null} subpath Purl subpath (leading slashes are stripped)
 * @returns {string|null} Canonical purl string, or `null` when the parts do not form a valid purl
 */
export function createOsQueryPurl(
  purlType,
  group,
  name,
  version,
  qualifiers,
  subpath,
) {
  // cdx-purl rejects absolute subpaths; strip a leading slash so filesystem
  // paths like /usr/lib/libcrypto.dylib become relative subpath segments.
  const safeSubpath = subpath ? subpath.replace(/^\/+/, "") : null;
  const type = purlType || "generic";
  const finalQualifiers = { ...qualifiers };
  // swid purls require a tag_id qualifier (ISO/IEC 19770-2). Auto-derive one
  // from the component name when the caller did not provide one.
  if (type === "swid" && !finalQualifiers.tag_id) {
    finalQualifiers.tag_id = name;
  }
  // The Linux OS package queries (deb_packages, rpm_packages, portage) yield no
  // group, but their purl types require a namespace. Derive the vendor from
  // /etc/os-release the same way osPackageResolver does, so these keep a valid
  // purl instead of losing one.
  let namespace = group || null;
  if (!namespace && NAMESPACE_REQUIRED_TYPES.has(type)) {
    namespace = getDistroInfo().namespace || null;
  }
  // tryBuildPurl rather than build: a component that cannot be expressed as a
  // valid purl must not abort the whole SBOM. Before this, an unknown distro on
  // Linux threw E_REQUIRED_COMPONENT out of the middle of createCppBom.
  return tryBuildPurl({
    type,
    namespace,
    name: name,
    version: version || null,
    qualifiers: Object.keys(finalQualifiers).length ? finalQualifiers : null,
    subpath: safeSubpath,
  });
}

function _deriveCertificateFormat(certificateFileExtension) {
  switch ((certificateFileExtension || "").toLowerCase()) {
    case "pem":
      return "PEM";
    case "der":
      return "DER";
    case "cer":
    case "crt":
      return "X.509";
    default:
      return undefined;
  }
}

function _normalizeCertificateDate(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const stringValue = `${value}`.trim();
  if (!stringValue) {
    return undefined;
  }
  const numericValue = Number(stringValue);
  if (Number.isFinite(numericValue)) {
    const millis = stringValue.length > 10 ? numericValue : numericValue * 1000;
    const parsedDate = new Date(millis);
    return Number.isNaN(parsedDate.getTime())
      ? undefined
      : parsedDate.toISOString();
  }
  const parsedDate = new Date(stringValue);
  return Number.isNaN(parsedDate.getTime())
    ? undefined
    : parsedDate.toISOString();
}
