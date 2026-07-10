declare class CIMap extends Map {
    #private;
    constructor(items?: any[]);
    get(key: any): any;
    set(key: any, val: any): this;
    delete(key: any): boolean | undefined;
    has(key: any): boolean;
}
export default CIMap;
//# sourceMappingURL=case-insensitive-map.d.ts.map