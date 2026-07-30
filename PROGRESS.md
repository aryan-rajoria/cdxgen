# PROGRESS — cdxgen

## D05 — cdxrs scaffold, protocol, JS bridge, cross-build

- Updated all @cdxgen/cdxgen-plugins-bin pins from 2.5.1 to 3.0.0 (1 dependency + 10 optionalDependencies).
- Added missing @cdxgen/cdxgen-plugins-bin-linux-riscv64 optionalDependency.
- Added cdxrs to plugins.js binary resolution (PLUGIN_ENV_COMMAND_NAMES, resolveBundledPluginBinary).
- Created lib/helpers/cdxrs.js bridge: cdxrsAvailable, runCdxrs, cdxrsDisabled, CDXRS_FALLBACK sentinel. Handles all six failure modes.
- Created lib/helpers/cdxrs.poku.js: 11 tests covering all six failure modes + success + cdxrsDisabled + sentinel, using fake binary fixtures.
- Added --verbose and --no-rust CLI flags. Wired cdxrs info into --version --verbose output.
- Added --debug cdxrs status line reporting availability at BOM generation start.
- Created contrib/rs-disable-golden-test.js: permanent CDXGEN_RS_DISABLE=all golden-identical safety net. Proven to fail when output changes (injected component → 1 failed → reverted → all pass).
- Created docs/v13/rust.md: full protocol, exit codes, env vars, and extension specification.
- Final gates: 27/30/135/8 golden, 134/0 poku, lint clean, rs-disable green.

