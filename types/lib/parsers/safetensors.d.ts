/**
 * Read and parse the JSON header of a safetensors model file.
 *
 * Only the leading header is read; tensor payloads are ignored. The returned
 * object separates the optional `__metadata__` map from the per-tensor
 * descriptors.
 *
 * @param {string} filePath Path to a `.safetensors` file
 * @returns {{
 *   metadata: Object,
 *   tensorCount: number,
 *   dtypes: string[],
 *   totalParameters: number,
 * } | undefined} Parsed header summary, or undefined when it cannot be read
 */
export declare function readSafetensorsHeader(filePath: string): {
    metadata: Object;
    tensorCount: number;
    dtypes: string[];
    totalParameters: number;
} | undefined;
//# sourceMappingURL=safetensors.d.ts.map