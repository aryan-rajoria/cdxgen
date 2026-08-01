/**
 * Encode a string for safe inclusion in a PackageURL, percent-encoding special characters
 * while preserving already-encoded `%40` sequences and keeping `:` and `/` unencoded.
 *
 * @param {string} s String to encode
 * @returns {string} Encoded string suitable for use in a PackageURL component
 */
export declare function encodeForPurl(s: string): string;
/**
 * Build a purl string, returning `null` instead of throwing when the parts do
 * not form a valid purl.
 *
 * cdx-purl is strict: it rejects a maven purl without a groupId, a swift or
 * golang purl without a namespace, a vscode-extension without a publisher, and
 * so on. Those rejections are correct and must not be papered over — but they
 * also must not crash a scan of an otherwise fine project. This helper is the
 * one sanctioned place to turn a `PurlError` into an absent purl.
 *
 * Only `PurlError` is swallowed. Anything else (a `TypeError` from a bad call,
 * for instance) is a defect in the caller and is rethrown.
 *
 * @param {object} parts Purl parts accepted by cdx-purl's `build()`
 * @returns {string|null} Canonical purl string, or `null` if it is not valid
 */
export declare function tryBuildPurl(parts: object): string | null;
/**
 * Build a canonical npm purl from a package name and version.
 *
 * Prefer this over hand-assembling `pkg:npm/...` strings. Manual assembly has
 * to re-implement percent-encoding and gets it wrong in ways cdx-purl then
 * rejects: an unencoded `+` in a semver build-metadata version
 * (`1.0.0+build.1`) throws `E_INVALID_CHARACTER`, and the scope separator has
 * to survive encoding. `build()` handles both, so callers pass raw values.
 *
 * @param {string} pkgName Package name, optionally scoped (`@scope/name`)
 * @param {string} [version] Package version, raw and unencoded
 * @returns {string} Canonical npm purl string
 */
export declare function npmPurl(pkgName: string, version?: string): string;
/**
 * Report whether a string is a valid purl according to cdx-purl.
 *
 * Use this before writing anything into a CycloneDX `purl` field that did not
 * come from `build()` — notably when recovering a purl from a `bom-ref`, which
 * is an opaque identifier and frequently is not a purl at all.
 *
 * @param {string} candidate String to test
 * @returns {boolean} true when cdx-purl parses it
 */
export declare function isValidPurl(candidate: string): boolean;
/**
 * Parse a purl string, returning `null` instead of throwing when it is invalid.
 *
 * The parse-side counterpart of {@link tryBuildPurl}, for callers that have
 * already assembled a purl string. Only `PurlError` is swallowed.
 *
 * @param {string} purlString Candidate purl
 * @returns {string|null} Canonical purl string, or `null` if it is not valid
 */
export declare function tryParsePurl(purlString: string): string | null;
/**
 * Build a `bom-ref` for a component that has no valid purl.
 *
 * `bom-ref` must be **unique within the document** — CycloneDX uses it as the
 * key for the dependency graph, so two components sharing one silently merge
 * their edges. The bare component name is therefore not usable: the syft go
 * module graph contains eight versions of `go.opencensus.io`, none of which can
 * carry a golang purl (cdx-purl requires a namespace), and naming them all
 * `go.opencensus.io` collapsed eight distinct modules into one ref.
 *
 * The `type:group/name:version` shape matches the convention already used for
 * root components (`application:swift-smoke:latest`) and for the dedupe key in
 * `lib/stages/postgen/ruleEngine.js`.
 *
 * @param {object} component Component with `type`, `group`, `name`, `version`
 * @returns {string} A document-unique, deterministic bom-ref
 */
export declare function fallbackBomRef(component: object): string;
/**
 * Attach a purl and `bom-ref` to a component, never emitting an invalid purl.
 *
 * CycloneDX requires `component.purl` to be a valid Package URL when present,
 * so a component we cannot build a purl for must omit the field entirely — it
 * must *not* fall back to the bare name, which is what produced
 * `"purl": "swift-smoke"` in the swift golden.
 *
 * `bom-ref` has no syntax constraint but does have a uniqueness constraint, so
 * the fallback goes through {@link fallbackBomRef} rather than using the name.
 *
 * Any pre-existing `purl` is deleted when the new one is invalid, so a
 * component cannot retain a stale purl from an earlier enrichment pass.
 *
 * @param {object} component Component to mutate
 * @param {string|null} purlString Canonical purl string, or `null`/`undefined`
 * @param {string} [fallbackRef] Explicit `bom-ref` override for when there is no purl
 * @returns {object} The same component, for chaining
 */
export declare function applyPurl(component: object, purlString: string | null, fallbackRef?: string): object;
/**
 * Sanitize a purl that cdxgen did not author.
 *
 * cdxgen ingests components from places it does not control — caxa binary
 * metadata, existing SBOMs supplied as input, converter output. Those purls can
 * be invalid (`@cdxgen/caxa` emitted `pkg:generic/...?arch=…&platform=…`, and
 * `arch`/`platform` are not qualifiers the `generic` type allows), and cdxgen
 * must neither emit an invalid purl it merely read nor hard-fail on third-party
 * data.
 *
 * Order of preference:
 *   1. Keep the purl when it is already valid.
 *   2. Rebuild a canonical purl from the component's own type/group/name/version.
 *   3. Drop the purl and assign a unique fallback `bom-ref`.
 *
 * The original string is preserved in a property whenever it is discarded, so the
 * provenance of the change is visible in the output rather than silent.
 *
 * @param {object} component Component to sanitize in place
 * @param {string} [purlType] purl type to use when rebuilding (default `generic`)
 * @returns {object} The same component, for chaining
 */
export declare function sanitizeIngestedPurl(component: object, purlType?: string): object;
/**
 * Build an `oci` purl from a Docker/OCI repository digest.
 *
 * The `oci` type **prohibits** a namespace, so the registry-qualified repository
 * cannot go in the purl path: `pkg:oci/docker.io/library/alpine@sha256:…` is
 * invalid. Per the purl spec the name is the repository's last segment, the
 * version is the digest, and the full repository travels in `repository_url`.
 *
 * @param {string} repoDigest e.g. `docker.io/library/alpine@sha256:abc…`
 * @param {string} [tag] Optional image tag, emitted as the `tag` qualifier
 * @returns {string|null} Canonical purl, or `null` when one cannot be built
 */
export declare function ociPurl(repoDigest: string, tag?: string): string | null;
/**
 * Create a PackageURL object from a repository URL string, package type, and version.
 *
 * Supports HTTPS URLs, SSH `git@` URLs, Bitbucket SSH URLs, and local paths.
 * Extracts the namespace (host + path prefix) and repository name from the URL.
 *
 * @param {string} type PackageURL type (e.g. `"swift"`, `"generic"`)
 * @param {string} repoUrl Repository URL string
 * @param {string} version Package version
 * @returns {PackageURL|undefined} PackageURL object, or undefined for unsupported URL formats
 */
export declare function purlFromUrlString(type: string, repoUrl: string, version: string): PackageURL | undefined;
/**
 * NOT IMPLEMENTED YET.
 * A future method to locate a generic package given some name and properties
 *
 * @param {object} apkg Package to locate
 * @returns Located project with precise purl or the original unmodified input.
 */
export declare function locateGenericPackage(apkg: object): object;
export declare function mapConanPkgRefToPurlStringAndNameAndVersion(conanPkgRef: any): any[];
//# sourceMappingURL=purl.d.ts.map