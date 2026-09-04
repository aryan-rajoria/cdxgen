// PyPI Trove classifier interpretation and package -> module-name resolution.
//
// PyPI responses carry two structured signals that were previously read only for
// their license lines and then discarded:
//
//   * `Framework :: X` — the author's declaration that the distribution belongs to
//     framework X. It is more reliable than any name-prefix heuristic: it catches
//     `flask-talisman`, `dj-database-url` and `starlette-context` without anyone
//     maintaining a list, and it never fires on a package that merely has a
//     framework's name embedded in its own.
//   * `Topic :: ...` — a curated taxonomy of what the distribution does, which maps
//     cleanly onto the description-tag vocabulary in `data/component-tags.json`.
//
// Tags derived here flow into `component.tags` and, for the `framework` tag, into
// `determinePackageType()` in `lib/cli/bomAssembly.js`, which already promotes any
// package carrying a `framework` tag to `type: "framework"`.

import { PYPI_MODULE_PACKAGE_MAPPING } from "../core/state.js";

/**
 * `Framework ::` values that do not mean "an application is built on this".
 *
 * Two groups, both of which would otherwise put a `framework` tag — and therefore
 * `type: "framework"` — on a large share of an ordinary dependency tree, drowning
 * the runtime frameworks the tag exists to surface:
 *
 *   * Development, build, test and documentation tooling. A pytest plugin
 *     declaring `Framework :: Pytest` is making a true statement, but it belongs
 *     to the dev dependencies, not to what the application runs on.
 *   * Concurrency runtimes. `Framework :: AsyncIO` is declared by a very large
 *     number of libraries to advertise that they work under asyncio; observed on
 *     `fastapi`, and `Framework :: AnyIO` likewise on `starlette`. It describes an
 *     execution model, not a framework the application is written against.
 *
 * The declared name is still emitted as a tag in every case, and still recorded in
 * `cdx:pypi:frameworks`; only the generic `framework` tag is withheld.
 */
export const PYPI_NON_APPLICATION_FRAMEWORKS = new Set([
  "anyio",
  "asyncio",
  "buildout",
  "cookiecutter",
  "flake8",
  "hatch",
  "hypothesis",
  "mkdocs",
  "pytest",
  "robotframework",
  "setuptools",
  "sphinx",
  "tox",
  "trio",
  "wheel",
]);

/**
 * `Topic ::` prefix -> tags, longest prefix wins.
 *
 * Every value on the right-hand side is an existing entry in
 * `data/component-tags.json` so that a tag derived from a classifier and the same
 * tag derived from a description are indistinguishable to consumers.
 */
const TOPIC_TAGS = [
  [
    "Topic :: Software Development :: Libraries :: Application Frameworks",
    ["framework"],
  ],
  ["Topic :: Software Development :: Object Brokering", ["rpc"]],
  ["Topic :: Software Development :: Testing", ["test"]],
  ["Topic :: Internet :: WWW/HTTP :: WSGI", ["web", "http", "wsgi"]],
  ["Topic :: Internet :: WWW/HTTP :: Session", ["web", "http", "auth"]],
  ["Topic :: Internet :: WWW/HTTP :: Dynamic Content", ["web", "http"]],
  ["Topic :: Internet :: WWW/HTTP", ["web", "http"]],
  ["Topic :: Internet :: XML-RPC", ["rpc", "xml"]],
  ["Topic :: Internet :: Proxy Servers", ["web", "traffic"]],
  ["Topic :: Database :: Front-Ends", ["database"]],
  ["Topic :: Database", ["database"]],
  ["Topic :: Security :: Cryptography", ["crypto", "security"]],
  ["Topic :: Security", ["security"]],
  ["Topic :: System :: Logging", ["logging"]],
  ["Topic :: System :: Distributed Computing", ["rpc"]],
  ["Topic :: Communications :: Email", ["mail"]],
  ["Topic :: Text Processing :: Markup :: HTML", ["html", "template"]],
  ["Topic :: Text Processing :: Markup :: XML", ["xml"]],
  ["Topic :: Scientific/Engineering :: Artificial Intelligence", ["ai", "ml"]],
  [
    "Topic :: Scientific/Engineering :: Image Recognition",
    ["ml", "object-detect"],
  ],
  ["Topic :: Office/Business :: Financial", ["finance"]],
  ["Topic :: Terminals", ["cli"]],
  ["Topic :: Utilities", ["tools"]],
];

