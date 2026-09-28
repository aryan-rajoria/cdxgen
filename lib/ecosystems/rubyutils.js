import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";

import { build, Purl } from "@cdxgen/cdx-purl";

// utils.js does not import rubyutils.js, so importing from it here is safe and
// does not introduce a cyclic dependency.
import {
  cdxgenAgent,
  DEBUG_MODE,
  readEnvironmentVariable,
} from "../core/activity.js";
import { shouldFetchLicense } from "../core/env.js";
import { getAllFiles, safeExistsSync, safeSpawnSync } from "../core/fs.js";
import { dirNameStr, isWin } from "../core/paths.js";
import { mergeDependencies } from "../inventory/depsUtils.js";
import {
  prefetchEnabled,
  prefetchedResponse,
  prefetchJson,
  recordPolicyDegradationFromError,
} from "../inventory/fetchBatch.js";

// FIXME. This has to get removed, once we improve the module detection one-liner.
// If you're a Rubyist, please help us improve this code.
const RUBY_KNOWN_MODULES = JSON.parse(
  readFileSync(join(dirNameStr, "data", "ruby-known-modules.json"), "utf-8"),
);

// `Gem::Platform#to_s` is `[cpu, os, os_version].compact.join("-")`, which
// Bundler writes as a `-` separated suffix to the version in the `specs:`
// section of Gemfile.lock. Examples of the suffix: `x86_64-linux`,
// `x86_64-linux-musl`, `aarch64-linux-gnu`, `arm64-darwin`, `x64-mingw-ucrt`,
// `x86-mswin32-60`, `universal-darwin-20`, `java`, `universal-java-11`.
// The cpu is an open token, so there is no exhaustive list to match against.
// The os component, however, comes from a fixed table in `Gem::Platform`.
const RUBY_PLATFORM_OSES = new Set([
  "aix",
  "cygwin",
  "dalvik",
  "darwin",
  "dotnet",
  "freebsd",
  "java",
  "jruby",
  "linux",
  "macruby",
  "mingw",
  "mingw32",
  "mswin32",
  "mswin64",
  "netbsdelf",
  "openbsd",
  "ruby",
  "solaris",
  "wasi",
]);

/**
 * Is the given string a `Gem::Platform` such as `x86_64-linux` or `java`?
 * The cpu component is an open token in RubyGems, so we validate by looking
 * for a known os name in any position.
 *
 * Note that `truffleruby` is deliberately absent from the os table.
 * `Gem::Platform.new("truffleruby").to_s` is `"unknown"`: TruffleRuby reports a
 * conventional local platform such as `x86_64-linux`, and reuses plain ruby
 * gems via an allowlist rather than through a platform of its own. So
 * `truffleruby` never appears as a platform suffix.
 *
 * @param {string} value Candidate platform string
 * @returns {boolean} true if the value looks like a gem platform
 */
export function isRubyPlatform(value) {
  if (!value?.length) {
    return false;
  }
  return value.split("-").some((segment) => RUBY_PLATFORM_OSES.has(segment));
}

/**
 * Normalize a gem platform the way `Gem::Platform` does.
 *
 * The only alias that matters for a lockfile or a gemspec is `jruby`, which
 * `Gem::Platform` maps to the os `java`, so `Gem::Platform.new("jruby").to_s`
 * is `"java"`. Normalizing keeps a JRuby gem from being reported under two
 * different purls depending on which spelling the source used.
 *
 * @param {string | undefined} platform Platform to normalize
 * @returns {string | undefined} Normalized platform
 */
export function normalizeGemPlatform(platform) {
  if (!platform?.length) {
    return platform;
  }
  return platform === "jruby" ? "java" : platform;
}

/**
 * Split a gem version string into its version and optional native platform.
 *
 * Bundler writes native gems as `name (version-platform)`, for example
 * `google-protobuf (3.25.1-x86_64-linux)`. This mirrors how Bundler itself
 * parses the lockfile: its `NAME_VERSION` regex captures the version as
 * `([^-]*)` followed by an optional `-(.*)` platform, i.e. it splits at the
 * *first* hyphen. That is unambiguous because `Gem::Version` rewrites any `-`
 * to `.pre.` on construction, so a canonical version string, which is what
 * Bundler writes to the lockfile, never contains a hyphen.
 *
 * @param {string | undefined} version Version that may include a platform suffix
 * @returns {{version: (string | undefined), platform: (string | undefined)}} Version and platform
 */
export function splitRubyVersionPlatform(version) {
  if (!version?.length) {
    return { version, platform: undefined };
  }
  const hyphenIndex = version.indexOf("-");
  // A leading hyphen, or nothing after it, is not a platform suffix
  if (hyphenIndex < 1 || hyphenIndex === version.length - 1) {
    return { version, platform: undefined };
  }
  return {
    version: version.slice(0, hyphenIndex),
    platform: version.slice(hyphenIndex + 1),
  };
}

/**
 * Simplify the ruby version by removing platform suffixes
 *
 * @param {string} version Version to simplify
 * @returns {string} Simplified version
 */
export function simplifyRubyVersion(version) {
  return splitRubyVersionPlatform(version).version;
}

/**
 * Construct a gem purl. Per the purl specification, the native platform is
 * represented with the `platform` qualifier and not as part of the version.
 * `ruby` is the implied default platform, so it is left out.
 *
 * @param {string} name Gem name
 * @param {string | undefined} version Gem version without any platform suffix
 * @param {string | undefined} platform Gem platform such as `x86_64-linux`
 * @returns {string} purl string
 */
export function toGemPurl(name, version, platform) {
  const gemPlatform = normalizeGemPlatform(platform);
  return build({
    type: "gem",
    namespace: "" || null,
    name: name,
    version: version || null,
    qualifiers:
      gemPlatform && gemPlatform !== "ruby"
        ? { platform: gemPlatform }
        : null || null,
  });
}

// Well known `Gem::Specification#metadata` keys, mapped to the CycloneDX
// external reference types. See
// https://guides.rubygems.org/specification-reference/#metadata
const GEM_METADATA_REFERENCE_TYPES = {
  bug_tracker_uri: "issue-tracker",
  changelog_uri: "release-notes",
  documentation_uri: "documentation",
  funding_uri: "other",
  homepage_uri: "website",
  mailing_list_uri: "mailing-list",
  source_code_uri: "vcs",
  wiki_uri: "documentation",
};

/**
 * Parse a ruby array literal as found in a gemspec, such as
 * `["ext/nokogiri/extconf.rb".freeze]` or `%w[a b]`.
 *
 * @param {string} value Ruby array literal
 * @returns {Array<string>} Parsed entries
 */
