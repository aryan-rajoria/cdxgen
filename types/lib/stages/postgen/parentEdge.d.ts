/**
 * Root reachability repair for the `dependencies` graph.
 *
 * CycloneDX expects `metadata.component` to appear in `dependencies` with the
 * first level of the tree in its `dependsOn`. That edge is emitted by each
 * ecosystem leg from whatever manifest declares the direct dependencies, so a
 * leg that resolves a project entirely from a lock file, an export command, or
 * a pre-resolved graph can produce a complete transitive tree that no consumer
 * can enter: every edge is present, but nothing is reachable from the root.
 *
 * This module repairs that shape at finalization time, independent of the
 * ecosystem. When the parent has no outgoing edge and the tree does contain
 * edges, the components that nothing else points to are the roots of the graph,
 * and attaching them to the parent restores reachability for the whole tree.
 *
 * The repair is deliberately weaker than a leg that knows the manifest: a
 * direct dependency that some transitive dependency also requires is not a
 * root here and stays out of the parent's `dependsOn`. It is a safety net that
 * keeps a tree traversable, not a replacement for emitting the edge at the
 * source, and it records what it inferred so consumers can tell the two apart.
 */
/** Property recording how many root edges were inferred rather than observed. */
export declare const INFERRED_ROOTS_PROPERTY = "cdx:bom:inferredRootDependencies";
/**
 * Adds the missing edge from the parent component to the roots of the
 * dependency graph. A no-op unless the document has a parent component with no
 * outgoing edge, a tree that already contains edges, and at least one component
 * that nothing points to.
 *
 * @param {Object} bomJson CycloneDX BOM
 *
 * @returns {Object} The same BOM, repaired in place when applicable
 */
export declare function repairParentDependencyEdge(bomJson: Object): Object;
//# sourceMappingURL=parentEdge.d.ts.map