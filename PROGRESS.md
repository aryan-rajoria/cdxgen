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
