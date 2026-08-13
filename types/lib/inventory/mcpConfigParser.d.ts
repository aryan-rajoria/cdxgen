/**
 * Parser for MCP (Model Context Protocol) client configuration files.
 *
 * Matches common MCP config file names (`.mcp.json`, `mcp.json`,
 * `claude_desktop_config.json`, `opencode.json[c]`, and editor-specific
 * variants) and converts each configured server into a CycloneDX service plus
 * a file component carrying credential-exposure, hidden-unicode, and transport
 * properties.
 *
 * @type {{id: string, patterns: string[], parse(files: string[], options?: Object): {components: Object[], services: Object[]}}}
 */
export declare const mcpConfigParser: {
    id: string;
    patterns: string[];
    parse(files: string[], options?: Object): {
        components: Object[];
        services: Object[];
    };
};
//# sourceMappingURL=mcpConfigParser.d.ts.map