## D08

### Design change from the original plan

The plan specified a **postgen enhancement pass**: `cdxrs fetch` takes a BOM on
stdin and returns an enriched BOM. That shape was built, reviewed and replaced,
for two reasons that are worth recording because they are properties of the
codebase rather than of the implementation.

1. **Parity on the assembled BOM is unreachable for npm.** The inline metadata
   functions write cdxgen-internal `pkgList` fields (`p.license`,
   `p.repository`, `p.homepage`, `p.distribution`, `p._integrity`) that
   `addExternalReferences` and the licence/hash builders in `lib/cli/index.js`
   consume **during component construction**. `addExternalReferences` takes an
   `if/else`: when a component already carries `externalReferences`, `homepage`
   and `repository` are ignored entirely. Whether that was true at construction
   time is information a postgen pass no longer has. Writing those keys onto an
   assembled BOM also produces invalid CycloneDX — `cdxrs validate` rejects it
   with "Additional properties are not allowed ('license', 'repository',
   'homepage' were unexpected)".

2. **The batching boundary already exists.** `getNpmMetadata(pkgList)` receives
   the entire list; it just fetches serially inside it. Batching there gives the
   full parallelism with none of the above risk.

So `cdxrs fetch` is now a **registry-agnostic batched GET**: `{"requests":[...]}`
in, `{"results":[...],"stats":{...}}` out. All field derivation stays in JS.
Consequences worth knowing:

- Byte-identical output is a property of the design, not a test result: the same
  JavaScript derives every field from the same registry documents either way.
  `contrib/fetch-parity-test.js` asserts it anyway, and asserts that the Rust
  batch actually ran so the comparison cannot be vacuous.
- Every registry benefits, including the ones listed as skipped below, as soon
  as their metadata function adopts `prefetchJson`. Only npm, crates.io and
  pub.dev do so far.

### Skipped / Deferred

1. **PyPI, NuGet, Maven, Swift metadata functions not yet batched.** Nothing
   about them is load-bearing under the new design — the Rust side no longer
   touches fields at all, so the load-bearing/decorative distinction that ruled
   PyPI and NuGet out of the postgen pass does not apply. They are simply not
   converted yet: each needs its URL construction hoisted ahead of its loop the
   way npm's was. Maven additionally reads `~/.m2` and `~/.gradle` first, so its
   batch must be built from the subset that will actually go to the network.

2. **SPDX normalization stays in JS.** `lib/inventory/licenseEnhancer.js` runs
   in postgen via `enhanceBom`. Rust returns registry documents; JS derives and
   normalizes. That is Deliverable 09 and is unaffected.

3. **`getRepoLicense` inside `getNpmMetadata` is still serial.** It only fires
   when the registry document has no licence field, and its URL is not known
   until that document arrives, so it cannot join the first batch. A second
   batch round would fix it; not done this round.

4. **`test:rs-disable` still cannot exercise fetch.** No golden scenario sets
   `FETCH_LICENSE`, so the 27/27 byte-identical comparison runs the JS path
   against the JS path as far as fetch is concerned. That gap is why the earlier
   implementation's defects went unnoticed. `contrib/fetch-parity-test.js` is
   the covering test; extending the golden corpus with a `FETCH_LICENSE`
   scenario would be better still and is not done.

5. **Auth: only `GITHUB_TOKEN`.** `.npmrc` `_authToken`, `NUGET_AUTH` and netrc
   are not read by the Rust client. The previous implementation's doc comment
   claimed all four; the claim was false. A request needing credentials the Rust
   side does not have fails in the batch and falls back to the JS agent, which
   does have them — so the behaviour is correct, just not accelerated.

6. **Benchmark latency is injected, not real.** `contrib/bench-fetch.js` runs
   both paths against a local registry double with a fixed per-response delay,
   because the numbers have to be reproducible. Real-registry timings will
   differ; the serialisation being measured will not.

## D06

### Skipped / Known divergences

1. **`props.suspicious-native-name` — DROPPED.** The JS check is gated on
   `DEBUG_MODE` (`if (suspicious.length > 0 && DEBUG_MODE)` at L736 of
   `bomValidator.js`), so it is silent in production. Porting it as an
   always-on warning would be a false-positive regression for every cdxgen
   user with `native` or `bindings` in a package name. The rule is documented
   as dropped in `docs/v13/validation-rules.md` and
   `parity-exceptions.toml`.

2. **RESOLVED (in review): the 1.4/1.5 divergence.** The JS validator accepted
   spec 1.4/1.5 while cdxrs accepted only 1.6/1.7, so a valid 1.5 BOM passed or
   failed validation depending on whether a cdxrs binary happened to be
   installed — and `bin/cdxgen.js` calls `process.exit(1)` on an invalid
   verdict. Fixed by removing `"1.4"` and `"1.5"` from
   `SUPPORTED_CYCLONEDX_SCHEMA_VERSIONS`, so both paths now reject them
   identically. The parity exception has been deleted.

