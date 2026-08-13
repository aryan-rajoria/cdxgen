# Lesson 29 - Trust enrichment with trustinspector

An SBOM tells you _what_ is installed. A trust-enriched BOM also tells you
_whether each artefact is signed, by whom, and whether the host actually trusts
it_. On macOS that means code-signing identity, notarization status, and
Gatekeeper posture. On Windows it means Authenticode signer details and WDAC
(Windows Defender Application Control) policy coverage. On Linux container
rootfs it means repository trust anchors and the keys that sign them.

cdxgen collects this evidence through an optional companion helper called
`trustinspector`. This lesson explains what the helper does, when it runs, and
how to read the properties it adds.

## Goal

By the end of this lesson you should be able to:

1. Produce a trust-enriched OBOM or rootfs BOM.
2. Explain the difference between per-component trust properties and host-level
   trust findings.
3. Find repo trust anchors and trusted key files in the BOM.
4. Gate CI on trust posture using the built-in audit categories.

## Learning Objective

Understand how `enrichOSComponentsWithTrustData` in `lib/managers/binary.js`
attaches trust evidence to OS components, what the `cdx:trustinspector`,
`cdx:darwin`, and `cdx:windows` properties contain, and how this differs from
the consumption workflow covered in `OBOM_LESSONS.md`.

## 1) What trust enrichment is

Trust enrichment attaches signing and execution-policy evidence to components
that already exist in the BOM. Concretely:

- **macOS**: the code-signing identifier, team identifier, and certificate
  authority for each binary or app bundle, plus the notarization assessment
  result and the source (for example "Notarized Developer ID").
- **Windows**: the Authenticode validation status, whether the file is a known
  OS binary, the signer subject name, and the signer thumbprint.
- **Linux rootfs**: the repository sources (apt, yum, ppa) and the trusted key
  files and CA certificates that anchor them.

This is distinct from the osquery inventory that builds the OBOM in the first
place. osquery tells you a binary exists at a path; `trustinspector` tells you
whether it is signed and by whom.

## 2) When it runs

Trust enrichment is gated on two conditions, checked at the top of
`enrichOSComponentsWithTrustData` (`lib/managers/binary.js:2987`):

1. The platform is `darwin` or `windows`.
2. The `trustinspector` binary is resolvable.

The binary is resolved through `resolvePluginBinary("trustinspector", ...)`,
which looks in the optional companion package `cdxgen-plugins-bin`, or at the
`TRUSTINSPECTOR_CMD` environment variable. On Linux neither condition holds for
the per-component Authenticode/codesign path, so the helper is skipped (Linux
trust material still arrives through the Trivy-backed rootfs flow described in
step 5).

The function is called from the OBOM lifecycle in `lib/cli/index.js:237`, after
osquery has collected the host inventory. To trigger it, generate an OBOM on the
host you want to inspect:

```bash
obom --deep -o obom.json
```

`obom` is a command alias for `cdxgen -t os`. `--deep` is not strictly required
for trust enrichment (it runs whenever the helper is present), but it is the
common flag for full host inventory. For an image or extracted rootfs on either
macOS or Windows:

```bash
cdxgen -t rootfs --deep /path/to/rootfs -o rootfs-bom.json
```

For rootfs scans, cdxgen also asks the packaged Trivy helper for trust
metadata, which is how Linux repository and key material enters the BOM.

## 3) The two enrichment modes

`trustinspector` is invoked in two modes:

- **`paths <list>`**: per-component path inspection. cdxgen extracts candidate
  host paths from each component's properties (`path`, `bundle_path`,
  `executable`, `program`, `image_path`, `binary_path`, `action_path`), filters
  out macOS plist files and well-known system paths under `/usr/bin`,
  `/System/`, and so on, and batches the remaining paths 200 at a time. The
  returned properties are merged onto the matching components.
- **`host`**: a single host-level sweep. The findings become new `type: data`
  components (see step 4).

Both modes attach the `trustinspector` tool component to `metadata.tools` so the
BOM records which helper produced the evidence and at which version.

## 4) The trust properties

### Per-component properties (macOS)

| Property                             | Example value            |
| ------------------------------------ | ------------------------ |
| `cdx:darwin:codesign:identifier`     | `com.apple.calculator`   |
| `cdx:darwin:codesign:teamIdentifier` | `Software Signing`       |
| `cdx:darwin:codesign:authority`      | `Software Signing`       |
| `cdx:darwin:notarization:assessment` | `accepted`               |
| `cdx:darwin:notarization:source`     | `Notarized Developer ID` |

### Per-component properties (Windows)

| Property                                    | Example value                           |
| ------------------------------------------- | --------------------------------------- |
| `cdx:windows:authenticode:status`           | `Valid`                                 |
| `cdx:windows:authenticode:isOSBinary`       | `true`                                  |
| `cdx:windows:authenticode:signerSubject`    | `CN=Microsoft Windows, O=Microsoft ...` |
| `cdx:windows:authenticode:signerThumbprint` | `<thumbprint>`                          |

### Host-level finding components

