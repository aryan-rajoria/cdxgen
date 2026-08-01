# Migrating to cdxgen v13

This guide covers user-visible breaking changes introduced by cdxgen v13.
Additional sections will be appended as later deliverables land.

## Package rename: `@cyclonedx/cdxgen` → `@cdxgen/cdxgen`

The npm package has moved from the `@cyclonedx` scope to the `@cdxgen` scope,
where it joins `@cdxgen/cdx-purl`, `@cdxgen/cdx-hbom`, `@cdxgen/cdx-proto`, and
`@cdxgen/safer-exec`.

**The `cdxgen` command name is unchanged.** All 15 bin entries (`cdxgen`,
`cbom`, `obom`, `evinse`, `cdx-audit`, `cdx-convert`, `cdx-validate`,
`tracebom`, etc.) install the same command names as before. Only the package
specifier changes.

### Install

```shell
# Before (v12)
npm install -g @cyclonedx/cdxgen

# After (v13)
npm install -g @cdxgen/cdxgen
```

### Programmatic imports

```js
// Before (v12)
import { createBom, submitBom } from "@cyclonedx/cdxgen";

// After (v13)
import { createBom, submitBom } from "@cdxgen/cdxgen";
```

Deep imports change **both scope and path**. For example:

```js
// Before (v12)
import { parsePkgLock } from "@cyclonedx/cdxgen/helpers/parsers-js";

// After (v13)
import { parsePkgLock } from "@cdxgen/cdxgen/helpers/parsers-js";
```

Some modules moved package as well as scope. The foundational modules now live
under `core/`, and the HuggingFace manifest readers under `parsers/`:

| v12 path | v13 path |
|---|---|
| `helpers/logger` | `core/logger` |
| `helpers/propertySanitizer` | `core/propertySanitizer` |
| `helpers/paths` | `core/paths` |
| `helpers/state` | `core/state` |
| `helpers/core-activity` | `core/activity` |
| `helpers/core-fs` | `core/fs` |
| `helpers/core-env` | `core/env` |
| `helpers/httpClient` | `core/httpClient` |
| `helpers/huggingfaceManifest` | `parsers/huggingfaceManifest` |
| `helpers/huggingfaceUtils` | `parsers/huggingfaceUtils` |

The `helpers/parsers-*.js` modules keep their paths in v13. A later release may
move them to `parsers/ecosystems/<eco>.js`; check the release notes.

### JSR

```ts
// Before (v12)
export { createBom } from "jsr:@cyclonedx/cdxgen";

// After (v13)
export { createBom } from "jsr:@cdxgen/cdxgen";
```

### `metadata.tools` change — action required for dep-scan and similar consumers

cdxgen records itself in `metadata.tools.components[].purl`. After the rename:

| Field | Before (v12) | After (v13) |
|---|---|---|
| `purl` | `pkg:npm/%40cyclonedx/cdxgen@12.x` | `pkg:npm/%40cdxgen/cdxgen@13.x` |
| `bom-ref` | `pkg:npm/@cyclonedx/cdxgen@12.x` | `pkg:npm/@cdxgen/cdxgen@13.x` |
| `group` | `@cyclonedx` | `@cdxgen` |

**dep-scan and other tools that identify the generating tool by purl or
`bom-ref`** will see the new strings. To handle the transition:

1. **Match on `name`/`group` instead of purl.** The `name` is always `"cdxgen"`;
   match on that plus `group` to identify cdxgen-generated BOMs regardless of
   package scope.
2. **Or accept both purls.** Treat `pkg:npm/%40cyclonedx/cdxgen@*` and
   `pkg:npm/%40cdxgen/cdxgen@*` as equivalent during the transition.

This is the same class of consumer-side break as the PyPI name canonicalization
(see [Package URL canonicalization](#package-url-purl-canonicalization) above) —
both land in v13 as one story.

### Out of scope

Container image names (`ghcr.io/cyclonedx/cdxgen*`), the GitHub organization
(`@cyclonedx`), and repository URLs are **unchanged** by this rename. Only the
npm/JSR package identity changes.

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
one major version, so existing `import { X } from "@cdxgen/cdxgen/helpers/utils"`
(or relative `"./utils.js"`) imports keep working unchanged.

The barrel is **deprecated as of v13**. Consumers should import from the
specific leaf module instead:

| New module | Theme |
|---|---|
| `helpers/purl` | purl build/parse, version compare, conan/nix purl helpers |
| `helpers/spdx` | license-id normalisation, SPDX expressions, license data lookup |
| `core/state` | eval-time data constants (frameworks, version, module tables) |
| `core/paths` | path/OS detection helpers |
| `core/activity` | activity/dry-run/host-allowlist, `cdxgenAgent`, feature flags |
| `core/fs` | safe wrappers, `safeSpawnSync`, file discovery, checksums |
| `core/env` | runtime detection, env flags, command resolution, alias tables |
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
`@cdxgen/cdxgen`. In v12 it was an optional dependency that could be
excluded with `--omit=optional` or `--no-optional`.

**What this means for you:**

- `npm install @cdxgen/cdxgen` will always install the plugins-bin
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
