/**
 * Terraform and OpenTofu parser for `.terraform.lock.hcl`.
 *
 * The lock file pins every provider the configuration resolves to, with its
 * exact version, the version constraints that produced it, and content
 * hashes. It is written in a small, regular subset of HCL: provider blocks,
 * `version` and `constraints` attributes, and a `hashes` list of prefixed
 * digests. A line scanner is sufficient and avoids a general HCL parser.
 *
 * Provider addresses look like `registry.terraform.io/hashicorp/aws`; the
 * registry host and namespace identify the provider upstream, so they are
 * kept in the component group and a generic purl
 * (`pkg:generic/<host>/<namespace>/<type>@<version>`), with the intended type
 * recorded as a `cdx:purl:proposedType` property because no `terraform`
 * purl type is registered.
 *
 * The two hash schemes in the `hashes` list mean different things. A `zh:`
 * digest is a SHA-256 of the official `.zip` package as the registry indexes
 * it, so it is the one a consumer can check an artifact against and the one
 * emitted in the CycloneDX `hashes` array. An `h1:` digest is base64 over a
 * hash of the package's *contents* rather than the archive, which lets
 * Terraform verify an unpacked directory but makes it useless as an artifact
 * checksum; it is kept as a property instead of being mislabelled SHA-256.
 */
/**
 * Parse a `.terraform.lock.hcl` file.
 *
 * @param {string} lockFile Path to the lock file
 * @returns {{ pkgList: object[] }} Provider components
 */
export declare function parseTerraformLockFile(lockFile: string): {
    pkgList: object[];
};
//# sourceMappingURL=parsers-terraform.d.ts.map