/**
 * Create or load the in-memory Namespaces, Usages, and DataFlows models.
 *
 * Initialises each model and returns a sequelize-like handle along with the
 * model references used by evinse for persisting slice evidence.
 *
 * @returns {Promise<{ sequelize: { close: () => boolean }, Namespaces: Object, Usages: Object, DataFlows: Object }>}
 */
export declare const createOrLoad: () => Promise<{
    sequelize: {
        close: () => boolean;
    };
    Namespaces: Object;
    Usages: Object;
    DataFlows: Object;
}>;
//# sourceMappingURL=db.d.ts.map