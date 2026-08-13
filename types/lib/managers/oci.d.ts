/**
 * Retrieves a CycloneDX BOM attached to an OCI image purely in JavaScript
 * without relying on the `oras` CLI tool.
 *
 * @param {string} image OCI image reference (e.g. `"registry.example.com/org/app:tag"`)
 * @param {string} [platform] OCI platform string (e.g. `"linux/amd64"`); no-op for JS implementation
 * @returns {Promise<Object|undefined>} Parsed CycloneDX BOM JSON object, or `undefined` if not found
 */
export declare function getBomWithOras(image: string, _platform?: undefined): Promise<Object | undefined>;
/**
 * Attach a CycloneDX BOM to an OCI image using the OCI 1.1 artifact manifest
 * API, pushing the BOM as a blob and linking it via the referrers API (with a
 * fallback tag when the registry does not support referrers).
 *
 * @param {string} image The target OCI image reference to attach the BOM to.
 * @param {Object} bomJson The CycloneDX BOM document to attach.
 * @returns {Promise<string|undefined>} The digest of the pushed manifest, or
 *   undefined when the manifest could not be pushed.
 */
export declare function attachBomNative(image: string, bomJson: Object): Promise<string | undefined>;
//# sourceMappingURL=oci.d.ts.map