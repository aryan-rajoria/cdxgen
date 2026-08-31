---
name: sbom-fidelity-loop
description: Runs the cdxgen SBOM fidelity loop: scan with --introspect or --profile introspect, read the cdxgen fidelity report, execute its ranked remediations, and re-scan until the fidelity tiers stop improving. Use when improving SBOM accuracy or completeness, fixing missing transitive dependencies in a generated BOM, build tool setup for SBOM generation, or interpreting a cdxgen fidelity/introspection report.
---

# SBOM fidelity loop

Use this skill to raise a cdxgen SBOM from a shallow scan (direct dependencies
only) to a fully resolved one. `cdxgen --introspect` grades each scanned
ecosystem against a fidelity tier ladder and ranks the fixes that would improve
it; this skill is the loop that executes those fixes and re-scans. The report
format is documented in [reference/report-schema.md](reference/report-schema.md)
and the six remediation action kinds in
[reference/remediation-actions.md](reference/remediation-actions.md); the
user-facing feature docs are [docs/CLI.md](../../docs/CLI.md) ("Build
introspection") and
[docs/INTROSPECTION.md](../../docs/INTROSPECTION.md), which shows a worked
degraded-to-repaired transition with both real reports.

The loop measures the environment the user actually has. It fixes the
environment; it never fixes the project.

## The loop

```text
history = read .cdxgen/introspection-history.json (fresh when absent)
for iteration in 1..maxIterations (default 6):
    run: cdxgen <user args> --profile introspect \
         --introspect-report .cdxgen/report.md --introspect-json .cdxgen/report.json
    exit 1 means cdxgen failed to generate a BOM at all: fix the invocation,
    do not count it as a fidelity iteration
    report = read .cdxgen/report.json
    if report.ledger.complete is false:
        set CDXGEN_INTROSPECT_LEDGER=.cdxgen/ledger.jsonl and re-run once;
        if still incomplete: STOP — unverifiable
    append {n, score: report.overall.score, tier: report.overall.tier,
            inputsFingerprint: report.inputsFingerprint} to history.iterations
    candidates = report.remediation entries where blocked is false
                 and remediationId was not attempted at this inputsFingerprint
    done = every row in report.ecosystems has state "at-ceiling", or tier
           "resolved", or tier "lockfile" with no candidate naming that
           ecosystem — a lockfile row is finished only once nothing is left
           to try on it
    if done and (no report.gate or report.gate.passed):
        STOP — success
    if iteration > 1 and report.overall.score <= previous score
       and report.inputsFingerprint == previous inputsFingerprint:
        STOP — stalled
    if candidates empty:
        STOP — nothing-further-available
    pick candidates[0]  (report.remediation is ranked by expected gain)
    execute its actions under the rules below
    record the attempt in history.attempted with the outcome
STOP — budget-exhausted
```

Prefer `--introspect` over `--profile introspect` when the project's language
does not support evidence collection or when the profile's extra passes add
noise the loop does not need; both produce the same report.

## Stop conditions — report which one you hit, and the final report path

Every stop condition is a legitimate result. `stalled` and `blocked` are
findings about the project or environment, not failures to hide; an agent that
reports success because it ran out of ideas has failed.

| Stop | When | Report to the user |
| --- | --- | --- |
| `success` | Every ecosystem is at-ceiling or at `resolved`/`lockfile` and the gate (if configured) passed | Final score and report path |
| `stalled` | A re-run with the same `inputsFingerprint` did not raise the score — the applied fix did not change the inputs | The attempted remediation id; the fix did not take effect |
| `blocked` | Every remaining candidate is `blocked: true` (secure mode, offline, dry-run, in-container) | The `blockedReason` values; these are facts for the human, not work for you |
| `nothing-further-available` | No unblocked, unattempted candidate remains — including a score below 100 with an empty `remediation[]` | The score and the reason no action exists; never improvise a fix to close the gap |
| `unverifiable` | The ledger is incomplete even after the sidecar retry, or the report cannot be read/parsed | Say the verdict cannot be trusted and what is missing |
| `budget-exhausted` | `maxIterations` reached with work still ranked | What would be attempted next |

A score below 100 with an empty `report.remediation[]` is real: the deduction
has no catalog entry yet (a bare missing interpreter on PATH behaves this way
today). That is `nothing-further-available` — report it, do not invent a
remediation the report did not emit.

## Rules for executing actions

- **Ask before installing.** `install` and `container` actions change the
  user's machine. Present the planned actions and wait, unless the user said to
  run unattended. In CI with an explicit mandate, proceed.
- **Never run an action the report did not emit.** No improvising a fix.
- **Never modify the project to make a rule pass.** Do not add a lockfile the
  project does not have, do not edit `pom.xml`/`build.sbt`/manifests to pin
  versions, do not touch source files. The goal is an accurate SBOM of the
  project *as it is*; adding a lockfile the project does not carry falsifies
  the subject of the measurement. Where a remediation's fix is a project
  change (`config` actions), surface it to the human as advice instead of
  executing it.
- **Never weaken the measurement.** Do not pass `--skip-*` flags, do not lower
  `--introspect-fail-below`, do not disable rules. If you find yourself wanting
  to, stop and report `blocked`.
- **Prefer `container` over host installs** when the report offers both and
  the environment can run containers — a container run is reversible.
- **Verify on the next iteration.** After executing actions, judge the fix by
  the *next* report's entry `verify` clause (rules stopped firing, tier
  reached) — never by the action's exit code. Record the outcome in
  `history.attempted`; a `no-change` or `failed` outcome is never retried at
  the same `inputsFingerprint`.

