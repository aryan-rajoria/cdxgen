declare class CanPlaceDep {
    _treeSnapshot: string;
    canPlace: any;
    canPlaceSelf: any;
    dep: any;
    target: any;
    edge: any;
    explicitRequest: any;
    peerPath: any;
    preferDedupe: any;
    parent: any;
    children: any[];
    isSource: boolean;
    name: any;
    current: any;
    targetEdge: any;
    conflicts: Map<any, any>;
    edgeOverride: boolean;
    _canPlacePeers: any;
    constructor(options: any);
    checkCanPlace(): any;
    checkCanPlaceCurrent(): any;
    checkCanPlaceNoCurrent(): any;
    get deepestNestingTarget(): any;
    get conflictChildren(): any[];
    get allChildren(): any[];
    get top(): any;
    canPlacePeers(state: any): any;
    get peerSetSource(): any;
    get peerEntryEdge(): any;
    static get CONFLICT(): symbol;
    static get OK(): symbol;
    static get REPLACE(): symbol;
    static get KEEP(): symbol;
    get description(): any;
}
export default CanPlaceDep;
//# sourceMappingURL=can-place-dep.d.ts.map