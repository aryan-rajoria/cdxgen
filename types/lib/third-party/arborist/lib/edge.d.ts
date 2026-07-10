import util from "node:util";
declare class ArboristEdge {
    name: any;
    spec: any;
    type: any;
    from: any;
    to: any;
    error: any;
    peerConflicted: boolean | undefined;
    overridden: any;
    constructor(edge: any);
}
declare class Edge {
    #private;
    [util.inspect.custom]: () => ArboristEdge;
    overrides: any;
    peerConflicted: boolean;
    static types: readonly string[];
    static errors: readonly string[];
    constructor(options: any);
    satisfiedBy(node: any): any;
    explain(seen?: any[]): any;
    get bundled(): boolean;
    get workspace(): boolean;
    get prod(): boolean;
    get dev(): boolean;
    get optional(): boolean;
    get peer(): boolean;
    get type(): any;
    get name(): string;
    get rawSpec(): string;
    get spec(): any;
    get accept(): string | undefined;
    get valid(): boolean;
    get missing(): boolean;
    get invalid(): boolean;
    get peerLocal(): boolean;
    get error(): any;
    reload(hard?: boolean): void;
    detach(): void;
    get from(): any;
    get to(): any;
    toJSON(): ArboristEdge;
}
export default Edge;
//# sourceMappingURL=edge.d.ts.map