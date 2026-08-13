/**
 * Parser for Rust/Cargo and Pixi maturin formulation components.
 *
 * Matches `Cargo.toml` and `pyproject.toml` files and converts them into
 * formulation components carrying build-tool, build-script capability, native
 * build dependency, and maturin metadata properties.
 *
 * @type {{id: string, patterns: string[], parse(files: string[]): {components: Object[]}}}
 */
export declare const rustFormulationParser: {
    id: string;
    patterns: string[];
    parse(files: string[]): {
        components: Object[];
    };
};
//# sourceMappingURL=rustFormulationParser.d.ts.map