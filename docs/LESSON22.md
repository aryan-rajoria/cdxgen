# Lesson 22 - cdx-audit deep dive: predictive supply-chain audit and reporters

You generated an SBOM. Now what? A BOM with 500 components does not tell you
which dependency deserves review first, or whether any of them carry
supply-chain risk signals worth escalating. `cdx-audit` fills that gap. It
takes an existing CycloneDX BOM and either evaluates the BOM directly with the
built-in rule engine, or resolves supported package URLs back to their source
repositories, generates child SBOMs, and produces a prioritized, explainable
review queue.

## Goal

By the end of this lesson you should be able to answer:

1. What is the difference between a direct BOM audit and a predictive
   dependency audit, and when do I use each?
2. Which reporter (console, json, sarif) fits which workflow?
3. How do scope and trusted-publishing filters change what gets analyzed?
4. How do I enforce a license compliance policy alongside the audit?
5. What do the exit codes mean, and how do I gate CI on them?

## Prerequisites

- Node.js >= 24 (the v13 floor)
- `@cdxgen/cdxgen` installed globally. `cdx-audit` ships with the main package:

```shell
npm install -g @cdxgen/cdxgen
```

- A CycloneDX JSON BOM. If you do not have one: `cdxgen -t nodejs -o bom.json .`

## Step 1: Direct vs predictive audit modes

### Predictive dependency audit (default)

The default mode extracts supported package URLs (npm, PyPI, Cargo) from the
input BOM, resolves each to its upstream source repository, clones it,
generates a child SBOM, and evaluates that child SBOM against built-in rules.
The result is a prioritized review queue:

```shell
cdx-audit --bom bom.json
```

Use this mode when you want to know which dependencies to inspect before
spending time elsewhere.

### Direct BOM audit

Add `--direct-bom-audit` to evaluate the supplied BOM itself with the same
rule engine that `cdxgen --bom-audit` uses. No cloning, no child SBOMs. This
is useful for re-auditing a saved OBOM or previously generated SBOM:

```shell
cdx-audit --bom obom.json --direct-bom-audit
cdx-audit --bom obom.json --direct-bom-audit --categories obom-runtime
cdx-audit --bom aibom.json --direct-bom-audit --categories ai-bom
```

In direct mode, `--categories` defaults to `obom-runtime` for OBOM-like inputs
and all categories otherwise. In predictive mode, `--categories` applies to the
generated child SBOMs (default: `ai-agent`, `ci-permission`,
`dependency-source`, `package-integrity`).

You can also audit a directory of BOMs: `cdx-audit --bom-dir ./boms --report
json`.

## Step 2: The three reporters

`--report` selects the output format. The default is `console`.

**Console** is best for terminal triage. It prints a summary (input BOMs,
candidate targets, scanned targets, errored targets) then an action table with
severity, target, why it needs attention, and the next concrete step. When
nothing crosses the threshold, you get: `No dependencies require your attention
right now.`

**JSON** is best for automation and dashboards:

```shell
cdx-audit --bom bom.json --report json -o audit.json
```

Inspect the summary and top-scoring targets with jq:

```shell
# Overall summary
jq '.summary' audit.json

# Top 5 targets by score
jq '.results | sort_by(-.assessment.score) | .[:5] | .[] | {purl: .target.purl, severity: .assessment.severity, score: .assessment.score, topReason: .assessment.reasons[0]}' audit.json
```

The JSON report includes `results[]` (or `groupedResults[]` when alerts are
consolidated), `licenseViolations[]` when a policy is supplied, and a `tool`
block.

**SARIF** is best for GitHub code scanning and centralized review queues. It
includes rule metadata, remediation text, per-result `properties.nextAction`,
and `relatedLocations` for correlated local workflow receiver files:

```shell
cdx-audit --bom bom.json --report sarif -o audit.sarif
```

## Step 3: Scope selection

`--scope` controls which components become audit targets in predictive mode.

- `--scope all` (default): considers all supported purls.
- `--scope required`: scans only components with `scope=required`. A missing
  scope is treated as required, so this effectively excludes `scope=optional`
  and `scope=excluded` packages.

For large SBOMs, cap the review queue with `--max-targets`. When the queue is
trimmed, direct runtime dependencies are prioritized by default:

```shell
cdx-audit --bom bom.json --scope required --max-targets 25
```

## Step 4: Trusted-publishing filters

