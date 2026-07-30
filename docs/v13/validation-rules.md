# Validation Rules — `cdxrs validate`

This document is the **authoritative registry** of every validation rule id
emitted by `cdxrs validate`. Rule ids are a public API: once published, an id
never changes meaning. Users filter CI pipelines on these strings.

## Severity model

| Severity | Meaning | Exit code |
|----------|---------|-----------|
| `error` | The BOM is not well-formed CycloneDX. | 3 (or 0 with `--fail-on none`) |
| `warning` | The BOM is well-formed but has a quality issue. Never fails by default. | 0 |
| `info` | Informational observation. Never fails. | 0 |

**`--fail-on` defaults are unchanged from the JS validator**: warnings never
cause a non-zero exit unless `--fail-on warning` is explicitly set. `error`
findings always produce exit code 3.

## Execution order

Schema validation runs first. If schema validation produces any `error`
finding, semantic rules are **not** run (matching the JS validator's
short-circuit behaviour). This avoids cascading noise from a structurally
broken BOM.

## Rule registry

### Schema rules

| Rule id | Severity | JS source | Meaning |
|---------|----------|-----------|---------|
| `schema.unsupported-version` | `error` | `validateBom` L153 | `specVersion` is not in the supported set (1.6, 1.7). |
| `schema.invalid` | `error` | `validateBom` L162 | The BOM does not conform to the CycloneDX JSON schema for its declared `specVersion`. |

### Metadata rules (`validateMetadata`)

All metadata checks produce `warning`; none can fail the BOM on their own.

| Rule id | Severity | JS source | Meaning |
|---------|----------|-----------|---------|
| `metadata.component-missing` | `warning` | L384 | `metadata.component` is absent or empty. |
| `metadata.component-purl-missing` | `warning` | L393 | `metadata.component` has no `purl`. |
| `metadata.component-bomref-missing` | `warning` | L396 | `metadata.component` has no `bom-ref`. |
| `metadata.component-version-missing` | `warning` | L400 | `metadata.component` has no `version`. |
| `metadata.component-placeholder-name` | `warning` | L408 | `metadata.component.name` is a placeholder (`app`, `application`, `project`). |
| `metadata.duplicate-parent-in-components` | `warning` | L416 | Parent component `bom-ref` appears inside `metadata.component.components`. |
| `metadata.duplicate-parent-by-name` | `warning` | L421 | Parent component `name` appears inside `metadata.component.components` when `bom-ref` is absent. |

### PURL rules (`validatePurls`)

| Rule id | Severity | JS source | Meaning |
|---------|----------|-----------|---------|
| `purl.crypto-asset-has-purl` | `error` | L462 | A `cryptographic-asset` component has a `purl` (spec forbids it). |
| `crypto.asset-missing-crypto-properties` | `error` | L467 | A `cryptographic-asset` component lacks `cryptoProperties`. |
| `crypto.algorithm-missing-oid` | `error` | L472 | A `cryptographic-asset` of `assetType: algorithm` has no `oid`. |
| `crypto.certificate-missing-algorithm-properties` | `error` | L478 | A `cryptographic-asset` of `assetType: certificate` has no `algorithmProperties`. |
| `purl.invalid-syntax` | `error` | L536 | The purl string cannot be parsed. |
| `purl.encoded-slash-without-namespace` | `error` | L499 | An `npm` or `golang` purl contains `%2F` in the name but has no namespace. |
| `purl.version-missing-epoch` | `error` | L527 | The component `version` does not start with the epoch qualifier value. |
| `purl.type-not-normalized` | `warning` | L490 | The purl type contains uppercase characters. |
| `purl.unexpected-qualifiers` | `warning` | L506 | Qualifiers are present on a purl type that does not use them per spec. |
| `purl.too-many-frameworks` | `warning` | L542 | More than 20 components are typed as `framework`. |

### Dependency / ref rules (`validateRefs`)

| Rule id | Severity | JS source | Meaning |
|---------|----------|-----------|---------|
| `ref.encoded-dependency-ref` | `error` | L619 | A dependency `ref` contains URL-encoded characters (`%40`, `%3A`, `%2F`). |
| `ref.partial-tree` | `warning` | L612 | The dependency tree has multiple empty `dependsOn` entries. |
| `ref.dangling-dependency-ref` | `warning` | L626 | A dependency `ref` does not correspond to any component `bom-ref`. |
| `ref.dangling-dependson-ref` | `warning` | L648 | A `dependsOn` entry does not correspond to any component `bom-ref`. |
| `ref.dangling-provides-ref` | `warning` | L673 | A `provides` entry does not correspond to any component `bom-ref`. |
| `ref.parent-without-children` | `warning` | L636 | The parent component's dependency entry has an empty `dependsOn` in a non-trivial tree. |
| `ref.type-mismatch` | `warning` | L660 | A parent and child in the dependency graph have different purl types (non-`oci`/`generic`/`container`). |

### Property / evidence rules (`validateProps`)

All property checks produce `warning`; none can fail the BOM. These checks only
run when `metadata.component.type` is `application`, `framework`, or `library`.
They are cdxgen quality checks, not CycloneDX spec violations.

| Rule id | Severity | JS source | Meaning |
|---------|----------|-----------|---------|
| `props.missing-properties` | `warning` | L763 | A library/framework npm or pypi component lacks `properties`. |
| `props.missing-srcfile` | `warning` | L793 | A component lacks a `SrcFile` property. |
| `props.missing-workspace-properties` | `warning` | L789 | In workspace mode, a component lacks workspace-related properties. |
| `props.missing-evidence` | `warning` | L799 | A component lacks `evidence`. |
| `props.npm-missing-tarball` | `warning` | L805 | Some npm components lack `externalReferences.distribution` while others have it. |
| `props.absolute-srcfile-path` | `warning` | L810 | A `SrcFile` property value starts with `/` (absolute path). |
| `props.suspicious-native-name` | `warning` | L736 | An npm package has a native-sounding name but no `cdx:npm:native_addon` flag. **Dropped** in the Rust port — see below. |

## Dropped checks

| JS check | Rule id | Reason |
|----------|---------|--------|
| `props.suspicious-native-name` (L736) | `props.suspicious-native-name` | The JS code gates this on `DEBUG_MODE` (`if (suspicious.length > 0 && DEBUG_MODE)`), so it is silent in production. Porting it as an always-on warning would be a false-positive regression for every cdxgen user with `native`/`bindings` in a package name. Porting it as debug-only would require the Rust binary to know cdxgen's `DEBUG_MODE`, which crosses the process boundary. Dropped with parity-exception. |

## Out of scope (Deliverable 07 or later)

- **Compliance rules** (SCVS, CRA) — these live in `lib/validator/complianceEngine.js` and answer "does this satisfy a policy?", not "is this well-formed CycloneDX?".
- **SPDX export validation** (`validateSpdx`, `spdx-export.schema.json`) — Deliverable 11.
- **CycloneDX 2.0** (`cyclonedx-2.0-bundled.schema.json`, `Ajv2020` branch) — above the v13 floor pair (1.6/1.7).
- **Spec 1.4/1.5** — below the v13 floor. Dropped from the JS validator's
  `SUPPORTED_CYCLONEDX_SCHEMA_VERSIONS` too, so both validators reject them
  identically. While only cdxrs rejected them, whether a 1.5 BOM passed
  validation depended on whether a cdxrs binary happened to be installed —
  and `bin/cdxgen.js` exits 1 on an invalid verdict.
