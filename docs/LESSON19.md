# Lesson 19 — Recording provenance with CycloneDX 1.7 citations

A BOM asserts a great many things: that a component is present, that it carries
a particular license, that its integrity hash is what it says. What a BOM has
never been able to say is **who asserted each of those things**. A component
inferred from a lockfile, a component copied from a vendor's own SBOM, and a
component someone typed in by hand all look identical once serialized.

CycloneDX 1.7 adds a root-level `citations` array to close that gap. This lesson
shows what cdxgen emits, how to read it, how to add your own, and — most
importantly — the rules that keep a citation from being worse than no citation
at all.

## Goal

By the end of this lesson you should be able to answer:

1. What does a citation actually claim, and what are its schema constraints?
2. Which citations does cdxgen emit by default, and why only those?
3. How do I trace a component back to the SBOM that declared it?
4. Why do citation timestamps not change between two runs?
5. What happens to citations when I downgrade to 1.6 or export to protobuf?

## 1) The shape of a citation

```bash
cdxgen -t npm -o bom.json /path/to/project
node -e "console.log(JSON.stringify(require('./bom.json').citations, null, 2))"
```

```json
[
  {
    "expressions": ["$.components"],
    "attributedTo": "pkg:npm/@cdxgen/cdxgen@13.0.0",
    "note": "Component inventory collected by cdxgen 13.0.0.",
    "timestamp": "2026-08-06T14:23:15Z"
  }
]
```

Four things are worth reading carefully, because the schema is stricter than it
first appears:

| Field | Rule |
| ----- | ---- |
| `timestamp` | Required. |
| `pointers` / `expressions` | **Exactly one** of the two (`oneOf`). `pointers` are RFC 6901 JSON Pointers; `expressions` are RFC 9535 JSONPath. Supplying both, or neither, is invalid. |
| `attributedTo` / `process` | **At least one** (`anyOf`). Each holds the `bom-ref` of something else in the document. |
| `bom-ref`, `note` | Optional. |

`--spec-version 1.7` is the default, so citations are on unless you ask for an
older document.

## 2) A citation is a pointer to something that exists

`attributedTo` is not free text. It is the `bom-ref` of a component, service,
tool, organisational entity, person, or formulation process **that is already in
the BOM**. A citation naming a ref that appears nowhere else is a dangling
reference: it validates against the schema, and it tells a consumer nothing.

cdxgen enforces this rather than working around it. When there is no honest ref
to point at, the citation is **dropped**, not aimed at a placeholder. You will
see this if you generate a BOM with no tool metadata: the inventory citation
simply does not appear.

This is the single most useful rule to carry into your own tooling. A missing
citation is a known unknown. An invented one is a lie that survives review.

## 3) What cdxgen emits by default

Only two, and both are claims cdxgen can actually make about itself:

- **Component inventory** → `$.components`, attributed to the cdxgen tool
  component. cdxgen collected these; it can say so.
- **Audit findings** → the `cdx:audit:*` properties, attributed to the same tool
  component, noting the rule engine. Only present when `--bom-audit` ran.

There is deliberately **no license citation**. cdxgen mostly relays license
metadata from package registries and file headers; it does not author it.
Attributing every `licenses` array to cdxgen would be a false claim printed on
essentially every BOM, which devalues the citations that are true.

## 4) Citations that trace a component to its real source

The interesting citations come from features that ingest someone else's
assertions. Both of cdxgen's third-party ingestion paths attribute to the entity
that actually made the claim.

### PEP 770 embedded SBOMs

```bash
cdxgen -t python -o bom.json /path/to/venv-project
```

```json
{
  "expressions": [
    "$.components[?(@.properties[?(@.name == 'cdx:embeddedSbom:source' && @.value == 'demo_pkg-1.0.0')])]"
  ],
  "attributedTo": "pkg:pypi/demo-pkg@1.0.0",
  "note": "Components declared by demo_pkg-1.0.0 in its PEP 770 .dist-info/sboms/ directory (demo_pkg-1.0.0.dist-info/sboms/demo-pkg.cdx.json).",
  "timestamp": "2026-08-06T14:23:29Z"
}
```

