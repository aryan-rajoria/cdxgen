# PROGRESS — v13/23: untangle and re-home lib/ecosystems/

## Base
- Branch: v13/23-untangle off origin/release/13.0.x @ 4bc4783c
- Start gates: 135/0 tests, boundaries 0, lib-paths 0 ✓

## Result
- lib/ecosystems/ split into lib/inventory/ (59 generic modules, L2) + lib/ecosystems/ (24 ecosystem-specific + 1 barrel, L3)
- Zero back-edges, zero layer violations, zero barrel violations
- All original 14 back-edges broken: 9 dissolved by reclassification, 5 broken by injection

## Edge analysis (verified)
- Original 14 back-edges reduced to 5 by reclassifying purl, osqueryTransform, osinfo,
  provenanceUtils, atomUtils, osPackageResolver, dosaiParsers, ciParsers/*,
  rustFormulationParser as generic (technique 1: move down)
- Remaining 5 broken by injection (technique 3)

## Commits
1. 8aa7e67b — inject getNpmMetadata into parseCaxaMetadata (edge 1/5)
2. 96891488 — inject analyzeDosaiCrypto into collectDosaiCryptoComponents (edge 2/5)
3. e2ddbbd1 — inject parsePkgJson and parsers-misc helpers into evidenceUtils (edges 3-4/5)
4. a642b4ad — inject fetchPomXmlAsJson into resolveGitUrlFromPurl (edge 5/5)
5. 9292a0d2 — split lib/ecosystems/ into lib/inventory/ + lib/ecosystems/, renumber layers
6. 706926b3 — regenerate types for lib/inventory/ split
7. 2bd248a9 — fix import ordering and remove dead import after split

## Final gates (all verified)
- pnpm test: 135/0 ✓
- pnpm run test:deno: 1/0 ✓
- pnpm run test:golden: 27/30/135/8 ✓
- pnpm run test:rs-disable: 27/27 byte-identical ✓
- pnpm run lint:check: 349 files, 0 warnings ✓
- CI=true pnpm install --frozen-lockfile: green ✓
- check-boundaries --strict: exit 0 ✓
- check-lib-paths: exit 0 ✓
- purl-sweep: 41/41 clean ✓
- git status --short: empty ✓
