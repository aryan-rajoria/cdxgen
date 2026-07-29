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

## D04 — Golden test corpus expansion

### RESOLVED (in review): pylock-smoke — the bug was in the harness, not in lib/

The D04 agent skipped `pylock.toml` after diagnosing
`c.evidence.identity.slice is not a function` as a schema violation in
`lib/helpers/pylockutils.js:271-283` (emitting `evidence.identity` as an object
rather than an array) and correctly declined to touch `lib/` under the
"note pre-existing bugs, don't fix them" rule.

That diagnosis was backwards. `evidence.identity` is an **object** in CycloneDX
1.5 and an **array** from 1.6 on, and cdxgen emits both shapes — the object form
from ~68 call sites in `lib/`, the array form from ~8. The object form is the
dominant convention, so `pylockutils.js` is not anomalous. The actual defect was
in `contrib/sbom-normalize.js:259-263` — squarely D04's own scope — which called
`.slice()` on the bare value without an `Array.isArray` guard, unlike the
`externalReferences` and `hashes` branches immediately above it. `occurrences`
(line 264) had the same unguarded assumption.

Fixed by guarding both with `Array.isArray`. Deliberately **not** by coercing the
object form into an array: coercion would normalize away a genuine shape change
instead of reporting it, which is the failure mode this deliverable exists to
prevent. Verified the fix alters none of the 26 pre-existing goldens (a full
`UPDATE_GOLDEN=1` regeneration produced zero content drift).

`repotests/pylock-smoke/` is therefore now a live scenario, and a valuable one:
its 15 components carry **10 object-form and 5 array-form** `evidence.identity`
values, making it the only golden that guards both shapes. Two unit-level
regression tests were added to `contrib/mutation-tests.js` Section 6; the
shape-tolerance test was confirmed to fail against the pre-fix normalizer.

Lesson: a crash that surfaces while adding a fixture is not automatically a bug in
the code under test. Check whether the harness's assumption or the library's
output is the outlier — here a one-line grep (68 object vs 8 array) settled it, and
would have turned a skipped ecosystem into a two-line fix.

### Pre-existing lib bug (NOT fixed): source-crypto is unreachable via the CLI

Found while building `cbom-js-smoke`, and worth filing separately — the D04 agent
identified this correctly in passing but did not record it.

`createBom` dispatches single-`projectType` invocations down a fast path that
`return`s before reaching the `for (const path of pathList)` loop in
`createMultiXBom`, where source-crypto collection
(`collectSourceCryptoComponents`) lives. The consequence is that the documented
user-facing invocation collects **nothing**:

```
-t js  --include-crypto  ->  0 components,  0 cryptographic-asset
-t js,mcp --include-crypto  ->  2 components, 2 cryptographic-asset
```

(reproduced directly against `repotests/cbom-js-smoke`). The lightweight
source-crypto path is effectively dead code for every single-type CLI run; only
the heavyweight evinser/atom flow (`bin/cdxgen.js:1658-1681`) enriches crypto for
those. `lib/` was not touched, per the rules.

Because of this, `cbom-js-smoke` pins a code path no CLI user reaches, via a
synthetic `["js","mcp"]` routing. It is retained deliberately — it is the only
golden covering `cryptographic-asset` components, which carry **no purl** and use
OID-derived bom-refs, an edge case worth locking down in the normalizer — but it
must not be read as evidence that `cdxgen --include-crypto -t js` works. When the
dispatch bug is fixed, this scenario should be re-pointed at the single-type
invocation and its manifest description updated.

### Other skips (no toolchain bug, just out of scope for offline goldens)

See the D04 closing report for: Gradle (needs running daemon + network),
container image, OS packages/OBOM, Rust binary, SPDX output (normalizer is
CycloneDX-shaped), dynamic-smoke (platform-dependent shared libraries by design).

#### Gradle — verified skip

`createJavaBom` always invokes the Gradle daemon (`gradle dependencies`); there is
no `gradle.lockfile` parser (repo-wide grep confirms). The golden-runner pins
`GRADLE_USER_HOME`/`GRADLE_CACHE_DIR` to an empty scratch dir for host-independence,
which makes offline resolution impossible. Verified: a minimal `build.gradle` with
two Maven Central deps, run with `GRADLE_USER_HOME=/tmp/gradle-scratch` (empty),
fails with `BUILD FAILED` and produces 0 components. Working gradle goldens would
therefore require either the live network (flaky) or committing a full Maven local
repo into the fixture (impractical). Skipping is correct under the "offline by
default" invariant.
