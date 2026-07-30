import { URL } from "node:url";

import { build, Purl } from "@cdxgen/cdx-purl";

import { DEBUG_MODE } from "./utils.js";

/**
 * Encode a string for safe inclusion in a PackageURL, percent-encoding special characters
 * while preserving already-encoded `%40` sequences and keeping `:` and `/` unencoded.
 *
 * @param {string} s String to encode
 * @returns {string} Encoded string suitable for use in a PackageURL component
 */
export function encodeForPurl(s) {
  return s && !s.includes("%40")
    ? encodeURIComponent(s).replace(/%3A/g, ":").replace(/%2F/g, "/")
    : s;
}

/**
 * Build a purl string, returning `null` instead of throwing when the parts do
 * not form a valid purl.
 *
 * cdx-purl is strict: it rejects a maven purl without a groupId, a swift or
 * golang purl without a namespace, a vscode-extension without a publisher, and
 * so on. Those rejections are correct and must not be papered over — but they
 * also must not crash a scan of an otherwise fine project. This helper is the
 * one sanctioned place to turn a `PurlError` into an absent purl.
 *
 * Only `PurlError` is swallowed. Anything else (a `TypeError` from a bad call,
 * for instance) is a defect in the caller and is rethrown.
 *
 * @param {object} parts Purl parts accepted by cdx-purl's `build()`
 * @returns {string|null} Canonical purl string, or `null` if it is not valid
 */
export function tryBuildPurl(parts) {
  try {
    return build(parts);
  } catch (err) {
    if (err?.code?.startsWith("E_")) {
      if (DEBUG_MODE) {
        console.log(`Unable to construct a purl from ${JSON.stringify(parts)}`);
      }
      return null;
    }
    throw err;
  }
}

/**
 * Build a canonical npm purl from a package name and version.
 *
 * Prefer this over hand-assembling `pkg:npm/...` strings. Manual assembly has
 * to re-implement percent-encoding and gets it wrong in ways cdx-purl then
 * rejects: an unencoded `+` in a semver build-metadata version
 * (`1.0.0+build.1`) throws `E_INVALID_CHARACTER`, and the scope separator has
 * to survive encoding. `build()` handles both, so callers pass raw values.
 *
 * @param {string} pkgName Package name, optionally scoped (`@scope/name`)
 * @param {string} [version] Package version, raw and unencoded
 * @returns {string} Canonical npm purl string
 */
export function npmPurl(pkgName, version) {
  let namespace = null;
  let name = pkgName;
  if (pkgName?.startsWith("@")) {
    const slash = pkgName.indexOf("/");
    if (slash > -1) {
      namespace = pkgName.slice(0, slash);
      name = pkgName.slice(slash + 1);
    }
  }
  return build({
    type: "npm",
    namespace,
    name,
    version: version || null,
  });
}

/**
 * Report whether a string is a valid purl according to cdx-purl.
 *
 * Use this before writing anything into a CycloneDX `purl` field that did not
 * come from `build()` — notably when recovering a purl from a `bom-ref`, which
 * is an opaque identifier and frequently is not a purl at all.
 *
 * @param {string} candidate String to test
 * @returns {boolean} true when cdx-purl parses it
 */
