import { readFileSync } from "node:fs";

import { tryBuildPurl } from "../inventory/purl.js";

/**
 * Erlang rebar3 parser for `rebar.lock`.
 *
 * A rebar lock holds one or two Erlang terms, each ended by a period:
 *
 *   {"1.2.0", [{<<"cowboy">>,{pkg,<<"cowboy">>,<<"2.10.0">>},0}]}.
 *   [{pkg_hash, [{<<"cowboy">>, <<"3AFD...">>}]},
 *    {pkg_hash_ext, [...]}].
 *
 * The first term pairs the lock format version with the locked dependency
 * list; the hashes live in a separate second term, which is absent from locks
 * that hold no hex packages. Lock format 1.0.0 omitted the version and wrote
 * the dependency list as the only term.
 *
 * Rather than a large regular expression over the surface syntax, a small
 * recursive reader parses the terms into plain JavaScript values: tuples and
 * lists become arrays, binaries and strings become strings, atoms become
 * strings. Only the shapes rebar actually writes are understood; anything
 * else is skipped.
 *
 * Hex dependencies are identified with the registered `hex` purl type, since
 * rebar resolves Erlang packages through hex.pm. The `pkg_hash` values hex
 * publishes are SHA-256 digests of the package tarball, so they are emitted
 * into the CycloneDX `hashes` array where consumers expect content hashes.
 */

/**
 * Parse a `rebar.lock` file.
 *
 * @param {string} rebarLockFile Path to `rebar.lock`
 * @returns {{ pkgList: object[] }} Locked packages
 */
export function parseRebarLock(rebarLockFile) {
  let text;
  try {
    text = readFileSync(rebarLockFile, "utf-8");
  } catch (error) {
    console.warn(`Failed to read ${rebarLockFile}: ${error.message}`);
    return { pkgList: [] };
  }
  const terms = parseErlangTerms(text);
  const deps = lockedDependencies(terms);
  const pkgHashes = hexHashesFromTerms(terms);

  const pkgList = [];
  const seen = new Set();
  for (const entry of deps) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[0]) {
      continue;
    }
    const name = entry[0];
    const spec = entry[1];
    let pkgName = name;
    let version;
    if (Array.isArray(spec) && spec[0] === "pkg") {
      if (typeof spec[1] === "string" && spec[1]) {
        pkgName = spec[1];
      }
      if (typeof spec[2] === "string" && spec[2]) {
        version = spec[2];
      }
    } else if (Array.isArray(spec) && spec[0] === "git") {
      // Git-sourced entries carry {git, Url, {ref, Sha}}; the revision is the
      // most precise version available without running git.
      const ref =
        Array.isArray(spec[2]) && spec[2][0] === "ref" ? spec[2][1] : undefined;
      if (typeof ref === "string" && ref) {
        version = ref;
      }
    } else if (typeof spec === "string" && spec) {
      version = spec;
    }
    if (seen.has(pkgName)) {
      continue;
    }
    seen.add(pkgName);
    pkgList.push(
      rebarPackage(pkgName, version, {
        // rebar records the dependency depth; level 0 entries are the
        // project's own dependencies, deeper entries are transitive.
        direct: entry[2] === 0,
        sha256: pkgHashes.get(pkgName) || pkgHashes.get(name),
        srcFile: rebarLockFile,
      }),
    );
  }
  return { pkgList };
}

/**
 * Build a component-like package record for a rebar dependency.
 *
 * @param {string} name Hex package name
 * @param {string|undefined} version Resolved version or git revision
 * @param {object} opts Extra context (`direct`, `sha256`, `srcFile`)
 * @returns {object} Package record
 */
function rebarPackage(name, version, opts) {
  const purl = tryBuildPurl({
    type: "hex",
    name,
    version: version || undefined,
  });
  const properties = [
    { name: "internal:SrcFile", value: opts.srcFile },
    {
      name: "cdx:rebar:dependency",
      value: opts.direct ? "direct" : "transitive",
    },
  ];
  const pkg = {
    name,
    ...(version ? { version } : {}),
    type: "library",
    scope: "required",
    properties,
  };
  if (opts.sha256 && /^[0-9a-f]{64}$/iu.test(opts.sha256)) {
    pkg.hashes = [{ alg: "SHA-256", content: opts.sha256.toLowerCase() }];
  }
  if (purl) {
    pkg.purl = purl;
    pkg["bom-ref"] = decodeURIComponent(purl);
  } else {
    pkg["bom-ref"] = `library:${name}:${version || ""}`;
  }
  return pkg;
}

/**
 * Pick the locked dependency list out of the parsed terms.
 *
 * The current format wraps it in `{Version, Deps}`; format 1.0.0 wrote the
 * list on its own. A dependency entry is always a tuple whose first element
 * is the application name, which tells the two shapes apart.
 *
 * @param {Array} terms Parsed top-level terms
 * @returns {Array} Dependency entries
 */
function lockedDependencies(terms) {
  for (const term of terms) {
    if (!Array.isArray(term)) {
      continue;
    }
    if (typeof term[0] === "string" && Array.isArray(term[1])) {
      // {Version, Deps}
      return term[1];
    }
    if (term.every(isDependencyEntry)) {
      // A bare dependency list, including the empty lock `[].`
      return term;
    }
  }
  return [];
}

/**
 * Recognise a locked dependency entry: `{Name, Source, Level}`.
 *
 * @param {*} entry Candidate entry
 * @returns {boolean} true when the entry looks like a dependency tuple
 */
function isDependencyEntry(entry) {
  return (
    Array.isArray(entry) &&
    typeof entry[0] === "string" &&
    entry[0].length > 0 &&
    entry.length >= 2
  );
}

