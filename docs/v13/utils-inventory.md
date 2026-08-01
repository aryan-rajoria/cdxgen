# `lib/ecosystems/utils.js` decomposition inventory — Deliverable 03

**Branch:** `v13/03-decompose-utils`
**Base:** `7ec577b9` (D04 test harness)
**Status:** INVENTORY — gated for review before any function is moved.

This document inventories every export and internal function in
`lib/ecosystems/utils.js`, assigns each a target module, and catalogues the
module-level mutable state that constrains the split. Nothing has been moved
yet. Per the deliverable process, **this inventory must be reviewed before any
moves occur.**

---

## 1. File under review

| Metric | Value |
|---|---|
| Total lines | 21,913 |
| Exported names | 261 (217 functions, 30 `const`, 1 re-export, plus class/value exports) |
| Non-exported functions | 118 |
| Test file | `lib/ecosystems/utils.poku.js` — 12,419 lines, 1,521 `assert.*` calls, 250 `it`/`test` blocks |
| Importing files | 79 under `lib/` and `bin/` |

### Established baselines (all green on `7ec577b9`)

- `pnpm run test:golden` — 15 goldens + 25 mutation + 75 shuffle + 8 cassette
- `pnpm test` — 116 poku files
- `node contrib/check-boundaries.js` — clean
- `pnpm exec poku lib/packaging.poku.js` — clean
- `pnpm run lint:check` — clean

---

## 2. On-disk layout decision

**New modules will be flat files under `lib/helpers/`** (the existing mapped
package directory), not new top-level `lib/` trees.

Rationale:

1. **Hazard 4 (exports map).** `package.json` publishes `"./helpers/*"` →
   `./lib/helpers/*.js`. A new `lib/inventory/purl.js` is immediately reachable
   as `@cdxgen/cdxgen/helpers/purl`. No `exports` additions needed, so
   `lib/packaging.poku.js` cannot regress. A new top-level `lib/purl/` would
   require explicit `exports` entries and risks an unpublished path.
2. **Hazard 3 (boundary checker).** `PACKAGE_DIRS` maps `lib/helpers` →
   `helpers` package. Files added under `lib/helpers/` are already scanned and
   enforced against `cli/`, `managers/`, `parsers/`, etc. No `PACKAGE_DIRS`
   edit is required for new files in an existing mapped directory; the
   between-helpers edges are not package boundaries (acceptable for D03).
3. **`packages/helpers/package.json`** already declares its dependencies; no
   new workspace packages are created by adding files inside the mapped dir.

