/**
 * Structural BOM diff.
 *
 * Produces a human-readable structural comparison of two normalized CycloneDX
 * BOMs: added/removed/changed components first, then capped field-level detail.
 * Never dumps a 10,000-line text diff.
 *
 * Used by:
 * - The golden runner (to explain a failure).
 * - `UPDATE_GOLDEN=1` regeneration summary (to report what changed).
 */

const MAX_FIELD_DETAILS = 20;
const MAX_PATH_DEPTH = 3;

/**
 * Build a lookup of components keyed by their normalized bom-ref (or purl).
 */
function indexComponents(components) {
  const map = new Map();
  for (const c of components || []) {
    const key = c["bom-ref"] || c.purl || `${c.type}:${c.name}:${c.version}`;
    map.set(key, c);
  }
  return map;
}

/**
 * Build a lookup of dependency nodes keyed by ref.
 */
function indexDependencies(deps) {
  const map = new Map();
  for (const d of deps || []) {
    map.set(d.ref, d);
  }
  return map;
}

/**
 * Short label for a component: type:name@version.
 */
function compLabel(c) {
  const group = c.group ? `${c.group}/` : "";
  return `${c.type || "?"}:${group}${c.name || "?"}@${c.version || "?"}`;
}

/**
 * Deep diff two values, returning a list of human-readable change descriptions.
 * Recurses into objects and arrays (by index for arrays).
 */
function deepDiff(path, a, b, changes) {
  if (a === b) {
    return;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    changes.push(`${path}: ${truncate(JSON.stringify(a))} → ${truncate(JSON.stringify(b))}`);
    return;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const subPath = path ? `${path}.${key}` : key;
      // Skip undefined values — they are absent in JSON and only exist as
      // JS object property artifacts (e.g. from structuredClone).
      const aHas = key in a && a[key] !== undefined;
      const bHas = key in b && b[key] !== undefined;
      if (bHas && !aHas) {
        changes.push(`${subPath}: + ${truncate(JSON.stringify(b[key]))}`);
      } else if (aHas && !bHas) {
        changes.push(`${subPath}: - ${truncate(JSON.stringify(a[key]))}`);
      } else if (aHas && bHas) {
        deepDiff(subPath, a[key], b[key], changes);
      }
    }
    return;
  }
  changes.push(`${path}: ${truncate(JSON.stringify(a))} → ${truncate(JSON.stringify(b))}`);
}

function truncate(s) {
  if (s === undefined) {
    return "undefined";
  }
  if (s === null) {
    return "null";
  }
  if (s.length > 120) {
    return `${s.slice(0, 117)}...`;
  }
  return s;
}

/**
 * Compare two normalized BOMs and return a structural diff summary.
 *
 * @param {Object} actual Normalized actual BOM.
 * @param {Object} expected Normalized expected BOM.
 * @returns {{ isEqual: boolean, summary: string, details: string[] }}
 */
