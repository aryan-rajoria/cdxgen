# Deprecations and removal schedule

What is deprecated, when it goes, and the condition that has to hold before it
goes. A fallback with no removal date is not a safety net, it is permanent
maintenance; a fallback removed on a date rather than on evidence is a
regression waiting to happen. Each entry below therefore names a criterion, not
just a version.

## Rust fallback paths

`cdxrs` subcommands are optional. `runCdxrs` returns `CDXRS_FALLBACK` and the
JavaScript implementation runs whenever the binary is missing, the version
major does not match, the subcommand is disabled, the input cannot be spilled
to a temp file, or the process fails. Nothing surfaces to the user beyond one
warning.

| Path             | JS fallback                   | Status                |
| ---------------- | ----------------------------- | --------------------- |
| `cdxrs fetch`    | `lib/inventory/fetchBatch.js` | Retained indefinitely |
| `cdxrs validate` | `lib/validator/`              | Retained indefinitely |

**Neither fallback is scheduled for removal, and that is a deliberate reversal
of the v13 plan.** The plan assumed the Rust surface would keep growing and the
JS paths would become dead weight. Measurement went the other way:

- `cdxrs fetch` — the 15x improvement attributed to Rust was concurrency. A
  JavaScript pool at 16 matches the Rust binary.
- `cdxrs license` — dropped.
- `cdxrs evinse` — atom accounts for 89–99.7% of evinse wall time; JavaScript
  is under 0.6%. Nothing to move.

With two subcommands wired and no measured advantage large enough to justify
requiring the binary, the JS paths are the primary implementation and the Rust
paths are the optimisation. Removing the fallbacks would make an optional
dependency mandatory in exchange for nothing.

`contrib/rs-disable-golden-test.js` asserts `CDXGEN_RS_DISABLE=all` produces
byte-identical output. That gate is what makes the fallback safe to take
silently, so it is a release blocker, not a nicety.

### If that changes

Before any fallback is removed, all of these must hold:

1. The Rust path measurably beats the JS path on a stated corpus, with the
   measurement published in [BENCHMARKS.md](BENCHMARKS.md).
2. `rs-disable-golden-test` has been green for two minor releases.
3. The binary ships for every supported platform, including the ones where the
   native build is currently unavailable.
4. One minor release has warned on fallback before the release that removes it.

Removal would be a major-version change, since it turns an optional dependency
into a required one.

## Removed in v13

Already gone; listed so an upgrade failure is diagnosable.

| Removed                                        | Replacement                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Node.js < 24                                   | Node.js >= 24                                                          |
| CycloneDX 1.4/1.5 as a **target** spec version | 1.6 or 1.7. Downgrade _output_ to 1.4/1.5 still works                  |
| `ghcr.io/cyclonedx/*` images                   | `ghcr.io/cdxgen/*` — see [MIGRATING-TO-V13.md](../MIGRATING-TO-V13.md) |
| `@cyclonedx/cdxgen` on npm                     | `@cdxgen/cdxgen`                                                       |
| Node.js 20 container images                    | `cdxgen-alpine-node24`                                                 |
| `cheerio` dependency                           | Internal extractor; no user-visible change                             |

## Property naming

`cdx:mcp:*` properties emitted behind `--experimental-mcp-pinning` are
namespaced so they can be renamed mechanically. The CycloneDX agent-BOM
proposal is not ratified, so these names carry **no stability promise** and may
change or disappear in a minor release. They are off by default for that
reason.

The `internal:` prefix on legacy properties (`internal:SrcFile` and the Maven,
Gradle and Go properties) is stable as of v13.

## Experimental features

Anything behind an `--experimental-*` flag or documented as experimental has no
stability promise at all, in either direction: it may change shape, change
names, or be removed in a minor release. Currently:

- `--experimental-mcp-pinning`
- `--tea-publish` — the TEA publisher API is a draft recommendation, not part
  of the Beta 2 conformance spec, and will change when the standard lands.
  `--tea-fetch` targets the conformance spec and is not experimental.
