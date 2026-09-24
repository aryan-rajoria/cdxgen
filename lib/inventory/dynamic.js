import { basename } from "node:path";

import { checksumFile } from "../core/fs.js";
import { mapWithConcurrency } from "../core/parallel.js";
import { resolvePackageForFile } from "./osPackageResolver.js";
import { applyPurl, tryBuildPurl } from "./purl.js";
import { executeAndTrace, groupHttpEntriesToServices } from "./traceRunner.js";

/**
 * Builds a flat list of CycloneDX component objects and services by executing
 * the given command and inspecting which shared libraries it loads at runtime
 * and which HTTP URLs it accesses.
 *
 * Each component receives:
 *  - type: "library"
 *  - scope: "required"  (loaded at runtime — definitely required)
 *  - hashes: SHA-256 of the on-disk file
 *  - evidence.identity[].methods[].technique: "instrumentation"
 *  - confidence: 0.8 when the OS package manager reports a version, 0.5 otherwise
 *
 * Services are detected from HTTP request URLs collected during tracing and
 * follow the CycloneDX service schema with endpoints.
 *
 * @param {string} commandStr - Shell command to execute and trace (e.g. "node --version")
 * @param {string} workingDir - Working directory for the traced process
 * @param {Object} [traceOptions] - Additional sandbox options forwarded to executeAndTrace
 * @returns {Promise<{components: Array<Object>, services: Array<Object>}>} Components and services
 */
export async function buildDynamicComponents(
  commandStr,
  workingDir,
  traceOptions = {},
) {
  const result = await executeAndTrace(commandStr, workingDir, traceOptions);
  const libPaths = result.libPaths || [];
  const httpAccessEntries = result.httpAccessEntries || [];
  const egressEntries = result.egressEntries || [];
  const cryptoComponents = result.cryptoComponents || [];
  const components = [];

  const libHashes = await mapWithConcurrency(libPaths, (libPath) =>
    checksumFile("sha256", libPath).catch(() => null),
  );

  for (let li = 0; li < libPaths.length; li++) {
    const libPath = libPaths[li];
    const fileHash = libHashes[li];
    if (!fileHash) {
      continue;
    }

    const pkgInfo = resolvePackageForFile(libPath);
    let name = basename(libPath);
    let version = "";
    let purlStr = "";
    let confidence = 0.5;

    if (pkgInfo) {
      name = pkgInfo.name;
      version = pkgInfo.version || "";
      confidence = version ? 0.8 : 0.5;

      // pkgInfo.purl is already computed by resolvePackageForFile using the
      // correct distro-aware namespace derived from /etc/os-release.
      purlStr =
        pkgInfo.purl ||
        tryBuildPurl({
          type: pkgInfo.type,
          name: name,
          version: version || null,
          qualifiers: pkgInfo.arch ? { arch: pkgInfo.arch } : null,
        });
    } else {
      // Fall back to a generic purl carrying the file path as a subpath. It was
      // previously a `path` qualifier, which generic does not permit.
      purlStr = tryBuildPurl({
        type: "generic",
        name: name,
        subpath: libPath ? libPath.replace(/^\/+/, "") : null,
      });
    }

    /** @type {Object} */
    const component = {
      name,
      type: "library",
      scope: "required",
      hashes: [
        {
          alg: "SHA-256",
          content: fileHash,
        },
      ],
      properties: [
        {
          name: "cdx:dynamic:filePath",
          value: libPath,
        },
      ],
      evidence: {
        identity: [
          {
            field: "purl",
            confidence,
            methods: [
              {
                technique: "instrumentation",
                confidence,
                value: purlStr,
              },
            ],
          },
        ],
      },
    };

    if (version) {
      component.version = version;
    }
    // applyPurl sets a unique fallback bom-ref when no valid purl exists, so a
    // library that cannot be expressed as a purl still participates correctly in
    // the dependency graph.
    applyPurl(component, purlStr);

    components.push(component);
  }

  // Append cryptographic assets
  for (const comp of cryptoComponents) {
    components.push(comp);
  }

  // Build services from collected HTTP URLs
  const servicesMap = groupHttpEntriesToServices(httpAccessEntries);
  const services = Object.keys(servicesMap).map((serviceName) => {
    const entry = servicesMap[serviceName];
    return {
      name: serviceName,
      bomRef: `urn:service:dynamic:${serviceName}`,
      endpoints: Array.from(entry.endpoints).sort(),
      properties: entry.properties,
    };
  });

  // Egress seen by the safer-exec proxy: hostnames the command connected to
  // (allowed) or tried to reach (denied). This works on every platform,
  // including macOS where eBPF URL tracing is unavailable.
  const servicesByName = new Map(services.map((svc) => [svc.name, svc]));
  for (const egress of egressEntries) {
    const name = `dynamic-${egress.host}-${egress.port}`;
    const defaultPort = egress.protocol === "http" ? 80 : 443;
    const endpoint = `${egress.protocol}://${egress.host}${egress.port !== defaultPort ? `:${egress.port}` : ""}`;
    let svc = servicesByName.get(name);
    if (!svc) {
      svc = {
        name,
        bomRef: `urn:service:dynamic:${name}`,
        endpoints: [],
        properties: [],
      };
      servicesByName.set(name, svc);
      services.push(svc);
    }
    if (!svc.endpoints.some((e) => e.startsWith(endpoint))) {
      svc.endpoints.push(endpoint);
      svc.endpoints.sort();
    }
    if (
      !svc.properties.some(
        (p) =>
          p.name === "cdx:dynamic:egressDecision" &&
          p.value === egress.decision,
      )
    ) {
      svc.properties.push({
        name: "cdx:dynamic:egressDecision",
        value: egress.decision,
      });
    }
  }

  return { components, services, dryRunSummary: result.dryRunSummary };
}
