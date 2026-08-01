import { getDistroInfo } from "./osinfo.js";
import { tryBuildPurl } from "./purl.js";

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

export function sanitizeOsQueryIdentity(value) {
  return String(value || "")
    .replace(/ /g, "+")
    .replace(/[:%]/g, "-")
    .replace(/^[@{]/g, "")
    .replace(/[}]$/g, "");
}

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
