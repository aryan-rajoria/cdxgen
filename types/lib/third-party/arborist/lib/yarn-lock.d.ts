declare class YarnLockEntry {
    #private;
    resolved: any;
    version: any;
    integrity: any;
    dependencies: any;
    optionalDependencies: any;
    constructor(specs: any);
    toString(): string;
    addSpec(spec: any): void;
}
declare class YarnLock {
    entries: Map<any, any> | null;
    current: YarnLockEntry | null | undefined;
    subkey: string | symbol | undefined;
    static parse(data: any): YarnLock;
    static fromTree(tree: any): YarnLock;
    constructor();
    endCurrent(): void;
    parse(data: any): this;
    splitQuoted(str: any, delim: any): any[];
    toString(): string;
    fromTree(tree: any): this;
    addEntryFromNode(node: any): void;
    entryDataFromNode(node: any): {
        dependencies: any;
        optionalDependencies: any;
        version: any;
        resolved: any;
        integrity: any;
    };
    static get Entry(): typeof YarnLockEntry;
}
export default YarnLock;
//# sourceMappingURL=yarn-lock.d.ts.map