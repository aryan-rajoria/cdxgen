# Lesson 32 - Build introspection: grading the SBOM you just generated

Two SBOMs for the same Java service can look equally healthy and be nothing
alike. One was produced with a working Maven, so it carries the resolved
dependency graph. The other was produced on a machine where Maven failed, so
cdxgen fell back to parsing `pom.xml` and captured direct declarations only.
Both are valid CycloneDX. Only one is worth scanning for vulnerabilities.

Build introspection is cdxgen grading its own run: which tools it expected,
which it resolved, where it fell back, and what that cost the SBOM. It emits
a score, a tier per ecosystem, and a ranked list of remediations an agent or
a human can act on. This lesson generates a degraded SBOM on purpose, reads
the verdict, repairs the environment the report names, and gates a build on
the result.

## Goal

Pre-requisites: Node.js 24 or newer, `@cdxgen/cdxgen` installed globally, and
a Maven project to scan (any project with a `pom.xml`).

By the end of this lesson you should be able to:

1. Produce an introspection verdict and read its tier, score, and confidence.
2. Explain why an ecosystem scores what it does, and what a ceiling means.
3. Apply the remediation the report ranks first and verify the repair.
4. Gate CI on fidelity with `--introspect-fail-below` and read exit codes 4
   and 5 correctly.
5. Point an agent at the report through the `sbom-fidelity-loop` skill.

## Step 1: A degraded run, on purpose

Introspection is opt-in. The flag switches on the recorder, the reflection,
and the two reports:

```shell
cdxgen --introspect -t java -o bom.json /path/to/java-project
```

To see a verdict worth reading, break the toolchain the way a misconfigured
CI machine does — by pointing Maven at a command that does not exist. The
corpus stays untouched; only the environment changes:

```shell
MVN_CMD=/nonexistent/mvn cdxgen --introspect -t java -o bom.json /path/to/java-project
```

The diagnostic stream summarises the verdict, and two files land beside the
BOM:

```text
Build introspection: overall manifest (45/100), confidence high
Build introspection: 2 remediation(s) ranked
Build introspection: markdown report: bom.json.introspection.md
Build introspection: json report: bom.json.introspection.json
```

`bom.json.introspection.md` is for people. `bom.json.introspection.json` is
the contract tools read, and it is documented field by field in
[the skill's schema reference](../.agents/skills/sbom-fidelity-loop/reference/report-schema.md).

## Step 2: Read the tier before the score

The score is a summary; the tier is the claim. Each scanned ecosystem is
graded on a ladder:

| Tier        | What the BOM contains                                  |
| ----------- | ------------------------------------------------------ |
| `resolved`  | A working build or resolver; the full dependency graph |
| `lockfile`  | Pinned versions; the graph is not fully resolved       |
| `manifest`  | Direct declarations only                               |
| `heuristic` | Components inferred from build artifacts               |
| `absent`    | The ecosystem was requested and produced nothing       |

```shell
jq '.overall, (.ecosystems[] | {ecosystem, tier, score, state})' bom.json.introspection.json
```

```json
{ "score": 45, "tier": "manifest", "confidence": "high" }
{ "ecosystem": "java", "tier": "manifest", "score": 45, "state": "graded" }
```

`state` matters as much as `tier`. A `graded` row has room to improve. An
`at-ceiling` row is already as good as that ecosystem gets — a Helm chart is
`manifest` forever, and npm, python and rust cap at `lockfile` because every
BOM their parsers emit carries lockfile-only evidence — so it scores 100 and
proposes nothing. An `unsupported` ecosystem is excluded from the score and
listed in `coverageGaps[]`: cdxgen's backlog, not a defect in the project.

Ask why the tier is what it is:

```shell
jq '.ecosystems[] | select(.ecosystem=="java") | .tierReasons' bom.json.introspection.json
```

## Step 3: Apply what the report ranks

`remediation[]` is ordered by expected score gain, and each entry carries the
concrete steps — with Windows variants — that close the gap:

```shell
jq '.remediation[0] | {remediationId, impact, expectedGain, blocked, actions, verify}' bom.json.introspection.json
```

```json
{
  "remediationId": "jvm.maven.manifest-fallback",
  "impact": "transitive-deps",
  "expectedGain": 55,
  "blocked": false,
  "actions": [{ "kind": "build", "command": "mvn -q package -DskipTests" }],
  "verify": { "rules": ["BF-JVM-001"], "expectTier": "resolved" }
}
```

Two fields decide whether to act. `blocked: true` means the environment
forbids the fix — the run is offline, or a command-execution policy denies
it — and the entry names the reason instead of pretending the fix is
available. `verify` is how you check afterwards: the rules that must stop
firing, and the tier the repair should reach.

Repair the environment and re-scan:

```shell
unset MVN_CMD
cdxgen --introspect -t java -o bom.json /path/to/java-project
jq '.overall' bom.json.introspection.json
```

```json
{ "score": 100, "tier": "resolved", "confidence": "high" }
```

Judge the repair by the new report, never by the command's exit code. A
build can exit 0 and still leave the tier where it was.

## Step 4: Gate CI on fidelity

A threshold turns the verdict into a build decision:

```shell
cdxgen --introspect --introspect-fail-below 70 -t java -o bom.json .
echo $?   # 4 when the score is below 70
```

Exit **4** means "generated, but not good enough": the BOM and both reports
are written first, always. That is the difference from exit **1**, which
means no BOM exists. Treat them differently in CI — 4 is a fixable
environment, 1 is a broken run.

`--fail-on-error` composes with this. On an introspected run a failing
extractor no longer takes the process down before the reports exist; it
stops without falling back, the outputs are written, and the run exits **5**:

```shell
MVN_CMD=/nonexistent/mvn cdxgen --introspect --fail-on-error -t java -o bom.json .
echo $?   # 5, with bom.json and both reports on disk
```

If the failure left no BOM at all, the exit stays 1 — there is no verdict to
read.

The verdict also travels inside the BOM, so a consumer who only has the
CycloneDX file can still see it:

```shell
jq '.metadata.properties[] | select(.name | startswith("cdx:introspection"))' bom.json
```

## Step 5: Hand it to an agent

The report exists so an agent can improve an SBOM without guessing. The
`sbom-fidelity-loop` skill (in `.agents/skills/`) is the contract: scan, read
the report, execute the ranked remediation's actions, re-scan, and stop in
one of six defined ways — `success`, `stalled`, `blocked`,
`nothing-further-available`, `unverifiable`, `budget-exhausted`.

Two rules keep the loop honest. The loop fixes the _environment_; it never
edits the project to make a rule pass. And an attempt counts as verified only
when the next report says so.

```shell
cdxgen --profile introspect --introspect-fail-below 70 -t java -o bom.json .
```

`--profile introspect` is `--introspect` plus formulation and evidence
passes — the fullest picture, and the mode to use when an agent will act on
the result.

## Step 6: Know what it does not tell you

Introspection grades _how_ the SBOM was produced. It does not tell you the
components are safe, the licences are compatible, or the project builds. A
`resolved` 100 verdict on a project with no dependencies is still an SBOM
with no dependencies.

It also grades only what it scanned. If `-t` named one ecosystem in a
polyglot repo, the other ecosystems are invisible to the verdict rather than
scored badly.

The reference documentation is [INTROSPECTION.md](INTROSPECTION.md), which
covers the rule pack, the remediation catalog, and the toolchain matrix that
tests the whole thing across pinned container images.
