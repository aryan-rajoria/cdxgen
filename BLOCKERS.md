# v13/03 Blockers

## D5 — Split `lib/helpers/utils.poku.js` — DONE (was deferred)

Completed in the review pass. `utils.poku.js` 12,422 → 95 lines, split across 16 new
`*.poku.js` files mirroring the source modules. Live test count preserved exactly at
**247** (and 6 `describe` blocks). See the counting note below.

The split was done from a `@babel/parser` AST, not line heuristics. That matters: a
line-based splitter corrupts this file in two ways that both produce green-looking runs.
First, top-level `});` sequences appear inside TOML/YAML template-literal fixtures, so
naive block-end detection truncates tests. Second, three tests live inside `/* ... */`
comments; extracting a block whose leading `/*` is left behind silently resurrects them as
live code, and they reference an unbound `utils` identifier.

## Open items (decisions, not blockers)

### 1. JSDoc stranded in the barrel — RESOLVED (was nearly a doc-loss regression)

The extraction scripts used in the autonomous session copied function *bodies* without
their leading JSDoc, so all 161 doc blocks stayed behind in `utils.js` while the functions
moved to leaf modules. Every one of the ten scripted modules was affected
(`parsers-misc.js` 0 docs / 33 exported functions, `core-misc-b.js` 0/23, and so on). The
earlier hand-done batches — `purl`, `spdx`, `deps`, `core-env`, `core-fs` — carried their
docs correctly, which is why the problem was confined and easy to miss.

Those blocks looked like harmless residue and were briefly treated as such. They were not:
they were the **only** remaining copy of the documentation. Deleting them would have
silently dropped the docs for ~158 public functions from both the source and the generated
`.d.ts` surface.

Resolved by harvesting each JSDoc block from pre-decomposition `0cbce22b`, matching it to
its function by name, and inserting it above that function in whichever leaf module now
owns it — 161 blocks relocated, 13 left alone because the target already had docs.
Verification: **zero** functions that had a JSDoc at `0cbce22b` now lack one, and `@param`
count across `types/lib/helpers/*.d.ts` rose from 534 to 817. `utils.js` is now a 565-line
documented re-export barrel (`utils.d.ts` 31 lines, no `@param`), and all 20 of its
statements were proven byte-identical before and after the comment strip.

**Lesson for future batches:** a line- or brace-based extraction script must move the
leading comment block with the declaration. Verify with a per-module ratio of
documented-to-exported functions, not just a diff of moved bodies — a body-only diff looks
perfectly clean while the docs quietly stay behind.

### 2. Three tests are commented out in the suite (pre-existing)

The suite contains three `it(...)` blocks inside `/* ... */`, marked *"Slow test"* and
*"These tests are disabled because they are returning undefined"*, covering
`getMvnMetadata` and IRI-reference validation. They were preserved verbatim during the
split (the `getMvnMetadata` one now sits in `ecosystems.poku.js`, the IRI ones in
`core-misc-b.poku.js`) but remain disabled. Re-enabling them means fixing whatever makes
them return `undefined` — a behaviour question, not a decomposition one.

**Note on test counting:** `grep -c '^\s*(it|test)\('` returns **250** because it also
counts those three commented-out blocks. The AST-parsed live count is **247**. Use the AST
count when verifying a test split lost nothing — the grep number agreed before and after
only because it was equally wrong on both sides.