/**
 * Normalize a distribution name per PEP 503.
 *
 * @param {string} name Distribution name
 * @returns {string} Normalized name, or an empty string for unusable input
 */
export function normalizePypiName(name) {
  if (!name || typeof name !== "string") {
    return "";
  }
  let out = "";
  let lastWasSeparator = false;
  for (const ch of name.trim().toLowerCase()) {
    if (ch === "-" || ch === "_" || ch === ".") {
      if (!lastWasSeparator && out.length) {
        out += "-";
      }
      lastWasSeparator = true;
      continue;
    }
    out += ch;
    lastWasSeparator = false;
  }
  return out.endsWith("-") ? out.slice(0, -1) : out;
}

/**
 * `data/pypi-pkg-aliases.json` maps module name -> distribution name. Inverting it
 * gives the mapping consumers actually need: distribution -> the module names it
 * installs. Built once on first use.
 *
 * @type {Map<string, string[]> | undefined}
 */
let invertedAliases;

function packageToModules() {
  if (invertedAliases) {
    return invertedAliases;
  }
  invertedAliases = new Map();
  for (const [moduleName, pkgName] of Object.entries(
    PYPI_MODULE_PACKAGE_MAPPING,
  )) {
    const key = normalizePypiName(pkgName);
    if (!key || !moduleName) {
      continue;
    }
    const existing = invertedAliases.get(key);
    if (existing) {
      if (!existing.includes(moduleName)) {
        existing.push(moduleName);
      }
    } else {
      invertedAliases.set(key, [moduleName]);
    }
  }
  return invertedAliases;
}

/**
 * Best-known import module names for a PyPI distribution.
 *
 * Two sources, in order: the curated alias map (which is where the cases that
 * cannot be derived from the name live — `pyyaml` installs `yaml`, `absl-py`
 * installs `absl`, `beautifulsoup4` installs `bs4`), and the name-derived form,
 * which is correct for the large majority of distributions. Callers that need to
 * distinguish the two should read the alias map themselves; for tagging purposes
 * both are usable and a wrong extra candidate simply matches nothing.
 *
 * This is deliberately not a guess at *every* module a distribution ships — only
 * at its top-level import names.
 *
 * @param {string} name Distribution name, e.g. "PyYAML"
 * @returns {string[]} Candidate top-level module names, deduplicated
 */
export function pypiModulesForPackage(name) {
  const normalized = normalizePypiName(name);
  if (!normalized) {
    return [];
  }
  const modules = [...(packageToModules().get(normalized) || [])];
  // The name-derived form. PEP 503 collapses `.` and `_` to `-`; imports use `_`.
  const derived = normalized.replaceAll("-", "_");
  if (derived && !modules.includes(derived)) {
    modules.push(derived);
  }
  return modules;
}

/**
 * Interpret a PyPI classifier list.
 *
 * @param {string[]} classifiers Raw `info.classifiers` from the PyPI JSON API
 * @returns {{frameworks: string[], tags: string[]}} Declared frameworks (lowercased,
 *   e.g. `["django"]`) and the tag vocabulary they and the `Topic ::` lines imply
 */
