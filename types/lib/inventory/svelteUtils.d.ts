/**
 * Build a same-length masked buffer of a `.svelte` source where every byte
 * outside the `<script>` / `<script module>` / `<script context="module">`
 * bodies is replaced by a space (newlines preserved). Because nothing moves,
 * the Babel parse of the buffer yields statement offsets and `loc.line`
 * values that are true to the original file.
 *
 * Handles multiple script blocks, arbitrary attribute order, self-closing and
 * unterminated tags, CRLF input, and a script block appearing after the
 * markup.
 *
 * @param {string} source `.svelte` file content.
 * @returns {string} Same-length buffer containing only the script bodies.
 */
export declare const maskSvelteScripts: (source: string) => string;
/**
 * The `lang` attribute values of the `<script>` blocks, lowercased.
 *
 * @param {string} source `.svelte` file content.
 * @returns {string[]}
 */
export declare const extractSvelteScriptLanguages: (source: string) => string[];
/**
 * Collect `<style>` block facts: the block's `lang` and the package
 * references found in its `@use` / `@import` / `@forward` / `url()` rules.
 * Reference offsets are absolute indices into the original source so callers
 * can derive line numbers.
 *
 * @param {string} source `.svelte` file content.
 * @returns {Array<{lang: string|undefined, start: number, references: Array<{reference: string, index: number}>}>}
 */
export declare const extractSvelteStyleReferences: (source: string) => Array<{
    lang: string | undefined;
    start: number;
    references: Array<{
        reference: string;
        index: number;
    }>;
}>;
/** Rune names that imply the `svelte` package even without an import. */
export declare const SVELTE_RUNE_NAMES: string[];
/**
 * Find Svelte 5 rune usages (`$state`, `$derived`, `$effect`, ...). A
 * rune-only component may never `import` from `svelte`, yet it cannot compile
 * without the compiler, so rune usage is `svelte` evidence.
 *
 * @param {string} source `.svelte` content (script blocks scanned) or the
 *   full text of a `.svelte.js` / `.svelte.ts` module (pass
 *   `scriptBlocksOnly = false`).
 * @param {boolean} [scriptBlocksOnly=true] Scan only `<script>` block bodies.
 * @returns {Array<{rune: string, index: number}>} Absolute rune offsets.
 */
export declare const findSvelteRunes: (source: string, scriptBlocksOnly?: boolean) => Array<{
    rune: string;
    index: number;
}>;
/** SvelteKit virtual module prefixes that resolve inside `@sveltejs/kit`. */
export declare const SVELTE_KIT_VIRTUAL_MODULE_PREFIXES: string[];
/**
 * True for import specifiers provided by SvelteKit itself (`$app/stores`,
 * `$env/static/public`, `$service-worker`, ...).
 *
 * @param {string} specifier Import specifier.
 * @returns {boolean}
 */
export declare const isSvelteKitVirtualModuleSpecifier: (specifier: string) => boolean;
/** The default SvelteKit `$lib` alias target. */
export declare const SVELTE_DEFAULT_LIB_ALIAS = "src/lib";
/**
 * Extract framework facts from a `svelte.config.*` source: the adapter named
 * in string form (`adapter: "netlify"`), the `kit.alias` entries, and the
 * `extensions` list. Adapter and preprocessor *imports* are collected by the
 * regular config-file parse once `svelte.config.*` stops being ignored; the
 * string adapter form has no import to recover, so it is extracted here.
 *
 * @param {string} source `svelte.config.*` file content.
 * @returns {{adapterName: string|undefined, aliases: Object<string, string>, extensions: string[]}}
 */
export declare const parseSvelteConfigSource: (source: string) => {
    adapterName: string | undefined;
    aliases: Record<string, string>;
    extensions: string[];
};
/** `<style lang>` values that require a CSS preprocessor package. */
export declare const SVELTE_STYLE_LANG_PACKAGES: {
    less: string;
    postcss: string;
    sass: string;
    scss: string;
    stylus: string;
};
/**
 * Executable names appearing in Svelte project npm scripts and the npm
 * packages that provide them. Used by the shared script-evidence walk so a
 * `svelte-kit sync` script marks `@sveltejs/kit` required on its own
 * evidence.
 */
export declare const SVELTE_SCRIPT_EXECUTABLE_PACKAGE_MAP: {
    "svelte-kit": string;
    "svelte-check": string;
    "svelte-package": string;
    vite: string;
    vitest: string;
    playwright: string;
};
/**
 * Prime the module-scoped template-parser handle with a dynamic import,
 * which works on every supported runtime. Called before the parse fan-out so
 * the inline (small-project) path can use tier 2 on the main thread. Any
 * failure is silent at default verbosity: the optional package is absent
 * from the plain cdxgen binaries, and tier 1 already recovers all scope
 * evidence.
 *
 * @returns {Promise<Object|null>} The module namespace, or null when unavailable.
 */
export declare const primeSvelteParser: () => Promise<Object | null>;
/**
 * Synchronous accessor for the parse path: returns the primed handle, lazily
 * resolving it once when called before `primeSvelteParser`.
 *
 * @returns {Object|null} The module namespace, or null when unavailable.
 */
export declare const getSvelteTemplateParser: () => Object | null;
//# sourceMappingURL=svelteUtils.d.ts.map