/**
 * Render rows as a bordered text table.
 *
 * @param {Array[]} rows Table rows
 * @param {Object} [config={}] Table configuration (header, columns, border style)
 * @returns {string} Rendered table, or an empty string when there are no rows
 */
export declare function table(rows: any[][], config?: Object): string;
/**
 * Create a streaming table writer that renders rows to stdout incrementally.
 *
 * @param {Object} [config={}] Table configuration (header, columns, border style)
 * @returns {{write(row: *): void, end(): void}} Writer whose `end()` emits the bottom border
 */
export declare function createStream(config?: Object): {
    write(row: any): void;
    end(): void;
};
//# sourceMappingURL=table.d.ts.map