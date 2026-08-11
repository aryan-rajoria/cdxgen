// Experimental, off-by-default MCP server pinning and composition enrichment.
//
// The CycloneDX working group's agent-BOM proposal is not yet a ratified
// standard, so everything emitted here is gated behind an explicit opt-in and
// namespaced under `cdx:mcp:` so the property names can be renamed or removed
// mechanically when the standard lands. See docs/MCP.md (Gap analysis).
//
// The governing rule: an unpinned or unhashable MCP server must never serialise
// as though it were pinned. Absence of a hash is represented explicitly, never
// implied by the absence of a property.

import { readEnvironmentVariable } from "../core/activity.js";
import { createCitation, findCdxgenToolBomRef } from "./citations.js";

const PINNING_PROPERTY = "cdx:mcp:pinning";
const COMPOSITION_PROPERTY = "cdx:mcp:composition";
const MCP_PACKAGE_FLAG = "cdx:mcp:package";
const MCP_TRANSPORT_PROPERTY = "cdx:mcp:transport";

/**
 * @param {Object} component A CycloneDX component
 * @returns {boolean} true when the component carries an MCP-package flag property
 */
function isMcpPackageComponent(component) {
  return Boolean(
    Array.isArray(component?.properties) &&
      component.properties.some(
        (property) =>
          property?.name === MCP_PACKAGE_FLAG &&
          String(property?.value).toLowerCase() === "true",
      ),
  );
}

function findProperty(component, name) {
  return component?.properties?.find((property) => property?.name === name);
}

function setProperty(component, name, value) {
  component.properties = component.properties || [];
  const existing = component.properties.find(
    (property) => property?.name === name,
  );
  if (existing) {
    existing.value = value;
    return;
  }
  component.properties.push({ name, value });
}

/**
 * A package component is considered pinned when it carries at least one
 * CycloneDX hash, or an ssri `_integrity` that downstream processing converts
 * into a `hashes[]` entry.
 *
 * @param {Object} component A CycloneDX component
 * @returns {boolean} true when the component is integrity-pinned
 */
function isPinnedComponent(component) {
  if (Array.isArray(component?.hashes) && component.hashes.length > 0) {
    return true;
  }
  return Boolean(component?._integrity);
}

/**
 * Decide whether a discovered MCP service is a remote endpoint with no local
 * package backing. Such servers are composition-unknown: a consumer must not
 * mistake them for a fully-resolved local package.
 *
 * @param {Object} service A CycloneDX service
 * @returns {boolean} true when the service is a remote, package-less MCP server
 */
function isRemotePackagelessService(service) {
  if (!service || typeof service !== "object") {
    return false;
  }
  const isMcpService =
    Array.isArray(service.properties) &&
    service.properties.some((property) =>
      property?.name?.startsWith("cdx:mcp:"),
    );
  if (!isMcpService) {
    return false;
  }
  // Config/source servers record their package references as a string property.
  // An empty or absent list means no resolvable local package.
  const packageRefs = findProperty(service, "cdx:mcp:packageRefs");
  const hasPackageRefs =
    packageRefs && String(packageRefs.value || "").trim().length > 0;
  return !hasPackageRefs;
}

/**
 * Index MCP service transports by the package names they reference, so package
 * components can inherit the transport of the service they back.
 *
 * @param {Object[]} services CycloneDX services
 * @returns {Map<string, string>} lower-cased package reference -> transport
 */
function indexServiceTransportsByPackage(services) {
  const index = new Map();
  for (const service of services || []) {
    const transport = findProperty(service, MCP_TRANSPORT_PROPERTY)?.value;
    const packageRefs = findProperty(service, "cdx:mcp:packageRefs");
    if (!transport || !packageRefs) {
      continue;
    }
    for (const token of String(packageRefs.value || "")
      .split(/[\s,]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)) {
      index.set(token, transport);
    }
  }
  return index;
}

function packageNameTokens(component) {
  const tokens = new Set();
  if (component.name) {
    tokens.add(String(component.name).toLowerCase());
  }
  if (component.purl) {
    const match = /\/([^@/]+)@/.exec(String(component.purl));
    if (match) {
      tokens.add(match[1].toLowerCase());
    }
  }
  return tokens;
}

/**
 * Apply experimental MCP pinning/composition properties. Mutates `bomJson` in
 * place and returns citation hints for the registry-attributed integrity. The
 * caller is responsible for emitting citations only at spec version 1.7+.
 *
 * @param {Object} bomJson CycloneDX BOM
 * @param {Object} [options] CLI options
 * @returns {Object[]} Citation hints produced by the enrichment
 */
export function applyMcpPinningState(bomJson, options = {}) {
  const enabled =
    options?.experimentalMcpPinning === true ||
    readEnvironmentVariable("CDXGEN_EXPERIMENTAL_MCP_PINNING") === "true";
  if (!enabled || !bomJson) {
    return [];
  }
  const pinnedNames = [];
  const components = Array.isArray(bomJson.components)
    ? bomJson.components
    : [];
  const services = Array.isArray(bomJson.services) ? bomJson.services : [];
  const transportsByPackage = indexServiceTransportsByPackage(services);

  for (const component of components) {
    if (!isMcpPackageComponent(component)) {
      continue;
    }
    const pinned = isPinnedComponent(component);
    setProperty(component, PINNING_PROPERTY, pinned ? "pinned" : "unpinned");
    if (pinned) {
      pinnedNames.push(component.name);
    }
    // Inherit transport from any service that references this package.
    if (!findProperty(component, MCP_TRANSPORT_PROPERTY)) {
      for (const token of packageNameTokens(component)) {
        if (transportsByPackage.has(token)) {
          setProperty(
            component,
            MCP_TRANSPORT_PROPERTY,
            transportsByPackage.get(token),
          );
          break;
        }
      }
    }
  }

  // Remote, package-less MCP services are composition-unknown.
  for (const service of services) {
    if (isRemotePackagelessService(service)) {
      setProperty(service, COMPOSITION_PROPERTY, "unknown");
      setProperty(service, PINNING_PROPERTY, "unhashable");
    }
  }

  if (!pinnedNames.length) {
    return [];
  }
  // One citation covers every pinned package: the integrity values all come
  // from the same place — the package registry, resolved by cdxgen's dependency
  // pipeline — so a per-component citation would repeat one fact N times.
  // Attribution names the cdxgen tool component, the only ref that exists in
  // the BOM for this claim; without it there is nothing honest to point at and
  // the citation is dropped rather than aimed at an invented ref.
  const attributedTo = findCdxgenToolBomRef(bomJson);
  if (!attributedTo) {
    return [];
  }
  const citation = createCitation({
    expressions: [
      "$.components[?(@.properties[?(@.name == 'cdx:mcp:pinning' && @.value == 'pinned')])].hashes",
    ],
    attributedTo,
    note: `Integrity for ${pinnedNames.length} pinned MCP package(s) resolved from the package registry.`,
  });
  return citation ? [citation] : [];
}