export function isValidPurl(candidate) {
  if (!candidate || typeof candidate !== "string") {
    return false;
  }
  try {
    Purl.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a purl string, returning `null` instead of throwing when it is invalid.
 *
 * The parse-side counterpart of {@link tryBuildPurl}, for callers that have
 * already assembled a purl string. Only `PurlError` is swallowed.
 *
 * @param {string} purlString Candidate purl
 * @returns {string|null} Canonical purl string, or `null` if it is not valid
 */
export function tryParsePurl(purlString) {
  try {
    return Purl.parse(purlString).toString();
  } catch (err) {
    if (err?.code?.startsWith("E_")) {
      return null;
    }
    throw err;
  }
}

/**
 * Build a `bom-ref` for a component that has no valid purl.
 *
 * `bom-ref` must be **unique within the document** — CycloneDX uses it as the
 * key for the dependency graph, so two components sharing one silently merge
 * their edges. The bare component name is therefore not usable: the syft go
 * module graph contains eight versions of `go.opencensus.io`, none of which can
 * carry a golang purl (cdx-purl requires a namespace), and naming them all
 * `go.opencensus.io` collapsed eight distinct modules into one ref.
 *
 * The `type:group/name:version` shape matches the convention already used for
 * root components (`application:swift-smoke:latest`) and for the dedupe key in
 * `lib/stages/postgen/ruleEngine.js`.
 *
 * @param {object} component Component with `type`, `group`, `name`, `version`
 * @returns {string} A document-unique, deterministic bom-ref
 */
export function fallbackBomRef(component) {
  const type = component?.type || "library";
  const group = component?.group ? `${component.group}/` : "";
  const name = component?.name || "unnamed";
  const version = component?.version || "";
  return `${type}:${group}${name}:${version}`;
}

/**
 * Attach a purl and `bom-ref` to a component, never emitting an invalid purl.
 *
 * CycloneDX requires `component.purl` to be a valid Package URL when present,
 * so a component we cannot build a purl for must omit the field entirely — it
 * must *not* fall back to the bare name, which is what produced
 * `"purl": "swift-smoke"` in the swift golden.
 *
 * `bom-ref` has no syntax constraint but does have a uniqueness constraint, so
 * the fallback goes through {@link fallbackBomRef} rather than using the name.
 *
 * Any pre-existing `purl` is deleted when the new one is invalid, so a
 * component cannot retain a stale purl from an earlier enrichment pass.
 *
 * @param {object} component Component to mutate
 * @param {string|null} purlString Canonical purl string, or `null`/`undefined`
 * @param {string} [fallbackRef] Explicit `bom-ref` override for when there is no purl
 * @returns {object} The same component, for chaining
 */
export function applyPurl(component, purlString, fallbackRef) {
  if (purlString) {
    component.purl = purlString;
    component["bom-ref"] = decodeURIComponent(purlString);
  } else {
    delete component.purl;
    component["bom-ref"] = fallbackRef ?? fallbackBomRef(component);
  }
  return component;
}

/**
 * Create a PackageURL object from a repository URL string, package type, and version.
 *
 * Supports HTTPS URLs, SSH `git@` URLs, Bitbucket SSH URLs, and local paths.
 * Extracts the namespace (host + path prefix) and repository name from the URL.
 *
 * @param {string} type PackageURL type (e.g. `"swift"`, `"generic"`)
 * @param {string} repoUrl Repository URL string
 * @param {string} version Package version
 * @returns {PackageURL|undefined} PackageURL object, or undefined for unsupported URL formats
 */
export function purlFromUrlString(type, repoUrl, version) {
  let namespace = "";
  let name;
  if (repoUrl?.startsWith("http")) {
    const url = new URL(repoUrl);
    const pathnameParts = url.pathname.split("/");
    // Bug #4136 fix. Strip trailing slash
    if (pathnameParts[pathnameParts.length - 1] === "") {
      pathnameParts.pop();
    }
    const pathnameLastElement = pathnameParts.pop(); // pop() returns last element and removes it from pathnameParts
    name = pathnameLastElement.replace(".git", "");
    const urlpath = pathnameParts.join("/");
    namespace = url.hostname + urlpath;
  } else if (repoUrl?.startsWith("git@")) {
    const parts = repoUrl.split(":");
    const hostname = parts[0].split("@")[1];
    const pathnameParts = parts[1].split("/");
    const pathnameLastElement = pathnameParts.pop();
    name = pathnameLastElement.replace(".git", "");
    const urlpath = pathnameParts.join("/");
    namespace = `${hostname}/${urlpath}`;
  } else if (repoUrl?.startsWith("ssh://git@bitbucket")) {
    repoUrl = repoUrl.replace("ssh://git@", "");
    const parts = repoUrl.split(":");
    const hostname = parts[0];
    const pathnameParts = parts[1].split("/").slice(1);
    const pathnameLastElement = pathnameParts.pop();
    name = pathnameLastElement.replace(".git", "");
    const urlpath = pathnameParts.join("/");
    namespace = `${hostname}/${urlpath}`;
  } else if (repoUrl?.startsWith("/")) {
    const parts = repoUrl.split("/");
    name = parts[parts.length - 1] || "unknown";
    if (type === "swift") {
      // cdx-purl requires a swift namespace with host/owner segments.
      // Local paths have none, so return undefined and let the caller
      // construct the component without a purl.
      return undefined;
    }
  } else {
    if (DEBUG_MODE) {
      console.warn("unsupported repo url for swift type");
    }
    return undefined;
  }

  return new Purl({
    type: type,
    namespace: namespace || null,
    name: name,
    version: version || null,
  });
}

/**
 * NOT IMPLEMENTED YET.
 * A future method to locate a generic package given some name and properties
 *
 * @param {object} apkg Package to locate
 * @returns Located project with precise purl or the original unmodified input.
 */
export function locateGenericPackage(apkg) {
  return apkg;
}

function createConanPurlString(name, version, user, channel, rrev, prev) {
  // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#conan

  const qualifiers = {};

  if (user) qualifiers["user"] = user;
  if (channel) qualifiers["channel"] = channel;
  if (rrev) qualifiers["rrev"] = rrev;
  if (prev) qualifiers["prev"] = prev;

  return build({
    type: "conan",
    namespace: "" || null,
    name: name,
    version: version || null,
    qualifiers: Object.keys(qualifiers).length ? qualifiers : null || null,
  });
}

function untilFirst(separator, inputStr) {
  // untilFirst("/", "a/b") -> ["/", "a", "b"]
  // untilFirst("/", "abc") -> ["/", "abc", null]

  if (!inputStr || inputStr.length === 0) {
    return [null, null, null];
  }

  const separatorIndex = inputStr.search(separator);
  if (separatorIndex === -1) {
    return ["", inputStr, null];
  }
  return [
    inputStr[separatorIndex],
    inputStr.substring(0, separatorIndex),
    inputStr.substring(separatorIndex + 1),
  ];
}

export function mapConanPkgRefToPurlStringAndNameAndVersion(conanPkgRef) {
  // A full Conan package reference may be composed of the following segments:
  // conanPkgRef = "name/version@user/channel#recipe_revision:package_id#package_revision"
  // See also https://docs.conan.io/1/cheatsheet.html#package-terminology

  // The components 'package_id' and 'package_revision' do not appear in any files processed by cdxgen.
  // The components 'user' and 'channel' are not mandatory.
  // 'name/version' is a valid Conan package reference, so is 'name/version@user/channel' or 'name/version@user/channel#recipe_revision'.
  // pURL for Conan does not recognize 'package_id'.

  const UNABLE_TO_PARSE_CONAN_PKG_REF = [null, null, null];

  if (!conanPkgRef) {
    if (DEBUG_MODE)
      console.warn(
        `Could not parse Conan package reference '${conanPkgRef}', input does not seem valid.`,
      );

    return UNABLE_TO_PARSE_CONAN_PKG_REF;
  }

  const separatorRegex = /[@#:\/]/;

  const info = {
    name: null,
    version: null,
    user: null,
    channel: null,
    recipe_revision: null,
    package_id: null,
    package_revision: null,
    phase_history: [],
  };

  const transitions = {
    ["name"]: {
      "/": "version",
      "#": "recipe_revision",
      "": "end",
    },
    ["version"]: {
      "@": "user",
      "#": "recipe_revision",
      "": "end",
    },
    ["user"]: {
      "/": "channel",
    },
    ["channel"]: {
      "#": "recipe_revision",
      "": "end",
    },
    ["recipe_revision"]: {
      ":": "package_id",
      "": "end",
    },
    ["package_id"]: {
      "#": "package_revision",
    },
    ["package_revision"]: {
      "": "end",
    },
  };

  let phase = "name";
  let remainder = conanPkgRef;
  let separator;
  let item;

  while (remainder) {
    [separator, item, remainder] = untilFirst(separatorRegex, remainder);

    if (!item) {
      if (DEBUG_MODE)
        console.warn(
          `Could not parse Conan package reference '${conanPkgRef}', empty item in phase '${phase}', separator=${separator}, remainder=${remainder}, info=${JSON.stringify(info)}`,
        );
      return UNABLE_TO_PARSE_CONAN_PKG_REF;
    }

    info[phase] = item;
    info.phase_history.push(phase);

    if (!(phase in transitions)) {
      if (DEBUG_MODE)
        console.warn(
          `Could not parse Conan package reference '${conanPkgRef}', no transition from '${phase}', separator=${separator}, item=${item}, remainder=${remainder}, info=${JSON.stringify(info)}`,
        );
      return UNABLE_TO_PARSE_CONAN_PKG_REF;
    }

    const possibleTransitions = transitions[phase];
    if (!(separator in possibleTransitions)) {
      if (DEBUG_MODE)
        console.warn(
          `Could not parse Conan package reference '${conanPkgRef}', transition '${separator}' not allowed from '${phase}', item=${item}, remainder=${remainder}, info=${JSON.stringify(info)}`,
        );
      return UNABLE_TO_PARSE_CONAN_PKG_REF;
    }

    phase = possibleTransitions[separator];
  }

  if (phase !== "end") {
    if (DEBUG_MODE)
      console.warn(
        `Could not parse Conan package reference '${conanPkgRef}', end of input string reached unexpectedly in phase '${phase}', info=${JSON.stringify(info)}.`,
      );
    return UNABLE_TO_PARSE_CONAN_PKG_REF;
  }

  if (!info.version) info.version = "latest";

  const purl = createConanPurlString(
    info.name,
    info.version,
    info.user,
    info.channel,
    info.recipe_revision,
    info.package_revision,
  );

  return [purl, info.name, info.version];
}
