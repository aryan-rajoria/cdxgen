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