function parseGemspecArray(value) {
  if (!value) {
    return [];
  }
  return value
    .replaceAll(".freeze", "")
    .replace(/^%w?[[(]/, "")
    .replace(/^\[/, "")
    .replace(/[\])].*$/, "")
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter((s) => s.length);
}

/**
 * Parse a `Gem::Requirement` literal as found in a gemspec, such as
 * `Gem::Requirement.new([">= 2.2".freeze, "< 4.0".freeze])` or
 * `Gem::Requirement.new(">= 3.0".freeze)`.
 *
 * @param {string} value Requirement literal
 * @returns {string | undefined} Comma separated requirement string
 */
function parseGemRequirement(value) {
  if (!value) {
    return undefined;
  }
  const inner = value.includes("Gem::Requirement.new")
    ? value.replace(/.*Gem::Requirement\.new\(/, "").replace(/\).*$/, "")
    : value;
  const parts = inner
    .replaceAll(".freeze", "")
    .replace(/^\[/, "")
    .replace(/].*$/, "")
    .split(",")
    .map((s) => s.trim().replace(/["';]/g, ""))
    .filter((s) => s.length && s !== "nil");
  return parts.length ? parts.join(", ") : undefined;
}

// Closing delimiters of the bracketing Ruby percent literals, such as `%q{}`.
// Any other punctuation closes itself, as in `%q|...|`.
const RUBY_CLOSING_DELIMITERS = { "(": ")", "[": "]", "{": "}", "<": ">" };

// Longest heredoc or multi-line array a gemspec assignment is followed across
const GEMSPEC_MAX_CONTINUATION_LINES = 200;

/**
 * Tells whether the source that follows a literal ends the statement, so the
 * literal is the whole value: nothing, a `.freeze`, a comment, or an `if` /
 * `unless` modifier. Anything else, such as `+ suffix`, makes the value an
 * expression that cannot be read statically.
 *
 * @param {string} rest Source after the literal
 * @returns {boolean} true when the literal is the complete value
 */
function endsRubyStatement(rest) {
  let tail = rest.trim();
  while (tail.startsWith(".freeze")) {
    tail = tail.slice(".freeze".length).trim();
  }
  return (
    !tail.length ||
    tail.startsWith("#") ||
    tail.startsWith(";") ||
    tail.startsWith("if ") ||
    tail.startsWith("unless ")
  );
}

/**
 * Read the Ruby string literal at the start of `text`: a double or single
 * quoted string, or a `%q`/`%Q`/`%` percent literal. Escaped delimiters and
 * backslashes are unescaped; every other escape sequence is kept as written.
 * An interpolation such as `#{spec.name}` is kept verbatim, including any
 * quotes inside it.
 *
 * @param {string} text Source starting with the literal
 * @returns {{value: string, interpolated: boolean, complete: boolean, rest: string} | undefined}
 *   The literal's value, whether it holds an interpolation, whether it was
 *   closed within `text`, and the source after it. Undefined when `text` does
 *   not start with a string literal.
 */
export function readRubyStringLiteral(text) {
  if (!text?.length) {
    return undefined;
  }
  let opener;
  let interpolates;
  let start;
  if (text[0] === '"' || text[0] === "'") {
    opener = text[0];
    interpolates = opener === '"';
    start = 1;
  } else if (text[0] === "%") {
    const kind = text[1] === "q" || text[1] === "Q" ? text[1] : "";
    opener = text[1 + kind.length];
    // `%w` and `%i` arrays, or a `%` that is the modulo operator
    if (!opener || /[\w\s]/.test(opener)) {
      return undefined;
    }
    interpolates = kind !== "q";
    start = 2 + kind.length;
  } else {
    return undefined;
  }
  const closer = RUBY_CLOSING_DELIMITERS[opener] || opener;
  let depth = 0;
  let value = "";
  let interpolated = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      value += [opener, closer, "\\"].includes(next) ? next : `${ch}${next}`;
      i++;
      continue;
    }
    if (interpolates && ch === "#" && text[i + 1] === "{") {
      const end = text.indexOf("}", i + 2);
      if (end < 0) {
        value += text.slice(i);
        break;
      }
      value += text.slice(i, end + 1);
      interpolated = true;
      i = end;
      continue;
    }
    if (ch === closer && depth === 0) {
      return {
        value,
        interpolated,
        complete: true,
        rest: text.slice(i + 1),
      };
    }
    if (closer !== opener) {
      if (ch === opener) {
        depth++;
      } else if (ch === closer) {
        depth--;
      }
    }
    value += ch;
  }
  return { value, interpolated, complete: false, rest: "" };
}

/**
 * Read a Ruby list of strings as written for `authors`, `email`, or `licenses`:
 * an array of string literals, a `%w[]` word array, or a single string. Array
 * elements that are not string literals, such as constants, are skipped.
 *
 * @param {string} text Source of the value
 * @returns {{values: string[], complete: boolean} | undefined} The strings,
 *   and whether the array was closed within `text`. Undefined when the value
 *   is an expression that cannot be read statically.
 */
export function readRubyStringList(text) {
  const source = text?.trim();
  if (!source?.length) {
    return undefined;
  }
  if (/^%[wW][^\w\s]/.test(source)) {
    const closer = RUBY_CLOSING_DELIMITERS[source[2]] || source[2];
    const end = source.indexOf(closer, 3);
    const words = source.slice(3, end < 0 ? undefined : end);
    return {
      values: words.split(" ").filter((word) => word.length),
      complete: end >= 0,
    };
  }
  if (source.startsWith("[")) {
    const values = [];
    let rest = source.slice(1).trim();
    while (rest.length) {
      if (rest.startsWith("]")) {
        return { values, complete: true };
      }
      const literal = readRubyStringLiteral(rest);
      if (literal) {
        if (!literal.complete) {
          return { values, complete: false };
        }
        if (!literal.interpolated && literal.value.trim().length) {
          values.push(literal.value.trim());
        }
        rest = literal.rest.trim();
        while (rest.startsWith(".freeze")) {
          rest = rest.slice(".freeze".length).trim();
        }
      } else {
        // Skip an element that is not a string literal
        const comma = rest.indexOf(",");
        const close = rest.indexOf("]");
        if (close >= 0 && (comma < 0 || close < comma)) {
          return { values, complete: true };
        }
        if (comma < 0) {
          return { values, complete: false };
        }
        rest = rest.slice(comma);
      }
      if (rest.startsWith(",")) {
        rest = rest.slice(1).trim();
      }
    }
    return { values, complete: false };
  }
  const literal = readRubyStringLiteral(source);
  if (
    !literal?.complete ||
    literal.interpolated ||
    !endsRubyStatement(literal.rest)
  ) {
    return undefined;
  }
  return {
    values: literal.value
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length),
    complete: true,
  };
}

/**
 * Find the value assigned to a gemspec attribute on a line, such as the
 * `"1.0".freeze` of `s.version = "1.0".freeze`.
 *
 * @param {string} line Whitespace-normalized gemspec line
 * @param {string} attribute Attribute name, such as `version`
 * @returns {string | undefined} Source of the assigned value
 */
function readGemspecAssignment(line, attribute) {
  const target = `.${attribute}`;
  let idx = line.indexOf(target);
  while (idx >= 0) {
    const after = line.slice(idx + target.length).trimStart();
    // `.version =` but neither `.versions`, `.version ==`, nor `.version =>`
    if (
      after.startsWith("=") &&
      !["=", "~", ">"].includes(after[1]) &&
      !/\w/.test(line[idx + target.length] || "")
    ) {
      return after.slice(1).trim();
    }
    idx = line.indexOf(target, idx + target.length);
  }
  return undefined;
}

/**
 * Read the heredoc terminator of a value such as `<<~DESC` or `<<-'EOS'.strip`.
 *
 * @param {string} value Source of an assigned value
 * @returns {string | undefined} The terminator, or undefined for any other value
 */
function readHeredocTerminator(value) {
  if (!value.startsWith("<<")) {
    return undefined;
  }
  let rest = value.slice(2);
  if (rest[0] === "~" || rest[0] === "-") {
    rest = rest.slice(1);
  }
  const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
  rest = rest.slice(quote.length);
  let terminator = "";
  while (
    terminator.length < rest.length &&
    /\w/.test(rest[terminator.length])
  ) {
    terminator += rest[terminator.length];
  }
  return /^[A-Za-z_]\w*$/.test(terminator) ? terminator : undefined;
}

/**
 * Change in the nesting depth of hash braces on a line. Braces inside string
 * literals, including the ones of a `#{...}` interpolation, are not counted.
 *
 * @param {string} line Gemspec line
 * @returns {number} Opened minus closed braces
 */
function hashBraceDelta(line) {
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "#" && line[i + 1] !== "{") {
      // A comment
      break;
    }
    if (ch === '"' || ch === "'") {
      const literal = readRubyStringLiteral(line.slice(i));
      if (!literal?.complete) {
        break;
      }
      i = line.length - literal.rest.length - 1;
      continue;
    }
    if (ch === "{") {
      delta++;
    } else if (ch === "}") {
      delta--;
    }
  }
  return delta;
}

/**
 * Expand the interpolations of a gemspec string that refer to the gem's own
 * fields, such as `#{spec.name}` and `#{spec.version}`. Gems routinely build
 * their changelog and documentation URIs this way.
 *
 * @param {string} value String value with interpolations
 * @param {string | undefined} specVar Block variable of `Gem::Specification.new`
 * @param {Object<string, string | undefined>} fields Known gem fields by name
 * @returns {string} The value with every resolvable interpolation expanded
 */
function expandGemspecInterpolation(value, specVar, fields) {
  return value.replace(/#\{([^{}]*)\}/g, (token, expression) => {
    const [receiver, field, ...extra] = expression.trim().split(".");
    if (
      extra.length ||
      !(specVar ? receiver === specVar : /^\w+$/.test(receiver)) ||
      !Object.hasOwn(fields, field) ||
      !fields[field]
    ) {
      return token;
    }
    return fields[field];
  });
}

/**
 * Tells whether a string is usable as a RubyGems version.
 *
 * @param {string | undefined} version Candidate version
 * @returns {boolean} true for values such as `0.8.1` or `2.0.0.rc1`
 */
function looksLikeGemVersion(version) {
  return !!version && /^\d[\w.+-]*$/.test(version);
}

/**
 * Collect the local file a gemspec `require` line loads, when the file looks
 * like the one defining the gem version, such as `lib/<gem>/version.rb`.
 *
 * Supported forms are `require "<gem>/version"`, `require_relative
 * "lib/<gem>/version"`, and `require File.expand_path("../lib/<gem>/version",
 * __FILE__)` or its `__dir__` variant.
 *
 * @param {string} line Whitespace-normalized gemspec line
 * @param {string} gemspecFile Path of the gemspec
 * @returns {string[]} Candidate file paths, most likely first
 */
function gemspecVersionRequireCandidates(line, gemspecFile) {
  const keyword = ["require_relative", "require"].find(
    (akeyword) =>
      line.startsWith(`${akeyword} `) || line.startsWith(`${akeyword}(`),
  );
  if (!keyword) {
    return [];
  }
  let argument = line.slice(keyword.length).trim();
  if (argument.startsWith("(")) {
    argument = argument.slice(1).trim();
  }
  const baseDir = dirname(gemspecFile);
  let requirePath;
  let candidates;
  const direct = readRubyStringLiteral(argument);
  if (direct?.complete && !direct.interpolated) {
    requirePath = direct.value;
    candidates =
      keyword === "require_relative"
        ? [join(baseDir, requirePath)]
        : [join(baseDir, "lib", requirePath), join(baseDir, requirePath)];
  } else if (argument.startsWith("File.expand_path(")) {
    const expanded = readRubyStringLiteral(
      argument.slice("File.expand_path(".length).trim(),
    );
    if (!expanded?.complete || expanded.interpolated) {
      return [];
    }
    requirePath = expanded.value;
    const anchor = expanded.rest.replace(/^\s*,\s*/, "");
    // `File.expand_path(path, __FILE__)` resolves against the gemspec itself,
    // so its leading `..` steps out of the file name, not the directory
    if (anchor.startsWith("__FILE__")) {
      candidates = [join(gemspecFile, requirePath)];
    } else if (
      anchor.startsWith("__dir__") ||
      anchor.startsWith("File.dirname(__FILE__)")
    ) {
      candidates = [join(baseDir, requirePath)];
    } else {
      return [];
    }
  } else {
    return [];
  }
  if (!/version$/i.test(basename(requirePath).replace(/\.rb$/, ""))) {
    return [];
  }
  return candidates.map((candidate) =>
    candidate.endsWith(".rb") ? candidate : `${candidate}.rb`,
  );
}

/**
 * Resolve a version constant such as `OpenTelemetry::Instrumentation::VERSION`
 * from the version file the gemspec requires. Only files inside the gemspec
 * directory are read, and only a plain string assignment to the constant is
 * accepted.
 *
 * @param {string} gemspecFile Path of the gemspec
 * @param {string[]} candidates Version files the gemspec requires
 * @param {string} constantName Last segment of the constant, such as `VERSION`
 * @returns {string | undefined} Resolved version
 */
