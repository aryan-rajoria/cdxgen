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

