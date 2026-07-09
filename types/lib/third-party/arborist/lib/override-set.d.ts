declare class OverrideSet {
    parent: any;
    children: Map<any, any>;
    name: any;
    key: any;
    keySpec: any;
    value: any;
    constructor({ overrides, key, parent }: {
        key: any;
        overrides: any;
        parent: any;
    });
    childrenAreEqual(other: any): boolean;
    isEqual(other: any): any;
    getEdgeRule(edge: any): any;
    getNodeRule(node: any): any;
    getMatchingRule(node: any): any;
    ancestry(): Generator<this, void, unknown>;
    get isRoot(): boolean;
    get ruleset(): Map<any, any>;
    static findSpecificOverrideSet(first: any, second: any): any;
    static doOverrideSetsConflict(first: any, second: any): boolean;
}
export default OverrideSet;
//# sourceMappingURL=override-set.d.ts.map