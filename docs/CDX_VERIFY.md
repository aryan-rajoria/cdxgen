# cdx-verify — Verify CycloneDX BOM signatures

`cdx-verify` validates JSF signatures on CycloneDX BOMs.

It can verify:

- a root BOM signature
- nested component signatures
- nested service signatures
- nested annotation signatures
- JSON BOMs loaded from a local file or an OCI reference

## Who should use this

- **CI/CD maintainers** — fail a pipeline when a signed BOM no longer verifies
- **Artifact consumers** — verify the signer before trusting a BOM from another team
- **Compliance teams** — confirm the published BOM still matches the signed payload

## Quick start

```shell
# Verify a BOM on disk
cdx-verify -i bom.json --public-key public.pem

# Verify only the root BOM signature
cdx-verify -i bom.json --public-key public.pem --no-deep

# Verify a BOM attached to an OCI image
cdx-verify -i ghcr.io/cdxgen/cdxgen:master --public-key public.pem

# Verify an HMAC (HS256, HS384, HS512) signature with a shared secret
cdx-verify -i bom.json --secret-key shared.secret
```

## CLI reference

| Flag                   | Default      | Description                                                                                             |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `-i, --input`          | `bom.json`   | Local BOM path or OCI reference                                                                         |
| `--platform`           | —            | OCI platform override when verifying an attached BOM                                                    |
| `--public-key`         | `public.key` | PEM-encoded public key (a private key is reduced to its public key)                                     |
| `--secret-key`         | —            | Shared secret file for `HS256`, `HS384`, and `HS512` signatures. Cannot be combined with `--public-key` |
| `--deep` / `--no-deep` | on           | Verify nested component, service, and annotation signatures too                                         |
| `-h, --help`           | off          | Show help                                                                                               |

## Verification behavior

- Local protobuf BOM input (`.cdx`, `.cdx.bin`, `.proto`) is detected and decoded, but verification intentionally fails with a clear message because `cdx-proto` does not currently preserve JSF signature blocks in protobuf form.
- If the BOM contains a root `signature`, `cdx-verify` validates it first.
- A signature only verifies when its declared `algorithm` matches the key type (see [Algorithms and keys](CDX_SIGN.md#algorithms-and-keys)). A key given with `--public-key` is always treated as a public key, so HMAC signatures are only accepted with `--secret-key`.
- The signature metadata (`algorithm`, `keyId`, `publicKey`) is part of the signed data, so changing it invalidates the signature. An embedded `publicKey` must be the verification key.
- For `signers`, each entry verifies on its own. For `chain`, each entry also covers the entries before it, so a reordered or truncated chain fails.
- When a signature fails, `cdx-verify` prints the reason for each signature entry it tried.
- BOMs signed with cdxgen 13.2.0 or earlier do not verify and must be [re-signed](CDX_SIGN.md#re-signing-boms-from-earlier-releases).
- With `--deep` enabled, nested signatures are also verified.
- If there is no root signature but nested signatures exist, the command validates those nested signatures and succeeds only when all of them are valid.
- If no valid signatures are present, the command exits with a failure.

## Exit behavior

- exit code `0` — the requested signatures verified successfully
- exit code `1` — invalid input, missing key, failed verification, or no valid signatures found

## Practical guidance

- Use `--no-deep` when the trust decision is only about the published root BOM.
- Keep `--deep` enabled when nested signatures are part of your release policy.
- If you export a protobuf sidecar (`bom.cdx`), keep the original signed JSON BOM alongside it for verification workflows.
- Store public keys in version-controlled trust stores or your CI secret manager rather than downloading them ad hoc.

## Example CI step

```yaml
- name: Verify BOM signature
  run: cdx-verify -i bom.json --public-key builder_public.pem
```

## Related docs

- [cdx-sign — Sign a CycloneDX BOM](CDX_SIGN.md)
- [cdx-validate — Supply-Chain Compliance Validator](CDX_VALIDATE.md)
- [Tutorials - Sign & Attach](LESSON3.md)
- [Tutorials - Multi-Signing and Signature Chaining for SBOMs](LESSON6.md)