export function diffBoms(actual, expected) {
  const details = [];
  const summaryParts = [];

  // --- Components ---
  const actualComps = indexComponents(actual?.components);
  const expectedComps = indexComponents(expected?.components);
  const allCompKeys = new Set([...actualComps.keys(), ...expectedComps.keys()]);

  const addedComps = [];
  const removedComps = [];
  const changedComps = [];

  for (const key of allCompKeys) {
    const a = actualComps.get(key);
    const e = expectedComps.get(key);
    if (a && !e) {
      addedComps.push(compLabel(a));
    } else if (!a && e) {
      removedComps.push(compLabel(e));
    } else if (a && e) {
      const fieldChanges = [];
      deepDiff("", a, e, fieldChanges);
      if (fieldChanges.length > 0) {
        changedComps.push({ label: compLabel(a), changes: fieldChanges });
      }
    }
  }

  if (addedComps.length) {
    summaryParts.push(`+${addedComps.length} components`);
  }
  if (removedComps.length) {
    summaryParts.push(`-${removedComps.length} components`);
  }
  if (changedComps.length) {
    summaryParts.push(`~${changedComps.length} components changed`);
  }

  // --- Dependencies ---
  const actualDeps = indexDependencies(actual?.dependencies);
  const expectedDeps = indexDependencies(expected?.dependencies);
  const allDepKeys = new Set([...actualDeps.keys(), ...expectedDeps.keys()]);

  const depChanges = [];
  for (const key of allDepKeys) {
    const a = actualDeps.get(key);
    const e = expectedDeps.get(key);
    if (a && !e) {
      depChanges.push(`+ dep ${key}`);
    } else if (!a && e) {
      depChanges.push(`- dep ${key}`);
    } else if (a && e) {
      const aSet = new Set(a.dependsOn || []);
      const eSet = new Set(e.dependsOn || []);
      const added = [...aSet].filter((d) => !eSet.has(d));
      const removed = [...eSet].filter((d) => !aSet.has(d));
      if (added.length || removed.length) {
        const parts = [];
        if (added.length) {
          parts.push(`+dependsOn:[${added.slice(0, 5).join(", ")}]`);
        }
        if (removed.length) {
          parts.push(`-dependsOn:[${removed.slice(0, 5).join(", ")}]`);
        }
        depChanges.push(`~ dep ${key}: ${parts.join(" ")}`);
      }
    }
  }
  if (depChanges.length) {
    summaryParts.push(`~${depChanges.length} dependency edges changed`);
  }

  // --- Metadata component ---
  const metaChanges = [];
  if (actual?.metadata?.component && expected?.metadata?.component) {
    deepDiff(
      "metadata.component",
      actual.metadata.component,
      expected.metadata.component,
      metaChanges,
    );
  }
  if (metaChanges.length) {
    summaryParts.push(`~metadata.component changed`);
  }

  // --- Assemble details (capped) ---
  if (removedComps.length) {
    details.push("Removed components:");
    for (const c of removedComps.slice(0, MAX_FIELD_DETAILS)) {
      details.push(`  - ${c}`);
    }
  }
  if (addedComps.length) {
    details.push("Added components:");
    for (const c of addedComps.slice(0, MAX_FIELD_DETAILS)) {
      details.push(`  + ${c}`);
    }
  }
  if (changedComps.length) {
    details.push("Changed components:");
    let shown = 0;
    for (const { label, changes } of changedComps) {
      if (shown >= MAX_FIELD_DETAILS) {
        details.push(`  ... and ${changedComps.length - shown} more`);
        break;
      }
      details.push(`  ~ ${label}:`);
      for (const ch of changes.slice(0, MAX_PATH_DEPTH)) {
        details.push(`      ${ch}`);
      }
      shown++;
    }
  }
  if (depChanges.length) {
    details.push("Dependency changes:");
    for (const d of depChanges.slice(0, MAX_FIELD_DETAILS)) {
      details.push(`  ${d}`);
    }
    if (depChanges.length > MAX_FIELD_DETAILS) {
      details.push(`  ... and ${depChanges.length - MAX_FIELD_DETAILS} more`);
    }
  }
  if (metaChanges.length) {
    details.push("Metadata component changes:");
    for (const m of metaChanges.slice(0, MAX_FIELD_DETAILS)) {
      details.push(`  ${m}`);
    }
  }

  const isEqual =
    addedComps.length === 0 &&
    removedComps.length === 0 &&
    changedComps.length === 0 &&
    depChanges.length === 0 &&
    metaChanges.length === 0;

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(", ")
      : "identical";

  return { isEqual, summary, details };
}

/**
 * Format the diff as a single human-readable string block.
 */
export function formatDiff(actual, expected) {
  const { isEqual, summary, details } = diffBoms(actual, expected);
  const lines = [`  BOM diff: ${summary}`];
  if (!isEqual && details.length > 0) {
    lines.push(...details.map((d) => `    ${d}`));
  }
  return lines.join("\n");
}
