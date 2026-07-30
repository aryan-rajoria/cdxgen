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
