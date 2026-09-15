# svelte-precision-eval

Measures the precision improvement of cdxgen's Svelte / SvelteKit component
scope detection between a baseline (pre-Svelte-support) cdxgen and the
current branch, as a `required`-scope delta table over sample applications.

## Usage

From the repo root:

```shell
# Accurate side-by-side comparison against a baseline cdxgen checkout
node contrib/svelte-precision-eval/index.js --baseline-cdxgen /path/to/cdxgen-master

# Approximate mode without a baseline install (under-reports: only the
# svelte.config ignore-pattern half is simulated)
node contrib/svelte-precision-eval/index.js

# Include public SvelteKit sample apps (requires git + network)
node contrib/svelte-precision-eval/index.js --baseline-cdxgen /path/to/cdxgen-master --clone-samples
```

Per-app BOM files and a machine-readable `precision-report.json` are written
to the output directory (default `/tmp/svelte-precision-eval`).

## Samples

The three committed fixtures (`test/data/svelte-repotest`,
`test/data/svelte-legacy-repotest`, `test/data/svelte-precision`) always
run; `samples.json` additionally lists public repositories for use with
`--clone-samples`.
