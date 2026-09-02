/**
 * Command-facts collector for command shaping.
 *
 * Gathers, once per run and cached, the project facts the command resolver
 * consumes: which maven and gradle wrapper scripts the project root carries,
 * which Python manager owns its lock files, and which npm client the project
 * names or locks. Detection is filesystem reads only — existence and, for
 * the platform's own shell scripts, the executable bit. Nothing here spawns
 * a process: whether a wrapper actually runs is a question the run itself
 * answers elsewhere, and shaping that cannot know says so through the
 * resolver's fallbacks.
 */

import { join } from "node:path";

import {
  safeExistsSync,
  safeIsExecutableSync,
  safeReadFileSync,
} from "../../../core/fs.js";

/**
 * The POSIX wrapper scripts whose executable bit is meaningful, mapped to
 * the fact names the resolver reads.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
const POSIX_WRAPPERS = [
  ["mvnw", "mvnw"],
  ["gradlew", "gradlew"],
  ["composer.phar", "composerPhar"],
];

/**
 * The Windows wrapper batches whose presence is the practical usability
 * test, mapped to the fact names the resolver reads.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
const WINDOWS_WRAPPERS = [
  ["mvnw.cmd", "mvnwCmd"],
  ["gradlew.bat", "gradlewBat"],
];

/**
 * Python managers detected through the lock file that owns them. Poetry is
 * completed by the build backend its pyproject.toml declares, because a
 * stray poetry.lock alone does not make a project poetry-managed.
 *
 * @type {Readonly<Record<string, string>>}
 */
const MANAGER_LOCK_FILES = Object.freeze({
  "uv.lock": "uv",
  "poetry.lock": "poetry",
  "pdm.lock": "pdm",
  "Pipfile.lock": "pipenv",
});

/**
 * pyproject.toml build backends that settle which competing manager governs
 * the project.
 *
 * @type {Readonly<Record<string, string>>}
 */
const BACKEND_MANAGERS = Object.freeze({
  "poetry.core.masonry.api": "poetry",
  "pdm.backend": "pdm",
  "pdm.pep517.api": "pdm",
  uv: "uv",
  uv_build: "uv",
});

/** Facts gathered so far, keyed by the project root they describe. */
const factsCache = new Map();

/**
 * Whether a path exists and, on POSIX, carries the executable bit for the
 * current user. On Windows every readable file is runnable, so existence is
 * the whole answer.
 *
 * @param {string} filePath Path to check.
 * @param {boolean} checkExecutable True when the executable bit matters.
 * @returns {boolean} Usability of the path as an executable.
 */
function isUsableExecutable(filePath, checkExecutable) {
  return checkExecutable
    ? safeIsExecutableSync(filePath)
    : safeExistsSync(filePath);
}

/**
 * Read the build backend a pyproject.toml declares, from its
 * `[build-system]` section only, so a mention elsewhere cannot answer.
 *
 * @param {string} pyprojectPath Path to pyproject.toml.
 * @returns {string|undefined} The declared backend, when present.
 */
function declaredBuildBackend(pyprojectPath) {
  let content;
  try {
    content = safeReadFileSync(pyprojectPath, "utf-8");
  } catch {
    return undefined;
  }
  let inBuildSystem = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inBuildSystem = trimmed === "[build-system]";
      continue;
    }
    if (!inBuildSystem || !trimmed.startsWith("build-backend")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      return undefined;
    }
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  return undefined;
}

/**
 * Whether a pyproject.toml declares a `[tool.<name>]` section, so a
 * manager's own configuration marks the project as its own.
 *
 * @param {string} pyprojectPath Path to pyproject.toml.
 * @param {string} toolName Tool section name, e.g. `poetry`.
 * @returns {boolean} True when the section is present.
 */