"Trusted publishing" means a package carries registry-visible provenance
evidence, such as `cdx:npm:trustedPublishing=true`,
`cdx:pypi:trustedPublishing=true`, or `cdx:cargo:trustedPublishing=true`. By
default, `cdx-audit` skips trusted-publishing-backed packages because they are
lower-risk candidates.

Override this with two mutually exclusive flags:

```shell
# Include trusted packages alongside non-trusted ones
cdx-audit --bom bom.json --include-trusted --max-targets 50

# Audit only trusted-publishing-backed packages
cdx-audit --bom bom.json --only-trusted
```

Passing both together is invalid. You can also append your own purl prefix
allowlist to the built-in well-known filter (which already skips prefixes like
`pkg:npm/%40babel`, `pkg:npm/npm`, and `pkg:npm/%40types`):

```shell
cdx-audit --bom bom.json --allowlist-file ./audit-allowlist.json
```

The allowlist file may be a JSON array (`["pkg:npm/%40acme",
"pkg:pypi/internal-tool"]`) or newline-delimited text.

## Step 5: License policy enforcement

Pass `--license-policy` to evaluate every component license against a
compliance policy. The policy file format is a YAML file with a
`license_policies` list (documented in [Lesson 17](LESSON17.md)):

```yaml
license_policies:
  - license_key: MIT
    label: approved
  - license_key: GPL-3.0-only
    label: prohibited
  - category: Copyleft
    label: prohibited
```

Run the audit with the policy attached:

```shell
cdx-audit --bom bom.json --license-policy policy.yml --report json -o audit.json
```

License violations appear as a separate `licenseViolations[]` array in JSON and
a standalone table in console output. Any prohibited (error-level) license
causes exit code 3 regardless of the supply-chain severity threshold.
Evaluation recurses through nested components and, in predictive mode, also
covers the child SBOMs generated from cloned upstream sources.

## Step 6: Exit codes for CI gating

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | The run completed and no result met `--fail-severity` and no prohibited license was found |
| `1`  | Configuration or runtime error                                                            |
| `3`  | A result met or exceeded `--fail-severity`, or a prohibited license was found             |

The `--fail-severity` flag sets the threshold for exit code 3 (default:
`high`). Use `--fail-severity medium` to fail on medium and above.

This makes the exit status safe to gate CI on: `3` means findings crossed the
threshold, `0` means clean, and `1` means something went wrong with the run.

## Step 7: CI sketch with SARIF upload

A production gate that generates a BOM, runs predictive audit, uploads SARIF
to GitHub code scanning, then enforces the exit code:

```yaml
jobs:
  cdx-audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @cdxgen/cdxgen
      - run: cdxgen -t nodejs -o bom.json .

      - name: Run predictive audit (SARIF)
        run: |
          cdx-audit --bom bom.json --scope required --max-targets 50 \
            --fail-severity high --report sarif --report-file audit.sarif
        continue-on-error: true

      - name: Upload SARIF to GitHub code scanning
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: audit.sarif
          category: cdx-audit

      - name: Enforce threshold
        run: cdx-audit --bom bom.json --scope required --max-targets 50 --fail-severity high

      - uses: actions/upload-artifact@v4
        with:
          name: audit-results
          path: |
            audit.sarif
            bom.json
```

The `continue-on-error: true` on the audit step ensures the SARIF file is
generated and uploaded even when findings exit with code 3. The enforcement
step re-runs without SARIF output so the job fails after the upload succeeds.

For direct BOM audit in CI, replace the audit invocation with:
`cdx-audit --bom bom.json --direct-bom-audit --fail-severity high --report
sarif --report-file audit.sarif`.

## What to take away

1. Predictive audit clones upstream repos and prioritizes which dependencies to
   review first. Direct audit evaluates the BOM you already have.
2. Use `console` for terminal triage, `json` for automation, and `sarif` for
   GitHub code scanning.
3. `--scope required` plus `--max-targets` keeps triage focused. Direct runtime
   dependencies are prioritized when the queue is trimmed.
4. Trusted-publishing-backed packages are skipped by default. Use
   `--include-trusted` to widen or `--only-trusted` to narrow.
5. `--license-policy` adds license compliance as a separate, hard-failing
   signal. Any prohibited license exits with code 3.
6. Exit code 0 means clean, 1 means error, 3 means findings crossed
   `--fail-severity`. Gate CI on 3.
