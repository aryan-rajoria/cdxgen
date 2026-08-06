# Lesson 20 — Exchanging BOMs with the Transparency Exchange API (TEA)

Most SBOM workflows still move documents by hand: an email attachment, a link in
a portal, a file in a release page. The [Transparency Exchange
API](https://github.com/CycloneDX/transparency-exchange-api) (TEA, ECMA TC54
TG1) replaces that with a resolvable identifier. You publish once against a
stable identity; consumers resolve that identity and always get your current
artefacts.

This lesson covers both directions in cdxgen: retrieving a supplier's SBOM into
your own BOM, and publishing yours.

## Goal

By the end of this lesson you should be able to answer:

1. How does a TEI resolve to an actual SBOM download?
2. How do fetched upstream components merge with what cdxgen inferred?
3. When does cdxgen refuse to merge a downloaded artifact?
4. How do I publish, and what happens if the publish fails?
5. Which parts of TEA are standardised, and which are not?

## 1) Standardised, and not

This distinction determines how much you should trust each half of the feature.

| Surface | Status | cdxgen support |
| ------- | ------ | -------------- |
| Consumer API (`spec/openapi.yaml`, 0.4.0, "Beta 2") | Conformance base | `--tea-fetch` |
| Publisher API (`spec/publisher/`) | **Draft recommendation** — "will be a recommended TEA publisher API" | `--tea-publish`, subject to change |

The publisher API is not part of the conformance spec. `--tea-publish` targets
the draft's `POST /collection` shape and will change when the standard lands.
Treat it as usable but not yet stable.

## 2) The identifier and how it resolves

A **TEI** is a URN:

```
urn:tei:uuid:cdxgen.github.io:d4d9f54a-abcf-11ee-ac79-1a52914d44b1
        │    │                └── unique identifier
        │    └── domain, used for discovery
        └── type
```

Resolution is four hops, and cdxgen performs all of them:

1. `GET https://cdxgen.github.io/.well-known/tea` — HTTPS only, per spec.
2. Pick an endpoint: highest API version supported by both sides, highest
   `priority` breaking ties. If a server has moved ahead of this client, cdxgen
   falls back to the server's highest version rather than refusing outright.
3. `GET {endpoint}/v{version}/discovery?tei=…` → a product release UUID.
4. `GET {endpoint}/v{version}/productRelease/{uuid}/collection/latest` → a
   Collection listing Artifacts, each with formats, URLs and checksums.

You can watch this against a real third-party server:

```bash
curl -s https://us.sbom.cybeats.com/.well-known/tea | jq
```

A `401` from the discovery endpoint is normal for a TEI you do not own — and per
spec a `401`/`403` must **not** cause failover to the next endpoint, because an
auth failure is not an availability failure.

## 3) Fetching upstream SBOMs

```bash
cdxgen -t js /path/to/repo \
  --tea-fetch urn:tei:uuid:cdxgen.github.io:d4d9f54a-abcf-11ee-ac79-1a52914d44b1 \
  -o bom.json
```

Credentials, when the server needs them:

```bash
export TEA_TOKEN="…"        # or --tea-token
```

The token is sent only as an `Authorization: Bearer` header. It is never logged
and never written into the BOM; a test asserts exactly that.

### How the merge works

Fetched components are placed **before** cdxgen's inferred components, and the
dedupe keeps the first match — so **upstream wins on conflict**. This is
deliberate: a supplier's own SBOM is a stronger assertion than cdxgen's
inference from your lockfile. The conflict is recorded by unioning properties
rather than discarding the loser.

Every fetched component carries:

| Property | Meaning |
| -------- | ------- |
| `cdx:tea:source` | URL of the artifact it came from |
| `cdx:tea:collection` | UUID of the Collection |

plus a CycloneDX 1.7 citation (see [Lesson 19](LESSON19.md)).

A fetch failure — unresolvable TEI, network error, dead endpoint — produces a
warning and nothing else. The locally generated BOM stands. Enrichment is never
a precondition for getting your SBOM.

