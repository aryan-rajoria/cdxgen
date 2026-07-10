import Node from "./node.js";
declare const _loadDeps: unique symbol;
declare class Link extends Node {
    isStoreLink: any;
    constructor(options: any);
    get version(): any;
    get target(): any;
    set target(target: any);
    get resolved(): string | null;
    set resolved(_r: string | null);
    [_loadDeps](): void;
    get children(): Map<any, any>;
    set children(_c: Map<any, any>);
    get isLink(): boolean;
}
export default Link;
//# sourceMappingURL=link.d.ts.map