## Reading the report

| tier | meaning | keep going? |
| --- | --- | --- |
| `resolved` | Working build/resolver; full dependency graph captured | No — done |
| `lockfile` | Pinned versions captured, graph not fully resolved | Done when nothing is actionable; a remediation may still target `resolved` |
| `manifest` | Direct declarations only | Yes — the highest-gain remediation usually lives here |
| `heuristic` | Components inferred from build artifacts | Yes |
| `absent` | Nothing was produced for the ecosystem | Yes |

- A row with `state: "at-ceiling"` is done regardless of tier: the ecosystem
  already parses at the best fidelity cdxgen can achieve for it (helm charts
  are `manifest` forever). Do not try to improve one.
- Rows named in `coverageGaps` are cdxgen's backlog, not your work.
- `confidence: "low"` means the verdict rests on thin evidence: set
  `CDXGEN_INTROSPECT_LEDGER` to a sidecar path, re-run, and only then act on
  remediations.
- Placeholders in action commands (`{{version}}`, `{{major}}`) resolve from the
  ecosystem row's `tools.expected` entries. When the report recorded no
  expected version, ask the user which version to install; never silently
  invent one.

Keep loop state in `.cdxgen/introspection-history.json` so other agents and
later sessions share it:

```json
{
  "schemaVersion": "1.0",
  "iterations": [
    {
      "n": 1,
      "score": 45,
      "tier": "manifest",
      "inputsFingerprint": "sha256:4c734642d88a9bc75b9496f2840397d14320cd3bb28a3ba14d45b00c5e3d69c6",
      "at": "2026-08-30T13:21:11.300Z"
    }
  ],
  "attempted": [
    {
      "remediationId": "jvm.maven.manifest-fallback",
      "at": "2026-08-30T13:25:00.000Z",
      "actions": ["sdk install maven 3.9.9", "mvn -q package -DskipTests"],
      "outcome": "verified",
      "detail": "BF-JVM-001 no longer fires; java graded resolved"
    }
  ]
}
```

`outcome` is one of `verified`, `no-change`, `failed`. The history file is
written by the agent, never by cdxgen. `.cdxgen/` is scratch state, not
project content: add it to the target repo's `.gitignore` and never commit it.

## Worked example

Measured on a real Java project (`java-sec-code`) scanned without Maven. The
environment variable forces the degradation any machine can reproduce:

```sh
MVN_CMD=/nonexistent cdxgen --profile introspect --introspect-fail-below 70 \
  -t java -o /tmp/d09/x.bom.json --no-install-deps ~/sandbox/java-sec-code
```

The run falls back to parsing `pom.xml`, then prints:

```text
Falling back to parsing pom.xml files. Only direct dependencies would get included!
Multiple errors occurred while building this project with maven. The SBOM is therefore incomplete!
✔ Generating BOM  58 components  0.2s
Build introspection: overall manifest (45/100), confidence high
Build introspection: 2 remediation(s) ranked
Build introspection: markdown report: /tmp/d09/x.bom.json.introspection.md
Build introspection: json report: /tmp/d09/x.bom.json.introspection.json
Build introspection: score 45 is below the --introspect-fail-below threshold 70.
```

Exit code **4**: the BOM and both reports were written, and the gate failed.
`report.remediation[0]` is `jvm.maven.manifest-fallback`, 45 → 100, with two
`install` actions, one `build`, and a `rerun`; it `subsumes` `BF-JVM-001`, so
fixing it clears that finding too. The `install` commands carry `{{version}}`
placeholders because this run recorded no expected version. Per the rules: the
agent presents the actions to the user instead of installing unprompted. Here
the machine already had Java 25 and Maven under SDKMAN (visible in
`ecosystems[0].tools.resolved`), so no install was needed; the loop re-runs the
same command for iteration 2:

```text
✔ Generating BOM  204 components  4.7s
Build introspection: overall resolved (100/100), confidence medium
Build introspection: 0 remediation(s) ranked
Build introspection: markdown report: /tmp/d09/x.bom.json.introspection.md
Build introspection: json report: /tmp/d09/x.bom.json.introspection.json
```

Exit code **0**. Every row is `resolved` and the gate passes: STOP — success,
204 components against 58 before, report at the same path.