A host sweep produces `type: data` components with a
`pkg:generic/host-trust/<name>@<version>` purl and a `cdx:trustinspector:kind`
property. Examples on macOS include a `gatekeeper-system-policy` component
carrying `cdx:darwin:gatekeeper:status=assessments enabled`. On Windows you get a
`wdac-active-policies` component carrying
`cdx:windows:wdac:activePolicyCount`.

Read them all with jq:

```bash
jq '[.components[] | .properties[]? | select(.name | startswith("cdx:darwin:") or startswith("cdx:windows:"))] | group_by(.name) | map({name: .[0].name, count: length})' obom.json

jq '.components[] | select(.purl | startswith("pkg:generic/host-trust/"))' obom.json
```

## 5) Trust relationships: repo sources and trusted keys

On Linux rootfs, trust is anchored in the package repositories and the keys that
sign them. cdxgen models this as explicit components rather than opaque file
paths:

- **Repository sources** (`apt`, `yum`, `ppa`) become `type: data` components
  with `cdx:os:repo:*` properties, including `cdx:os:repo:url`,
  `cdx:os:repo:enabled`, and `cdx:os:repo:signedBy` (the keyring path).
- **Trusted key files** (such as `debian-archive-keyring.gpg`) become
  `cryptographic-asset` components with
  `cryptoProperties.relatedCryptoMaterialProperties.type = public-key` and
  `cdx:crypto:*` properties (`fingerprint`, `algorithm`, `keyStrength`, `keyId`,
  `userId`).
- **CA certificates** (such as `ca-certificates.crt`) become `cryptographic-asset`
  components with `assetType: certificate`.

When a repository source file explicitly references a key through `signed-by` or
`gpgkey`, cdxgen records that link in the `dependencies` array so the trust
relationship is navigable, not just implied by a shared path.

List the trust anchors:

```bash
jq '.components[] | select(.type == "cryptographic-asset") | {name, assetType: .cryptoProperties.assetType}' rootfs-bom.json

jq '.components[] | select(.type == "data") | select(.properties[]? | .name | startswith("cdx:os:repo:")) | {name, url: ([.properties[]? | select(.name=="cdx:os:repo:url") | .value] | first)}' rootfs-bom.json
```

## 6) Reviewing trust evidence

The fastest review is a jq query for binaries whose signing status is not what
you expect. On Windows, find persistence surfaces with an invalid or unknown
Authenticode status:

```bash
jq '.components[] | select(has("properties")) | select(any(.properties[]; .name == "cdx:windows:authenticode:status" and (.value | ascii_downcase | IN("valid","unknown","unknownerror","unknown_error") | not))) | {name, path: ([.properties[]? | select(.name=="path") | .value] | first)}' obom.json
```

In the `cdxi` REPL, the cryptographic-asset pivot lists the trusted keys and
certificates as a table so you can review fingerprints and algorithms without
writing jq:

```
.cryptographicassets
```

For the full consumption workflow (pivoting from trust signals into persistence
surfaces like launchd entries, Run keys, and scheduled tasks), see section 10 of
`OBOM_LESSONS.md`. This lesson is about producing the evidence; that one is about
acting on it.

## 7) CI and audit sketch

The `obom-runtime` audit ruleset turns trust properties into pass/fail signals.
Two rule families consume them directly:

- **Gatekeeper posture** checks that assessments and identified-developer
  enforcement are enabled on macOS.
- **Authenticode status** flags Windows persistence registrations (Run keys,
  scheduled tasks, services) whose backing binary has an invalid, non-OS, or
  unresolved signing status.

Run the audit inline with generation:

```bash
obom --deep -o obom.json --bom-audit --bom-audit-categories obom-runtime
```

In a workflow, gate on high-severity findings but keep going so the BOM is
always uploaded:

```yaml
jobs:
  obom:
    runs-on: macos-15 # or windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate trust-enriched OBOM
        run: obom --deep -o obom.json --bom-audit --bom-audit-categories obom-runtime -r sarif -o obom-audit.sarif
        continue-on-error: true
      - name: Fail on high-severity trust findings
        run: |
          if jq -e '.runs[0].results[]? | select(.level == "error")' obom-audit.sarif > /dev/null; then
            echo "High-severity trust findings detected"; exit 1
          fi
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: obom-audit.sarif
          category: obom-trust
      - uses: actions/upload-artifact@v4
        with:
          name: obom
          path: obom.json
```

Note that trust enrichment runs on the host it is invoked on. An OBOM generated
in CI describes the CI runner, not your production endpoints. For fleet-wide
trust review, generate the OBOM on the target host (or from a captured rootfs)
and collect the artefacts centrally.

## What to take away

1. Trust enrichment requires the `trustinspector` companion helper and runs on
   macOS and Windows; Linux rootfs trust material arrives through the Trivy
   path.
2. Per-component properties (`cdx:darwin:codesign:*`, `cdx:windows:authenticode:*`)
   are merged onto existing OS components; host-level findings become new
   `type: data` components.
3. Repository sources are `type: data` with `cdx:os:repo:*`, trusted keys are
   `cryptographic-asset` components, and the link between them is in
   `dependencies`.
4. The `obom-runtime` audit category turns signing and Gatekeeper posture into
   CI-gatable findings.
5. This lesson produces the evidence; `OBOM_LESSONS.md` section 10 consumes it.
