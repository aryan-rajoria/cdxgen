/**
 * Resolve the ecosystem a declared tool belongs to.
 *
 * @param {string} tool Declared tool name
 * @returns {string} cdxgen ecosystem name, or "generic" for unknown tools.
 */
export declare function ecosystemForTool(tool: string): string;
/**
 * Check whether a version identifier carries a prerelease suffix such as
 * `-rc-3`, `-M2`, or `-milestone-1`. The marker list is exact so that vendor
 * suffixes that merely begin with the same letters, such as the `-crac` java
 * distributions, stay classified as stable.
 *
 * @param {string} version Version identifier
 * @returns {boolean} True for prerelease versions.
 */
export declare function isPrereleaseVersion(version: string): boolean;
/**
 * Compare two dotted version identifiers. Numeric components are compared
 * numerically, stable releases rank above prereleases, and prerelease
 * suffixes are compared token-wise so `rc-9` beats `rc-10` only when
 * numerically larger. Missing components count as zero, so `21` equals
 * `21.0.0`.
 *
 * @param {string} a First version
 * @param {string} b Second version
 * @returns {number} Negative when a < b, positive when a > b, zero on equality.
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Extract the JDK major from a `java --version` style description such as
 * `openjdk 21.0.11 2025-04-15` or a bare sdkman java identifier such as
 * `25-tem`. General availability releases print an undotted major
 * (`openjdk 25 2025-09-16`), so the first token starting with a digit is
 * used rather than requiring a dotted version.
 *
 * @param {string} versionDesc Version description string
 * @returns {number|undefined} JDK major version.
 */
export declare function extractJavaMajor(versionDesc: string): number | undefined;
/**
 * Extract the first version-looking token from a tool version description,
 * such as `go version go1.23.1 darwin/arm64` or `rustc 1.82.0 (f6e511eec
 * 2024-10-08)`. Leading letters (`v20.11.1`, `go1.23.1`) and quoting are
 * stripped before validation.
 *
 * @param {string} versionDesc Raw version description
 * @returns {string|undefined} The version token, when one is found.
 */
export declare function extractVersionToken(versionDesc: string): string | undefined;
export type RequirementVerdict = "satisfied" | "violated" | "unparseable";
/**
 * Verdict of a declared-requirement check. `unparseable` means the wanted or
 * found value carries no comparable version, which is never evidence of a
 * defect: an unparseable requirement must not produce a mismatch.
 *
 * @typedef {"satisfied"|"violated"|"unparseable"} RequirementVerdict
 */
/**
 * Check whether a found version satisfies a declared requirement. Wanted
 * forms handled: exact versions (`3.9.9`), major-only and partial pins
 * (`21`, `20.11`), `.x` ranges (`20.x`), caret and tilde ranges (`^20.11`,
 * `~4.9`), comparison ranges (`>=18`, `<21`), hyphen ranges (`1.9 - 2.3`),
 * whitespace-conjoined ranges (`>=18 <=20`), `||` alternatives, and the
 * unconstrained `*`/`latest`. Anything else is unparseable and never
 * violates.
 *
 * @param {string} found Version actually present, possibly embedded in a
 *   longer description such as `go version go1.23.1 darwin/arm64`.
 * @param {string} wanted Declared requirement.
 * @returns {RequirementVerdict} Verdict of the check.
 */
export declare function checkVersionRequirement(found: string, wanted: string): RequirementVerdict;
/**
 * Classify the result of a failed tool probe. A probe that was denied the
 * right to run must be reported as `denied` — the tool may well be present —
 * while only evidence that the command does not exist counts as `missing`.
 *
 * @param {Object|string|undefined} result Result object from spawnSync, or
 *   undefined when no result shape is known.
 * @returns {"found"|"denied"|"missing"} Classification of the probe result.
 */
export declare function classifyProbeResult(result: Object | string | undefined): "found" | "denied" | "missing";
/**
 * Classify the active environment restriction that would stop a command from
 * running, without the human-readable wording. `describeSpawnRestriction`
 * derives its message from this classifier, and consumers that need to act on
 * the cause rather than the prose use it directly.
 *
 * @param {string} command Command that would run
 * @returns {"dry-run"|"secure-mode"|"allowlist"|"deno"|undefined} Restriction cause, or undefined when nothing restricts the command.
 */
export declare function classifySpawnRestriction(command: string): "dry-run" | "secure-mode" | "allowlist" | "deno" | undefined;
/**
 * Explain why a command probe may not run in the current environment, so a
 * failed probe can be reported as degraded evidence rather than a missing
 * tool.
 *
 * @param {string} command Command that was probed
 * @returns {string|undefined} Human-readable restriction, or undefined when
 *   the environment does not restrict the command.
 */
