/**
 * Apply experimental MCP pinning/composition properties. Mutates `bomJson` in
 * place and returns citation hints for the registry-attributed integrity. The
 * caller is responsible for emitting citations only at spec version 1.7+.
 *
 * @param {Object} bomJson CycloneDX BOM
 * @param {Object} [options] CLI options
 * @returns {Object[]} Citation hints produced by the enrichment
 */
export declare function applyMcpPinningState(bomJson: Object, options?: Object): Object[];
//# sourceMappingURL=mcpPinning.d.ts.map