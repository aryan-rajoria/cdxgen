import { readFileSync } from "node:fs";

import { tryBuildPurl } from "../inventory/purl.js";

/**
 * Terraform and OpenTofu parser for `.terraform.lock.hcl`.
 *
 * The lock file pins every provider the configuration resolves to, with its
 * exact version, the version constraints that produced it, and content
 * hashes. It is written in a small, regular subset of HCL: provider blocks,
 * `version` and `constraints` attributes, and a `hashes` list of prefixed
 * digests. A line scanner is sufficient and avoids a general HCL parser.
 *
 * Provider addresses look like `registry.terraform.io/hashicorp/aws`; the
 * registry host and namespace identify the provider upstream, so they are
 * kept in the component group and a generic purl
 * (`pkg:generic/<host>/<namespace>/<type>@<version>`), with the intended type
 * recorded as a `cdx:purl:proposedType` property because no `terraform`
 * purl type is registered.
 *
 * The two hash schemes in the `hashes` list mean different things. A `zh:`
 * digest is a SHA-256 of the official `.zip` package as the registry indexes
 * it, so it is the one a consumer can check an artifact against and the one
 * emitted in the CycloneDX `hashes` array. An `h1:` digest is base64 over a
 * hash of the package's *contents* rather than the archive, which lets
 * Terraform verify an unpacked directory but makes it useless as an artifact
 * checksum; it is kept as a property instead of being mislabelled SHA-256.
 */

/**
 * Parse a `.terraform.lock.hcl` file.
 *
 * @param {string} lockFile Path to the lock file
 * @returns {{ pkgList: object[] }} Provider components
 */
export function parseTerraformLockFile(lockFile) {
  let text;
  try {
    text = readFileSync(lockFile, "utf-8");
  } catch (error) {
    console.warn(`Failed to read ${lockFile}: ${error.message}`);
    return { pkgList: [] };
  }

  const pkgList = [];
  let current;
  let inHashes = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (inHashes) {
      if (line.startsWith("]")) {
        inHashes = false;
        continue;
      }
      const hash = line.match(/^"([^"]+)"/u);
      if (hash && current) {
        current.candidates.push(hash[1]);
      }
      continue;
    }
    const block = line.match(/^provider\s+"([^"]+)"\s*\{/u);
    if (block) {
      current = { address: block[1], candidates: [] };
      continue;
    }
    if (line.startsWith("}")) {
      if (current) {
        const pkg = buildProviderComponent(current, lockFile);
        if (pkg) {
          pkgList.push(pkg);
        }
        current = undefined;
      }
      continue;
    }
    const version = matchAttribute(line, "version");
    if (version && current) {
      current.version = version;
      continue;
    }
    const constraints = matchAttribute(line, "constraints");
    if (constraints && current) {
      current.constraints = constraints;
      continue;
    }
    if (/^hashes\s*=\s*\[/u.test(line) && current) {
      inHashes = true;
      // Some writers put the first digest on the same line as the bracket.
      const inline = line.replace(/^hashes\s*=\s*\[\s*/u, "");
      const inlineHash = inline.match(/^"([^"]+)"/u);
      if (inlineHash) {
        current.candidates.push(inlineHash[1]);
      }
    }
  }
  return { pkgList };
}

/**
 * Match a string attribute assignment such as `version = "5.80.0"`.
 *
 * @param {string} line Trimmed line
 * @param {string} name Attribute name
 * @returns {string|undefined} Attribute value when present
 */
function matchAttribute(line, name) {
  const match = line.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "u"));
  return match ? match[1] : undefined;
}

/**
 * Build a provider component from one parsed block.
 *
 * @param {{address: string, version?: string, constraints?: string, candidates: string[]}} block
 *   Parsed provider block
 * @param {string} srcFile Lock file path
 * @returns {object|undefined} Component record
 */
function buildProviderComponent(block, srcFile) {
  const segments = block.address.split("/").filter(Boolean);
  if (segments.length < 2) {
    return undefined;
  }
  const name = segments[segments.length - 1];
  const namespace = segments.slice(0, -1).join("/");
  const purl = tryBuildPurl({
    type: "generic",
    namespace,
    name,
    version: block.version,
  });
  const properties = [
    { name: "internal:SrcFile", value: srcFile },
    { name: "cdx:purl:proposedType", value: "terraform-provider" },
    { name: "cdx:tf:address", value: block.address },
  ];
  if (block.constraints) {
    properties.push({ name: "cdx:tf:constraints", value: block.constraints });
  }
  const contentHash = block.candidates.find((candidate) =>
    candidate.startsWith("h1:"),
  );
  if (contentHash) {
    properties.push({ name: "cdx:tf:h1", value: contentHash });
  }
  const pkg = {
    group: namespace,
    name,
    ...(block.version ? { version: block.version } : {}),
    type: "library",
    scope: "required",
    properties,
  };
  const sha256 = zipDigestsHex(block.candidates);
  if (sha256.length) {
    pkg.hashes = sha256.map((content) => ({ alg: "SHA-256", content }));
  }
  if (purl) {
    pkg.purl = purl;
    pkg["bom-ref"] = decodeURIComponent(purl);
  } else {
    pkg["bom-ref"] = `library:${block.address}:${block.version || ""}`;
  }
  return pkg;
}

/**
 * Collect the `zh:` package digests of a provider block.
 *
 * A provider is published as one zip per platform and the lock records a
 * digest for each, so a block yields several digests for the same version.
 * All of them are returned: each is a genuine SHA-256 of a distributed
 * artifact for this component, and the lock does not say which platform a
 * given digest belongs to.
 *
 * @param {string[]} candidates Prefixed digests from the hashes list
 * @returns {string[]} Lowercase hex digests, in file order and deduplicated
 */
function zipDigestsHex(candidates) {
  const digests = new Set();
  for (const candidate of candidates) {
    if (!candidate.startsWith("zh:")) {
      continue;
    }
    const digest = candidate.slice(3).toLowerCase();
    if (/^[0-9a-f]{64}$/u.test(digest)) {
      digests.add(digest);
    }
  }
  return [...digests];
}