function resolveGemVersionConstant(gemspecFile, candidates, constantName) {
  const root = resolve(dirname(gemspecFile));
  for (const candidate of candidates) {
    const relativePath = relative(root, resolve(candidate));
    if (
      !relativePath.length ||
      relativePath.split(sep)[0] === ".." ||
      isAbsolute(relativePath) ||
      !safeExistsSync(candidate)
    ) {
      continue;
    }
    let content;
    try {
      content = readFileSync(candidate, { encoding: "utf-8" });
    } catch (_err) {
      continue;
    }
    for (const aline of content.split("\n")) {
      const trimmed = aline.trim();
      if (!trimmed.startsWith(constantName)) {
        continue;
      }
      const after = trimmed.slice(constantName.length).trimStart();
      if (!after.startsWith("=") || after[1] === "=") {
        continue;
      }
      const literal = readRubyStringLiteral(after.slice(1).trim());
      if (
        literal?.complete &&
        !literal.interpolated &&
        endsRubyStatement(literal.rest) &&
        looksLikeGemVersion(literal.value)
      ) {
        return literal.value;
      }
    }
  }
  return undefined;
}

// Digest algorithms Bundler may record in the CHECKSUMS section, mapped to the
// CycloneDX hash algorithm names.
const GEM_CHECKSUM_ALGOS = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha512: "SHA-512",
};

/**
 * Parse a single line from the `CHECKSUMS` section of a Gemfile.lock. Bundler
 * 2.5 onwards writes `name (version[-platform]) algo=digest[,algo=digest]`,
 * where the `name (version[-platform])` token is identical to the one used in
 * the `specs:` section. The digest is lowercase hex. An entry may carry no
 * checksum at all when Bundler could not obtain one.
 *
 * @param {string} line Trimmed line from the CHECKSUMS section
 * @returns {{lockName: string, hashes: Array<object>} | undefined} Lock name and CycloneDX hashes
 */
export function parseGemChecksumLine(line) {
  const match = line?.match(/^(\S+) \(([^)]+)\)(?:\s+(\S+))?$/);
  if (!match) {
    return undefined;
  }
  const [, name, version, checksums] = match;
  const hashes = [];
  for (const achecksum of (checksums || "").split(",")) {
    const [algo, digest] = achecksum.split("=");
    const alg = GEM_CHECKSUM_ALGOS[algo?.toLowerCase()];
    // Bundler always writes hex, but guard against anything else
    if (alg && /^[0-9a-f]+$/.test(digest || "")) {
      hashes.push({ alg, content: digest });
    }
  }
  if (!hashes.length) {
    return undefined;
  }
  return { lockName: `${name} (${version})`, hashes };
}

/**
 * Default location of Bundler's compact index cache. This is the protocol
 * Bundler itself uses to resolve, so any gem the developer has ever installed
 * has a cached `info/<gem>` file here.
 *
 * @returns {string} Path to the compact index cache directory
 */
export function getCompactIndexCacheDir() {
  return (
    readEnvironmentVariable("CDXGEN_COMPACT_INDEX_CACHE_DIR") ||
    join(
      readEnvironmentVariable("BUNDLE_USER_CACHE") ||
        join(homedir(), ".bundle", "cache"),
      "compact_index",
    )
  );
}

/**
 * Parse the contents of a Bundler compact index `info/<gem>` file. Each line
 * describes one release:
 *
 *   `VERSION[-PLATFORM] <deps>|checksum:<sha256>,ruby:<req>,rubygems:<req>,...`
 *
 * This is the cheapest source of gem metadata available: a single local file
 * carries the sha256, the runtime dependencies and the required ruby and
 * rubygems versions for every release of a gem.
 *
 * @param {string} infoData Contents of an info file
 * @returns {object} Map of `version[-platform]` to release metadata
 */
export function parseCompactIndexInfo(infoData) {
  const releases = {};
  if (!infoData) {
    return releases;
  }
  for (const aline of infoData.split("\n")) {
    const line = aline.trim();
    if (!line.length || line === "---") {
      continue;
    }
    const pipeIndex = line.lastIndexOf("|");
    const spec = (pipeIndex > -1 ? line.slice(0, pipeIndex) : line).trim();
    const fullVersion = spec.split(" ")[0];
    if (!fullVersion?.length) {
      continue;
    }
    const release = {};
    if (pipeIndex > -1) {
      for (const requirement of line.slice(pipeIndex + 1).split(",")) {
        const separator = requirement.indexOf(":");
        if (separator < 1) {
          continue;
        }
        release[requirement.slice(0, separator)] = requirement
          .slice(separator + 1)
          .trim();
      }
    }
    releases[fullVersion] = release;
  }
  return releases;
}

/**
 * Parse a `.bundle/config` file. Bundler writes a small YAML document of
 * `BUNDLE_<SETTING>: "value"` pairs. Two settings matter for an SBOM:
 * `BUNDLE_PATH`, which tells us where the gems actually live, and
 * `BUNDLE_WITHOUT`, which tells us that some groups were never installed and
 * that the SBOM is therefore incomplete by construction.
 *
 * @param {string} configFile Path to a .bundle/config file
 * @returns {object} Map of setting name to value
 */
