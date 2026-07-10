declare class Inventory extends Map {
    #private;
    constructor();
    get primaryKey(): string;
    get indexes(): string[];
    filter(fn: any): Generator<any, void, unknown>;
    add(node: any): void;
    delete(node: any): void;
    query(key: any, val: any): any;
    has(node: any): boolean;
    set(): void;
}
export default Inventory;
//# sourceMappingURL=inventory.d.ts.map