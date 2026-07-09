/**
 * Retrieves a CycloneDX BOM attached to an OCI image purely in JavaScript
 * without relying on the `oras` CLI tool.
 *
 * @param {string} image OCI image reference (e.g. `"registry.example.com/org/app:tag"`)
 * @param {string} [platform] OCI platform string (e.g. `"linux/amd64"`); no-op for JS implementation
 * @returns {Promise<Object|undefined>} Parsed CycloneDX BOM JSON object, or `undefined` if not found
 */
export declare function getBomWithOras(image: string, _platform?: undefined): Promise<Object | undefined>;
export declare function attachBomNative(image: any, bomJson: any): Promise<string>;
//# sourceMappingURL=oci.d.ts.map