export function parsePypiClassifiers(classifiers) {
  const frameworks = [];
  const tags = new Set();
  if (!Array.isArray(classifiers)) {
    return { frameworks, tags: [] };
  }
  for (const classifier of classifiers) {
    if (!classifier || typeof classifier !== "string") {
      continue;
    }
    if (classifier.startsWith("Framework :: ")) {
      // "Framework :: Django :: 5.0" -> "django". The version segment is dropped:
      // it is the framework version the package supports, not a distinct signal.
      const declared = classifier.split(" :: ")[1]?.trim();
      if (!declared) {
        continue;
      }
      const name = declared.toLowerCase().replaceAll(" ", "-");
      if (!frameworks.includes(name)) {
        frameworks.push(name);
      }
      tags.add(name);
      if (!PYPI_NON_APPLICATION_FRAMEWORKS.has(name)) {
        tags.add("framework");
      }
      continue;
    }
    if (!classifier.startsWith("Topic :: ")) {
      continue;
    }
    for (const [prefix, topicTags] of TOPIC_TAGS) {
      if (classifier === prefix || classifier.startsWith(`${prefix} ::`)) {
        for (const tag of topicTags) {
          tags.add(tag);
        }
        break;
      }
    }
  }
  return { frameworks, tags: Array.from(tags) };
}

function addProperty(pkg, name, value) {
  if (!value) {
    return;
  }
  if (!pkg.properties) {
    pkg.properties = [];
  }
  const existing = pkg.properties.find((prop) => prop.name === name);
  if (existing) {
    existing.value = value;
    return;
  }
  pkg.properties.push({ name, value });
}

/**
 * Attach classifier-derived tags and properties to a package.
 *
 * Tags are merged into any the package already carries rather than replacing
 * them — `lib/managers/binary.js` sets `tags: ["source"]` as an identity marker,
 * and losing it would change how that package is reconciled later.
 *
 * @param {Object} pkg Package object, mutated in place
 * @param {string[]} classifiers Raw `info.classifiers` from the PyPI JSON API
 * @returns {Object} The same package object
 */
export function applyPypiClassifierMetadata(pkg, classifiers) {
  if (!pkg || !Array.isArray(classifiers) || !classifiers.length) {
    return pkg;
  }
  const { frameworks, tags } = parsePypiClassifiers(classifiers);
  if (tags.length) {
    const merged = new Set(Array.isArray(pkg.tags) ? pkg.tags : []);
    for (const tag of tags) {
      merged.add(tag);
    }
    pkg.tags = Array.from(merged);
  }
  if (frameworks.length) {
    addProperty(pkg, "cdx:pypi:frameworks", frameworks.join(","));
  }
  // The full list is retained so that consumers wanting the whole taxonomy are
  // not limited to the tag vocabulary mapped above. Classifiers come from a
  // closed PyPI-maintained set, so there is no free-text or secret exposure.
  addProperty(
    pkg,
    "cdx:pypi:classifiers",
    classifiers.filter((c) => typeof c === "string" && c.length).join("\n"),
  );
  return pkg;
}

/**
 * Attach the distribution's top-level import module names as `internal:Namespaces`.
 *
 * This is the same property jar, gem, nuget and composer components already carry,
 * so downstream consumers that map namespaces back to components need no
 * pypi-specific path. Unlike the jar case the value is name-derived and
 * alias-curated rather than read out of the artifact, which is why
 * `cdx:pypi:modulesFrom` records the provenance.
 *
 * @param {Object} pkg Package object, mutated in place
 * @returns {Object} The same package object
 */
export function applyPypiModuleNames(pkg) {
  if (!pkg?.name) {
    return pkg;
  }
  // Extras (`requests[security]`) are not part of the distribution name.
  const name = pkg.name.includes("[") ? pkg.name.split("[")[0] : pkg.name;
  if (name.includes("https")) {
    return pkg;
  }
  const normalized = normalizePypiName(name);
  const modules = pypiModulesForPackage(name);
  if (!modules.length) {
    return pkg;
  }
  // Most alias-map entries map a distribution to the module its own name already
  // implies, so the map having an entry says nothing. The provenance worth
  // recording is whether it contributed a module the name could not have given -
  // that is the difference between `flask` and `pyyaml` -> `yaml`.
  const derived = normalized.replaceAll("-", "_");
  const curatedAddedSomething = (packageToModules().get(normalized) || []).some(
    (moduleName) => moduleName !== derived,
  );
  addProperty(pkg, "internal:Namespaces", modules.join("\n"));
  addProperty(
    pkg,
    "cdx:pypi:modulesFrom",
    curatedAddedSomething ? "alias-map,distribution-name" : "distribution-name",
  );
  return pkg;
}
