/**
 * Reader over the BOM's formulation section, the third evidence source.
 *
 * Formulation is two things at once, and the distinction governs every
 * confidence decision downstream. The run-derived half — `type: "platform"`
 * components recording the toolchain the generating run probed, and the git
 * provenance components — is what cdxgen itself did. The config-parsed half —
 * the commands, environment variables and task types under
 * `formulation[].workflows[]` — is what the repo's CI declares, and a
 * declared command was never observed to run.
 *
 * This module is pure: the BOM and the caller's run facts are the only
 * inputs, nothing is read from the filesystem, and environment variable
 * *values* are never touched — names only, because the BOM stores them and
 * copying them into a report would republish them.
 */
/**
 * Property carrying the id of the run that stamped a BOM's formulation, set
 * on every formulation workflow by the introspection pass that reflected
 * over the freshly generated document.
 *
 * @type {string}
 */
export declare const FORMULATION_RUN_ID_PROPERTY: string;
/** The formulation record was produced by the run being reflected. */
export declare const FORMULATION_ORIGIN_SAME_RUN = "same-run";
/** The formulation record came with a BOM this run did not generate. */
export declare const FORMULATION_ORIGIN_FOREIGN = "foreign";
/**
 * The BOM carries no formulation record at all, which is neither of the
 * above: there is no evidence to weigh, so every consumer must behave as it
 * did before formulation became a source.
 */
export declare const FORMULATION_ORIGIN_ABSENT = "absent";
/**
 * Platform component names, as the environment probes emit them, mapped to
 * the canonical ecosystem whose row their facts can corroborate. Names not
 * listed here have no fidelity row to join.
 *
 * @type {Readonly<Record<string, string>>}
 */
export declare const TOOL_NAME_ECOSYSTEMS: Readonly<Record<string, string>>;
/**
 * Resolver executables whose presence in a declared command says a build or
 * dependency resolution was attempted, mapped to the ecosystem they drive.
 * Keys are executable basenames, lower-cased.
 *
 * @type {Readonly<Record<string, string>>}
 */
export declare const RESOLVER_EXECUTABLES: Readonly<Record<string, string>>;
/**
 * Whether an `executed` value is a CI action reference such as
 * `actions/checkout@<sha>` rather than a shell command. An action reference
 * carries no whitespace, contains a path separator, and names a revision of
 * the repository after the last separator; a relative-path executable such
 * as `./mvnw` carries no revision and stays a command.
 *
 * @param {string|undefined} executed The executed value of a step command.
 * @returns {boolean} True when the value names an action, not a command.
 */
export declare function isActionReference(executed: string | undefined): boolean;
/**
 * The executable a command line starts with, as a bare name.
 *
 * @param {string|undefined} commandLine Command line.
 * @returns {string} Basename of the first whitespace token, or "" when absent.
 */
export declare function executableOf(commandLine: string | undefined): string;
/**
 * Read the provenance-aware formulation evidence out of a BOM.
 *
 * `origin` decides how the evidence may be used. `same-run` means the
 * formulation describes this very run — its platform components are the same
 * probes the ledger recorded as `tool.resolved`, so the evidence corroborates
 * and must never add confidence. `foreign` means the BOM arrived without a
 * ledger for its generation, and the formulation is the only surviving trace
 * of what that build attempted. `absent` is neither: the BOM carries no
 * formulation record, so there is nothing to weigh and every consumer keeps
 * the behaviour it had before formulation became a source.
 *
 * Environment variable names are collected; values are never read.
 *
 * @param {Object} bomJson CycloneDX BOM.
 * @param {Object} [context] Run facts the caller already knows.
 * @param {string} [context.runId] This reflection's run id, matched against the formulation's marker.
 * @param {number} [context.ledgerEventCount] Events the ledger holds for this BOM's generation.
 * @returns {{
 *   origin: "same-run"|"foreign"|"absent",
 *   tools: {name: string|undefined, version: string|undefined, source: "probe"}[],
 *   declaredCommands: {executable: string, commandLine: string, workflow: string|undefined, task: string|undefined, step: string|undefined, source: "ci-config"}[],
 *   sourceTree: {commit: string|undefined, treeId: string|undefined, fileCount: number}|undefined,
 *   environmentKeys: string[]
 * }} The formulation evidence.
 */
export declare function readFormulationEvidence(bomJson: Object, context?: {
    runId?: string;
    ledgerEventCount?: number;
}): {
    origin: "same-run" | "foreign" | "absent";
    tools: {
        name: string | undefined;
        version: string | undefined;
        source: "probe";
    }[];
    declaredCommands: {
        executable: string;
        commandLine: string;
        workflow: string | undefined;
        task: string | undefined;
        step: string | undefined;
        source: "ci-config";
    }[];
    sourceTree: {
        commit: string | undefined;
        treeId: string | undefined;
        fileCount: number;
    } | undefined;
    environmentKeys: string[];
};
/**
 * The formulation platform entry for the runtime family this reflection runs
 * on, when the record cannot describe the machine in use: either the
 * recorded version of the family differs from the runtime actually running,
 * or the record names other toolchains but no entry of this family at all. A
 * difference proves the formulation's toolchain record describes a machine
 * other than the one re-scanning the BOM; it says nothing about the other
 * toolchains the record names, which no probe of this run observed.
 *
 * @param {Object} evidence Formulation evidence from readFormulationEvidence.
 * @param {Object} runtime The reflection's runtime facts.
 * @param {string} runtime.name Runtime name, such as "Node.js".
 * @param {string} runtime.version Runtime version.
 * @returns {{tool: string, recordedVersion: string|undefined, runtimeVersion: string}|undefined} The mismatching formulation entry, when one exists.
 */
export declare function findRuntimeToolMismatch(evidence: Object, runtime: {
    name: string;
    version: string;
}): {
    tool: string;
    recordedVersion: string | undefined;
    runtimeVersion: string;
} | undefined;
/**
 * The declared CI command a formulation records for one ecosystem, if any.
 * Commands carry no ecosystem tag, so the executable answers: the first
 * declared command whose executable drives that ecosystem's resolver wins,
 * in the order the formulation records them.
 *
 * @param {Object} evidence Formulation evidence from readFormulationEvidence.
 * @param {string} ecosystem Canonical ecosystem name.
 * @returns {Object|undefined} The matching declared command entry.
 */
export declare function declaredCommandForEcosystem(evidence: Object, ecosystem: string): Object | undefined;
//# sourceMappingURL=formulationEvidence.d.ts.map