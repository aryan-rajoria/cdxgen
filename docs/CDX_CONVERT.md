# cdx-convert - CycloneDX converter

`cdx-convert` converts an existing CycloneDX BOM into SPDX 3.0.1 JSON-LD, or
into a different CycloneDX specification version.

It is distributed with `@cdxgen/cdxgen` alongside `cdxgen`, `cdx-sign`,
`cdx-verify`, and `cdx-validate`. It is also published as a standalone binary
via the `binary-builds` workflow.

## Scope and supported versions

`cdx-convert` supports two conversion paths, selected with `--to`:

| `--to`                 | Input spec versions | Output                             |
| ---------------------- | ------------------- | ---------------------------------- |
| `spdx` (default)       | `1.6`, `1.7`        | SPDX `3.0.1` JSON-LD               |
| a CycloneDX version    | any cdxgen supports | CycloneDX at the requested version |

Input is CycloneDX JSON or protobuf (`.cdx`, `.cdx.bin`, `.proto`) with
`bomFormat: "CycloneDX"`. If the input is not CycloneDX, the command fails with
a clear error. For the SPDX path, a `specVersion` other than `1.6` or `1.7`
also fails.

## Quick start

```shell
# Convert bom.json (CycloneDX 1.6 or 1.7) to SPDX 3.0.1 JSON-LD
cdx-convert -i bom.json -o bom.spdx.json

# Convert a protobuf BOM exported by cdxgen
cdx-convert -i bom.cdx -o bom.spdx.json

# Pretty-print output JSON
cdx-convert -i bom.json -o bom.spdx.json --json-pretty

# Skip SPDX validation (enabled by default)
cdx-convert -i bom.json -o bom.spdx.json --no-validate

# Downgrade a 1.7 BOM to 1.6, reporting the fields 1.6 does not define
cdx-convert -i bom.json --to 1.6

# Downgrade and write protobuf, chosen by the output extension
cdx-convert -i bom.json --to 1.6 -o bom-1_6.cdx
```

## CLI reference

| Flag                           | Default             | Description                                |
| ------------------------------ | ------------------- | ------------------------------------------ |
| `-i, --input`                  | `bom.json`          | Input CycloneDX BOM JSON or protobuf file. |
| `-o, --output`                 | see below           | Output file path.                          |
| `--to`                         | `spdx`              | `spdx`, or a CycloneDX spec version.       |
| `--validate` / `--no-validate` | on                  | Validate the converted output.             |
| `--json-pretty`                | off                 | Pretty-print JSON output.                  |

`-o` defaults to `<input>.spdx.json` for the SPDX path, and to
`<input>-<version>.<ext>` for a CycloneDX version conversion — so
`bom.json --to 1.6` writes `bom-1_6.json` and never overwrites its input. An
explicit `-o` naming a protobuf extension writes protobuf instead of JSON.

## CycloneDX version conversion

The reshaping is done by `applySpecVersionCompatibility()` in
`lib/stages/postgen/specVersionCompat.js` — the same normalizer the postgen
stage applies to freshly generated BOMs. `cdx-convert -i bom.json --to 1.6` and
`cdxgen --spec-version 1.6` therefore agree on the result.

Conversion is not purely subtractive. Beyond removing elements the target
version does not define, it reshapes fields the versions model differently:

- `evidence.identity` is a single object up to 1.5 and an array from 1.6, so a
  downgrade past that boundary keeps the first identity and drops
  `concludedValue`
- `metadata.tools` flips from a `tools` object to component and service arrays
  at 2.0
- component types the target version does not define are filtered out, and
  dependencies pointing at pruned components are removed so the graph never
  references a missing `bom-ref`
- license and license-expression attributes are trimmed per version, since
  CycloneDX forbids additional properties

Every field path that did not survive is listed on stderr before the file is
written, so a lossy downgrade is never silent:

```text
Converting to CycloneDX 1.6 dropped 5 field path(s) that version does not define:
  - citations
  - citations.attributedTo
  ...
```

Output is schema-validated unless `--no-validate` is passed. cdxgen bundles
CycloneDX schemas for `1.6`, `1.7`, and `2.0`; converting to any other version
skips the schema check and says so.

## SPDX conversion algorithm

The conversion logic uses `convertCycloneDxToSpdx()` in
`lib/stages/postgen/spdxConverter.js`.

High-level flow:

```text
read input file
  -> parse JSON or decode protobuf
  -> validate input shape and CycloneDX specVersion (1.6 or 1.7)
  -> convert CycloneDX object to SPDX 3.0.1 JSON-LD graph
  -> validate SPDX output (unless --no-validate)
  -> write output file
```

SPDX mapping behavior includes:

- document-level creation info and root element mapping
- component mapping to SPDX packages/files
- dependency mapping to SPDX relationships
- retention of CycloneDX-specific data in `cdxgen:cyclonedx` extension fields
  when there is no direct SPDX 3.0.1 field

## Features

- deterministic field mapping for CycloneDX 1.6/1.7 to SPDX 3.0.1 conversion
  when the input BOM includes stable `serialNumber` and `metadata.timestamp`
- optional SPDX validation after conversion
- predictable output naming (`<input>.spdx.json` when `-o` is omitted)
- directory auto-creation for output paths
- preservation of key compliance metadata in extension fields, including
  authors, publisher, maintainers, tags, and licenses

## Limitations

- input must be CycloneDX JSON or protobuf, not XML
- the SPDX path accepts only CycloneDX `1.6` and `1.7` input, and its output
  target is fixed to SPDX `3.0.1`
- a CycloneDX downgrade is lossy by nature; keep the source BOM if you need the
  dropped fields
- protobuf output requires the optional `@cdxgen/cdx-proto` dependency
- CycloneDX fields without equivalent SPDX core fields are retained via
  extension fields, not promoted to standard SPDX core fields

## When to use cdx-convert vs cdxgen --format spdx

Use `cdx-convert` when you already have a CycloneDX JSON or protobuf file and
need SPDX, or need it at a different CycloneDX version.

Use `cdxgen --format spdx` or `cdxgen --format cyclonedx,spdx` when you are
generating a new BOM and want SPDX output during the same run, and
`cdxgen --spec-version` when you are generating a new BOM at an older version.