> **Boundary-enforcement note.** Because all new files remain inside the
> `helpers` package, `check-boundaries.js` enforces the *inter-package* edges
> (helpers↔cli, helpers↔managers, …) but does **not** enforce edges *between*
> the new helper files. That is an acceptable trade-off for D03: the goal here
> is to make the `get*Metadata` family and parsers individually addressable
> (for D08's Rust port) while preserving zero behaviour change. If finer
> sub-package boundaries are wanted later, that is a follow-up that creates new
> `lib/<x>/` trees with matching `PACKAGE_DIRS` + `exports` entries.

Proposed new files (one per batch, all under `lib/helpers/`):

**Corrected order** (round-2 review): `deps` moves **before** `ecosystems` because
the ecosystems cluster calls six functions in deps (`parsePomXml`,
`getPomPropertiesFromMavenDir`, `parseJarManifest`, `inferJarGroupFromManifest`,
`trimJarGroupSuffix`, `collectJarNS`), while deps→ecosystems is zero edges. With
the original order, batch 4 (ecosystems) would import the still-monolithic
`utils.js` while `utils.js` imports back into `ecosystems.js` — a live cycle
across a module that does work at eval time. Each batch's outbound calls are
checked against the tree **as it will be at that moment**, not the final graph.

| Batch | New file | Theme |
|---|---|---|
| 1 | `lib/inventory/purl.js` | purl build/parse, version compare, conan/nix purl helpers |
| 2 | `lib/inventory/spdx.js` | license-id normalisation, SPDX expressions, license data lookup |
| 3 | `lib/core/activity.js` / `lib/core/fs.js` / `lib/core/env.js` | path/file/hash/string utils, safe wrappers, activity/dry-run/host-allowlist, env/runtime/command resolution, feature flags |
| 4 | `lib/inventory/deps.js` | dependency-tree assembly, component merge/dedupe, JAR namespace collection |
| 5 | `lib/ecosystems/ecosystems.js` | the `get*Metadata` family + registry fetch helpers |
| 6 | `lib/ecosystems/parsers-<ecosystem>.js` | the `parse*` family, grouped per ecosystem (see §6) |
| 7 | `lib/core/activity.js` / `lib/core/fs.js` / `lib/core/env.js` (cont.) | residual core that resisted earlier classification |

**Types requirement (round-2 review):** `exports["./helpers/*"]` maps `types` to
`./types/lib/helpers/*.d.ts`, `types/` is committed, and
`lib/packaging.poku.js` asserts every types entry exists on disk. So for every
new `lib/helpers/*.js`, in the same commit: run `pnpm gen-types`, commit the
generated `.d.ts` + `.d.ts.map`, regenerate `test/baseline/npm-pack-file-list.txt`
from a clean worktree of the base branch, and run
`pnpm exec poku lib/packaging.poku.js`.

`lib/ecosystems/utils.js` becomes a re-export barrel preserving all 261 public
names (kept for one major version; deprecated in `MIGRATING-TO-V13.md`).

---

## 3. Hazard 1 — module-level mutable-state table

This is the constraint that makes the split non-trivial. Every binding below is
declared once at module scope and closed over by one or more functions. After
the split there must remain **exactly one instance** of each.

A complete scan of `utils.js` finds **37 module-level `let`/`const` bindings
that are mutable containers or reassignable**. They fall into three groups.

### 3a. Reassignable / mutated bindings that stay within a single cluster (safe)

These are referenced only by functions that will land in the same target
module, so moving the binding and its users together is a pure move.

| Binding | Kind | Line | Functions that touch it (all same target) | Target |
|---|---|---|---|---|
| `activityLedger` | `const []` | 151 | `recordActivity` (w), `resetRecordedActivities` (w — `length = 0`), `getRecordedActivities` (r — `return [...activityLedger]`) | core/activity |
| `activityCounter` | `let` | 152 | `recordActivity` (rw), `resetRecordedActivities` (w) | core/activity |
| `currentActivityContext` | `let` (reassigned) | 153 | `setActivityContext` (w), `resetActivityContext` (w), `recordActivity` (r) | core/activity |
| `dryRunReadTraceState` | `const` obj | 154 | `emitActivity`, `recordObservedActivity`, `recordEnvironmentRead`, `recordSensitiveFileRead`, `recordActivity`, `resetRecordedActivities` | core/activity |
| `isDryRun` | `export let` (reassigned) | 140 | `setDryRunMode` (w); read by `recordObservedActivity`, `recordEnvironmentRead`, `recordSensitiveFileRead`, `recordActivity`, all `safe*` wrappers, `safeSpawnSync`, and the `cdxgenAgent` hooks | core/activity |
| `commandsExecuted` | `export Set` | 1105 | `safeSpawnSync` (w, L1499). *(Verified: `safeExtractArchive` does not reference `commandsExecuted` directly, nor call `safeSpawnSync`; the only code-level write is L1499.)* | core/fs |
| `search_maven_org_errors` | `let` | 1700 | `extractJarArchive` (rw) only | ecosystems |
| `get_repo_license_errors` | `let` | 1704 | `getRepoLicense` (rw) only | ecosystems |
| `jarNSMapping_cache` | `const {}` | 1582 | `collectJarNS` (rw) only | deps |

> Note: `dryRunReadTraceState` is additionally guarded by a `globalThis.__cdxgenDryRunReadTraceState`
> singleton check, so even an accidental duplicate would share the same object.
> It stays with the activity cluster regardless.

### 3a-2. `export let` command bindings — reassigned at module-eval time (L1749–1795)

Each of these is `export let X = "default"; if (process.env.X) { X = process.env.X; }`
— a declaration immediately followed by a conditional reassignment, both at
module scope. They are safe **only if declaration and reassignment move together
as one unit** (they occupy consecutive lines and must not be separated).
`JAVA_CMD` (L1709, `const`), `PYTHON_CMD` (L1731, `const`), `SWIFT_CMD`
(L1798, `const`), `RUBY_CMD` (L1800, `const`) are `const` and never reassigned —
they move as plain constants.

| Binding | Kind | Line | Reassignment | Target |
|---|---|---|---|---|
| `DOTNET_CMD` | `export let` | 1749 | L1750–1752 from `process.env.DOTNET_CMD` | core/env |
| `NODE_CMD` | `export let` | 1753 | L1754–1756 from `process.env.NODE_CMD` | core/env |
| `NPM_CMD` | `export let` | 1757 | L1758–1760 | core/env |
| `YARN_CMD` | `export let` | 1761 | L1762–1764 | core/env |
| `GCC_CMD` | `export let` | 1765 | L1766–1768 | core/env |
| `RUSTC_CMD` | `export let` | 1769 | L1770–1772 | core/env |
| `GO_CMD` | `export let` | 1773 | L1774–1776 | core/env |
| `CARGO_CMD` | `export let` | 1777 | L1778–1780 | core/env |
| `CLJ_CMD` | `export let` | 1783 | L1784–1786 | core/env |
| `LEIN_CMD` | `export let` | 1788 | L1789–1791 | core/env |
| `CDXGEN_TEMP_DIR` | `export let` | 1793 | L1794–1796 from `process.env.CDXGEN_TEMP_DIR` | core/env |

All eleven land in `core-env.js` (the env/command-resolution leaf of the
former `core-activity.js` / `core-fs.js` / `core-env.js` cluster) and are re-exported by the barrel.

### 3a-3. Frozen-after-init config constants (`const Set`/`Map`, never mutated)

These are populated once at module-eval time and never written again. They are
technically mutable containers but pose no hazard: whichever module owns them
simply declares them and others import the (read-only) reference. Listed for
completeness so a reviewer can see "checked and safe":

`DIRECTORY_DISCOVERY_NAMES` (L164), `LOCKFILE_ACTIVITY_HINTS` (L179),
`MANIFEST_ACTIVITY_HINTS` (L257), `CERTIFICATE_FILE_EXTENSIONS` (L406),
`KEY_FILE_EXTENSIONS` (L407), `ALLOWED_WRAPPERS` (L1119),
`VERSION_PROBE_ARGS` (L1163), `NPM_LIFECYCLE_JS_RUNNERS` (L3064),
`NPM_LIFECYCLE_JS_RUNNER_VALUE_OPTIONS` (L3073),
`SENSITIVE_ENV_VAR_PATTERN` (L162, regex const),
`POSIX_SHELL_METACHARACTERS` (L1165), `WINDOWS_SHELL_METACHARACTERS` (L1166).

Plus frozen boolean/value constants: `isNode` (L143), `isBun` (L144),
`isDeno` (L145), `isWin` (L147), `isMac` (L148), `url` (L120, `let` used only
to compute `dirNameStr` at eval time — moves with `dirNameStr`).

Each moves with the cluster that uses it; no cross-cluster hazard.

### 3b. Bindings that span clusters (require a shared owner)

| Binding | Kind | Line | Problem | Proposed resolution |
|---|---|---|---|---|
| `metadata_cache` | `export let` **(reassigned)** | 1580 | Read/written by ecosystem funcs (`getNpmMetadata`, `getGoPkgLicense`, `getGoPkgVCSUrl`, `getNugetMetadata`) **and** reassigned (`= {}`) by `parseGoModData` (a parser). ESM forbids reassigning an imported binding, so the reassigner must live in the declaring module. | **Declare `metadata_cache` in `ecosystems.js`** alongside its primary users. Export a `_clearMetadataCache()` helper — **internal, NOT in the barrel's 261 public names**. `parseGoModData` (batch 6) imports `metadata_cache` (read) + `_clearMetadataCache` and calls the helper instead of `metadata_cache = {}`. **One-line mechanical adaptation at L10788**, documented in §7. |
| `cdxgenAgent` | `export const` | 2324 | Single HTTP client instance built via `createHttpClient`. Its `beforeRequest`/`afterResponse`/`beforeError` hooks close over `isDryRun`, `remoteHostsAccessed`, `recordActivity`, `recordPolicyActivity`, `inferNetworkIntent`, `isAllowedHttpHost`, `createDryRunError`, `createBlockedHostError`, `readEnvironmentVariable`, `traceLog`. Used by ~12 ecosystem/parser funcs. Two instances ⇒ two connection pools + two caches. | **Build `cdxgenAgent` in `core-activity.js` / `core-fs.js` / `core-env.js`** (with the activity/host-allowlist cluster it closes over). Ecosystem/parser modules import the single instance from there. The D04 cassette layer intercepts inside `httpClient.js`'s `doRequest`, so replay keeps working as long as there is one agent. |
| `remoteHostsAccessed` | `export Set` | 2249 | Written only by the `cdxgenAgent` `beforeRequest` hook; read externally by 1 importer. | Stays with `cdxgenAgent` in `core-activity.js` / `core-fs.js` / `core-env.js`. |
| `temporaryFiles` | `const Set` | 1585 | Written by `fullScanCocoaPod` (a cocoa helper). Has a `process.on("exit", …)` cleanup handler at L1586–1592 that calls `safeExistsSync`/`safeUnlinkSync`. | The binding + exit handler stay in **`core-fs.js`** (with the `safe*` wrappers the handler calls). `fullScanCocoaPod` (batch 7, `core-misc.js`) imports the `const` Set reference — safe because it is mutated, never reassigned. |

### 3c. Per-binding singleness guarantee (definition-of-done checklist)

After the split, exactly one instance of each binding exists:

- `activityLedger`, `activityCounter`, `currentActivityContext`, `isDryRun`,
  `dryRunReadTraceState`, `cdxgenAgent`, `remoteHostsAccessed` → declared once
  in `core-activity.js`.
- `commandsExecuted`, `temporaryFiles` (+ its `process.on("exit")` handler) →
  declared once in `core-fs.js`.
- `DOTNET_CMD` … `LEIN_CMD`, `CDXGEN_TEMP_DIR` (the 11 `export let` command
  bindings, each with its eval-time reassignment block) → declared once in
  `core-env.js`.
- `metadata_cache` → declared once in `ecosystems.js`; `_clearMetadataCache`
  is internal to `ecosystems.js` and **not** re-exported by the barrel.
- `search_maven_org_errors`, `get_repo_license_errors` → declared once in
  `ecosystems.js`.
- `jarNSMapping_cache` → declared once in `deps.js`.

The barrel (`utils.js`) re-exports the public names but does **not** redeclare
any of them.

---

## 4. Hazard 2 — import cycles (intermediate-state analysis)

ESM tolerates cycles across function declarations (hoisted) but throws
`ReferenceError: Cannot access 'X' before initialization` when a cycle crosses a
`const`/`class`/`let` binding used at module-evaluation time. **The cycles that
bite exist in the intermediate states**, where half the callees still live in
`utils.js`. Each batch is checked against the tree as it will be at that moment.

### The cycle that forced the reorder

The ecosystems cluster calls six functions that the original plan assigned to
`deps.js` (batch 6, *after* ecosystems):

- `getMvnMetadata` → `parsePomXml`
- `extractJarArchive` → `getPomPropertiesFromMavenDir`, `parseJarManifest`,
  `inferJarGroupFromManifest`, `trimJarGroupSuffix`, `collectJarNS`

Meanwhile, parsers still in `utils.js` call back into ecosystems (8 calls to
`getNpmMetadata`, 7 to `getRepoLicense`, 5 to `getPyMetadata`). With the
original order, moving ecosystems first would make `ecosystems.js` import
`utils.js` (for the deps functions still there) while `utils.js` imports back
into `ecosystems.js` — a live cycle across a module doing real work at eval
time (`JSON.parse` of license data, `cdxgenAgent` construction, `*_CMD`
assignments).

`deps → ecosystems` is **zero** edges, so moving deps first eliminates the
cycle outright. **Corrected order: purl → spdx → core → deps → ecosystems → parsers → residual.**

### Per-batch outbound-call check rule

Before moving each batch, compute the moved set's outbound calls. Every target
must be either (a) inside the moved set, or (b) in an **already-extracted**
module. If a target is still in `utils.js`, verify `utils.js` does not import
the moved module at eval time — if it does (and the moved module reads a
`const`/`let` from `utils.js` at eval time), **reorder rather than pushing
through**.

### Final-graph edges (all one-way, safe)

| Edge | Direction | Notes |
|---|---|---|
| `purl.js` → `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | purl is a leaf utility |
| `spdx.js` → `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | |
| `core-fs.js` → `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | safe wrappers use activity/dry-run state |
| `deps.js` → `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | |
| `ecosystems.js` → `deps.js`, `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | deps extracted first |
| `parsers-*.js` → `ecosystems.js`, `deps.js`, `core-activity.js` / `core-fs.js` / `core-env.js` | one-way | all targets extracted first |
| `core-activity.js` / `core-fs.js` / `core-env.js` → parsers/ecosystems | **must not happen** | core is a leaf |
| barrel `utils.js` re-exports from all new modules | new modules import siblings directly, never `./utils.js` | re-exports don't access values at eval time |

**Verification gate (per batch):** after creating each new module, run
`node --input-type=module -e 'await import("./lib/helpers/<mod>.js")'` in
isolation to confirm no TDZ cycle errors at import time.

---

## 5. Export inventory summary (261 names → target module)

Caller counts are files under `lib/`+`bin/` (excluding `*.poku.js` and
`utils.js` itself) that reference the name. The full per-name table is in
§5b.

### 5a. By target module

| Target | Exported funcs | Notable `const`/value exports | Approx lines |
|---|---|---|---|
| `core-activity.js` / `core-fs.js` / `core-env.js` | 90 | `DEBUG_MODE`, `dirNameStr`, `isSecureMode`, `isDryRun`, `isNode`, `isBun`, `isDeno`, `isWin`, `isMac`, `CDXGEN_VERSION`, `TIMEOUT_MS`, `MAX_BUFFER`, `cdxgenAgent`, `commandsExecuted`, `remoteHostsAccessed`, `metadata_cache`→no(see §3b), `PROJECT_TYPE_ALIASES`, `PACKAGE_MANAGER_ALIASES`, `FETCH_LICENSE`, `SEARCH_MAVEN_ORG`, `PYTHON_EXCLUDED_COMPONENTS`, `*_CMD` (JAVA/PYTHON/DOTNET/NODE/NPM/YARN/GCC/RUSTC/GO/CARGO/CLJ/LEIN/SWIFT/RUBY), `TABLE_BORDER_STYLE`, `CDXGEN_SPDX_CREATED_BY`, `includeMavenTestScope`, `PREFER_MAVEN_DEPS_TREE`, `DRY_RUN_ERROR_CODE`, `BLOCKED_HOST_ERROR_CODE`, `CDXGEN_TEMP_DIR`, `frameworksList` | ~8,250 (split internally, see §6) |
| `parsers-<eco>.js` | 84 | — | ~9,670 (split per ecosystem, see §6) |
| `ecosystems.js` | 18 | — | ~1,566 |
| `spdx.js` | 13 | — | ~531 |
| `deps.js` | 7 | — | ~501 |
| `purl.js` | 5 | — | ~305 |

> The barrel `utils.js` re-exports all 261, so existing `import { X } from "./utils.js"`
> keeps working unchanged. A snapshot test will assert all 261 names resolve.

### 5b. Full export → target table

Legend: `callers` = number of referencing files outside utils.js.

| callers | export | target |
|---:|---|---|
| 44 | `safeExistsSync` | core |
| 29 | `DEBUG_MODE` | core |
| 17 | `getTmpDir` | core |
| 15 | `dirNameStr` | core |
| 15 | `isDryRun` | core |
| 15 | `safeSpawnSync` | core |
| 15 | `safeWriteSync` | core |
| 14 | `safeMkdtempSync` | core |
| 13 | `getAllFiles` | core |
| 13 | `isWin` | core |
| 13 | `safeRmSync` | core |
| 11 | `safeMkdirSync` | core |
| 9 | `cdxgenAgent` | core |
| 9 | `isSecureMode` | core |
| 9 | `recordActivity` | core |
| 8 | `retrieveCdxgenVersion` | core |
| 7 | `getTimestamp` | core |
| 6 | `isMac` | core |
| 6 | `readEnvironmentVariable` | core |
| 4 | `FETCH_LICENSE` | core |
| 4 | `getNpmMetadata` | ecosystems |
| 4 | `setActivityContext` | core |
| 4 | `shouldFetchLicense` | core |
| 3 | `getLicenses` | spdx |
| 3 | `hasAnyProjectType` | core |
| 3 | `hasDangerousUnicode` | core |
| 3 | `isAllowedHttpHost` | core |
| 3 | `isBun` | core |
| 3 | `recordSensitiveFileRead` | core |
| 3 | `safeExtractArchive` | core |
| 2 | `CARGO_CMD` | core |
| 2 | `CDXGEN_VERSION` | core |
| 2 | `DOTNET_CMD` | core |
| 2 | `MAX_BUFFER` | core |
| 2 | `PROJECT_TYPE_ALIASES` | core |
| 2 | `RUBY_CMD` | core |
| 2 | `SWIFT_CMD` | core |
| 2 | `TIMEOUT_MS` | core |
| 2 | `attachIdentityTools` | core |
| 2 | `checksumFile` | core |
| 2 | `collectJarNS` | deps |
| 2 | `collectMvnDependencies` | deps |
| 2 | `convertOSQueryResults` | core |
| 2 | `createNpmWorkspacePurl` | purl (re-export from npmutils) |
| 2 | `extractPathEnv` | core |
| 2 | `extractToolRefs` | core |
| 2 | `getCratesMetadata` | ecosystems |
| 2 | `getMavenCommand` | core |
| 2 | `getPyMetadata` | ecosystems |
| 2 | `isDeno` | core |
| 2 | `isFeatureEnabled` | core |
| 2 | `isPartialTree` | core |
| 2 | `isValidDriveRoot` | core |
| 2 | `multiChecksumFile` | core |
| 2 | `parsePkgJson` | parsers-js |
| 2 | `recordDecisionActivity` | core |
| 2 | `resetActivityContext` | core |
| 2 | `safeCopyFileSync` | core |
| 2 | `safeUnlinkSync` | core |
| 2 | `setDryRunMode` | core |
| 2 | `shouldFetchVCS` | core |
| 2 | `toCamel` | core |
| 1 | (96 exports with 1 caller each) | see §5c grouping |
| 0 | (62 exports with 0 external callers) | kept in barrel for API completeness |

### 5c. Exports with ≤1 external caller, grouped by target

**core** (1 caller): `CDXGEN_SPDX_CREATED_BY`, `CLJ_CMD`, `GCC_CMD`, `GO_CMD`,
`LEIN_CMD`, `NPM_CMD`, `PREFER_MAVEN_DEPS_TREE`, `PYTHON_CMD`, `RUSTC_CMD`,
`TABLE_BORDER_STYLE`, `addEvidenceForDotnet`, `addEvidenceForImports`,
`buildObjectForCocoaPod`, `collectExecutables`, `collectSharedLibs`,
`commandsExecuted`, `createUVLock`, `executeAtom`, `executePodCommand`,
`generatePixiLockFile`, `getCppModules`, `getDefaultBomAuditCategories`,
`getJavaCommand`, `getMillCommand`, `getPipFrozenTree`, `getPipTreeForPackages`,
`getPropertyGroupTextNodes`, `getPyModules`, `getPythonCommand`,
`getRecordedActivities`, `getRuntimeInformation`, `includeMavenTestScope`,
`isNode`, `isPackageManagerAllowed`, `recomputeScope`, `retrieveCdxgenPluginVersion`,
`shouldRunPredictiveBomAudit`, `splitCommandArgs`, `remoteHostsAccessed`,
`findAppModules`.

**ecosystems**: `getMvnMetadata`, `getNugetMetadata`, `getSwiftPackageMetadata`,
`fetchPomXmlAsJson`, `extractJarArchive`, `findLicenseId`→spdx.

**spdx**: `adjustLicenseInformation`, `getKnownLicense`, `isSpdxLicenseExpression`.

**parsers-*** (1 caller each): `parseBazelActionGraph`, `parseBazelSkyframe`,
`parseBdistMetadata`, `parseBitbucketPipelinesFile`, `parseBowerJson`,
`parseCabalData`, `parseCargoData`, `parseCargoDependencyData`,
`parseCargoManifestDependencyData`, `parseCargoTomlData`, `parseCljDep`,
`parseCloudBuildData`, `parseCmakeLikeFile`, `parseCocoaDependency`,
`parseColliderLockData`, `parseComposerJson`, `parseComposerLock`,
`parseConanData`, `parseConanLockData`, `parseContainerFile`,
`parseContainerSpecData`, `parseCsPkgData`, `parseCsPkgLockData`,
`parseCsProjAssetsData`, `parseCsProjData`, `parseEdnData`, `parseFlakeLock`,
`parseFlakeNix`, `parseGitHubWorkflowData`, `parseGoListDep`, `parseGoModData`,
`parseGoModGraph`, `parseGoModWhy`, `parseGoModulesTxt`, `parseGopkgData`,
`parseGosumData`, `parseHelmYamlData`, `parseLeinDep`, `parseLeiningenData`,
`parseMakeDFile`, `parseMavenArgs`, `parseMavenTree`, `parseMavenTreeJson`,
`parseMillDependency`, `parseMinJs`, `parseMixLockData`, `parseNodeShrinkwrap`,
`parseNupkg`, `parseOpenapiSpecData`, `parsePackageJsonName`, `parsePaketLockData`,
`parsePiplockData`, `parsePixiLockFile`, `parsePixiTomlFile`, `parsePkgLock`,
`parsePnpmLock`, `parsePnpmWorkspace`, `parsePodfileLock`, `parsePodfileTargets`,
`parsePom`, `parsePrivadoFile`, `parsePubLockData`, `parsePubYamlData`,
`parsePyLockData`, `parsePyProjectTomlFile`, `parseReqFile`, `parseSetupPyFile`,
`parseSwiftJsonTree`, `parseSwiftResolved`, `parseYarnLock`, `parseYarnWorkspace`.

**deps**: `convertJarNSToPackages`, `parsePomXml`, `readZipEntry`.

**purl**: `encodeForPurl`, `getJarClasses`.

**0-caller exports** (kept for API completeness, not deleted): `BLOCKED_HOST_ERROR_CODE`,
`CDXGEN_TEMP_DIR`, `DRY_RUN_ERROR_CODE`, `JAVA_CMD`, `NODE_CMD`,
`PACKAGE_MANAGER_ALIASES`, `PYTHON_EXCLUDED_COMPONENTS`, `SEARCH_MAVEN_ORG`,
`YARN_CMD`, `addLicenseText`, `componentSorter`, `composePomXmlUrl`,
`createBlockedHostError`, `derivePythonLockMetadataFileName`, `executeAlpmList`,
`executeApkList`, `executeDpkgList`, `executeEqueryList`, `executeRpmList`,
`extractLicenseCommentFromPomXml`, `fetchPomXml`, `findLocalMvnArtifact`,
`findPnpmPackagePath`, `getAllFilesWithIgnore`, `getAtomCommand`,
`getDartMetadata`, `getGithubUrlParts`, `getGoPkgComponent`, `getGoPkgLicense`,
`getOSPackageForFile`, `getPomPropertiesFromMavenDir`, `getRepoLicense`,
`guessLicenseId`, `guessPypiMatchingVersion`, `identifyFlow`, `inferJarGroupFromManifest`,
`isDryRunError`, `isSensitiveEnvironmentVariableName`, `locateGenericPackage`,
`mapConanPkgRefToPurlStringAndNameAndVersion`, `metadata_cache`,
`parseBazelBuild`, `parseCUsageSlice`, `parseCargoAuditableData`,
`parseCmakeDotFile`, `parseGoVersionData`, `parseJarManifest`, `parseKVDep`,
`parseLeinMap`, `parseLicenseEntryOrArrayFromPomXml`, `parseNuspecData`,
`parsePomProperties`, `parsePyRequiresDist`, `parseReqEnvMarkers`,
`parseSwiftJsonTreeObject`, `pnpmMetadata`, `purlFromUrlString`,
`readLicenseText`, `recordDiscoveryActivity`, `recordObservedActivity`,
`recordPolicyActivity`, `recurseImageNameLookup`, `repoMetadataToGitHubApiUrl`,
`resetRecordedActivities`, `toGitHubApiUrl`, `trimJarGroupSuffix`,
`yarnLockToIdentMap`.

---

## 6. Batch plan

Each batch is one commit, independently green, and a pure move under
`git diff -w --find-renames`. **Corrected order** (round-2 review):
`purl → spdx → core → deps → ecosystems → parsers → residual`.

### Batch 1 — `lib/inventory/purl.js` (~305 lines)

Exports: `encodeForPurl`, `purlFromUrlString`, `locateGenericPackage`,
`getVersionNumPnpm`, `createNpmWorkspacePurl` (re-export), plus internal purl
helpers (`generateNixPurl`, `createConanPurlString`, `createPurlTemplate`,
`cargoPackageInfoToPurl`, `mapConanPkgRefToPurlStringAndNameAndVersion`).

No mutable state. Depends only on `PackageURL` + `core-activity.js` / `core-fs.js` / `core-env.js` utilities.
**Lowest risk; lands first.**

### Batch 2 — `lib/inventory/spdx.js` (~531 lines)

Exports: `isSpdxLicenseExpression`, `adjustLicenseInformation`, `getLicenses`,
`getKnownLicense`, `addLicenseText`, `readLicenseText`, `findLicenseId`,
`guessLicenseId`, and the license-data constants (`licenseMapping`,
`vendorAliases`, `spdxLicenses`, `knownLicenses`, `mesonWrapDB`).

Depends on JSON data loaded at module scope. No mutable state.

### Batch 3 — core cluster (~8,250 lines → sub-filed)

The activity/dry-run/host-allowlist cluster **plus** the `cdxgenAgent`
construction **plus** safe wrappers **plus** path/file/hash/string helpers
**plus** env/runtime/command resolution. This is the largest cluster and
**must** be sub-split to stay under ~1,500 lines/file. Split across multiple
commits (one per sub-file) so each stays independently green:

> **Rename note.** The plan originally called this single file
> `core-activity.js` / `core-fs.js` / `core-env.js`. It never materialised as one file: during implementation
> the cluster was decomposed into four leaf modules — `state.js`,
> `core-activity.js`, `core-fs.js`, and `core-env.js` — plus the future
> `core-misc-a.js` / `core-misc-b.js`. The `core-env.js` name (batches 3a/3b/3c
> having already landed `state.js`, `core-activity.js`, `core-fs.js`) captures
> the residual env/runtime/command-resolution/alias-table cluster.

| Sub-file | Contents | ~lines |
|---|---|---|
| `state.js` (batch 3a) | eval-time data constants (`frameworksList`, `CDXGEN_VERSION`, `mesonWrapDB`, `vendorAliases`, std-module tables) | ~40 |
| `core-activity.js` (batch 3b) | module state (§3a/3b single-instance bindings), `cdxgenAgent`, activity/dry-run/host-allowlist funcs, feature flags | ~1,500 |
| `core-fs.js` (batch 3c) | `safeExistsSync`/`safeWriteSync`/`safeMkdirSync`/`safeMkdtempSync`/`safeRmSync`/`safeUnlinkSync`/`safeCopyFileSync`/`safeExtractArchive`, `safeSpawnSync`, `commandsExecuted`, `temporaryFiles` + its `process.on("exit")` handler, `getAllFiles`/`getAllFilesWithIgnore`, checksum/hash helpers, `getTmpDir`/`getTimestamp` | ~1,500 |
| `core-env.js` (batch 3d) | runtime detection consts (`isNode`/`isBun`/`isDeno`), env-derived flags (`CDXGEN_SPDX_CREATED_BY`, `TABLE_BORDER_STYLE`, `includeMavenTestScope`, `PREFER_MAVEN_DEPS_TREE`), fetch predicates (`shouldFetchLicense`/`shouldFetchPackageMetadata`/`shouldFetchVCS`, `FETCH_LICENSE`, `SEARCH_MAVEN_ORG`), `parseMavenArgs`, `*_CMD` resolution (`JAVA_CMD`/`PYTHON_CMD` + their getters, 11 `export let` + eval-time reassignment blocks moved as units, `SWIFT_CMD`, `RUBY_CMD`), `PROJECT_TYPE_ALIASES`/`PACKAGE_MANAGER_ALIASES`/`PYTHON_EXCLUDED_COMPONENTS` | ~400 |
| `core-misc-a.js` | cocoa/pod helpers (`fullScanCocoaPod`, `buildObjectForCocoaPod`, `executePodCommand`, `parsePodfileLock`/`parsePodfileTargets`/`parseCocoaDependency`), python tree (`getPipFrozenTree`, `getPipTreeForPackages`, `createUVLock`), command builders (`getMavenCommand`, `getAtomCommand`, `executeAtom`, `getMillCommand`) | ~1,400 |
| `core-misc-b.js` | `convertOSQueryResults`, `buildColliderComponent`, `getCppModules`, `addEvidenceForImports`, `addEvidenceForDotnet`, `collectExecutables`/`collectSharedLibs`, `getRuntimeInformation`, remaining runtime/identity helpers | ~1,400 |

> `core-misc.js` is split into `core-misc-a.js` / `core-misc-b.js` (stated
> reason: the combined ~2,000 lines exceeds the ~1,500 ceiling). The split
> boundary is cocoa/pod/python-tree/command-builders vs. osquery/cpp/evidence.

### Batch 4 — `lib/inventory/deps.js` (~501 lines)

Exports: `collectJarNS`, `collectMvnDependencies`, `convertJarNSToPackages`,
`componentSorter`, `flattenDeps`, plus JAR/POM helpers (`parsePomXml`,
`parseJarManifest`, `parsePomProperties`, `getPomPropertiesFromMavenDir`,
`inferJarGroupFromManifest`, `trimJarGroupSuffix`, `isQualifiedJarNamespace`,
`readZipEntry`, `getJarClasses`).

**Owns:** `jarNSMapping_cache`.

Lands **before** ecosystems (§4 cycle fix): `deps → ecosystems` is zero edges,
but `ecosystems → deps` has six.

### Batch 5 — `lib/ecosystems/ecosystems.js` (~1,566 lines) ⭐ most important

Exports: `getNpmMetadata`, `getMvnMetadata`, `getPyMetadata`,
`getCratesMetadata`, `getDartMetadata`, `getNugetMetadata`,
`getSwiftPackageMetadata`, `getRepoLicense`, `getGoPkgLicense`,
`extractJarArchive`, `fetchPomXml`, `fetchPomXmlAsJson`, `findLocalMvnArtifact`,
plus internals (`getGoPkgVCSUrl`, `getNugetUrl`, `queryNuget`,
`guessPypiMatchingVersion`, `parseBdistMetadata`,
`repoMetadataToGitHubApiUrl`/`getGithubUrlParts`/`toGitHubApiUrl`).

**Five helpers added in round-2 review** (called by the ecosystems cluster;
left behind they would be back-edges into `utils.js`): `getGoPkgUrl`,
`getGoPkgFullName`, `mergeExternalReferences`, `collectPypiReleaseExternalReferences`,
`normalizeCargoIntegrity`.

**Owns the mutable state:** `metadata_cache` (declared here, with
`_clearMetadataCache` helper — **internal, not in the barrel's 261 names**),
`search_maven_org_errors`, `get_repo_license_errors`.

These are D08's Rust-port targets. D04's seven cassette tests pin their
behaviour (`hitCount > 0 && missCount === 0`). **No tidying.**

### Batch 6 — `lib/ecosystems/parsers-<ecosystem>.js` (~9,670 lines, split per ecosystem)

The `parse*` family grouped by ecosystem to keep each file < ~1,500 lines:

| File | Functions | ~lines |
|---|---|---|
| `parsers-js.js` | `parsePkgJson`, `parsePkgLock`, `parseYarnLock`, `yarnLockToIdentMap`, `parseNodeShrinkwrap`, `parsePnpmLock`, `pnpmMetadata`, `parsePnpmWorkspace`, `parseYarnWorkspace`, `findPnpmPackagePath`, `parseBowerJson`, `parseMinJs`, `parsePackageJsonName`, npm-lifecycle internals | ~2,400 |
| `parsers-python.js` | `parsePyProjectTomlFile`, `parsePyLockData`, `parseReqFile`/`parseReqData`, `parseReqEnvMarkers`, `parseSetupPyFile`, `parsePiplockData`, `parsePixiLockFile`, `parsePixiTomlFile`, `generatePixiLockFile`, `getPyModules`, python manifest-source internals | ~1,900 |
| `parsers-jvm.js` | `parsePom`, `parseMavenTree`, `parseMavenTreeJson`, `parseMillDependency`, `parseCljDep`, `parseLeinDep`, `parseLeinMap`, `parseLeiningenData`, `parseEdnData`, `parseBazelActionGraph`, `parseBazelSkyframe`, `parseBazelBuild`, `parseKVDep`, maven component internals | ~1,400 |
| `parsers-dotnet.js` | `parseCsProjData`, `parseCsProjAssetsData`, `parseCsPkgLockData`, `parsePaketLockData`, `parseCsPkgData`, `parseNuspecData`, `parseNupkg`, `getPropertyGroupTextNodes` | ~1,300 |
| `parsers-go.js` | `parseGoModData`, `parseGoModGraph`, `parseGoListDep`, `parseGoModWhy`, `parseGosumData`, `parseGopkgData`, `parseGoVersionData`, `parseGoModulesTxt`, go internals | ~1,000 |
| `parsers-rust.js` | `parseCargoData`, `parseCargoTomlData`, `parseCargoDependencyData`, `parseCargoManifestDependencyData`, `parseCargoAuditableData`, cargo workspace internals | ~1,400 |
| `parsers-misc.js` | `parseComposerJson`/`parseComposerLock`, `parsePubLockData`/`parsePubYamlData`, `parseHelmYamlData`, `parseContainerFile`, `parseBitbucketPipelinesFile`, `parseContainerSpecData`, `parsePrivadoFile`, `parseOpenapiSpecData`, `parseCabalData`, `parseMixLockData`, `parseGitHubWorkflowData`, `parseCloudBuildData`, `parseConanLockData`/`parseConanData`, `parseColliderLockData`, `parseFlakeNix`/`parseFlakeLock`, `parseSwiftJsonTree`/`parseSwiftResolved`/`parseSwiftJsonTreeObject`, `parseCmakeDotFile`/`parseCmakeLikeFile`, `parseMakeDFile`, `parseCUsageSlice`, `parseMavenArgs`, OS-package executors (`executeDpkgList`, etc.) | ~2,500 |

> **Batch 6 is the largest and may be deferred** (see §9). Batches 1–4 are the
> priority per the deliverable's "land fewer batches, fully" guidance.

### Batch 7 — residual `core-misc-a.js` / `core-misc-b.js`

Whatever remains after batches 1–6, with a per-function note on why it resisted
classification. Expected to be small command-builder and OS-query helpers.
Split into `core-misc-a.js` (cocoa/pod/python-tree/command-builders) and
`core-misc-b.js` (osquery/cpp/evidence/runtime).

---

## 7. Mechanical adaptations required (unavoidable, minimal)

These are the only non-pure-move changes. Each is a 1-line edit forced by ESM
semantics, not a logic change:

1. **`metadata_cache` reassignment** (L10788 in `parseGoModData`):
   - Before: `metadata_cache = {};`
   - After: `_clearMetadataCache();` (imported from `ecosystems.js`)
   - Reason: ESM forbids reassigning an imported `let` binding. The helper
     performs the identical `metadata_cache = {}` in the declaring module.
2. **Import-line changes only** in every moved function body — the deliverable
   requires `git diff -w --find-renames` to show only import additions.

No other logic, ordering, renaming, or "while I'm here" changes are planned.

---

## 8. Large-function watchlist (>200 lines)

These are the riskiest to move (large bodies, many internal calls). They will
be moved as-is, with extra attention to their internal helper dependencies:

| Function | Lines | Target | Notes |
|---|---|---|---|
| `parsePnpmLock` | 937 | parsers-js | largest single function |
| `parsePkgLock` | 649 | parsers-js | |
| `parsePyLockData` | 573 | parsers-python | |
| `getPipFrozenTree` | 590 | core-misc | |
| `parseYarnLock` | 516 | parsers-js | uses yarn internals (`_parseYarnLine`, etc.) |
| `parseCsProjData` | 430 | parsers-dotnet | |
| `extractJarArchive` | 400 | ecosystems | uses `search_maven_org_errors` + `cdxgenAgent` |
| `fullScanCocoaPod` | 326 | core-misc | uses `temporaryFiles` + `cdxgenAgent` |
| `safeSpawnSync` | 238 | core-fs | uses `commandsExecuted` + `isDryRun` |
| `getPyMetadata` | 248 | ecosystems | cassette-tested |
| `parsePyProjectTomlFile` | 281 | parsers-python | |
| `parseCmakeLikeFile` | 261 | parsers-misc | |
| `parseCsProjAssetsData` | 258 | parsers-dotnet | |
| `parseCargoTomlData` | 280 | parsers-rust | |

---

## 9. Scope statement

**Priority (will land):** Batches 1–4 — purl, spdx, core, deps.
These deliver a correct mutable-state split with a green corpus and establish
the extraction pattern.

**High-value (land if green and clean):** Batch 5 — ecosystems. This is the
D08-enabling isolation of the `get*Metadata` family. It depends on deps (batch 4)
being landed first. D04's cassette suite pins its behaviour.

**Best-effort (land if time and clean):** Batches 6–7 — parsers, residual.
Batch 6 is ~9,670 lines across ~84 functions and may span multiple commits per
ecosystem. If any batch cannot land cleanly without a behaviour change, it is
deferred with a note here.

The barrel + snapshot test + `MIGRATING-TO-V13.md` deprecation note ship with
the last batch that lands.

---

## 10. Bugs found (deliberately left in place)

None observed during inventory. Any bugs discovered during the moves will be
listed here and left unchanged per the zero-behaviour-change rule.

---

## 11. Reviewer notes (round-2 feedback — two claims verified as incorrect)

The round-2 review contained two factual assertions about the code that do not
hold up when checked against `utils.js` on `1ab608db`. Per the project lesson
"verify with a command, don't assume", the original (correct) entries are kept
and the reasoning is stated here so a reviewer can re-check:

1. **"`commandsExecuted` is touched by `safeExtractArchive` as well as
   `safeSpawnSync`"** — Verified false. `grep -n commandsExecuted` finds exactly
   one code-level write (L1499, inside `safeSpawnSync`). `safeExtractArchive`
   (L1049–1104) neither references `commandsExecuted` nor calls `safeSpawnSync`.
   The table row stating "`safeSpawnSync` (w) only" is correct; both land in
   `core-fs.js` regardless.
2. **"`getRecordedActivities` does not reference `activityLedger`"** — Verified
   false. The function body is `return [...activityLedger];` (L829). The table
   row listing `getRecordedActivities` as a reader of `activityLedger` is
   correct.
