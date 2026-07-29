# v13/03 Decomposition Progress Log

| Deliverable | Commit | utils.js lines | Barrel exports | Gate status |
|---|---|---|---|---|
| D1 (barrel test) | 823225d8 | 18,562 | 261 | 116/1, golden green |
| D2 (batch 5: ecosystems.js) | 33987ca3 | 16,663 | 261 | 115/2, golden green |
| D3a (batch 6a: parsers-go.js) | 05e7ce43 | 16,076 | 261 | 115/2, golden green |
| D3b (batch 6b: parsers-dotnet.js) | 094a298e | 14,907 | 261 | 115/2, golden green |
| D3c (batch 6c: parsers-rust.js) | 7fff0de3 | 13,698 | 261 | 115/2, golden green |
| D3d (batch 6d: parsers-jvm.js) | 971c7913 | 12,862 | 261 | 115/2, golden green |
| D3e (batch 6e: parsers-python.js) | cfcceb81 | 11,071 | 261 | 115/2, golden green |
| D3f (batch 6f: parsers-js.js) | b94e7894 | 7,468 | 261 | 115/2, golden green; esmock targets fixed |
| D3g (batch 6g: parsers-misc.js) | 945a2a2a | 5,510 | 261 | 115/2, golden green |
| D6+D7 (docs) | 06bb26e3 | — | 261 | — |
| D4a (batch 7a: core-misc-a.js) | ce85bc44 | 3,657 | 261 | 115/2, golden green |
| D4b (batch 7b: core-misc-b.js) | 6689d1e4 | 1,782 | 261 | 115/2, golden green |
| review: baseline + lint + sha fix | bfeaac5b | 1,782 | 261 | **117/0**, golden green |
| review: drop 3 dead dup consts from utils.js | (this commit) | 1,760 | 261 | 117/0, golden green |
| D5 (split utils.poku.js) | (this commit) | 1,760 | 261 | **133/0**, golden green |

| review: relocate 161 JSDoc onto leaf fns + strip barrel | ee01c17e | 565 | 261 | 133/0, golden green |

## Final state

- `lib/helpers/utils.js`: 21,913 → **565** lines, a documented re-export barrel (97.4% reduction)
- JSDoc: 161 blocks relocated from the barrel onto their functions in the leaf modules;
  zero functions that had docs at `0cbce22b` are now undocumented; `@param` on the
  generated leaf `.d.ts` surface rose 534 → 817
- `lib/helpers/utils.poku.js`: 12,422 → **95** lines, split into 16 module-mirroring test files
- Barrel exports: **261**, name set and per-export type/arity/value byte-identical to
  pre-decomposition `0cbce22b`
- Live test cases: **247** before and after the split (6 `describe` blocks); see
  `BLOCKERS.md` on why a `grep` count says 250
- Gates: `pnpm test` **133/0**, `test:golden` 15/25/75/8 green, `pnpm -r test` all
  packages 0 failed, boundaries clean, `biome check` clean, pack baseline regenerated

---

## D04 — Golden test corpus expansion

Starting state: 15 golden scenarios (cargo, cocoapods, composer, dotnet-eshop, go,
maven, mix, npm ×3, pipenv, poetry, pubspec, python, ruby). Gates 19/25/75/8, pnpm test 133/0.