Read that as: *demo-pkg itself says these components are inside it.* The
attribution is the distribution's own purl, not cdxgen's — because cdxgen did
not infer these components, it copied them from a document the publisher
shipped. The expression selects exactly the components carrying the matching
`cdx:embeddedSbom:source` tag, so the citation and the tag stay in agreement.

Note the note names a path *inside the distribution*, never the absolute build
path. A BOM travels beyond the machine that built it.

### TEA-retrieved BOMs

Components fetched with `--tea-fetch` are tagged `cdx:tea:source` and
`cdx:tea:collection` and cited the same way, attributed to the cdxgen tool
component that performed the retrieval — a TEA server is not an object in the
BOM, so it cannot be an attribution target. See [Lesson 20](LESSON20.md).

## 5) Timestamps come from the document, not the clock

Every citation on a document carries the document's own `metadata.timestamp`,
not the wall clock at the moment the citation was built:

```bash
cdxgen -t npm -o bom.json .
node -e "const b=require('./bom.json');
  console.log(b.citations.every(c => c.timestamp === b.metadata.timestamp));"
# true
```

Be precise about what this does and does not guarantee. Two *separate* cdxgen
runs still differ, because each run stamps its own `metadata.timestamp`; if you
are diffing BOMs across runs you have to normalise that field either way. What
this does guarantee is that **one document is
internally consistent and re-renders identically**: convert it, downgrade it,
re-serialize it, and the citations do not drift. Had each citation called the
clock as it was constructed, a single BOM could carry several different
timestamps for one generation run, and every re-render would churn the diff.
The annotator follows the same rule.

If you build citations yourself, pass `citationTimestamp(bomJson)` — or leave
`timestamp` unset and let `attachCitations` fill it.

## 6) Adding your own citations

`lib/inventory/citations.js` is the only supported entry point. It refuses to
build anything the schema would reject:

```js
import { createCitation } from "./lib/inventory/citations.js";

// Returns null: both targeting mechanisms supplied (oneOf violated).
createCitation({ pointers: ["/a"], expressions: ["$.a"], attributedTo: "ref" });

// Returns null: no attribution target (anyOf violated).
createCitation({ pointers: ["/a"] });

// Valid.
createCitation({
  pointers: ["/components/3/hashes"],
  attributedTo: "pkg:npm/some-registry-tool@2.0.0",
  note: "Integrity re-verified against the registry.",
});
```

A collector attaches its citations to `bomNSData.citations`; `postProcess`
merges them into the single root-level array. Merging de-duplicates on
`bom-ref`, or on (attribution target + selector set) when there is no ref, so
two collectors making the same claim produce one entry.

## 7) What happens on downgrade and on export

**`--spec-version 1.6`** — `citations` is a root-level element, and the
per-key downgrade recursion never sees the document root, so it needs an
explicit strip. cdxgen does that strip before recursing:

```bash
cdxgen -t npm --spec-version 1.6 -o bom16.json .
node -e "console.log(require('./bom16.json').citations)"   # undefined
```

If you add a new root-level 1.7 field, add it to `BOM_1_7_ONLY_FIELDS` in
`lib/stages/postgen/postgen.js` in the same commit as the emitter. Otherwise a
1.6 run will emit a 1.7 element and fail your consumers' schema validation.

**`--export-proto`** — protobuf models `Citation.pointers` and
`Citation.expressions` as wrapper messages around a repeated string, while
canonical JSON uses bare arrays. `@cdxgen/cdx-proto` 2.2.0 converts between the
two, so citations survive a binary round-trip unchanged:

```bash
cdxgen -t npm . -o bom.json --export-proto --proto-bin-file bom.bin
```

Note the `oneof`: the protobuf schema enforces the same "exactly one of
`pointers` or `expressions`" rule as the JSON schema, so a citation carrying
both is rejected at decode rather than silently truncated.

## What to take away

1. A citation without a real `attributedTo` is noise. Drop it instead.
2. Cite what you actually did. cdxgen cites its own inventory and its own audit,
   and stays quiet about license data it merely relayed.
3. Derive timestamps from the document so BOMs stay reproducible.
4. Third-party assertions should be attributed to the third party — that is the
   whole point of the feature.
