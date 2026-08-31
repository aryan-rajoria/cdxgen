# cdxgen build introspection

Overall: manifest (45/100) — the SBOM is missing transitive dependencies for java; 2 remediation(s) proposed.

## Ecosystems

| ecosystem | tier | score | components | edges | confidence |
| --- | --- | --- | --- | --- | --- |
| java | manifest | 45 | 3 | 0 | high |

## What to fix

Ranked by expected score gain.

### 1. Maven build failed; only the direct dependencies declared in pom.xml were captured

- Remediation: `jvm.maven.manifest-fallback` (source: ledger) — ecosystem: `java`, confidence: high
- Why: transitive dependency evidence was lost (1 event).
- Score: 45 → 100 (tier `resolved`); expected overall gain: +55.00
- Also resolves: `BF-JVM-001`
- Confirm `BF-JVM-001`, `BF-JVM-002` no longer fire and the tier reaches `resolved`.
- Docs: https://cyclonedx.github.io/cdxgen/#/PROJECT_TYPES?id=java

POSIX:

```sh
sdk install java 21
sdk install maven 3.9.9
mvn -q package -DskipTests
```

Windows:

```bat
winget install --id EclipseAdoptium.Temurin.21.JDK
winget install --id Apache.Maven
mvn -q package -DskipTests
```

- Re-run the cdxgen invocation from the Reproduce section to confirm the fix.

### 2. Only 0 of 3 components appear in the dependency graph (100% uncovered); the BOM reads like a flat list of declarations

- Remediation: `BF-GEN-001` (source: rule) — ecosystem: `java`, confidence: high
- Why: Run the ecosystem resolver before generating the BOM (or let cdxgen --install-deps drive it) so transitive edges are captured, then re-scan
- Score: 45 → 75 (tier `lockfile`); expected overall gain: +30.00
- Confirm `BF-GEN-001` no longer fires and the tier reaches `lockfile`.

POSIX:

```sh
cdxgen -t java --install-deps -o bom.json
```

Windows:

```bat
cdxgen -t java --install-deps -o bom.json
```

## Evidence

### java

Tools:

| tool | expected | resolved | missing | mismatched |
| --- | --- | --- | --- | --- |
| java | 21 (wrapper) | 21.0.7-tem (PATH) |  |  |
| maven | 3.9.9 (wrapper) | 3.9.9 (PATH) |  |  |

Rule findings:

- **BF-GEN-001** (high): Only 0 of 3 components appear in the dependency graph (100% uncovered); the BOM reads like a flat list of declarations
- **BF-JVM-001** (high): 3 pkg:maven components were captured with no dependency graph, so only declared dependencies are present

## Reproduce

```sh
cdxgen -t java --no-install-deps -o bom.json
```

- cdxgen version: `13.0.0`; runtime: Node.js 22.0.0
- Inputs fingerprint: `sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90`