export function parseBundleConfig(configFile) {
  const settings = {};
  if (!configFile || !safeExistsSync(configFile)) {
    return settings;
  }
  let configData;
  try {
    configData = readFileSync(configFile, { encoding: "utf-8" });
  } catch (_err) {
    return settings;
  }
  for (const aline of configData.split("\n")) {
    const line = aline.trim();
    if (!line.length || line.startsWith("#") || line.startsWith("---")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key.startsWith("BUNDLE_")) {
      continue;
    }
    settings[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return settings;
}

/**
 * Enrich gem components from the caches present on the machine, without making
 * any network calls. Two sources are consulted:
 *
 * 1. Bundler's compact index cache, for the sha256 and the required ruby and
 *    rubygems versions of the exact release, including native variants.
 * 2. The installed gemspecs under `GEM_HOME/specifications`, for licenses,
 *    description, project URIs and the native extension list.
 *
 * Because this only reads files it also works in dry-run mode, where the
 * registry lookups performed by `getRubyGemsMetadata` are blocked.
 *
 * @param {Array} pkgList List of gem components to enrich in place
 * @param {object} options Options
 * @param {string} options.gemHome GEM_HOME to read installed gemspecs from
 * @param {string} options.compactIndexCacheDir Bundler compact index cache directory
 * @returns {Promise<Array>} The enriched package list
 */
export async function enrichGemsFromLocalCache(pkgList, options = {}) {
  if (!pkgList?.length) {
    return pkgList;
  }
  const compactIndexCacheDir =
    options.compactIndexCacheDir || getCompactIndexCacheDir();
  const gemHome = options.gemHome;
  // A gem may be cached under several remotes. The cache lays out one
  // `<host>.<port>.<hash>/info/<gem>` directory per remote, so a shallow listing
  // of the remotes is enough to build the candidate paths for a given gem. That
  // is far cheaper than walking every cached info file.
  let infoDirs = [];
  if (safeExistsSync(compactIndexCacheDir)) {
    try {
      infoDirs = readdirSync(compactIndexCacheDir, { withFileTypes: true })
        .filter((anentry) => anentry.isDirectory())
        .map((anentry) => join(compactIndexCacheDir, anentry.name, "info"))
        .filter((adir) => safeExistsSync(adir));
    } catch (_err) {
      // pass
    }
  }
  // Installed gemspecs are named `<name>-<version>[-<platform>].gemspec`
  const gemspecsByFullName = {};
  if (gemHome && safeExistsSync(gemHome)) {
    for (const gemspecFile of getAllFiles(
      gemHome,
      "**/specifications/**/*.gemspec",
      { noIgnore: true },
    )) {
      gemspecsByFullName[basename(gemspecFile).replace(".gemspec", "")] =
        gemspecFile;
    }
  }
  if (!infoDirs.length && !Object.keys(gemspecsByFullName).length) {
    return pkgList;
  }
  const releasesCache = {};
  for (const p of pkgList) {
    if (!p.name || !p.version) {
      continue;
    }
    const platform = p.purl
      ? Purl.parse(p.purl).qualifiers?.platform
      : undefined;
    const fullVersion = platform ? `${p.version}-${platform}` : p.version;
    const fullName = `${p.name}-${fullVersion}`;
    // 1. Compact index cache
    if (!releasesCache[p.name]) {
      releasesCache[p.name] = {};
      for (const infoDir of infoDirs) {
        const infoFile = join(infoDir, p.name);
        if (!safeExistsSync(infoFile)) {
          continue;
        }
        try {
          Object.assign(
            releasesCache[p.name],
            parseCompactIndexInfo(
              readFileSync(infoFile, { encoding: "utf-8" }),
            ),
          );
        } catch (_err) {
          // pass
        }
      }
    }
    const release = releasesCache[p.name]?.[fullVersion];
    if (release) {
      if (release.checksum && !p.hashes?.length && !p._integrity) {
        p._integrity = `sha256-${release.checksum}`;
      }
      p.properties = p.properties || [];
      for (const [key, propName] of [
        ["ruby", "cdx:gem:rubyVersionSpecifiers"],
        ["rubygems", "cdx:gem:rubygemsVersionSpecifiers"],
      ]) {
        // Compact index joins alternative requirements with `&`
        const value = release[key]?.replaceAll("&", ", ");
        if (
          value?.length &&
          value !== ">= 0" &&
          !p.properties.some((prop) => prop.name === propName)
        ) {
          p.properties.push({ name: propName, value });
        }
      }
    }
    // 2. Installed gemspec
    const gemspecFile = gemspecsByFullName[fullName];
    if (gemspecFile) {
      let installedPkgs = [];
      try {
        installedPkgs = await parseGemspecData(
          readFileSync(gemspecFile, { encoding: "utf-8" }),
          gemspecFile,
        );
      } catch (_err) {
        // pass
      }
      const installed = installedPkgs?.[0];
      if (installed) {
        if (!p.description?.length && installed.description?.length) {
          p.description = installed.description;
        }
        if (!p.license && installed.licenses?.length) {
          // parseGemspecData returns the CycloneDX license shape, but the
          // license of an unfinished component is a plain list of names
          const licenseNames = installed.licenses
            .map((alicense) => alicense?.license?.name || alicense?.license?.id)
            .filter((aname) => aname?.length);
          if (licenseNames.length) {
            p.license = licenseNames;
          }
        }
        if (installed.externalReferences?.length) {
          p.externalReferences = p.externalReferences || [];
          for (const aref of installed.externalReferences) {
            if (
              !p.externalReferences.some(
                (existing) =>
                  existing.type === aref.type && existing.url === aref.url,
              )
            ) {
              p.externalReferences.push(aref);
            }
          }
        }
        p.properties = p.properties || [];
        for (const prop of installed.properties || []) {
          if (
            prop.name.startsWith("cdx:gem:") &&
            !p.properties.some((existing) => existing.name === prop.name)
          ) {
            p.properties.push(prop);
          }
        }
      }
    }
  }
  return pkgList;
}

/**
 * Apply a RubyGems API metadata payload to a component. Shared by the single
 * version lookup and the bulk versions lookup.
 *
 * @param {object} p Component to enrich in place
 * @param {object} body Metadata payload for one gem version
 */
function applyGemMetadata(p, body) {
  if (!body) {
    return;
  }
  p.properties = p.properties || [];
  const hasProperty = (name) => p.properties.some((prop) => prop.name === name);
  const addProperty = (name, value) => {
    if (value !== undefined && value !== null && !hasProperty(name)) {
      p.properties.push({ name, value: `${value}` });
    }
  };
  p.description = body.description || body.summary || "";
  if (body.licenses) {
    p.license = body.licenses;
  }
  if (body.metadata) {
    if (body.metadata.source_code_uri) {
      p.repository = { url: body.metadata.source_code_uri };
      if (
        body.homepage_uri &&
        body.homepage_uri !== body.metadata.source_code_uri
      ) {
        p.homepage = { url: body.homepage_uri };
      }
    }
    if (body.metadata.bug_tracker_uri) {
      p.bugs = { url: body.metadata.bug_tracker_uri };
    }
    // Whether the gem requires MFA to publish is a supply chain signal
    if (body.metadata.rubygems_mfa_required) {
      addProperty("cdx:gem:mfaRequired", body.metadata.rubygems_mfa_required);
    }
  }
  // The well known project URIs are reported at the top level by the v1 gems
  // and v2 versions endpoints, and inside `metadata` by the versions listing.
  p.externalReferences = p.externalReferences || [];
  for (const [key, refType] of Object.entries(GEM_METADATA_REFERENCE_TYPES)) {
    const url = body[key] || body.metadata?.[key];
    if (
      url?.length &&
      !p.externalReferences.some(
        (aref) => aref.type === refType && aref.url === url,
      )
    ) {
      p.externalReferences.push({ type: refType, url, comment: key });
    }
  }
  // The .gem tarball is the distribution artifact for the component
  if (body.gem_uri?.length) {
    if (
      !p.externalReferences.some(
        (aref) => aref.type === "distribution" && aref.url === body.gem_uri,
      )
    ) {
      p.externalReferences.push({ type: "distribution", url: body.gem_uri });
    }
    addProperty("cdx:gem:gemUri", body.gem_uri);
  }
  if (!p.externalReferences.length) {
    p.externalReferences = undefined;
  }
  if (body.sha) {
    p._integrity = `sha256-${body.sha}`;
  }
  if (body.authors) {
    p.author = body.authors;
  }
  // `ruby_version` is the `required_ruby_version` requirement. Note that the
  // sibling `rubygems_version` field is the version of RubyGems that packaged
  // the gem, not a requirement, so it is deliberately not recorded as one.
  if (body.ruby_version?.length && body.ruby_version !== ">= 0") {
    addProperty("cdx:gem:rubyVersionSpecifiers", body.ruby_version);
  }
  if (body.yanked) {
    addProperty("cdx:gem:yanked", body.yanked);
  }
  if (body.prerelease) {
    addProperty("cdx:gem:prerelease", body.prerelease);
  }
  // Use the latest version if none specified
  if (!p.version) {
    p.version = body.number;
  }
}

/**
 * The platform of a gem component, taken from the purl qualifier. `ruby` is the
 * implied default that the RubyGems API reports for a pure ruby gem.
 *
 * @param {object} p Component
 * @returns {string} Platform such as `x86_64-linux`, or `ruby`
 */
function gemComponentPlatform(p) {
  if (!p?.purl) {
    return "ruby";
  }
  try {
    return Purl.parse(p.purl).qualifiers?.platform || "ruby";
  } catch (_err) {
    return "ruby";
  }
}

/**
 * The URL for a single gem's direct lookup, or `undefined` when the component
 * lacks the minimum fields. Shared by the batch prefetch and the per-package
 * fallback so the two cannot construct different URLs.
 *
 * @param {object} p Component with `name`, optional `version`, and purl.
 * @param {string} v2Url Base url of the v2 rubygems endpoint.
 * @param {string} v1Url Base url of the v1 gems endpoint.
 * @returns {string|undefined}
 */
function gemDirectUrl(p, v2Url, v1Url) {
  if (!p?.name) {
    return undefined;
  }
  const platform = gemComponentPlatform(p);
  const platformQuery =
    platform && platform !== "ruby"
      ? `?platform=${encodeURIComponent(platform)}`
      : "";
  return p.version
    ? `${v2Url}${p.name}/versions/${simplifyRubyVersion(p.version)}.json${platformQuery}`
    : `${v1Url}${p.name}.json`;
}

/**
 * Method to query rubygems api for gems details
 *
 * A gem that ships several native builds appears in the BOM once per platform.
 * Rather than making one request per variant, the versions listing endpoint is
 * used to fetch every version and platform of such a gem in a single request.
 *
 * @param {Array} pkgList List of packages with metadata
 */
export async function getRubyGemsMetadata(pkgList) {
  const RUBYGEMS_V2_URL =
    readEnvironmentVariable("RUBYGEMS_V2_URL") ||
    "https://rubygems.org/api/v2/rubygems/";
  const RUBYGEMS_V1_URL =
    readEnvironmentVariable("RUBYGEMS_V1_URL") ||
    "https://rubygems.org/api/v1/gems/";
  const RUBYGEMS_V1_VERSIONS_URL =
    readEnvironmentVariable("RUBYGEMS_V1_VERSIONS_URL") ||
    "https://rubygems.org/api/v1/versions/";
  const rdepList = [];
  const apiOptions = {
    responseType: "json",
  };
  if (readEnvironmentVariable("GEM_HOST_API_KEY")) {
    apiOptions.headers = {
      Authorization: readEnvironmentVariable("GEM_HOST_API_KEY"),
    };
  }
  // Group the components by gem name so that the multi platform gems can be
  // resolved with a single request each.
  const pkgsByName = {};
  for (const p of pkgList) {
    if (!pkgsByName[p.name]) {
      pkgsByName[p.name] = [];
    }
    pkgsByName[p.name].push(p);
  }

  // Collect every URL the loop below is going to need — the per-name versions
  // listing for multi-variant gems, and the per-package direct lookup for
  // everything else — and hand them to one batched round. The derivation in
  // applyGemMetadata is unchanged; only where the body comes from differs.
  const batchRequests = [];
  if (prefetchEnabled()) {
    const seenUrls = new Set();
    const gemAuthRealm = readEnvironmentVariable("GEM_HOST_API_KEY")
      ? "gem-auth"
      : undefined;
    const addBatchUrl = (url) => {
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        batchRequests.push({
          url,
          authRealm: gemAuthRealm,
          headers: apiOptions.headers,
        });
      }
    };
    for (const [name, pkgs] of Object.entries(pkgsByName)) {
      const versionedPkgs = pkgs.filter((p) => p.version);
      if (versionedPkgs.length > 1) {
        addBatchUrl(`${RUBYGEMS_V1_VERSIONS_URL}${name}.json`);
      }
      for (const p of pkgs) {
        addBatchUrl(gemDirectUrl(p, RUBYGEMS_V2_URL, RUBYGEMS_V1_URL));
      }
    }
  }
  const prefetched = await prefetchJson(batchRequests);

  for (const [name, pkgs] of Object.entries(pkgsByName)) {
    // The versions listing only helps when there are several versioned
    // components to satisfy from the one response.
    const versionedPkgs = pkgs.filter((p) => p.version);
    if (versionedPkgs.length > 1) {
      try {
        const versionsUrl = `${RUBYGEMS_V1_VERSIONS_URL}${name}.json`;
        let versions;
        const prefetchedEntry = prefetched.get(versionsUrl);
        if (prefetchedEntry?.ok) {
          versions = prefetchedEntry.body;
        } else {
          if (DEBUG_MODE) {
            console.log(
              `Querying rubygems.org for all ${versionedPkgs.length} variants of ${name}`,
            );
          }
          const res =
            prefetchedResponse(prefetched, versionsUrl) ||
            (await cdxgenAgent.get(versionsUrl, apiOptions));
          versions = res.body;
        }
        if (Array.isArray(versions) && versions.length) {
          const remaining = [];
          for (const p of pkgs) {
            const platform = gemComponentPlatform(p);
            const match = versions.find(
              (aversion) =>
                aversion.number === p.version &&
                (aversion.platform || "ruby") === platform,
            );
            if (match) {
              applyGemMetadata(p, match);
              rdepList.push(p);
            } else {
              remaining.push(p);
            }
          }
          // Anything the listing did not cover falls through to a direct lookup
          for (const p of remaining) {
            await enrichGemFromVersionEndpoint(
              p,
              RUBYGEMS_V2_URL,
              RUBYGEMS_V1_URL,
              apiOptions,
              prefetched,
            );
            rdepList.push(p);
          }
          continue;
        }
      } catch (err) {
        recordPolicyDegradationFromError(err);
        if (DEBUG_MODE) {
          console.error(name, err);
        }
      }
    }
    for (const p of pkgs) {
      await enrichGemFromVersionEndpoint(
        p,
        RUBYGEMS_V2_URL,
        RUBYGEMS_V1_URL,
        apiOptions,
        prefetched,
      );
      rdepList.push(p);
    }
  }
  return rdepList;
}

/**
 * Look up a single gem version and enrich the component in place.
 *
 * @param {object} p Component to enrich
 * @param {string} v2Url Base url of the v2 rubygems endpoint
 * @param {string} v1Url Base url of the v1 gems endpoint
 * @param {object} apiOptions Request options
 * @param {Map} [prefetched] Results from a prior prefetchJson round.
 */
async function enrichGemFromVersionEndpoint(
  p,
  v2Url,
  v1Url,
  apiOptions,
  prefetched,
) {
  try {
    if (DEBUG_MODE) {
      console.log(`Querying rubygems.org for ${p.name}`);
    }
    const fullUrl = gemDirectUrl(p, v2Url, v1Url);
    if (!fullUrl) {
      return;
    }
    const res =
      prefetchedResponse(prefetched, fullUrl) ||
      (await cdxgenAgent.get(fullUrl, apiOptions));
    let body = res.body;
    if (body?.length) {
      body = body[0];
    }
    applyGemMetadata(p, body);
  } catch (err) {
    recordPolicyDegradationFromError(err);
    if (DEBUG_MODE) {
      console.error(p, err);
    }
  }
}

function _upperFirst(string) {
  return string.slice(0, 1).toUpperCase() + string.slice(1, string.length);
}

/**
 * Utility method to convert a gem package name to a CamelCased module name. Low accuracy.
 *
 * @param name Package name
 */
export function toGemModuleNames(name) {
  const modList = name.split("-").map((s) => {
    return s
      .split("_")
      .map((str) => {
        return _upperFirst(str.split("/").map(_upperFirst).join("/"));
      })
      .join("");
  });
  const moduleNames = [];
  let prefix = "";
  for (const amod of modList) {
    if (amod !== "Ruby") {
      moduleNames.push(`${prefix}${amod}`);
    }
    prefix = prefix?.length ? `${prefix}${amod}::` : `${amod}::`;
    // ruby-prof is RubyProf
    if (prefix === "Ruby::") {
      prefix = "Ruby";
    }
  }
  return moduleNames;
}

/**
 * Collect all namespaces for a given gem present at the given gemHome
 *
 * @param {String} rubyCommand Ruby command to use if bundle is not available
 * @param {String} bundleCommand Bundle command to use
 * @param {String} gemHome Value to use as GEM_HOME env variable
 * @param {String} gemName Name of the gem
 * @param {String} filePath File path to the directory containing the Gemfile or .bundle directory
 *
 * @returns {Array<string>} List of module names
 */
export function collectGemModuleNames(
  rubyCommand,
  bundleCommand,
  gemHome,
  gemName,
  filePath,
) {
  gemHome =
    gemHome ||
    readEnvironmentVariable("CDXGEN_GEM_HOME") ||
    readEnvironmentVariable("GEM_HOME");
  if (!gemHome) {
    console.log(
      "Set the environment variable CDXGEN_GEM_HOME or GEM_HOME to collect the gem module names.",
    );
    return [];
  }
  if (!gemName || gemName.startsWith("/") || gemName === ".") {
    return [];
  }
  gemName = gemName.replace(/["']/g, "");
  // Module names for some gems cannot be obtained with our one-liner
  // So we keep a hard-coded list of such problematic ones.
  if (RUBY_KNOWN_MODULES[gemName]) {
    return RUBY_KNOWN_MODULES[gemName];
  }
  const moduleNames = new Set();
  const commandToUse = bundleCommand || rubyCommand;
  let args = bundleCommand ? ["exec", "ruby"] : [];
  args = args.concat([
    "-e",
    `initial = ObjectSpace.each_object(Module).map { |m| m.respond_to?(:name) ? m.name : nil }.compact;
  require '${gemName}';
  begin
    afterwards = ObjectSpace.each_object(Module).map { |m| m.respond_to?(:name) ? m.name : nil }.compact;
    added = afterwards - initial;
    puts added.sort
  rescue NoMethodError => e
    puts ""
  end
  `,
  ]);
  const result = safeSpawnSync(commandToUse, args, {
    shell: isWin,
    timeout: 5000,
    cwd: filePath,
    env: {
      ...process.env,
      GEM_HOME: gemHome,
    },
  });
  if (result.error || result.status !== 0) {
    if (result?.stderr?.includes("Could not locate Gemfile or .bundle")) {
      console.log(
        `${filePath} must be a directory containing the Gemfile. This appears like a bug in cdxgen.`,
      );
      return [];
    }
    // Let's retry for simple mismatches
    if (gemName?.includes("-")) {
      return collectGemModuleNames(
        rubyCommand,
        bundleCommand,
        gemHome,
        gemName.replaceAll("-", "/"),
        filePath,
      );
    }
    // bundle can sometimes offer suggestions for simple mismatches. Let's try that.
    if (result?.stderr?.includes("Did you mean?")) {
      const altGemName = result.stderr
        .split("Did you mean? ")[1]
        .split("\n")[0]
        .trim();
      if (
        altGemName?.length &&
        !altGemName.startsWith("/") &&
        altGemName !== "." &&
        gemName.replace(/[-_/]/g, "").toLowerCase() ===
          altGemName.replace(/[-_/]/g, "").toLowerCase()
      ) {
        if (DEBUG_MODE) {
          console.log("Retrying", gemName, "with", altGemName);
        }
        return collectGemModuleNames(
          rubyCommand,
          bundleCommand,
          gemHome,
          altGemName,
          filePath,
        );
      }
      if (DEBUG_MODE) {
        console.log(
          `Is ${altGemName} an alternative gem name for '${gemName}' package? Please let us know if this is correct.`,
        );
      }
    }
    // Gem wasn't installed or the GEM_HOME was not set correctly.
    if (
      result?.stderr?.includes("Bundler::GemNotFound") ||
      result?.stderr?.includes("(LoadError)")
    ) {
      return [];
    }
    if (
      !result?.stderr?.includes("(NameError)") &&
      !result?.stderr?.includes("(NoMethodError)") &&
      !result?.stderr?.includes("(ArgumentError)") &&
      DEBUG_MODE
    ) {
      console.log(
        `Unable to collect the module names exported by the gem ${gemName}.`,
      );
      console.log(result.stderr);
    }
    // Let's guess the module name based on common naming convention.
    return toGemModuleNames(gemName);
  }
  const simpleModuleNames = new Set();
  for (const aline of result.stdout.split("\n")) {
    if (
      !aline?.length ||
      aline.startsWith("Ignoring ") ||
      aline.includes("cannot load such file") ||
      aline.startsWith("#<")
    ) {
      continue;
    }
    if (!aline.includes("::")) {
      simpleModuleNames.add(aline.trim());
      continue;
    }
    moduleNames.add(aline.trim());
  }
  return moduleNames.size
    ? Array.from(moduleNames).sort()
    : Array.from(simpleModuleNames).sort();
}

// One `"key" => value` pair of a gemspec metadata hash, or one
// `metadata["key"] = value` assignment. The value is a string literal or a
// reference to another spec field, as in `spec.metadata["homepage_uri"] =
// spec.homepage`.
const GEM_METADATA_PAIR =
  /["']([a-z_]+)["']\s*(?:=>|\]\s*=)\s*(?:["']([^"']*)["']|(\w+)\.(homepage|name|version)\b)/g;

/**
 * Last segment of a version constant such as `Foo::Bar::VERSION`.
 *
 * @param {string} expression Source assigned to `spec.version`
 * @returns {string | undefined} The constant name, such as `VERSION`
 */
function gemVersionConstantName(expression) {
  let constantPath = expression.split(" ")[0];
  let suffix;
  while (
    (suffix = [".freeze", ".to_s", ".dup"].find((s) =>
      constantPath.endsWith(s),
    ))
  ) {
    constantPath = constantPath.slice(0, -suffix.length);
  }
  if (constantPath.startsWith("::")) {
    constantPath = constantPath.slice(2);
  }
  const segments = constantPath.split("::");
  if (!segments.every((segment) => /^[A-Z]\w*$/.test(segment))) {
    return undefined;
  }
  return segments[segments.length - 1];
}

/**
 * Method to parse Gemspec file contents.
 *
 * A source gemspec is Ruby code. The values that can be read without running
 * it are string literals, lists of them, heredocs, and a version constant
 * defined in the version file the gemspec requires. Anything else is left
 * unresolved instead of being guessed.
 *
 * Bundler evaluates the gemspec of a project that uses the Gemfile `gemspec`
 * directive, and locks the gem under `PATH remote: .`. Such a locked version
 * can be supplied through `options.lockedVersions` and is used when the
 * gemspec computes its version in a way that cannot be read statically.
 *
 * @param {string} gemspecData Gemspec data
 * @param {string} gemspecFile File name for evidence.
 * @param {Object} [options] Parse options
 * @param {Object<string, string>} [options.lockedVersions] Locked versions of
 *   the gems the project directory serves, by gem name
 */
export async function parseGemspecData(gemspecData, gemspecFile, options = {}) {
  let pkgList = [];
  const pkg = { properties: [] };
  if (gemspecFile) {
    pkg.name = basename(gemspecFile).replace(".gemspec", "");
  }
  if (!gemspecData) {
    return pkgList;
  }
  let versionHackMatch = false;
  let gemPlatform;
  let specVar;
  let literalVersion;
  let versionExpression;
  const texts = {};
  const lists = {};
  const versionFiles = [];
  // Keyed by metadata keys taken from the gemspec, so it has no prototype
  const gemMetadata = Object.create(null);
  let metadataDepth = 0;
  // A heredoc, string, or array whose value continues on the following lines
  let pending;
  const assignText = (field, value) => {
    const text = value.trim();
    if (text.length) {
      texts[field] = text;
    }
  };
  gemspecData.split("\n").forEach((rawLine) => {
    const line = rawLine.replaceAll("\r", "").replace(/\s+/g, " ").trim();
    // A string or array that seems to run into the next spec attribute was
    // misread, so keep what it had and parse the line as usual
    if (
      pending &&
      pending.kind !== "heredoc" &&
      specVar &&
      line.startsWith(`${specVar}.`)
    ) {
      if (pending.kind === "list") {
        const partialList = readRubyStringList(pending.text);
        if (partialList?.values.length) {
          lists[pending.field] = partialList.values;
        }
      } else {
        assignText(pending.field, readRubyStringLiteral(pending.text).value);
      }
      pending = undefined;
    }
    if (pending) {
      pending.lineCount++;
      if (pending.kind === "heredoc") {
        if (line === pending.terminator) {
          assignText(pending.field, pending.text);
          pending = undefined;
        } else {
          pending.text = `${pending.text} ${line}`;
        }
      } else {
        pending.text = `${pending.text} ${line}`;
        if (pending.kind === "list") {
          const list = readRubyStringList(pending.text);
          if (list?.complete) {
            lists[pending.field] = list.values;
            pending = undefined;
          }
        } else {
          const literal = readRubyStringLiteral(pending.text);
          if (literal?.complete) {
            assignText(pending.field, literal.value);
            pending = undefined;
          }
        }
      }
      if (pending && pending.lineCount > GEMSPEC_MAX_CONTINUATION_LINES) {
        pending = undefined;
      }
      return;
    }
    if (line.startsWith("#")) {
      return;
    }
    const l = line.replaceAll("%q{", "").replace(/}$/, "");
    if (!specVar && line.includes("Gem::Specification.new")) {
      const opening = line.indexOf("|");
      const closing = line.indexOf("|", opening + 1);
      const candidate =
        opening >= 0 && closing > opening
          ? line.slice(opening + 1, closing).trim()
          : "";
      if (/^\w+$/.test(candidate)) {
        specVar = candidate;
      }
    }
    if (gemspecFile) {
      versionFiles.push(...gemspecVersionRequireCandidates(line, gemspecFile));
    }
    // Native gems declare a platform. Installed gemspecs use either a plain
    // string (`s.platform = "java".freeze`) or the marshalled array form
    // (`s.platform = Gem::Platform.new(["x86_64", "linux", nil])`).
    if (l.includes(".platform = ")) {
      const platformValue = l
        .split(".platform = ")[1]
        .replaceAll(".freeze", "");
      if (platformValue.includes("Gem::Platform.new")) {
        const platformParts = platformValue
          .replace(/.*\[/, "")
          .replace(/].*/, "")
          .split(",")
          .map((s) => s.trim().replace(/["']/g, ""))
          .filter((s) => s.length && s !== "nil");
        if (platformParts.length) {
          gemPlatform = platformParts.join("-");
        }
      } else if (!platformValue.includes("Gem::Platform::RUBY")) {
        const platformString = platformValue.replace(/["';]/g, "").trim();
        if (platformString.length && isRubyPlatform(platformString)) {
          gemPlatform = platformString;
        }
      }
    }
    const versionValue = readGemspecAssignment(line, "version");
    if (versionValue !== undefined) {
      const literal = readRubyStringLiteral(versionValue);
      if (
        literal?.complete &&
        !literal.interpolated &&
        endsRubyStatement(literal.rest) &&
        looksLikeGemVersion(literal.value.trim())
      ) {
        literalVersion = literal.value.trim();
        versionExpression = undefined;
      } else {
        literalVersion = undefined;
        versionExpression = versionValue;
      }
    }
    for (const field of ["name", "description", "summary", "homepage"]) {
      const value = readGemspecAssignment(line, field);
      if (value === undefined) {
        continue;
      }
      const terminator = readHeredocTerminator(value);
      if (terminator && field !== "name") {
        pending = {
          kind: "heredoc",
          field,
          terminator,
          text: "",
          lineCount: 0,
        };
        return;
      }
      const literal = readRubyStringLiteral(value);
      if (!literal) {
        continue;
      }
      if (!literal.complete) {
        if (field !== "name") {
          pending = { kind: "literal", field, text: value, lineCount: 0 };
          return;
        }
        continue;
      }
      if (!endsRubyStatement(literal.rest)) {
        continue;
      }
      if (field === "name") {
        if (!literal.interpolated && literal.value.trim().length) {
          pkg.name = literal.value.trim();
        }
      } else {
        assignText(field, literal.value);
      }
    }
    // The singular spellings are aliases of the plural attributes, and a
    // gemspec may spread an array over several lines
    for (const [attribute, field] of [
      ["authors", "authors"],
      ["author", "authors"],
      ["email", "email"],
      ["licenses", "licenses"],
      ["license", "licenses"],
    ]) {
      const value = readGemspecAssignment(line, attribute);
      if (value === undefined) {
        continue;
      }
      const list = readRubyStringList(value);
      if (!list) {
        continue;
      }
      if (!list.complete) {
        pending = { kind: "list", field, text: value, lineCount: 0 };
        return;
      }
      lists[field] = list.values;
    }
    if (l.includes(".executables = ")) {
      try {
        const exeList = JSON.parse(
          l
            .split(".executables = ")
            .pop()
            .replaceAll(".freeze", "")
            .replaceAll("'", '"')
            .replaceAll(']"', ""),
        );
        if (exeList && Array.isArray(exeList)) {
          pkg.properties.push({
            name: "cdx:gem:executables",
            value: exeList.join(", "),
          });
        }
      } catch (_err) {
        // pass
      }
    }
    // A gem with extensions compiles native code at install time, which is a
    // meaningful execution surface for a supply chain review.
    if (l.includes(".extensions = ")) {
      const extList = parseGemspecArray(l.split(".extensions = ").pop());
      if (extList.length) {
        pkg.properties.push({
          name: "cdx:gem:extensions",
          value: extList.join(", "),
        });
      }
    }
    // `required_ruby_version` and `required_rubygems_version` are
    // Gem::Requirement strings such as `>= 3.0` or `>= 2.2, < 4.0`
    for (const [aprop, propName] of [
      ["required_ruby_version", "cdx:gem:rubyVersionSpecifiers"],
      ["required_rubygems_version", "cdx:gem:rubygemsVersionSpecifiers"],
    ]) {
      if (l.includes(`.${aprop} = `)) {
        const requirement = parseGemRequirement(l.split(`.${aprop} = `).pop());
        // `>= 0` carries no information
        if (requirement && requirement !== ">= 0") {
          pkg.properties.push({ name: propName, value: requirement });
        }
      }
    }
    // The free form metadata hash carries the well known project URIs and the
    // `rubygems_mfa_required` supply chain signal. It may be written inline as
    // `s.metadata = { "a" => "b", "c" => "d" }`, spread over several lines, or
    // assigned a key at a time with `s.metadata["a"] = "b"`. A multi-line hash
    // is followed until its braces balance, so a `#{...}` interpolation or an
    // unrelated hash further down cannot end or extend it.
    if (metadataDepth > 0 || line.includes(".metadata")) {
      for (const [, key, value, refVar, refField] of line.matchAll(
        GEM_METADATA_PAIR,
      )) {
        gemMetadata[key] =
          value !== undefined ? { value } : { refVar, refField };
      }
      if (metadataDepth > 0) {
        metadataDepth = Math.max(0, metadataDepth + hashBraceDelta(line));
      } else if (readGemspecAssignment(line, "metadata") !== undefined) {
        metadataDepth = Math.max(0, hashBraceDelta(line));
      }
    }
  });
  if (literalVersion) {
    pkg.version = literalVersion;
  } else if (versionExpression !== undefined) {
    // Installed gems live in a `<name>-<version>` directory
    if (gemspecFile) {
      const parentDir = basename(dirname(gemspecFile));
      const prefix = `${pkg.name}-`;
      if (parentDir.startsWith(prefix)) {
        const versionFromDir = parentDir.slice(prefix.length).split("-")[0];
        if (looksLikeGemVersion(versionFromDir)) {
          pkg.version = versionFromDir;
          versionHackMatch = true;
        }
      }
    }
    // Most gems built from source assign a constant defined in the
    // `lib/<gem>/version.rb` file the gemspec requires
    const constantName = gemVersionConstantName(versionExpression);
    if (!pkg.version) {
      pkg.version =
        constantName && versionFiles.length
          ? resolveGemVersionConstant(gemspecFile, versionFiles, constantName)
          : undefined;
    }
  }
  // Fall back to the release Bundler evaluated the gemspec to
  const lockedVersion =
    options.lockedVersions && Object.hasOwn(options.lockedVersions, pkg.name)
      ? options.lockedVersions[pkg.name]
      : undefined;
  if (!pkg.version && looksLikeGemVersion(lockedVersion)) {
    pkg.version = lockedVersion;
  }
  if (!pkg.version && versionExpression !== undefined && DEBUG_MODE) {
    console.log(
      `Unable to identify the version for '${pkg.name}' from '${versionExpression}'. Spec file: ${gemspecFile}`,
    );
  }
  const specFields = { name: pkg.name, version: pkg.version };
  const expand = (value) =>
    expandGemspecInterpolation(value, specVar, specFields);
  // Gems that only set `summary` still deserve a description in the BOM
  const description = texts.description || texts.summary;
  if (description) {
    pkg.description = expand(description);
  }
  // A URL whose interpolation cannot be resolved would be a wrong link
  const homepage = texts.homepage ? expand(texts.homepage) : undefined;
  specFields.homepage = homepage?.includes("#{") ? undefined : homepage;
  for (const [key, entry] of Object.entries(gemMetadata)) {
    const value =
      entry.value !== undefined
        ? expand(entry.value)
        : !specVar || entry.refVar === specVar
          ? specFields[entry.refField]
          : undefined;
    if (!value?.length || value.includes("#{")) {
      if (DEBUG_MODE && entry.value !== undefined) {
        console.log(
          `Ignoring the metadata '${key}' of '${pkg.name}' with the unresolved value '${entry.value}'. Spec file: ${gemspecFile}`,
        );
      }
      continue;
    }
    if (key === "rubygems_mfa_required") {
      pkg.properties.push({
        name: "cdx:gem:mfaRequired",
        value: `${value}`,
      });
      continue;
    }
    const refType = Object.hasOwn(GEM_METADATA_REFERENCE_TYPES, key)
      ? GEM_METADATA_REFERENCE_TYPES[key]
      : undefined;
    if (refType) {
      pkg.externalReferences = pkg.externalReferences || [];
      pkg.externalReferences.push({ type: refType, url: value, comment: key });
    }
  }
  // `s.homepage = "..."` is the project website
  if (specFields.homepage) {
    pkg.externalReferences = pkg.externalReferences || [];
    if (
      !pkg.externalReferences.some((ref) => ref.url === specFields.homepage)
    ) {
      pkg.externalReferences.push({
        type: "website",
        url: specFields.homepage,
      });
    }
  }
  if (pkg.name) {
    const purlString = toGemPurl(pkg.name, pkg.version, gemPlatform);
    pkg.purl = purlString;
    pkg["bom-ref"] = decodeURIComponent(purlString);
  }
  if (gemspecFile) {
    pkg.properties.push({ name: "internal:SrcFile", value: gemspecFile });
    // Did we find the version number from the directory name? Let's reduce the confidence and set the correct technique
    pkg.evidence = {
      identity: {
        field: "purl",
        confidence: !pkg.version || versionHackMatch ? 0.2 : 0.5,
        methods: [
          {
            technique: versionHackMatch ? "filename" : "manifest-analysis",
            confidence: !pkg.version || versionHackMatch ? 0.2 : 0.5,
            value: gemspecFile,
          },
        ],
      },
    };
  }
  if (lists.authors?.length) {
    // `spec.email` holds the contact addresses of the gem, not of an author.
    // An address can only be attributed when there is one per author, in the
    // same order, or when the gem has a single author.
    const emails = (lists.email || []).filter(
      (email) => email.includes("@") && !email.includes(" "),
    );
    pkg.authors = lists.authors.map((name, i) => {
      let email;
      if (emails.length === lists.authors.length) {
        email = emails[i];
      } else if (lists.authors.length === 1) {
        email = emails[0];
      }
      return email ? { name, email } : { name };
    });
  }
  if (lists.licenses?.length) {
    pkg.licenses = lists.licenses.map((l) => {
      return { license: { name: l } };
    });
  }
  if (pkg.name) {
    pkgList = [pkg];
  } else {
    console.log("Unable to parse", gemspecData, gemspecFile);
  }
  if (shouldFetchLicense()) {
    return await getRubyGemsMetadata(pkgList);
  }
  return pkgList;
}

/**
 * Method to parse Gemfile.lock
 *
 * Besides the components and the dependency tree, the result lists as
 * `projectGemRefs` the bom-refs of the gems served from the lockfile's own
 * directory (`PATH` with `remote: .`), which is how Bundler records the gem a
 * project builds when its Gemfile uses the `gemspec` directive.
 *
 * @param {object} gemLockData Gemfile.lock data
 * @param {string} lockFile Lock file
 */
export async function parseGemfileLockData(gemLockData, lockFile) {
  let pkgList = [];
  const pkgnames = {};
  const dependenciesList = [];
  const dependenciesMap = {};
  const pkgVersionMap = {};
  const pkgVersionPlatformMap = {};
  const pkgNameRef = {};
  if (!gemLockData) {
    return pkgList;
  }
  const checksumsMap = {};
  let specsFound = false;
  let checksumsFound = false;
  // We need two passes to identify components and resolve dependencies
  // In the first pass, we capture package name and version
  gemLockData.split("\n").forEach((l) => {
    l = l.trim();
    l = l.replaceAll("\r", "");
    if (checksumsFound) {
      const gemHashes = parseGemChecksumLine(l);
      if (gemHashes) {
        checksumsMap[gemHashes.lockName] = gemHashes.hashes;
      }
    }
    if (specsFound) {
      const tmpA = l.split(" ");
      if (tmpA && tmpA.length === 2) {
        const name = tmpA[0];
        if (name === "remote:") {
          return;
        }
        let version = tmpA[1];
        // We only allow bracket characters ()
        if (version.search(/[,><~ ]/) < 0) {
          version = version.replace(/[=()]/g, "");
          // Sometimes, the version number could include the platform
          // Examples:
          //  bcrypt_pbkdf (1.1.0)
          //  bcrypt_pbkdf (1.1.0-x64-mingw32)
          //  bcrypt_pbkdf (1.1.0-x86-mingw32)
          // In such cases, we need to track all of them to improve precision
          const { platform } = splitRubyVersionPlatform(version);
          if (platform) {
            pkgVersionMap[`${name}-${platform}`] = version;
            if (!pkgVersionPlatformMap[name]) {
              pkgVersionPlatformMap[name] = new Set();
            }
            pkgVersionPlatformMap[name].add(version);
          } else {
            pkgVersionMap[name] = version;
          }
        }
      }
    }
    if (l === "specs:") {
      specsFound = true;
    }
    if (l === l.toUpperCase()) {
      specsFound = false;
      checksumsFound = l === "CHECKSUMS";
    }
  });
  specsFound = false;
  let lastParent;
  let lastRemote;
  let lastRevision;
  let lastBranch;
  let lastTag;
  let lastParentPlatform;
  // The section (`PATH`, `GIT`, `GEM`) and the remote the specs come from
  let lastSection;
  let lastSectionRemote;
  // Dependencies block would begin with DEPENDENCIES
  let dependenciesBlock = false;
  const rootList = [];
  const projectGemRefs = [];
  // In the second pass, we use the space in the prefix to figure out the dependency tree
  gemLockData.split("\n").forEach((l) => {
    l = l.replaceAll("\r", "");
    if (l.trim().startsWith("remote:")) {
      lastRemote = l.trim().split(" ")[1];
      lastSectionRemote = lastRemote;
      if (lastRemote.length < 3) {
        lastRemote = undefined;
      }
    }
    if (l.trim().startsWith("revision:")) {
      lastRevision = l.trim().split(" ")[1];
    }
    if (l.trim().startsWith("branch:")) {
      lastBranch = l.trim().split(" ")[1];
    }
    if (l.trim().startsWith("tag:")) {
      lastTag = l.trim().split(" ")[1];
    }
    if (l.trim() === l.trim().toUpperCase()) {
      if (l.trim() === "DEPENDENCIES") {
        dependenciesBlock = true;
        return;
      }
      dependenciesBlock = false;
      specsFound = false;
      lastRemote = undefined;
      lastRevision = undefined;
      lastBranch = undefined;
      lastTag = undefined;
      lastParentPlatform = undefined;
      lastSection = l.trim() || undefined;
      lastSectionRemote = undefined;
    }
    if (l.trim() === "specs:") {
      specsFound = true;
      return;
    }
    if (specsFound) {
      const tmpA = l.split(" (");
      const nameWithPrefix = tmpA[0];
      const name = tmpA[0].replace(/["']/g, "").trim();
      const level = nameWithPrefix.replace(name, "").split("  ").length % 2;
      if (
        !name.length ||
        ["remote:", "bundler", name.toUpperCase()].includes(name)
      ) {
        return;
      }
      let mayBeVersion = l
        .trim()
        .replace(name, "")
        .replace(" (", "")
        .replace(")", "");
      if (mayBeVersion.search(/[,><~ ]/) < 0) {
        // Reset the platform
        if (level === 1) {
          lastParentPlatform = undefined;
        }
        // Extract the platform. Child gems without an explicit version inherit
        // the platform of their platform-specific parent, so we must only
        // overwrite the tracked platform when this line declares one.
        const { platform } = splitRubyVersionPlatform(mayBeVersion);
        if (platform) {
          lastParentPlatform = platform;
        }
      } else {
        mayBeVersion = undefined;
      }
      // Resolve this line to one or more concrete gem releases.
      //
      // A line that declares its own version is a spec and resolves to exactly
      // one release. A dependency reference has to be looked up, and when the
      // gem ships only as native builds we cannot tell which one Bundler would
      // install, so every variant becomes a candidate. Emitting the variants
      // that the lockfile really contains is more accurate than inventing a
      // phantom versionless component, which is what used to happen.
      const variants = pkgVersionPlatformMap[name]
        ? Array.from(pkgVersionPlatformMap[name])
        : [];
      let resolvedVersions = [];
      if (mayBeVersion) {
        resolvedVersions = [mayBeVersion];
      } else if (pkgVersionMap[name]) {
        // Identifying the resolved version for a given dependency requires multiple lookups
        resolvedVersions = [pkgVersionMap[name]];
      } else if (lastParentPlatform) {
        // Is there a platform specific alias?
        const alias = pkgVersionMap[`${name}-${lastParentPlatform}`];
        if (alias) {
          resolvedVersions = [alias];
        } else {
          // Is there a match based on the last parent platform?
          const fuzzyMatch = variants.find((aver) =>
            aver.includes(lastParentPlatform.replace("-gnu", "")),
          );
          if (fuzzyMatch) {
            resolvedVersions = [fuzzyMatch];
          }
        }
      }
      if (!resolvedVersions.length && variants.length) {
        resolvedVersions = variants;
      }
      if (!resolvedVersions.length) {
        resolvedVersions = [undefined];
      }
      for (const resolvedVersion of resolvedVersions) {
        // RubyGems models the version and the native platform separately, so we
        // must not leave the platform suffix in the version. The purl
        // specification represents it with the `platform` qualifier.
        const { version, platform } = splitRubyVersionPlatform(resolvedVersion);
        const purlString = toGemPurl(name, version, platform);
        const bomRef = decodeURIComponent(purlString);
        if (level === 1) {
          lastParent = bomRef;
          if (
            lastSection === "PATH" &&
            lastSectionRemote === "." &&
            !projectGemRefs.includes(bomRef)
          ) {
            projectGemRefs.push(bomRef);
          }
        }
        const properties = [
          {
            name: "internal:SrcFile",
            value: lockFile,
          },
        ];
        if (lastRemote) {
          properties.push({
            name: "cdx:gem:remote",
            value: lastRemote,
          });
        }
        if (lastRevision) {
          properties.push({
            name: "cdx:gem:remoteRevision",
            value: lastRevision,
          });
        }
        if (lastBranch) {
          properties.push({
            name: "cdx:gem:remoteBranch",
            value: lastBranch,
          });
        }
        if (lastTag) {
          properties.push({
            name: "cdx:gem:remoteTag",
            value: lastTag,
          });
        }
        const apkg = {
          name,
          version,
          purl: purlString,
          "bom-ref": bomRef,
          properties,
          evidence: {
            identity: {
              field: "purl",
              confidence: 0.8,
              methods: [
                {
                  technique: "manifest-analysis",
                  confidence: 0.8,
                  value: lockFile,
                },
              ],
            },
          },
        };
        // Bundler 2.5 onwards records the sha256 of each gem in a CHECKSUMS
        // section, keyed by the same `name (version[-platform])` token.
        const gemHashes = checksumsMap[`${name} (${resolvedVersion})`];
        if (gemHashes) {
          apkg.hashes = gemHashes;
        }
        if (lastParent && lastParent !== bomRef) {
          if (!dependenciesMap[lastParent]) {
            dependenciesMap[lastParent] = new Set();
          }
          dependenciesMap[lastParent].add(bomRef);
        }
        if (!dependenciesMap[bomRef]) {
          dependenciesMap[bomRef] = new Set();
        }
        // A gem with several native variants has several bom-refs. Track all of
        // them so that a direct dependency on such a gem does not resolve to an
        // arbitrary variant.
        if (!pkgNameRef[name]) {
          pkgNameRef[name] = [];
        }
        if (!pkgNameRef[name].includes(bomRef)) {
          pkgNameRef[name].push(bomRef);
        }
        // Allow duplicate packages if the version number includes platform
        if (!pkgnames[purlString]) {
          pkgList.push(apkg);
          pkgnames[purlString] = true;
        }
      }
    } else if (dependenciesBlock) {
      const rootDepName = l.trim().split(" ")[0].replace("!", "");
      if (pkgNameRef[rootDepName]?.length) {
        // Every native variant of a direct dependency is a direct dependency
        for (const aref of pkgNameRef[rootDepName]) {
          if (!rootList.includes(aref)) {
            rootList.push(aref);
          }
        }
      } else {
        // We are dealing with an optional platform-dependent import
        // create a placeholder component to track this
        let specifier;
        if (l.includes("(")) {
          specifier = l.trim().split(" (").pop().replace(")", "").trim();
        }
        const untrackedPurl = toGemPurl(rootDepName, null, null);
        const untrackedBomRef = decodeURIComponent(untrackedPurl);
        const untrackedProps = [
          {
            name: "internal:SrcFile",
            value: lockFile,
          },
        ];
        if (specifier) {
          untrackedProps.push({
            name: "cdx:gem:versionSpecifiers",
            value: specifier,
          });
        }
        const untrackedRootDep = {
          name: rootDepName,
          version: undefined,
          purl: untrackedPurl,
          "bom-ref": untrackedBomRef,
          properties: untrackedProps,
          evidence: {
            identity: {
              field: "purl",
              confidence: 0.3,
              methods: [
                {
                  technique: "manifest-analysis",
                  confidence: 0.3,
                  value: lockFile,
                },
              ],
            },
          },
        };
        pkgnames[untrackedPurl] = true;
        pkgNameRef[rootDepName] = [untrackedBomRef];
        pkgList.push(untrackedRootDep);
        rootList.push(untrackedBomRef);
        dependenciesMap[untrackedBomRef] = new Set();
      }
    }
  });
  for (const k of Object.keys(dependenciesMap)) {
    dependenciesList.push({
      ref: k,
      dependsOn: Array.from(dependenciesMap[k]).sort(),
    });
  }
  if (shouldFetchLicense()) {
    pkgList = await getRubyGemsMetadata(pkgList);
  }
  return { pkgList, dependenciesList, rootList, projectGemRefs };
}

// Fields that describe a gem, carried over to the parent component
const GEM_DESCRIPTIVE_FIELDS = [
  "description",
  "authors",
  "licenses",
  "externalReferences",
];

/**
 * Describe the gem a project builds in its parent component.
 *
 * A gem project sees its own gem more than once: in its gemspec, in the `PATH`
 * entry the Gemfile `gemspec` directive adds to its lockfile, and possibly as
 * an installed copy. Each of them describes the project itself, so all are
 * folded into the parent (discussion 4388). The parent takes the gem's
 * identity, its descriptive metadata, and its `cdx:gem:*` properties; the
 * dependency edges of the sightings move to the parent; and the sightings
 * leave the component list, so the gem is never a dependency of itself.
 *
 * An explicit `--project-version` names the version of the parent. Otherwise
 * the version of the gemspec, which may have come from the lockfile, is used.
 *
 * @param {object} parentComponent Parent component, updated in place
 * @param {object} projectGem Component parsed from the root gemspec
 * @param {object[]} pkgList Components
 * @param {object[]} dependencies Dependency edges
 * @param {string[]} rootList bom-refs of the direct dependencies
 * @param {string[]} projectGemRefs bom-refs of the gems the lockfiles serve from the project directory
 * @param {object} options CLI options
 * @returns {{pkgList: object[], dependencies: object[], rootList: string[]}}
 *   The components, edges, and direct dependencies with the gem folded in
 */
export function describeProjectGem(
  parentComponent,
  projectGem,
  pkgList,
  dependencies,
  rootList,
  projectGemRefs,
  options = {},
) {
  const version = options.projectVersion
    ? `${options.projectVersion}`
    : projectGem.version || "latest";
  const parentPurl = build({
    type: "gem",
    namespace: parentComponent.group || null,
    name: projectGem.name,
    version,
  });
  parentComponent.name = projectGem.name;
  parentComponent.version = version;
  parentComponent.purl = parentPurl;
  parentComponent["bom-ref"] = decodeURIComponent(parentPurl);
  const parentRef = parentComponent["bom-ref"];
  const selfRefs = new Set([parentRef, projectGem["bom-ref"]]);
  for (const ref of projectGemRefs || []) {
    if (
      pkgList.some((p) => p["bom-ref"] === ref && p.name === projectGem.name)
    ) {
      selfRefs.add(ref);
    }
  }
  // After trimComponents, the retained sighting holds the metadata of all the
  // duplicates it absorbed, so every retained sighting is consulted
  const sightings = [
    projectGem,
    ...pkgList.filter((p) => p !== projectGem && selfRefs.has(p["bom-ref"])),
  ];
  const hasValue = (value) =>
    Array.isArray(value) ? value.length > 0 : !!value;
  for (const field of GEM_DESCRIPTIVE_FIELDS) {
    if (hasValue(parentComponent[field])) {
      continue;
    }
    const source = sightings.find((s) => hasValue(s[field]));
    if (source) {
      parentComponent[field] = source[field];
    }
  }
  for (const sighting of sightings) {
    for (const prop of sighting.properties || []) {
      if (
        prop.name.startsWith("cdx:gem:") &&
        !parentComponent.properties?.some((p) => p.name === prop.name)
      ) {
        parentComponent.properties = parentComponent.properties || [];
        parentComponent.properties.push(prop);
      }
    }
    // Checksums identify an artifact, so only the parent's own release counts
    if (sighting["bom-ref"] === parentRef && sighting.hashes?.length) {
      parentComponent.hashes = parentComponent.hashes || [];
      for (const ahash of sighting.hashes) {
        if (
          !parentComponent.hashes.some(
            (h) => h.alg === ahash.alg && h.content === ahash.content,
          )
        ) {
          parentComponent.hashes.push(ahash);
        }
      }
    }
  }
  const rekey = (ref) => (selfRefs.has(ref) ? parentRef : ref);
  return {
    pkgList: pkgList.filter((p) => !selfRefs.has(p["bom-ref"])),
    // mergeDependencies unites the entries that now share the parent's ref and
    // drops the edges pointing back at the parent
    dependencies: mergeDependencies(
      [],
      dependencies.map((d) => ({
        ...d,
        ref: rekey(d.ref),
        dependsOn: (d.dependsOn || []).map(rekey),
      })),
      parentComponent,
    ),
    rootList: [
      ...new Set(rootList.map(rekey).filter((ref) => ref !== parentRef)),
    ],
  };
}
