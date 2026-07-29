import { URL } from "node:url";

import { PackageURL } from "packageurl-js";

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
      namespace = "local";
    }
  } else {
    if (DEBUG_MODE) {
      console.warn("unsupported repo url for swift type");
    }
    return undefined;
  }

  return new PackageURL(type, namespace, name, version, null, null);
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

  return new PackageURL(
    "conan",
    "",
    name,
    version,
    Object.keys(qualifiers).length ? qualifiers : null,
    null,
  ).toString();
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