3. **SPDX expression validation — OUT OF SCOPE.** The plan mentions purl
   type-specific rules and SPDX license expression parsing, but the JS
   `validateBom` pipeline does not include SPDX expression validation (that
   is in `validateSpdx`, which is Deliverable 11). Only the five functions
   in scope were ported.

4. **Pre-existing: `licenseFetchJourney.repo.poku.js` is flaky.** This
   network-dependent test intermittently fails when run alongside other
   tests in the full suite. It passes in isolation. Not related to this
   deliverable; no fix attempted.

5. **Open gap: differential parity is verdict-level, not finding-level.** The
   plan asks for equality of (severity, path, rule) triples across both
   validators. That is not achievable today: the JS validator has no findings
   document — `validateBom` returns a bare boolean and writes prose to
   `console.log`. `contrib/parity-harness.js` therefore compares verdicts
   bidirectionally and asserts each `testdata/invalid/` fixture triggers its
   registered rule. Closing this properly needs a structured-findings mode on
   the JS side; until then, finding-level divergence can only be caught by the
   per-rule unit tests.

6. **Open gap: rule coverage is partial.** Of the error-severity rules, review
   added tests for the three that had none
   (`crypto.asset-missing-crypto-properties`,
   `crypto.certificate-missing-algorithm-properties`,
   `purl.encoded-slash-without-namespace`). Several warning-severity rules
   (`props.*`, most `ref.*`, several `metadata.*`) still have no positive test.
   Warnings cannot fail a build, so this was deprioritised over the error rules,
   but the plan's "one test per rule id" bar is not met yet.

7. **Schema message quality: the jsonschema crate's error messages differ
   from Ajv's.** The JS validator logs Ajv error objects via
   `console.log(validate.errors)`, which include `instancePath`,
   `schemaPath`, `keyword`, `params`, and `message`. The Rust validator maps
   jsonschema crate errors to the findings format with a `path` field (RFC
   6901 JSON Pointer) and a `message` field. The messages are different in
   wording but convey the same information. This is documented as acceptable
   because the JS validator's raw `console.log` output is not user-facing
   (it is a debug log); the user-facing output is the boolean return value
   (valid/invalid).

8. **Note (fixed in review): the purl parser is hand-rolled, not the
   `packageurl` crate the plan named.** Kept hand-rolled by decision, but
   hardened against the spec after review found it accepted `pkg:npm`,
   `pkg:npm/` and `pkg:npm/@1.0.0` (name is required), rejected the
   case-insensitive `PKG:` scheme, did not ignore empty path segments, left
   `version` percent-encoded, kept empty-valued qualifiers, and mangled
   multi-byte UTF-8 in `url_decode` by pushing decoded bytes as `char`
   (`%C3%A9` → `Ã©`). All fixed with tests; the 38-BOM parity harness shows zero
   false positives from the stricter parsing.

## D22

No blockers. All gates pass.

### Notes

1. **contrib/fine-tuning/cdxgen-docs/*.jsonl — FROZEN.** These 14 JSONL files
   are v12-era training data mirroring the v12 documentation. They contain 17
   references to `@cyclonedx/cdxgen`. Decision: freeze, not regenerate. They
   are a historical record of v12-era docs; updating them would misrepresent
   the training data's provenance.

2. **ci/diff-v12-v13.js uses both names intentionally.** It installs
   `@cyclonedx/cdxgen@<v12-version>` for the v12 side of the comparison. The
   old name is correct there.

3. **Publishing steps not executed (maintainer-only).** The following should
   be added to DELIVERABLE-19-release.md:
   - `npm publish` under `@cdxgen/cdxgen`
   - `npm deprecate @cyclonedx/cdxgen "moved to @cdxgen/cdxgen; see MIGRATING-TO-V13.md"`
   - Do NOT unpublish `@cyclonedx/cdxgen`; `^12` must keep resolving forever
   - Container image names, GitHub org, repo URLs are out of scope

4. **Types not regenerated in-loop.** Per plan, `pnpm gen-types` is too slow
   for the development loop. Types should be regenerated once at the very end
   as a separate commit. The existing type files under `types/` are slightly
   stale (the `types/lib/parsers/huggingfaceManifest.d.ts` was moved to
   `types/lib/helpers/` but its content may not reflect the new exports from
   D23 step 2-3 changes).

## D20

No blockers. All gates pass with and without a staged cdxrs binary.

### Notes

1. **No Rust change needed for purl canonicalization.** The cdxrs validator
   (`parse_purl` in `semantic.rs`) validates purl syntax but does not
   normalize names. The JS-produced canonical purls (e.g.
   `pkg:pypi/jaraco-classes@3.4.0`) are syntactically valid, so the Rust
   validator accepts them. Parity harness: 38 goldens / 0 false positives,
   7/7 invalid parity OK.

2. **Typed-builder adoption deferred.** The `encodeForPurl` helper in
   `lib/helpers/purl.js` is retained because several call sites use it to
   pre-process names before constructing purls. Retiring it in favor of
   cdx-purl's `TypedPurlBuilders` would require auditing each call site
   individually and is not needed for correctness — `build()` already
   handles canonical percent-encoding. The shim is fully removed; this is
   the only optional follow-up.
