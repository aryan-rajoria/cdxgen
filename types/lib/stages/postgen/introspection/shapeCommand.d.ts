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
export declare const SHAPE_VARIABLES: Readonly<string[]>;
/**
 * Python managers a command can name, with the lock command each catalog
 * entry pairs the variable with.
 *
 * @type {Readonly<string[]>}
 */
export declare const PYTHON_MANAGERS: Readonly<string[]>;
export type CommandFacts = {
    /**
     * Directory the facts were gathered from.
     */
    projectRoot?: string;
    /**
     * Platform the command targets; defaults to posix.
     */
    platform?: "posix" | "windows";
    /**
     * Wrapper presence facts, executable-bit included for the platform's script.
     */
    wrappers?: {
        mvnw?: boolean;
        mvnwInexecutable?: boolean;
        mvnwCmd?: boolean;
        gradlew?: boolean;
        gradlewInexecutable?: boolean;
        gradlewBat?: boolean;
        composerPhar?: boolean;
    };
    /**
     * The Python manager in play.
     */
    pythonManager?: string | undefined;
    /**
     * Every manager detected, when two or more compete.
     */
    pythonManagerCandidates?: string[];
    /**
     * The npm client the project names or locks.
     */
    npmClient?: string;
};
/**
 * Shape one command string: substitute the template variables the catalog
 * authors into it and report which detection drove the result. A command
 * without any `{{` marker is returned byte-identical and unshaped.
 *
 * @param {string} templateCommand Catalog command template.
 * @param {CommandFacts} [facts] Facts gathered for the scanned project.
 * @returns {{command: string, shapedBy: string|undefined, shapedNote: string|undefined}} The shaped command, the detection behind it, and the question to surface when shaping could not answer.
 */
export declare function shapeCommand(templateCommand: string, facts?: CommandFacts): {
    command: string;
    shapedBy: string | undefined;
    shapedNote: string | undefined;
};
//# sourceMappingURL=shapeCommand.d.ts.map