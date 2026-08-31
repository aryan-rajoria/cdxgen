/**
 * Ecosystem marker detection for the build-introspection reflection step.
 *
 * A marker is a manifest or lockfile whose presence on disk proves an
 * ecosystem was part of the scanned project. Markers drive two verdicts:
 * an ecosystem with markers but zero components in the BOM is `absent`, and
 * an ecosystem that has markers but no cdxgen project type at all is a
 * coverage gap (`unsupported`), which is cdxgen's backlog rather than the
 * user's problem.
 *
 * Detection is deliberately bounded: the scanned directory itself plus one
 * level of immediate subdirectories. postProcess runs after generation, so a
 * second full tree walk would be a measurable cost on large repos; markers
 * deeper than one directory level are simply not seen, which is acceptable
 * because tier assignment never relies on markers alone when the BOM already
 * carries the ecosystem's components.
 */
/**
 * Marker table: ecosystem → manifest and lockfile names that indicate the
 * ecosystem is part of the project. Entries are either exact file names or
 * `{ suffix }` matchers for extension-driven ecosystems. Ecosystems cdxgen
 * cannot parse (elm, crystal, nim, perl, r) are included so the reflection
 * can report them as coverage gaps instead of silently ignoring them.
 *
 * @type {Readonly<Record<string, {names: string[], suffixes: string[]}>>}
 */
export declare const ECOSYSTEM_MARKERS: Readonly<Record<string, {
    names: string[];
    suffixes: string[];
}>>;
/** Marker file name → ecosystems claiming it, and marker suffix → claiming
 * ecosystems, both built once from the table. The name index is exported so
 * the reflection can recognize marker paths carried in ledger events without
 * rescanning the filesystem. */
export declare const MARKERS_BY_NAME: Map<any, any>;
/**
 * Detect ecosystem markers under a project directory without walking the full
 * tree: the directory itself is inspected, then up to
 * {@link MAX_SUBDIRS_SCANNED} immediate subdirectories in sorted order. Paths
 * are built with `node:path`, so `markersOnDisk` carries platform-correct
 * separators.
 *
 * @param {string} projectPath Directory that was scanned, when known.
 * @param {Object} [hooks] Test hooks.
 * @param {(dirPath: string) => {name: string, directory: boolean}[]} [hooks.listDir] Directory lister override.
 * @returns {{markersByEcosystem: Map<string, string[]>, scannedDirectories: number}} Marker paths per ecosystem and the number of directories inspected.
 */
export declare function detectEcosystemMarkers(projectPath: string, hooks?: {
    listDir?: (dirPath: string) => {
        name: string;
        directory: boolean;
    }[];
}): {
    markersByEcosystem: Map<string, string[]>;
    scannedDirectories: number;
};
//# sourceMappingURL=markers.d.ts.map