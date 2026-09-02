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
export declare function collectCommandFacts(projectRoot: string, options?: {
    platform?: "posix" | "windows";
}): import("./shapeCommand.js").CommandFacts;
/**
 * Forget the gathered facts. Test hook; a production run gathers once.
 *
 * @returns {void}
 */
export declare function clearCommandFactsCache(): void;
//# sourceMappingURL=commandFacts.d.ts.map