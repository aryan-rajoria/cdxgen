/**
 * Determine whether a BOM is a merged HBOM+OBOM host view.
 *
 * @param {Object} bomJson CycloneDX BOM document
 * @returns {boolean} `true` when the BOM declares the merged host-view mode or mixes HBOM components with osquery runtime components
 */
export declare function isMergedHostViewBom(bomJson: Object): boolean;
/**
 * Extract `cdx:hostview:*` summary values from a host-view BOM.
 *
 * @param {Object} bomJson CycloneDX BOM document
 * @returns {{linkedHardwareComponentCount: number, linkedRuntimeCategories: string[], mode: string|undefined, runtimeAnchorCount: number, runtimeComponentCount: number, topologyLinkCount: number}} Host view summary
 */
export declare function getHostViewSummary(bomJson: Object): {
    linkedHardwareComponentCount: number;
    linkedRuntimeCategories: string[];
    mode: string | undefined;
    runtimeAnchorCount: number;
    runtimeComponentCount: number;
    topologyLinkCount: number;
};
/**
 * Annotate an HBOM with host-inventory topology links.
 *
 * Links osquery runtime components and host anchor components to hardware
 * components through dependency edges and rebuilds the `cdx:hostview:*`
 * summary properties.
 *
 * @param {Object} bomJson CycloneDX HBOM document
 * @returns {Object} The annotated BOM, returned unchanged when the BOM is not HBOM-like
 */
export declare function applyHostInventoryTopology(bomJson: Object): Object;
/**
 * Merge an HBOM with OBOM runtime data into a single host-view BOM.
 *
 * Combines components, dependencies, services, and metadata from both BOMs,
 * then applies host-inventory topology annotations to the merged result.
 *
 * @param {Object} hbomJson CycloneDX HBOM document
 * @param {{bomJson?: Object, parentComponent?: Object}} obomData OBOM result carrying its BOM document and optional parent component
 * @returns {Object} Merged host-view BOM, or the HBOM alone when OBOM data is absent
 */
export declare function mergeHostInventoryBoms(hbomJson: Object, obomData: {
    bomJson?: Object;
    parentComponent?: Object;
}): Object;
//# sourceMappingURL=hostTopology.d.ts.map