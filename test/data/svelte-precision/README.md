# svelte-precision

Ported from `atom-parsetools/test-fixtures/projects/svelte-precision`, with
imports rewritten to reference the real npm packages declared in this
fixture's `package-lock.json` so every file yields assertable evidence.

`broken-template.svelte` is intentionally malformed — it is the regression
test for the script-only fallback path.

`store.svelte.ts` uses runes without any `import ... from "svelte"` — it is
the rune-only case that must still mark `svelte` required.
