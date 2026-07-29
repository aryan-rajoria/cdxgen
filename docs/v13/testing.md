# Testing (v13)

This document covers the three layers of the v13 test harness and how to add
new scenarios. The harness is the safety net for every subsequent deliverable
(Rust ports, refactors, performance changes) — without it, changes cannot be
reviewed with confidence.

## Layers

### 1. Normalization (`contrib/sbom-normalize.js`)

CycloneDX BOMs contain non-deterministic fields (random UUIDs, timestamps,
tool versions, absolute paths, array ordering). The normalizer canonicalizes
these so two runs of cdxgen on the same project produce byte-identical output.

**What gets normalized** (each rule has a one-line justification in the source):

- `serialNumber` → fixed sentinel
- `metadata.timestamp` → fixed sentinel
- `metadata.tools[*].version` → sentinel
- Absolute paths → `$ROOT`-relative
- `bom-ref` values → stable identity-derived refs (with graph-preserving rewrite)
- Array ordering → sorted by stable content-derived keys
- Object key order → sorted

**What is NOT normalized** (these are exactly what we test):

- Component purls, versions, license ids, scopes, types
- Content hashes
- Dependency graph edges (structure preserved, refs rewritten consistently)

### 2. Golden files (`contrib/golden-runner.js`)

Each scenario under `repotests/<project>/` runs cdxgen, normalizes the output,
and compares against a committed golden file at `expected/<scenario>.json`.

```bash
pnpm run test:golden             # Compare against golden files
UPDATE_GOLDEN=1 pnpm run test:golden  # Regenerate golden files (prints summary)
```

**Offline by default**: network-dependent scenarios use a recorded-fixture
HTTP layer (cassettes under `repotests/_cassettes/`). An unmatched request
throws `CassetteMissError` — the harness never silently falls through to the
live network.

### 3. Differential v12-vs-v13 (`ci/diff-v12-v13.js`)

Installs the latest published v12, runs both versions over the corpus,
normalizes both outputs, and diffs. Any delta not listed in
`ci/expected-deltas.yaml` fails the job. Runs nightly and on PRs labelled
`v13`.

## Mutation test suite (`contrib/mutation-tests.js`)

The acceptance evidence that the harness catches real regressions. Mutates a
real BOM and asserts whether each mutation is caught (or correctly ignored).
Run as part of `pnpm run test:golden`.

## How to add a scenario

1. Create a fixture directory under `repotests/<project>/` with the manifest
   files (e.g. `package.json`, `pom.xml`, `Cargo.lock`).

2. Add a `golden.manifest.json`:

   ```json
   {
     "fixture": ".",
     "scenarios": [
       {
         "name": "default",
         "projectType": ["npm"],
         "options": {}
       }
     ]
   }
   ```

3. Generate the golden file:

   ```bash
   UPDATE_GOLDEN=1 pnpm run test:golden
   ```

4. Review the regeneration summary to verify the golden file content is
   correct. **Never rubber-stamp a golden file you have not reviewed.**

5. Commit the fixture, manifest, and golden file.

### Network-dependent scenarios

For scenarios that exercise `get*Metadata` family functions (registry
lookups):

1. Set `"network": true` in the scenario definition.
2. First run with `UPDATE_GOLDEN=1 CDXGEN_CASSETTE_MODE=record` to capture
   the cassette.
3. Subsequent runs replay from the cassette — no network needed.
4. Commit the cassette under `repotests/_cassettes/`.

## Rust snapshot convention (for Deliverable 05)

The `cdxrs` Rust crate uses `cargo-insta` for snapshot testing:

- Add `insta` to `[dev-dependencies]` in `Cargo.toml`.
- Snapshot files committed under `crates/.../snapshots/`.
- Use `cargo insta review` to accept/reject snapshots interactively.
- Snapshots are the Rust equivalent of golden files: review every diff.

See `CONTRIBUTING.md` in the `cdxgen-plugins-bin` repo for the full
`cargo-insta` workflow.
