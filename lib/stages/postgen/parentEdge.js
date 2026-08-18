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

import { readEnvironmentVariable } from "../../core/activity.js";
import { thoughtLog } from "../../core/logger.js";

/** Property recording how many root edges were inferred rather than observed. */
export const INFERRED_ROOTS_PROPERTY = "cdx:bom:inferredRootDependencies";

/**
 * Collects the bom-refs of every component in the document, including nested
 * subcomponents and the subcomponents of the parent itself.
 *
 * @param {Object} bomJson CycloneDX BOM
 * @returns {Set<string>} Known component bom-refs
 */
function collectComponentRefs(bomJson) {
  const refs = new Set();
  const visit = (component) => {
    if (!component) {
      return;
    }
    if (component["bom-ref"]) {
      refs.add(component["bom-ref"]);
    }
    for (const sub of component.components || []) {
      visit(sub);
    }
  };
  for (const component of bomJson?.components || []) {
    visit(component);
  }
  for (const sub of bomJson?.metadata?.component?.components || []) {
    visit(sub);
  }
  for (const service of bomJson?.services || []) {
    if (service?.["bom-ref"]) {
      refs.add(service["bom-ref"]);
    }
  }
  return refs;
}

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
export function repairParentDependencyEdge(bomJson) {
  if (readEnvironmentVariable("CDXGEN_PARENT_EDGE_REPAIR") === "false") {
    return bomJson;
  }
  const dependencies = bomJson?.dependencies;
  const parentRef = bomJson?.metadata?.component?.["bom-ref"];
  if (!parentRef || !Array.isArray(dependencies) || !dependencies.length) {
    return bomJson;
  }
  const lowerParentRef = parentRef.toLowerCase();
  let parentEntry;
  let hasEdges = false;
  const referenced = new Set();
  for (const adep of dependencies) {
    if (!adep?.ref) {
      continue;
    }
    if (adep.ref.toLowerCase() === lowerParentRef) {
      parentEntry = adep;
    }
    if (adep.dependsOn?.length) {
      hasEdges = true;
    }
    for (const ref of adep.dependsOn || []) {
      referenced.add(ref);
    }
    // A crypto asset that is only ever provided is not a root of the tree.
    for (const ref of adep.provides || []) {
      referenced.add(ref);
    }
  }
  if (parentEntry?.dependsOn?.length) {
    return bomJson;
  }
  // Without a single edge there is no tree to enter, only a flat inventory such
  // as a container image or an OS package list, where a fabricated root edge
  // would assert a relationship that was never observed.
  if (!hasEdges) {
    return bomJson;
  }
  const componentRefs = collectComponentRefs(bomJson);
  const roots = [];
  for (const adep of dependencies) {
    const ref = adep?.ref;
    if (
      !ref ||
      ref.toLowerCase() === lowerParentRef ||
      referenced.has(ref) ||
      !componentRefs.has(ref)
    ) {
      continue;
    }
    roots.push(ref);
  }
  // Every component being a root means the observed edges all pointed at refs
  // that no component in the document declares, so the graph cannot be trusted.
  if (!roots.length || roots.length === componentRefs.size) {
    return bomJson;
  }
  roots.sort();
  if (parentEntry) {
    parentEntry.dependsOn = roots;
  } else {
    dependencies.splice(0, 0, { ref: parentRef, dependsOn: roots });
  }
  if (!bomJson.metadata.properties) {
    bomJson.metadata.properties = [];
  }
  const existing = bomJson.metadata.properties.find(
    (p) => p.name === INFERRED_ROOTS_PROPERTY,
  );
  if (existing) {
    existing.value = `${roots.length}`;
  } else {
    bomJson.metadata.properties.push({
      name: INFERRED_ROOTS_PROPERTY,
      value: `${roots.length}`,
    });
  }
  thoughtLog(
    `The parent component had no direct dependencies, so I attached the ${roots.length} component(s) that nothing else depends on to keep the tree reachable.`,
  );
  return bomJson;
}