export declare function describeSpawnRestriction(command: string): string | undefined;
/**
 * Parse the content of an asdf/mise `.tool-versions` file into the first
 * version each tool declares. Comment lines and inline comments are ignored;
 * a tool line listing several versions keeps the first.
 *
 * @param {string} content `.tool-versions` file content
 * @returns {Object|undefined} Map of tool name to declared version.
 */
export declare function parseToolVersionsFile(content: string): Object | undefined;
/**
 * Parse the `go` and `toolchain` directives of a `go.mod` file. The
 * `toolchain` directive wins when both are present because it names the
 * exact toolchain the module asks for.
 *
 * @param {string} content `go.mod` file content
 * @returns {Object|undefined} `{ tool, version, directive }` with
 *   `directive` naming the line the version came from.
 */
export declare function parseGoModFile(content: string): Object | undefined;
/**
 * Parse a `rust-toolchain.toml` or plain `rust-toolchain` file into its
 * channel. Target-specific subsections are ignored, so only the `[toolchain]`
 * section's `channel` key is read.
 *
 * @param {string} content Toolchain file content
 * @returns {Object|undefined} `{ channel }` when a channel is declared.
 */
export declare function parseRustToolchainFile(content: string): Object | undefined;
/**
 * Parse a `package.json` content into the tool requirements it declares
 * through `engines` and `packageManager`. The `packageManager` pin's
 * integrity-hash suffix (`pnpm@9.1.0+sha512.…`) is stripped to the bare
 * version.
 *
 * @param {string} content `package.json` content
 * @returns {Object|undefined} Map of tool name to declared version.
 */
export declare function parsePackageJsonToolRequirements(content: string): Object | undefined;
/**
 * Parse a `global.json` file into the .NET SDK version it pins.
 *
 * @param {string} content `global.json` content
 * @returns {Object|undefined} Map with the `dotnet` requirement.
 */
export declare function parseGlobalJsonToolRequirements(content: string): Object | undefined;
/**
 * Parse the `requires-python` declaration of a `pyproject.toml` file.
 *
 * @param {string} content `pyproject.toml` content
 * @returns {Object|undefined} Map with the `python` requirement.
 */
export declare function parsePyprojectRequiresPython(content: string): Object | undefined;
/**
 * Parse an `.nvmrc` file into the Node.js version it requests.
 *
 * @param {string} content `.nvmrc` content
 * @returns {Object|undefined} Map with the `node` requirement.
 */
export declare function parseNvmrc(content: string): Object | undefined;
/**
 * Parse a `.python-version` file into the interpreter version it requests.
 *
 * @param {string} content `.python-version` content
 * @returns {Object|undefined} Map with the `python` requirement.
 */
export declare function parsePythonVersionFile(content: string): Object | undefined;
/**
 * Parse a `.java-version` file into the JDK version it pins. Both the bare
 * major (`21`) and a full version (`21.0.5`) occur in the wild, and both are
 * passed through verbatim — an install command needs the exact declaration.
 *
 * The legacy `1.N` spelling of a pre-9 release (`1.8`, `1.8.0_302`) is
 * normalised to its modern major (`8`), because it is the major line that
 * names a package: the literal declaration yields `Temurin.1.JDK`, which no
 * provisioner offers.
 *
 * Distribution-prefixed values written by version managers (`temurin-21`,
 * `openjdk64-17.0.1`) name a vendor build rather than a release, so they are
 * left unparsed rather than turned into an install argument no provisioner
 * accepts; the run then reports the version as unresolved and the agent asks.
 *
 * @param {string} content `.java-version` content
 * @returns {Object|undefined} Map with the `java` requirement.
 */
export declare function parseJavaVersionFile(content: string): Object | undefined;
/**
 * Parse the `BUNDLED WITH` section of a `Gemfile.lock` into the bundler
 * version the lockfile was written with.
 *
 * @param {string} content `Gemfile.lock` content
 * @returns {string|undefined} Bundler version, when declared.
 */
export declare function parseGemfileLockBundlerVersion(content: string): string | undefined;
/**
 * Read every declared tool requirement a project directory declares through
 * its well-known tool pin files: `.tool-versions`, `.nvmrc`, `.java-version`,
 * `.python-version`, `pyproject.toml`, `go.mod`, `rust-toolchain.toml`,
 * `rust-toolchain`, `package.json`, and `global.json`. Missing files are
 * skipped; each entry names the file that declared it so the report can
 * trace every expectation back to its source.
 *
 * @param {string} projectPath Project directory to inspect
 * @returns {Array<{tool: string, wanted: string, source: string, ecosystem: string, path: string}>}
 *   Declared requirements, empty when the directory declares none.
 */
export declare function readDeclaredToolRequirements(projectPath: string): Array<{
    tool: string;
    wanted: string;
    source: string;
    ecosystem: string;
    path: string;
}>;
//# sourceMappingURL=toolRequirements.d.ts.map