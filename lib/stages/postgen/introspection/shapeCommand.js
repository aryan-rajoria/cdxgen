/**
 * Command shaping for remediation actions.
 *
 * The remediation catalog authors commands with template variables where the
 * right value depends on the scanned project: which maven or gradle
 * executable the repo wraps, which Python manager owns its lock files, which
 * client npm itself should use. This module substitutes those variables from
 * a facts object the caller gathered earlier, and names on every shaped
 * command the detection it relied on, so a reviewer can tell a correct
 * detection from a lucky default.
 *
 * Every function here is pure: the facts object is the only input beyond the
 * template string, nothing reads the filesystem, and the same facts always
 * yield the same command. The filesystem reads live in the collector
 * (`commandFacts.js`).
 */

/**
 * Template variables this module substitutes, beside the `{{version}}` and
 * `{{major}}` placeholders the version cascade fills.
 *
 * @type {Readonly<string[]>}
 */
export const SHAPE_VARIABLES = Object.freeze([
  "mvn",
  "gradle",
  "pythonManager",
  "npmClient",
  "go",
  "cargo",
  "composer",
  "dart",
  "mix",
  "cabal",
]);

/**
 * Python managers a command can name, with the lock command each catalog
 * entry pairs the variable with.
 *
 * @type {Readonly<string[]>}
 */
export const PYTHON_MANAGERS = Object.freeze(["uv", "poetry", "pdm", "pipenv"]);

/**
 * Project facts one shaping pass consumes. Produced once per run by the
 * collector; every field is optional so a caller without collector facts
 * still resolves the fallbacks.
 *
 * @typedef {Object} CommandFacts
 * @property {string} [projectRoot] Directory the facts were gathered from.
 * @property {"posix"|"windows"} [platform] Platform the command targets; defaults to posix.
 * @property {Object} [wrappers] Wrapper presence facts, executable-bit included for the platform's script.
 * @property {boolean} [wrappers.mvnw] ./mvnw exists and is executable.
 * @property {boolean} [wrappers.mvnwInexecutable] ./mvnw exists but is not executable.
 * @property {boolean} [wrappers.mvnwCmd] mvnw.cmd exists (Windows variant).
 * @property {boolean} [wrappers.gradlew] ./gradlew exists and is executable.
 * @property {boolean} [wrappers.gradlewInexecutable] ./gradlew exists but is not executable.
 * @property {boolean} [wrappers.gradlewBat] gradlew.bat exists (Windows variant).
 * @property {boolean} [wrappers.composerPhar] ./composer.phar exists and is executable.
 * @property {string|undefined} [pythonManager] The Python manager in play.
 * @property {string[]} [pythonManagerCandidates] Every manager detected, when two or more compete.
 * @property {string} [npmClient] The npm client the project names or locks.
 */

/** Wrapper executable the POSIX {{mvn}} variable resolves to. */
const MAVEN_WRAPPER_POSIX = "./mvnw";
/** Wrapper executable the Windows {{mvn}} variable resolves to. */
const MAVEN_WRAPPER_WINDOWS = "mvnw.cmd";
/** Wrapper executable the POSIX {{gradle}} variable resolves to. */
const GRADLE_WRAPPER_POSIX = "./gradlew";
/** Wrapper executable the Windows {{gradle}} variable resolves to. */
const GRADLE_WRAPPER_WINDOWS = "gradlew.bat";
/** Wrapper executable the POSIX {{composer}} variable resolves to. */
const COMPOSER_PHAR_POSIX = "./composer.phar";

/**
 * The facts for the platform one command variant targets: the collector's
 * platform fact describes the run, while a Windows command string needs
 * Windows resolution even on a POSIX run.
 *
 * @param {CommandFacts} facts Gathered facts.
 * @param {boolean} windows True for a Windows command variant.
 * @returns {CommandFacts} Facts pinned to the requested platform.
 */
function factsForPlatform(facts, windows) {
  const platform = windows
    ? "windows"
    : facts?.platform === "windows"
      ? "windows"
      : "posix";
  return { ...(facts || {}), platform };
}

/**
 * Resolve the `{{mvn}}` variable for one platform: the project's wrapper
 * when it is present and usable, the plain executable otherwise.
 *
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{value: string, shapedBy: string|undefined}} Substitute and the detection behind it, when there was one.
 */
function resolveMaven(facts) {
  const windows = facts.platform === "windows";
  const wrapper = windows ? facts?.wrappers?.mvnwCmd : facts?.wrappers?.mvnw;
  if (wrapper) {
    return {
      value: windows ? MAVEN_WRAPPER_WINDOWS : MAVEN_WRAPPER_POSIX,
      shapedBy: `wrapper:${windows ? MAVEN_WRAPPER_WINDOWS : MAVEN_WRAPPER_POSIX}`,
    };
  }
  if (!windows && facts?.wrappers?.mvnwInexecutable) {
    return {
      value: "mvn",
      shapedBy: `wrapper-not-executable:${MAVEN_WRAPPER_POSIX}`,
    };
  }
  return { value: "mvn", shapedBy: undefined };
}

/**
 * Resolve the `{{gradle}}` variable for one platform: the project's wrapper
 * when it is present and usable, the plain executable otherwise.
 *
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{value: string, shapedBy: string|undefined}} Substitute and the detection behind it, when there was one.
 */
function resolveGradle(facts) {
  const windows = facts.platform === "windows";
  const wrapper = windows
    ? facts?.wrappers?.gradlewBat
    : facts?.wrappers?.gradlew;
  if (wrapper) {
    return {
      value: windows ? GRADLE_WRAPPER_WINDOWS : GRADLE_WRAPPER_POSIX,
      shapedBy: `wrapper:${windows ? GRADLE_WRAPPER_WINDOWS : GRADLE_WRAPPER_POSIX}`,
    };
  }
  if (!windows && facts?.wrappers?.gradlewInexecutable) {
    return {
      value: "gradle",
      shapedBy: `wrapper-not-executable:${GRADLE_WRAPPER_POSIX}`,
    };
  }
  return { value: "gradle", shapedBy: undefined };
}

