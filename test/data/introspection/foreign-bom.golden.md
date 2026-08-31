# cdxgen build introspection

Overall: manifest (55/100) — the SBOM is missing transitive dependencies for dart; 1 remediation(s) proposed.

## Warnings about this report

- No build ledger was available (this BOM was audited without a cdxgen run), so verdicts rest on BOM structure alone.

## Ecosystems

| ecosystem | tier | score | components | edges | confidence |
| --- | --- | --- | --- | --- | --- |
| dart | manifest | 55 | 344 | 103 | low |

## What to fix

Ranked by expected score gain.

### 1. Only 104 of 344 components appear in the dependency graph (69.8% uncovered); the BOM reads like a flat list of declarations

- Remediation: `BF-GEN-001` (source: rule) — ecosystem: `dart`, confidence: low
- Why: Run the ecosystem resolver before generating the BOM (or let cdxgen --install-deps drive it) so transitive edges are captured, then re-scan
- Score: 55 → 85 (tier `lockfile`); expected overall gain: +30.00
- Confirm `BF-GEN-001` no longer fires and the tier reaches `lockfile`.

POSIX:

```sh
cdxgen -t dart --install-deps -o bom.json
```

Windows:

```bat
cdxgen -t dart --install-deps -o bom.json
```

## Evidence

### dart

Rule findings:

- **BF-GEN-001** (high): Only 104 of 344 components appear in the dependency graph (69.8% uncovered); the BOM reads like a flat list of declarations

## Reproduce

```sh
cdxgen -t dart --no-install-deps -o bom.json
```

- cdxgen version: `13.0.0`; runtime: Node.js 22.0.0
- Inputs fingerprint: `sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
