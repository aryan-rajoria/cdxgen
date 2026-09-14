/**
 * Parser for MCPB / DXT desktop-extension bundles.
 *
 * A bundle is a zip archive carrying a local MCP server, its dependencies, and
 * a `manifest.json`. This parser reads only the manifest to describe the
 * bundled server, the tools/prompts it exposes, the number of precompiled
 * platform binaries, and whether it injects secret-typed configuration values
 * as environment variables.
 *
 * @type {{id: string, patterns: string[], parse(files: string[], options?: Object): {components: Object[]}}}
 */
export declare const mcpbBundleParser: {
    id: string;
    patterns: string[];
    parse(files: string[], options?: Object): {
        components: Object[];
    };
};
//# sourceMappingURL=mcpbBundle.d.ts.map