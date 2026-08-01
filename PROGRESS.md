## D23

- v13/23: rewrite check-boundaries.js with cycle/layer/barrel detection + dynamic import support; synthetic-cycle rejection tests pass; checker intentionally fails on current tree (6 file cycles, 2 package cycles, 62 barrel violations)
- v13/23: break 6 barrel cycles by repointing 22 symbols to leaf modules (file cycles 6→0, getPnpmDepPurl moved to parsers-js to break npmutils↔parsers-js cycle)
- v13/23: break 4 cross-package edges (package cycles 2→0): huggingfaceManifest moved parsers→helpers, executeOsQuery injected via context from stages, getTreeWithPlugin injected from cli/index.js
- v13/23: declare layers in packages/*/package.json; remove redundant dependency lists; move SPDX constants to helpers to fix validator->stages edge
- v13/23 step 5: create lib/core/ (L0) — moved logger, propertySanitizer, paths, state, activity, fs, env, httpClient to lib/core/; renamed core-* to drop prefix; created packages/core
- v13/23 corrections: moved SPDX constants to lib/core/spdx.js (L0); moved huggingfaceManifest + huggingfaceUtils back to lib/parsers/ (L1)
- v13/23: repoint all 56 internal utils.js imports to leaf modules (barrel violations 56→0); ratchet lowered to 0
- v13/23 step 9: fix all 7 layer violations — reclassify stages L4→L3 (inject executeOsQuery/getBomWithOras to eliminate stages→managers edges), cli L5→L4, audit L4→L5; layer violations 7→0; `check-boundaries.js --strict` exits 0
- v13/23: exports map adds `./core/*`; parity harness 38/0 + 7/7 verified with staged binary; goldens byte-identical throughout

## D22

- v13/22: rename @cyclonedx/cdxgen -> @cdxgen/cdxgen in package.json/jsr.json/deno.json, code self-identification, CI configs, and documentation
- v13/22: re-record 27 golden expected files -- tool self-purl change (metadata.tools bom-ref, group, purl; 81 lines across 27 files)
- v13/22: MIGRATING-TO-V13.md package rename section; freeze contrib/fine-tuning/cdxgen-docs/*.jsonl as v12-era training data

## D06

### cdxgen

- `e50ffe34` v13/06: add schema drift guard test (cdxgen data/ ↔ cdxrs schemas/)
- `2f726a5e` v13/06: add validation rule registry (docs/v13/validation-rules.md)
- `7fc88305` v13/06: add differential parity harness (golden false-positive check + invalid BOM parity)
- `42096ba7` v13/06: wire cdxrs validate bridge with JS fallback + CDXGEN_RS_DISABLE support
- `34a9529d` v13/06: add reporter parity tests for all four reporters
- `ea5830a4` v13/06: add perf benchmark (JS vs Rust validation, 120x speedup on 10k components)
- `2035321a` v13/06: add real-binary validate tests + fix concurrent env-var race in bridge tests

### cdxgen-plugins-bin

- `3f740ec` vendor cyclonedx 1.6/1.7 schemas + drift guard
- `b5422d3` implement cdxrs validate: schema + semantic rules with findings format
- `b3521f5` add invalid test fixtures and parity-exceptions.toml
- `65c3181` add per-rule unit tests, insta snapshots, and fuzz guard

## D20

### cdxgen

- `88b2cb22` v13/20: fix undefined-version bug in createDefaultParentComponent
- `867abb95` v13/20: add purl migration audit probe
- `d89a23bb` v13/20: replace packageurl-js with @cdxgen/cdx-purl cleanly
- `78ec7c9b` v13/20: add migration guide and update audit probe for cdx-purl

### Summary

Replaced `packageurl-js` with `@cdxgen/cdx-purl` across all 40 importing files
and 159 call sites. No compatibility shim — the codebase uses cdx-purl's `Purl`,
`build`, and `Purl.parse` API directly.

Purl construction bugs fixed across ecosystems:
- Maven without groupId (gradleutils, parsers-jvm): try/catch, name-based bom-ref
- Golang modules without path separator (go4.org, go.opencensus.io): graceful
  fallback, name-based bom-ref; namespace derivation from last slash for all others
- Golang namespace case normalization (cdx-purl lowercases per spec)
- Swift local packages without namespace: no purl, name-based bom-ref
- vscode-extension without publisher: try/catch, name-based bom-ref
- HuggingFace version case preservation (revision hashes are case-sensitive)
- OSQuery swid purls: auto-provide tag_id qualifier; strip absolute subpaths
- Generic purls with custom qualifiers (kind/path/repo_type): moved to properties
- npm versions with + (semver build metadata): proper percent-encoding before parse
- binary.js purlObj null guard (exposed by strict parse failures)
- CMake absolute subpaths: strip leading slashes

Golden changes: PyPI normalization (jaraco.classes -> jaraco-classes etc.),
swift root component (no valid namespace), ai-modelfile version fix.
