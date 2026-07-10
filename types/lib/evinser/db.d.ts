declare class Model {
    tableName: any;
    store: Map<any, any>;
    constructor(tableName: any);
    init(): Promise<void>;
    findByPk(purl: any): Promise<{
        purl: any;
        data: any;
        createdAt: any;
        updatedAt: any;
    } | null>;
    findOrCreate(options: any): Promise<(boolean | {
        purl: any;
        data: any;
        createdAt: any;
        updatedAt: any;
    })[]>;
    findAll(options: any): Promise<{
        purl: any;
        data: any;
        createdAt: any;
        updatedAt: any;
    }[]>;
}
export declare const createOrLoad: () => Promise<{
    sequelize: {
        close: () => boolean;
    };
    Namespaces: Model;
    Usages: Model;
    DataFlows: Model;
}>;
export {};
//# sourceMappingURL=db.d.ts.map