/**
 * Resolve the `{{pythonManager}}` variable: the manager the collector
 * detected, left unresolved when two managers compete and the project does
 * not settle the question, or when none was detected.
 *
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{value: string|undefined, shapedBy: string|undefined, shapedNote: string|undefined}} Substitute, the detection behind it, and the question for the agent when detection could not answer.
 */
function resolvePythonManager(facts) {
  const manager = facts?.pythonManager;
  if (manager) {
    return {
      value: manager,
      shapedBy: `manager:${manager}`,
      shapedNote: undefined,
    };
  }
  const candidates = Array.isArray(facts?.pythonManagerCandidates)
    ? facts.pythonManagerCandidates.filter(Boolean)
    : [];
  if (candidates.length > 1) {
    return {
      value: undefined,
      shapedBy: "manager:ambiguous",
      shapedNote: `this project carries the lock files of ${candidates.join(" and ")}; confirm which one manages it before locking`,
    };
  }
  return {
    value: undefined,
    shapedBy: "manager:unresolved",
    shapedNote: undefined,
  };
}

/**
 * Resolve the `{{npmClient}}` variable: the client the project names or
 * locks, npm when nothing says otherwise.
 *
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{value: string, shapedBy: string|undefined}} Substitute and the detection behind it, when there was one.
 */
function resolveNpmClient(facts) {
  const client = facts?.npmClient || "npm";
  return {
    value: client,
    shapedBy: client === "npm" ? undefined : `npm-client:${client}`,
  };
}

/**
 * Resolve the `{{composer}}` variable: the project's local composer.phar when
 * it is present and usable, the plain executable otherwise.
 *
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{value: string, shapedBy: string|undefined}} Substitute and the detection behind it, when there was one.
 */
function resolveComposer(facts) {
  const windows = facts.platform === "windows";
  if (!windows && facts?.wrappers?.composerPhar) {
    return {
      value: COMPOSER_PHAR_POSIX,
      shapedBy: `wrapper:${COMPOSER_PHAR_POSIX}`,
    };
  }
  return { value: "composer", shapedBy: undefined };
}

/**
 * Resolve a tool variable whose executable no wrapper or version manager in
 * the facts overrides: the plain executable name.
 *
 * @param {string} executable The tool's executable name.
 * @returns {(facts: CommandFacts) => {value: string, shapedBy: string|undefined}} Resolver for that tool's variable.
 */
function resolvePlainExecutable(executable) {
  return () => ({ value: executable, shapedBy: undefined });
}

const VARIABLE_RESOLVERS = {
  mvn: resolveMaven,
  gradle: resolveGradle,
  pythonManager: resolvePythonManager,
  npmClient: resolveNpmClient,
  go: resolvePlainExecutable("go"),
  cargo: resolvePlainExecutable("cargo"),
  composer: resolveComposer,
  dart: resolvePlainExecutable("dart"),
  mix: resolvePlainExecutable("mix"),
  cabal: resolvePlainExecutable("cabal"),
};

/**
 * Substitute one template variable, leaving an unresolved `{{pythonManager}}`
 * verbatim so the command stays an honest question.
 *
 * @param {string} command Command carrying the variable.
 * @param {string} variable Variable name without braces.
 * @param {CommandFacts} facts Platform-pinned facts.
 * @returns {{command: string, shapedBy: string|undefined, shapedNote: string|undefined}} Command after substitution.
 */
function substituteVariable(command, variable, facts) {
  const placeholder = `{{${variable}}}`;
  if (!command.includes(placeholder)) {
    return { command, shapedBy: undefined, shapedNote: undefined };
  }
  const resolved = VARIABLE_RESOLVERS[variable](facts);
  if (!resolved.value) {
    return {
      command,
      shapedBy: resolved.shapedBy,
      shapedNote: resolved.shapedNote,
    };
  }
  return {
    command: command.split(placeholder).join(resolved.value),
    shapedBy: resolved.shapedBy,
    shapedNote: resolved.shapedNote,
  };
}

/**
 * Shape one command string: substitute the template variables the catalog
 * authors into it and report which detection drove the result. A command
 * without any `{{` marker is returned byte-identical and unshaped.
 *
 * @param {string} templateCommand Catalog command template.
 * @param {CommandFacts} [facts] Facts gathered for the scanned project.
 * @returns {{command: string, shapedBy: string|undefined, shapedNote: string|undefined}} The shaped command, the detection behind it, and the question to surface when shaping could not answer.
 */
export function shapeCommand(templateCommand, facts = {}) {
  if (typeof templateCommand !== "string" || !templateCommand.includes("{{")) {
    return {
      command: templateCommand,
      shapedBy: undefined,
      shapedNote: undefined,
    };
  }
  const windows = facts?.platform === "windows";
  const platformFacts = factsForPlatform(facts, windows);
  let command = templateCommand;
  const shapedBy = new Set();
  const notes = new Set();
  for (const variable of SHAPE_VARIABLES) {
    const result = substituteVariable(command, variable, platformFacts);
    command = result.command;
    if (result.shapedBy) {
      shapedBy.add(result.shapedBy);
    }
    if (result.shapedNote) {
      notes.add(result.shapedNote);
    }
  }
  return {
    command,
    shapedBy: shapedBy.size ? [...shapedBy].sort().join("; ") : undefined,
    shapedNote: notes.size ? [...notes].sort().join("; ") : undefined,
  };
}