/**
 * Collect the `pkg_hash` digests from the parsed terms.
 *
 * The digests live in their own top-level term, a list of
 * `{pkg_hash, [{Name, Digest}]}` tuples. `pkg_hash_ext` covers a different
 * packaging of the same release and is ignored so one digest is emitted per
 * package.
 *
 * @param {Array} terms Parsed top-level terms
 * @returns {Map<string, string>} Package name to SHA-256 hex digest
 */
function hexHashesFromTerms(terms) {
  const hashes = new Map();
  for (const term of terms) {
    if (!Array.isArray(term)) {
      continue;
    }
    for (const item of term) {
      if (
        !Array.isArray(item) ||
        item[0] !== "pkg_hash" ||
        !Array.isArray(item[1])
      ) {
        continue;
      }
      for (const pair of item[1]) {
        if (Array.isArray(pair) && typeof pair[0] === "string") {
          hashes.set(pair[0], pair[1]);
        }
      }
    }
  }
  return hashes;
}

/**
 * Parse every period-terminated Erlang term in a source text.
 *
 * @param {string} text Source text
 * @returns {Array} Parsed terms, in file order
 */
export function parseErlangTerms(text) {
  const state = { text, pos: 0 };
  const terms = [];
  // A lock holds at most two terms; the bound stops a malformed file from
  // driving the reader in circles.
  for (let i = 0; i < 8; i += 1) {
    skipTrivia(state);
    if (state.pos >= text.length) {
      break;
    }
    const before = state.pos;
    let term;
    try {
      term = readValue(state);
    } catch {
      break;
    }
    if (state.pos === before) {
      break;
    }
    terms.push(term);
    skipTrivia(state);
    if (text[state.pos] === ".") {
      state.pos += 1;
    }
  }
  return terms;
}

/**
 * Advance past whitespace and `%` line comments.
 *
 * @param {{text: string, pos: number}} state Reader state
 */
function skipTrivia(state) {
  const { text } = state;
  let { pos } = state;
  while (pos < text.length) {
    const char = text[pos];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      pos += 1;
    } else if (char === "%") {
      while (pos < text.length && text[pos] !== "\n") {
        pos += 1;
      }
    } else {
      break;
    }
  }
  state.pos = pos;
}

/**
 * Read one Erlang value at the cursor.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @returns {*} Parsed value
 */
function readValue(state) {
  skipTrivia(state);
  const char = state.text[state.pos];
  if (char === "{") {
    return readTupleOrList(state, "}");
  }
  if (char === "[") {
    return readTupleOrList(state, "]");
  }
  if (char === '"') {
    return readString(state, '"');
  }
  if (char === "<" && state.text[state.pos + 1] === "<") {
    return readBinary(state);
  }
  if (char === "'") {
    return readString(state, "'");
  }
  if (char === "-" || (char >= "0" && char <= "9")) {
    return readNumber(state);
  }
  return readAtom(state);
}

/**
 * Read a `{...}` tuple or `[...]` list into an array.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @param {string} closer `}` or `]`
 * @returns {Array} Elements
 */
function readTupleOrList(state, closer) {
  state.pos += 1;
  const items = [];
  skipTrivia(state);
  if (state.text[state.pos] === closer) {
    state.pos += 1;
    return items;
  }
  for (;;) {
    items.push(readValue(state));
    skipTrivia(state);
    const next = state.text[state.pos];
    if (next === ",") {
      state.pos += 1;
      continue;
    }
    if (next === closer) {
      state.pos += 1;
      return items;
    }
    // Malformed content: bail out rather than scanning the rest of the file.
    throw new Error(`unexpected character at offset ${state.pos}`);
  }
}

/**
 * Read a quoted string, honouring Erlang escapes.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @param {string} quote Quote character
 * @returns {string} Decoded string
 */
function readString(state, quote) {
  state.pos += 1;
  let out = "";
  while (state.pos < state.text.length) {
    const char = state.text[state.pos];
    if (char === "\\") {
      out += state.text[state.pos + 1] ?? "";
      state.pos += 2;
      continue;
    }
    if (char === quote) {
      state.pos += 1;
      return out;
    }
    out += char;
    state.pos += 1;
  }
  throw new Error("unterminated string");
}

/**
 * Read a `<<"...">>` binary as a string.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @returns {string} Decoded binary content
 */
function readBinary(state) {
  state.pos += 2;
  skipTrivia(state);
  if (state.text[state.pos] !== '"') {
    throw new Error("only string binaries are supported");
  }
  const value = readString(state, '"');
  skipTrivia(state);
  if (state.text[state.pos] === ">" && state.text[state.pos + 1] === ">") {
    state.pos += 2;
    return value;
  }
  throw new Error("unterminated binary");
}

/**
 * Read an integer or float.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @returns {number} Parsed number
 */
function readNumber(state) {
  const start = state.pos;
  if (state.text[state.pos] === "-") {
    state.pos += 1;
  }
  while (/[0-9.]/u.test(state.text[state.pos] || "")) {
    state.pos += 1;
  }
  return Number(state.text.slice(start, state.pos));
}

/**
 * Read a bare atom such as `pkg` or `git`.
 *
 * @param {{text: string, pos: number}} state Reader state
 * @returns {string} Atom name
 */
function readAtom(state) {
  const start = state.pos;
  while (/[A-Za-z0-9_@]/u.test(state.text[state.pos] || "")) {
    state.pos += 1;
  }
  if (state.pos === start) {
    throw new Error(`cannot parse token at offset ${start}`);
  }
  return state.text.slice(start, state.pos);
}
