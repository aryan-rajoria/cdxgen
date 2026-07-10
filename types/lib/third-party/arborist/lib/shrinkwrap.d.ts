import YarnLock from "./yarn-lock.js";
declare class Shrinkwrap {
    #private;
    lockfileVersion: number | null;
    tree: any;
    path: any;
    filename: any;
    data: any;
    indent: any;
    newline: any;
    loadedFromDisk: boolean;
    type: any;
    yarnLock: YarnLock | null;
    hiddenLockfile: any;
    loadingError: unknown;
    resolveOptions: any;
    shrinkwrapOnly: any;
    originalLockfileVersion: any;
    ancientLockfile: boolean | undefined;
    static get defaultLockfileVersion(): number;
    static load(options: any): Promise<Shrinkwrap>;
    static get keyOrder(): string[];
    static reset(options: any): Promise<Shrinkwrap>;
    static metaFromNode(node: any, path: any, options?: {}): {
        resolved: any;
        link: boolean;
    } | {
        name: any;
        devDependencies: any;
        resolved: any;
        extraneous: boolean;
        peer: boolean;
        dev: boolean;
        optional: boolean;
        devOptional: boolean;
    };
    constructor(options?: {});
    checkYarnLock(spec: any, options?: {}): any;
    reset(): void;
    get loadFiles(): Promise<any>;
    get resetFiles(): Promise<any>;
    inferFormattingOptions(packageJSONData: any): void;
    load(): Promise<this>;
    delete(nodePath: any): void;
    get(nodePath: any): any;
    add(node: any): void;
    addEdge(edge: any): void;
    commit(): any;
    toJSON(): any;
    toString(options?: {}): any;
    save(options?: {}): Promise<any>;
}
export default Shrinkwrap;
//# sourceMappingURL=shrinkwrap.d.ts.map