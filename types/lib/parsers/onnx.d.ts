/**
 * Read the identifying header fields of an ONNX model file.
 *
 * Only `ir_version`, `producer_name`, `producer_version`, `model_version`,
 * and the `opset_import` entries are extracted. The graph and every other
 * payload are skipped by offset without being read, so no tensor data is
 * ever loaded and no model code is executed.
 *
 * @param {string} filePath Path to the `.onnx` file
 * @returns {{
 *   irVersion: number,
 *   producerName: string,
 *   producerVersion: string,
 *   modelVersion: number,
 *   opsets: Array<{domain: string, version: number}>,
 * } | undefined} Header summary, or undefined when it cannot be read
 */
export declare function readOnnxHeader(filePath: string): {
    irVersion: number;
    producerName: string;
    producerVersion: string;
    modelVersion: number;
    opsets: Array<{
        domain: string;
        version: number;
    }>;
} | undefined;
//# sourceMappingURL=onnx.d.ts.map