# Migrating to cdxgen v13

This guide covers user-visible breaking changes introduced by cdxgen v13.
Additional sections will be appended as later deliverables land.

## Node requirement

cdxgen v13 requires **Node.js >= 24.0.0**.

Previous versions supported Node 20 and 22. If you are running an older Node,
upgrade to Node 24 (current LTS) or Node 26 before installing v13.

| cdxgen | Minimum Node | Notes |
|--------|-------------|-------|
| v12    | 20          | End of maintenance once v13 ships |
| v13    | 24          | Active development target |

## CycloneDX spec version changes

The `--spec-version` flag now accepts **1.6**, **1.7**, and **2.0** as
generation targets. The default remains **1.7**.

**Removed generation targets:** `1.4` and `1.5`.

If you previously used `--spec-version 1.4` or `--spec-version 1.5`, you will
now receive an error message explaining the change.

Note that generating with `--spec-version 1.6` produces a **1.6** document — it
does not emit 1.4 or 1.5. The 1.4/1.5 output-downgrade logic in
`lib/stages/postgen/postgen.js` is retained and is still reachable by library
callers that pass `specVersion: 1.4`/`1.5` to `createBom()`; only the CLI
generation target is restricted. To obtain a 1.4 or 1.5 document from the CLI,
generate 1.6 and convert it with an external tool, for example:

```shell
cdxgen -o bom.json --spec-version 1.6 .
cyclonedx-cli convert --input-file bom.json --output-version v1_5 --output-file bom-1.5.json
```

The validation command (`cdx-validate`) continues to accept existing 1.4 and
1.5 BOMs as input, and the bundled 1.4/1.5 JSON schemas in `data/` are retained
for that purpose.

The spec floor is enforced on the `cdxgen` CLI, the `tracebom` CLI, and the
`/sbom` HTTP server endpoint (which returns HTTP 400 for a rejected value).

## Removed CLI flags and env vars

| Flag | CLI | Status | Reason |
|------|-----|--------|--------|
| `--db-path` | `evinse` | Removed | Hidden flag whose own help text read "Unused". It was never read by any code path. |
| `--spec-version 1.4` / `1.5` | `cdxgen`, `tracebom` | Values rejected | Below the v13 spec floor. See above. |

No environment variables were formally deprecated in v12, so none are removed.

## `lib/helpers/utils.js` barrel deprecation

`lib/helpers/utils.js` has been decomposed into focused leaf modules. The file
remains as a re-export barrel that preserves all **261** public export names for
one major version, so existing `import { X } from "@cyclonedx/cdxgen/helpers/utils"`
(or relative `"./utils.js"`) imports keep working unchanged.

The barrel is **deprecated as of v13**. Consumers should import from the
specific leaf module instead:

| New module | Theme |
|---|---|
| `helpers/purl` | purl build/parse, version compare, conan/nix purl helpers |
| `helpers/spdx` | license-id normalisation, SPDX expressions, license data lookup |
| `helpers/state` | eval-time data constants (frameworks, version, module tables) |
| `helpers/paths` | path/OS detection helpers |
| `helpers/core-activity` | activity/dry-run/host-allowlist, `cdxgenAgent`, feature flags |
| `helpers/core-fs` | safe wrappers, `safeSpawnSync`, file discovery, checksums |
| `helpers/core-env` | runtime detection, env flags, command resolution, alias tables |
| `helpers/deps` | dependency-tree assembly, component merge/dedupe, JAR namespace collection |
| `helpers/ecosystems` | the `get*Metadata` family + registry fetch helpers |
| `helpers/parsers-go` | Go ecosystem parsers (`parseGoMod*`, `parseGosum*`, etc.) |
| `helpers/parsers-dotnet` | .NET ecosystem parsers (`parseCsProj*`, `parseNuspec*`, etc.) |
| `helpers/parsers-rust` | Rust/cargo parsers (`parseCargo*`, cargo workspace internals) |
| `helpers/parsers-jvm` | JVM parsers (`parsePom`, `parseMavenTree*`, `parseBazel*`, etc.) |
| `helpers/parsers-python` | Python parsers (`parsePy*`, `parseReq*`, `parsePixi*`, etc.) |
| `helpers/parsers-js` | JS/npm parsers (`parsePkgJson`, `parsePkgLock`, `parsePnpm*`, etc.) |
| `helpers/parsers-misc` | All other parsers (`parseComposer*`, `parseConan*`, `parseSwift*`, etc.) |

## Removed container images

The Node.js 20 images are removed, since cdxgen itself now requires Node.js >= 24:

| Removed | Replacement |
|---------|-------------|
| `ghcr.io/cyclonedx/cdxgen-node20` | `ghcr.io/cyclonedx/cdxgen-alpine-node24` |
| `ghcr.io/cyclonedx/cdxgen-alpine-node20` | `ghcr.io/cyclonedx/cdxgen-alpine-node24` |

The rolling `ghcr.io/cyclonedx/cdxgen-node` alias previously pointed at the
Node.js 20 image and now points at `cdxgen-alpine-node24`. Note that this
changes its base image from SUSE BCI to Alpine.

The `-t node20` **install-version project type** is unaffected and remains the
supported way to build a target application that requires an older Node.js:

