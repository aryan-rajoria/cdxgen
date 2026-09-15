// Shared CSS package-reference extraction for stylesheet content.
//
// Angular style files, Vue and Svelte single-file-component `<style>` blocks,
// and `additionalData` strings injected by vite/vue configs all refer to npm
// packages through the same small set of CSS rules (`@use`, `@import`,
// `@forward`, and `url()` references). The patterns and the `url()` package
// guard live here so every collector applies one dialect instead of drifting
// per-framework copies.
//
// Both patterns are global and therefore stateful (`lastIndex`): call sites
// that reuse them across files must reset `lastIndex = 0` first, the way
// `matchAll` callers in this codebase already do.

/**
 * Patterns matching a package reference inside CSS/SCSS/Less/Stylus content.
 * Capture group 1 holds the reference (for example `bulma/sass/utilities`).
 *
 * @type {RegExp[]}
 */
export const STYLE_PACKAGE_REFERENCE_PATTERNS = [
  /@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"\n)]+)['"]/g,
  /url\(\s*['"](~?[^'"\n)]+)['"]\s*\)/g,
];

/**
 * True when a `url()` reference points at a package rather than a local file.
 * Only the `~package/...` and `node_modules/...` spellings qualify; plain
 * relative URLs stay local.
 *
 * @param {string} reference Value captured from a `url()` rule.
 * @returns {boolean}
 */
export const isPackageStyleUrlReference = (reference) => {
  const normalizedReference = String(reference || "")
    .trim()
    .replaceAll("\\", "/");
  return (
    normalizedReference.startsWith("~") ||
    normalizedReference.startsWith("node_modules/")
  );
};