function hasToolSection(pyprojectPath, toolName) {
  let content;
  try {
    content = safeReadFileSync(pyprojectPath, "utf-8");
  } catch {
    return false;
  }
  const section = `[tool.${toolName}]`;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === section || trimmed.startsWith(`${section.slice(0, -1)}.`)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect the Python manager in play at a project root: the manager whose
 * lock file is present, with poetry confirmed by the `[tool.poetry]`
 * section its pyproject.toml declares. Two competing managers are settled
 * by the declared build backend; when it settles nothing, both candidates
 * travel in the facts so the report can ask instead of guessing.
 *
 * @param {string} projectRoot Directory to inspect.
 * @returns {{manager: string|undefined, candidates: string[]}} The manager in play and every candidate detected.
 */
function detectPythonManager(projectRoot) {
  const pyprojectPath = join(projectRoot, "pyproject.toml");
  const hasPyproject = safeExistsSync(pyprojectPath);
  const candidates = [];
  for (const [lockName, manager] of Object.entries(MANAGER_LOCK_FILES)) {
    if (!safeExistsSync(join(projectRoot, lockName))) {
      continue;
    }
    if (manager === "poetry") {
      if (!hasPyproject || !hasToolSection(pyprojectPath, "poetry")) {
        continue;
      }
    }
    if (!candidates.includes(manager)) {
      candidates.push(manager);
    }
  }
  const ordered = candidates.sort();
  if (ordered.length <= 1) {
    return { manager: ordered[0], candidates: ordered };
  }
  const backend = hasPyproject
    ? declaredBuildBackend(pyprojectPath)
    : undefined;
  const settled = backend ? BACKEND_MANAGERS[backend] : undefined;
  if (settled && ordered.includes(settled)) {
    return { manager: settled, candidates: ordered };
  }
  return { manager: undefined, candidates: ordered };
}

/**
 * Detect the npm client a project root uses: the `packageManager` field of
 * its package.json when the project names one, else the lock file present,
 * else npm.
 *
 * @param {string} projectRoot Directory to inspect.
 * @returns {string} The npm client name.
 */
function detectNpmClient(projectRoot) {
  const packageJsonPath = join(projectRoot, "package.json");
  if (safeExistsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(
        safeReadFileSync(packageJsonPath, "utf-8"),
      );
      const pinned = `${packageJson?.packageManager || ""}`;
      const at = pinned.indexOf("@");
      const name = (at > 0 ? pinned.slice(0, at) : pinned).trim();
      if (name) {
        return name;
      }
    } catch {
      // An unreadable package.json leaves the lock files to answer.
    }
  }
  const lockClients = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["deno.lock", "deno"],
    ["package-lock.json", "npm"],
  ];
  for (const [lockName, client] of lockClients) {
    if (safeExistsSync(join(projectRoot, lockName))) {
      return client;
    }
  }
  return "npm";
}

/**
 * Gather the command-shaping facts for a project root. The result is cached
 * per root, so repeated scoring passes over the same project read the
 * filesystem once.
 *
 * @param {string} projectRoot Directory that was scanned.
 * @param {Object} [options] Test hooks.
 * @param {"posix"|"windows"} [options.platform] Platform override; defaults to the runtime platform.
 * @returns {import("./shapeCommand.js").CommandFacts} Facts for the resolver.
 */
export function collectCommandFacts(projectRoot, options = {}) {
  const platform =
    options.platform ||
    (globalThis.process?.platform === "win32" ? "windows" : "posix");
  const cacheKey = `${platform}\n${projectRoot || ""}`;
  const cached = factsCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const facts = {
    projectRoot: projectRoot || "",
    platform,
    wrappers: {},
    pythonManager: undefined,
    pythonManagerCandidates: [],
    npmClient: "npm",
  };
  if (projectRoot && safeExistsSync(projectRoot)) {
    const checkExecutable = platform === "posix";
    for (const [fileName, factName] of POSIX_WRAPPERS) {
      const wrapperPath = join(projectRoot, fileName);
      if (isUsableExecutable(wrapperPath, checkExecutable)) {
        facts.wrappers[factName] = true;
      } else if (safeExistsSync(wrapperPath)) {
        facts.wrappers[`${factName}Inexecutable`] = true;
      }
    }
    for (const [fileName, factName] of WINDOWS_WRAPPERS) {
      if (isUsableExecutable(join(projectRoot, fileName), false)) {
        facts.wrappers[factName] = true;
      }
    }
    const python = detectPythonManager(projectRoot);
    facts.pythonManager = python.manager;
    facts.pythonManagerCandidates = python.candidates;
    facts.npmClient = detectNpmClient(projectRoot);
  }
  factsCache.set(cacheKey, facts);
  return facts;
}

/**
 * Forget the gathered facts. Test hook; a production run gathers once.
 *
 * @returns {void}
 */
export function clearCommandFactsCache() {
  factsCache.clear();
}