## 4) When cdxgen refuses a downloaded artifact

Anything retrieved over TEA is untrusted input from a channel you do not
control, so the client is deliberately unforgiving:

- **Every computable checksum must match.** Not the first one — all of them.
- **An artifact whose checksums all use algorithms this client cannot compute is
  rejected.** Merging content whose integrity was asserted and then not verified
  is worse than fetching nothing at all; a silently-unverified merge is the
  failure mode that matters here.
- **An artifact declaring no checksum is merged with a warning.** That is the
  publisher's choice to make, and it is visible.
- **Documents over 5 MiB are skipped**, as with PEP 770.
- **Only BOM-type artifacts in a JSON format are downloaded.** VEX documents,
  signatures and XML formats are skipped.
- **Anything that is not a recognised SBOM shape is skipped with a warning** —
  CycloneDX needs a `specVersion`; SPDX 2.x and 3.x JSON-LD are both accepted.

Every rejection names the artifact, so a skipped document is visible rather than
silent.

## 5) Publishing

```bash
cdxgen -t js /path/to/repo -o bom.json \
  --tea-publish https://cdxgen.github.io/tea \
  --tea-leaf-identifier 123e4567-e89b-12d3-a456-426614174000 \
  --tea-author-name "Jane Doe" \
  --tea-author-email jane@cdxgen.github.io \
  --tea-artifact-url https://cdxgen.github.io/downloads/bom.json
```

`--tea-artifact-url` matters more than it looks. The Collection records *where
the artifact can be downloaded*, and the server generally fetches it from there.
The default is your local output path, which no server can reach — so supply the
hosted URL whenever the BOM is published somewhere.

The checksum in the payload is computed over **the file that was written**, not
a re-serialisation of the in-memory BOM, so it describes the bytes a consumer
will actually download.

### Collection versioning is the server's job

You declare *why* you are publishing; the server assigns the version number.

```bash
--tea-reason INITIAL_RELEASE     # first publish (default)
--tea-reason ARTIFACT_UPDATED    # a new SBOM for the same release
--tea-reason ARTIFACT_ADDED
--tea-reason ARTIFACT_REMOVED
--tea-reason VEX_UPDATED
```

### A failed publish never costs you your SBOM

The BOM is written to disk **before** the publish is attempted. On failure
cdxgen reports the error and exits with status **3**, distinct from other
failures, and the file is still there:

```bash
cdxgen -t python . -o bom.json --tea-publish https://cdxgen.github.io/no-such-tea \
  --tea-leaf-identifier 123e4567-e89b-12d3-a456-426614174000
echo $?        # 3
ls -l bom.json # present
```

That makes the exit status safe to gate CI on: `3` means "SBOM generated,
distribution failed", which is usually a retry rather than a build failure.

## 6) CI sketch

```yaml
- name: Generate, enrich and publish
  env:
    TEA_TOKEN: ${{ secrets.TEA_TOKEN }}
  run: |
    set +e
    cdxgen -t js . -o bom.json \
      --tea-fetch "$UPSTREAM_TEI" \
      --tea-publish https://cdxgen.github.io/tea \
      --tea-leaf-identifier "$TEA_LEAF" \
      --tea-reason ARTIFACT_UPDATED \
      --tea-artifact-url "https://cdxgen.github.io/downloads/${GITHUB_SHA}/bom.json"
    status=$?
    if [ "$status" -eq 3 ]; then
      echo "::warning::TEA publish failed; the BOM was still generated"
    elif [ "$status" -ne 0 ]; then
      exit "$status"
    fi

- uses: actions/upload-artifact@v4
  with:
    path: bom.json
```

Upload the artifact regardless of the publish result — that is the whole reason
the exit status is distinct.

## What to take away

1. A TEI is the stable identity; everything else is discovery from it.
2. Upstream assertions beat local inference, and the merge records which is
   which.
3. Unverifiable content is refused, not merged quietly.
4. Distribution failures and generation failures are different events and should
   be handled differently.
5. Fetching is standardised; publishing is not yet. Plan for the publisher shape
   to change.