| Commit | Scenarios added | Total | Gate status |
|---|---|---|---|
| v13/04: goldens for pnpm + yarn | pnpm default/spec-1.6/spec-1.7, yarn default (+4) | 19 | golden 19/25/95/8, pnpm test 133/0 |
| v13/04: golden for uv + pylock(skip) | uv default (+1); pylock dropped on lib bug | 20 | golden 20/25/100/8, pnpm test 133/0 |
| v13/04: golden for swift | swift default (Package.resolved-only, toolchain-free) (+1) | 21 | golden 21/25/105/8, pnpm test 133/0 |
| v13/04: golden for .NET project.assets.json | dotnet-assets default (committed restore manifest, no restore at golden time) (+1) | 22 | golden 22/25/110/8, pnpm test 133/0 |
| v13/04: golden for AI-BOM | ai-modelfile default (local Ollama Modelfile → ML model component + ollama service) (+1) | 23 | golden 23/25/115/8, pnpm test 133/0 |
| v13/04: golden for CBOM (source crypto) | cbom-js default (JS AST → 2 cryptographic-asset algorithm components w/ OID bom-refs, no purl) (+1) | 24 | golden 24/25/120/8, pnpm test 133/0 |
| v13/04: permanent end-to-end negative test | +3 mutation tests (purl corruption + dropped edge caught via runner's real disk-compare path; control) | 24 | golden 24/28/120/8, pnpm test 133/0 |
| v13/04: yarn spec-version variants | yarn spec-1.6/1.7 (+2); spec-version normalization cross-checked across 3 lockfile formats | 26 | golden 26/28/130/8, pnpm test 133/0 |

### Negative-test evidence (manual run, then reverted)

The plan's named failure mode is "a normalizer so aggressive that golden files
stop detecting real regressions." Verified manually against real committed
goldens, then reverted; captured as the permanent tests in commit above.

**1. Corrupted component purl** (`repotests/npm-smoke/expected/default.json`,
left-pad `@1.3.0` → `@99.99.99`). Harness output:

```
[FAIL] npm-smoke/default: +1 components, -1 components
        Removed components:
          - library:left-pad@99.99.99
        Added components:
          + library:left-pad@1.3.0
```
Exit code 1. Structural diff names the offending component — not a text dump.

**2. Dropped dependency edge** (`repotests/cargo-smoke/expected/default.json`,
removed `abscissa_derive@0.5.0` from `abscissa_core@0.5.2`'s dependsOn):

```
[FAIL] cargo-smoke/default: ~1 dependency edges changed
        Dependency changes:
          ~ dep pkg:cargo/abscissa_core@0.5.2: +dependsOn:[pkg:cargo/abscissa_derive@0.5.0]
```
Exit code 1. Edge-level detail, not a full-BOM diff.

**3. License-id mutation:** no committed golden carries a `license.id` (npm/cargo
graphs are license-less), so this was not demonstrable against a real golden
file. It IS covered by the in-memory mutation suite (`change a license.id
(Apache-2.0 → MIT) → caught`, which adds a license when none exists).

### Normalizer fixed-point

Already asserted in the suite (Section 2, unchanged): `norm(norm(x)) === norm(x)`
and two independent `createBom` runs over `maven-smoke` normalize identically.
No new rule was added in D04, so no fixed-point regression is possible.


### Review pass (Claude)

- Verified branch lineage: 8 agent commits off `f8757261`, zero merges, clean tree.
- Verified `contrib/sbom-normalize.js` and `ci/` were untouched by the agent — the
  strongest available evidence that no golden was made to pass by loosening
  normalization.
- Verified `repotests/dotnet-assets-smoke/obj/project.assets.json` is genuinely
  host-independent despite committing `/Users/prabhu`, `/private/tmp/gen-dotnet` and a
  macOS SDK path: rewrote all three to Linux CI equivalents and the golden still
  compared `identical`. The paths are inert input strings cdxgen never dereferences.
- Verified the Section 7 negative tests round-trip goldens byte-identically (`git status`
  unchanged after a run), so running the suite cannot silently rewrite committed goldens.
- **Fixed a harness defect the agent misattributed to `lib/`**: `sbom-normalize.js`
  called `.slice()` on `evidence.identity`/`occurrences` without an `Array.isArray`
  guard. This unblocked the skipped `pylock-smoke` scenario. See BLOCKERS.md.
- **Scenario count 26 -> 27**; mutation suite 28 -> 30. Final gates:
  golden **27 / 30 / 135 / 8**, `pnpm test` **133/0**, lint clean, pack baseline
  unchanged, `repotests/` still unpacked (0 entries).
- Recorded the unreported `--include-crypto -t js` dispatch bug in BLOCKERS.md and
  annotated `cbom-js-smoke`'s manifest so its synthetic routing cannot be mistaken for
  working CLI CBOM coverage.
