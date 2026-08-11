# Releasing cdxgen

Three repositories publish artefacts that reference each other. Releasing them
in the wrong order produces a version of cdxgen that resolves a plugins-bin it
was never tested against, so the order below is not a suggestion.

## Repositories and what each publishes

| Repository | Publishes | Registry |
| ---------- | --------- | -------- |
| `cdxgen/cdxgen-plugins-bin` | `@cdxgen/cdxgen-plugins-bin` (bundles the `cdxrs` binary and the other plugin binaries) | npm |
| `cdxgen/cdxgen` | `@cdxgen/cdxgen` | npm + JSR |
| `cdxgen/cdxgen` | ~30 container images | `ghcr.io/cdxgen/*` |
| `cyclonedx/cdxgen-packages` | mirrors of those images | `ghcr.io/cyclonedx/*` |

## Release order

1. **`cdxgen-plugins-bin`** — publish a non-prerelease version first. cdxgen
   resolves it at install time; releasing cdxgen first leaves a window where
   `pnpm install` fails or silently picks an older binary.
2. **`cdxgen`** — tag `v<version>`. The `npm-release.yml` workflow publishes to
   npm and JSR and builds every container image from the same tag.
3. **Mirror** — the `cyclonedx/cdxgen-packages` schedule picks the new images up
   within 12 hours, or run its workflow by hand.

## The plugins-bin version contract

`lib/inventory/cdxrs.js` pins a **major** version:

```js
const CDXRS_VERSION_MAJOR = "3";
```

The bridge probes `cdxrs --version` before every use. A major mismatch is not
an error: it logs once and returns `CDXRS_FALLBACK`, and the JS implementation
runs instead. The same is true when the binary is missing, the probe fails, or
`CDXGEN_RS_DISABLE` names the subcommand.

That means a version mismatch is **quiet by design**. Two consequences worth
knowing before a release:

- A user with a mismatched plugins-bin gets correct output, just without the
  Rust path. Nothing fails, so nothing tells you the pairing is wrong.
- `contrib/rs-disable-golden-test.js` asserts `CDXGEN_RS_DISABLE=all` is
  byte-identical to the default path, which is what makes the fallback safe to
  take silently. If that gate ever fails, the fallback is no longer transparent
  and a mismatch stops being harmless.

Only `fetch` and `validate` currently route through `cdxrs`.

When bumping `CDXRS_VERSION_MAJOR`, release plugins-bin first and widen the
accepted range only after the new binary is published — otherwise every
existing install silently drops to the JS path on upgrade.

## Trusted publishing

Both registries authenticate the release workflow with the GitHub Actions OIDC
token. No npm token is stored in this repository.

- **npm** — the trusted publisher is registered against `@cdxgen/cdxgen` for
  repository `cdxgen/cdxgen` and workflow `npm-release.yml`. The workflow
  filename must keep matching; a rename surfaces as a 403 that does not say
  which field is wrong.
- **JSR** — the package is linked to the same repository. JSR checks the
  repository claim on the token, so any workflow in the repo with
  `id-token: write` can publish.

Two things in `npm-release.yml` exist specifically to keep this working, and
both look removable if you do not know why they are there:

- The `setup-node` step sets **no `registry-url` and no `scope`**. Either one
  makes `setup-node` write an `.npmrc` containing `_authToken`, and a
  credential in that file competes with the OIDC exchange.
- `id-token: write` is on the `pkg` job. Without it there is no token to
  exchange.

OIDC publishing needs **npm >= 11.5.1**, which is newer than the npm bundled
with most Node 24 images. pnpm reaches the OIDC path only via
`pnpm/action-setup` >= 6.0.6 (pnpm 11 shipped with it broken).

## Verifying a release actually used trusted publishing

A successful OIDC publish attaches a provenance attestation:

```bash
npm view @cdxgen/cdxgen dist.attestations
```

If that is empty, the publish used a token and the trusted-publisher path was
never exercised, whatever the workflow logs suggest.

## Container images

Images are built from the release tag and published to `ghcr.io/cdxgen/*`.
Tags come from `docker/metadata-action`:

| Pattern | Produces |
| ------- | -------- |
| `type=semver,pattern={{version}}` | `13.0.0` |
| `type=semver,pattern=v{{major}}.{{minor}}` | `v13.0` |
| `type=semver,pattern=v{{major}}` | `v13` |
| `type=raw,value=latest` | `latest` on any tag push |
| `type=raw,value=master` | `master` on the default branch |

`latest` moves on **any** tag push, so publishing a v12 patch after v13 would
move `latest` backwards. Release the older series with
`rebuild-images-only`, or repoint `latest` afterwards.

The image catalogue is in [images/README.md](images/README.md).

## Before tagging

- [ ] `@cdxgen/cdxgen-plugins-bin` released and the version in `package.json`
      points at it.
- [ ] `CDXRS_VERSION_MAJOR` matches the released binary's major.
- [ ] `pnpm test`, the golden corpus, `rs-disable-golden-test` and
      `purl-sweep` all green.
- [ ] `node ci/diff-v12-v13.js` clean, with every delta justified in
      `expected-deltas.yaml`.
- [ ] The packed tarball installs and runs on Linux, macOS and Windows — a real
      `npm pack` install, not just CI green.
- [ ] `MIGRATING-TO-V13.md` covers anything that changes component counts,
      purls, licences or audit scores.

## After releasing

- [ ] `npm view @cdxgen/cdxgen dist-tags` shows the new version as `latest`.
- [ ] `npm view @cdxgen/cdxgen dist.attestations` is non-empty.
- [ ] JSR shows the new version.
- [ ] `ghcr.io/cdxgen/cdxgen:v13` resolves and runs.
- [ ] The mirror ran, or was triggered by hand.
- [ ] For the first release under a new name, drop any bootstrap dist-tag:
      `npm dist-tag rm @cdxgen/cdxgen placeholder`.