```shell
docker run --rm -v $(pwd):/app:rw -t ghcr.io/cyclonedx/cdxgen:latest -t node20 -r /app -o /app/bom.json
```

## Install and package size changes

`@cdxgen/cdxgen-plugins-bin` is now a **direct (required) dependency** of
`@cyclonedx/cdxgen`. In v12 it was an optional dependency that could be
excluded with `--omit=optional` or `--no-optional`.

**What this means for you:**

- `npm install @cyclonedx/cdxgen` will always install the plugins-bin
  meta-package.
- The per-platform binary packages (e.g.
  `@cdxgen/cdxgen-plugins-bin-darwin-arm64`) remain **optional** and are
  selected automatically based on your runtime platform.

> **Important:** the meta-package is a stub — it ships no plugin binaries and
> declares no dependencies. The actual `plugins/` directory lives only in the
> per-platform packages, which are still optional. Promoting the meta-package
> therefore does **not** by itself guarantee that plugin binaries are present;
> installing with `--omit=optional` will still leave you without them. If your
> platform has a published binary package and it is missing, cdxgen now warns
> about a likely install-integrity problem. On platforms with no published
> binary package, plugin-backed features are skipped silently, as before.

**Measured impact (npm pack + installed size):**

| Metric | v12 (optional) | v13 (required) | Delta |
|--------|---------------|----------------|-------|
| Tarball (.tgz) | 2,072,434 bytes | 2,072,561 bytes | +127 bytes |
| Installed node_modules | 574 MB | 574 MB | 0 MB |

The installed footprint is unchanged because package managers (pnpm, npm)
already installed optional dependencies by default. The change is semantic:
the package can no longer be excluded.

## Rust-backed stages

> **Placeholder** — later v13 deliverables will document the `cdxrs` binary
> here, including how to disable individual Rust-backed steps via
> `CDXGEN_RS_DISABLE=<subcommand>[,...]` and the JS fallback guarantee.

## Package URL (purl) canonicalization

cdxgen v13 replaces the `packageurl-js` library with `@cdxgen/cdx-purl`, a
strict, canonicalizing implementation that enforces the purl-spec ABNF and
per-type policies. This section documents the user-visible purl changes.

### PyPI name normalization

PyPI package names containing `.` or `_` are now normalized to `-` per
[PEP 503](https://peps.python.org/pep-0503/), as required by the purl-spec.
**Both the `purl` string and the derived `bom-ref` change.**

| Before (v12) | After (v13) |
|---|---|
| `pkg:pypi/jaraco.classes@3.4.0` | `pkg:pypi/jaraco-classes@3.4.0` |
| `pkg:pypi/jaraco.context@6.1.1` | `pkg:pypi/jaraco-context@6.1.1` |
| `pkg:pypi/jaraco.functools@4.4.0` | `pkg:pypi/jaraco-functools@4.4.0` |

The component `name` field is **not** changed — only the `purl` and `bom-ref`.

### Golang namespace case normalization

Golang namespaces are lowercased per the purl-spec (golang paths are
case-insensitive). For example:

| Before (v12) | After (v13) |
|---|---|
| `pkg:golang/github.com/ShiftLeftSecurity/atlassian-connect-go` | `pkg:golang/github.com/shiftleftsecurity/atlassian-connect-go` |

The component `name` preserves its original case; only the `purl`/`bom-ref`
are lowercased.

### Components without a valid purl

Some components legitimately lack enough metadata to construct a valid purl
under strict rules. These now receive a **name-based `bom-ref`** and no `purl`
field:

- **Maven** artifacts without a `groupId` (some Mill/Gradle modules)
- **Swift** local application packages (no remote URL / namespace)
- **vscode-extension** packages without a publisher
- **Golang** modules with no path separator (e.g. `go4.org`)

Previously these received a non-canonical or invalid purl like
`pkg:swift/swift-smoke@undefined`.

### Guidance for downstream consumers

**dep-scan and other tools that match on purl strings** must handle the new
canonical forms. An unmigrated consumer that looks up
`pkg:pypi/jaraco.classes@3.4.0` will silently miss advisories stored under
`pkg:pypi/jaraco-classes@3.4.0`.

**What to do:**

1. **Normalize incoming purls the same way** before lookup. For PyPI, apply
   PEP 503 normalization: lowercase the name and replace runs of `-`, `_`,
   and `.` with a single `-`. The `@cdxgen/cdx-purl` library does this
   automatically — use `Purl.parse(purlString).toString()` to canonicalize.

2. **Treat old and new spellings as equivalent during a transition period.**
   When an exact purl match fails, retry with the canonicalized form. This
   covers SBOMs generated by v12 that are consumed by v13-era tooling.

3. **Match on `bom-ref` cautiously.** Since `bom-ref` is derived from `purl`
   in cdxgen, it changes alongside the purl. Dependency relationships
   (`dependencies[].ref`, `dependencies[].dependsOn[]`) reference `bom-ref`
   values, so they also change.

4. **Components without a purl** now use a name-based `bom-ref`. Consumers
   that assumed every component has a `pkg:`-prefixed `bom-ref` should handle
   non-purl refs gracefully.
