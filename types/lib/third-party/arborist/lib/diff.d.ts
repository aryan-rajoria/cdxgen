declare class Diff {
    filterSet: any;
    shrinkwrapInflated: any;
    children: any[];
    actual: any;
    ideal: any;
    resolved: any;
    integrity: any;
    action: string | null;
    parent: any;
    leaves: any[];
    unchanged: any[];
    removed: any[];
    constructor({ actual, ideal, filterSet, shrinkwrapInflated }: {
        actual: any;
        filterSet: any;
        ideal: any;
        shrinkwrapInflated: any;
    });
    static calculate({ actual, ideal, filterNodes, shrinkwrapInflated, }: {
        actual: any;
        filterNodes?: never[] | undefined;
        ideal: any;
        shrinkwrapInflated?: Set<any> | undefined;
    }): any;
}
export default Diff;
//# sourceMappingURL=diff.d.ts.map