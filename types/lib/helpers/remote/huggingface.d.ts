export { normalizeHuggingFaceReference, toHuggingFacePurl, } from "../huggingfaceUtils.js";
/**
 * Clear the in-process Hugging Face caches used for remote metadata lookup.
 */
export declare function resetHuggingFaceRemoteCaches(): void;
/**
 * Check whether remote Hugging Face metadata resolution is enabled.
 *
 * @param {Object} [options={}] CLI options
 * @returns {boolean} true when remote resolution is enabled
 */
export declare const isHuggingFaceRemoteEnabled: (options?: Object) => boolean;
/**
 * Resolve a Hugging Face model, dataset, or space into a BOM component.
 *
 * @param {string} assetType asset type such as model or dataset
 * @param {string} repoId Hugging Face repository id
 * @param {Object} [options={}] fetch and header overrides
 * @returns {Promise<Object|undefined>} resolved BOM component
 */
export declare function fetchHuggingFaceAssetInventory(assetType: string, repoId: string, options?: Object): Promise<Object | undefined>;
/**
 * Resolve a Hugging Face asset to the primary CycloneDX component only.
 *
 * @param {string} assetType asset type such as model or dataset
 * @param {string} repoId Hugging Face repository id
 * @param {Object} [options={}] fetch and header overrides
 * @returns {Promise<Object|undefined>} primary resolved component
 */
export declare function fetchHuggingFaceAssetMetadata(assetType: string, repoId: string, options?: Object): Promise<Object | undefined>;
//# sourceMappingURL=huggingface.d.ts.map