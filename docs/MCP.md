# MCP inventory for JavaScript and dedicated MCP project scans

cdxgen can catalog Model Context Protocol (MCP) server surfaces from JavaScript and TypeScript source trees during normal `-t js` analysis, or via the dedicated `-t mcp` project type.

By default, `-t js` now also reports shipped MCP configuration files and AI instruction/skill files that can influence build and post-build lifecycles. Use:

- `--exclude-type mcp` to drop the MCP inventory overlay — config file components, discovered services, and MCP primitives (tools/prompts/resources) — from the final BOM. Genuine MCP **SDK dependency packages** (for example `@modelcontextprotocol/*`, PyPI `mcp`, `io.modelcontextprotocol.sdk`) are real supply-chain components and are always retained.
- `--exclude-type ai-skill` to drop AI skill / instruction inventory from the final BOM
- `-t mcp` for an exact MCP-focused BOM. This includes the SDK packages, discovered services, primitives, and MCP config files (for example `.vscode/mcp.json`); `--type mcp` and `--exclude-type mcp` cover the same set of subjects so the two flags stay in lockstep.
- `-t ai-skill` for an exact AI skill / instruction BOM

## What cdxgen detects

For high-confidence JavaScript MCP patterns, cdxgen emits:

- **components** for well-known MCP SDK packages such as `@modelcontextprotocol/*`
- **services** for discovered MCP servers
- **synthetic components** for MCP primitives exposed by those servers:
  - tools
  - prompts
  - resources
  - resource templates
- **dependency/provides links** from the server service to the primitive components it exposes

## Current detection scope

- official and non-official MCP SDK imports
- `McpServer`-style server construction
- `Client`-style MCP client construction
- stdio and Streamable HTTP transports
- MCP tool / prompt / resource registration calls
- prompt / tool / resource client usage call sites
- explicit capability declarations
- authentication helpers for HTTP MCP servers
- OAuth metadata literals and MCP auth-discovery wiring
- explicit provider and model literals such as `provider`, `providerName`, `model`, and `modelName`
- provider SDK imports, outbound provider hosts, and MCP gateway patterns
- AI agent instruction files that reference hidden MCP endpoints or wrappers
- MCP client configuration files such as `.vscode/mcp.json`, `.mcp.json`, `claude_desktop_config.json`, and `opencode.json`
- community agent tooling layouts such as OpenCode (`opencode.json`, `.opencode/agents`, `.opencode/tools`, `.opencode/skills`), Nanocoder (`.mcp.json`, `.nanocoder/agents`, `.nanocoder/commands`), LangGraph (`langgraph.json`), and common CrewAI project files (`agents.py`, `tasks.py`, `config/agents.yaml`, `config/tasks.yaml`)
- config-derived auth posture, trust profile, dynamic client registration, and inline credential exposure

The analysis is intentionally conservative. cdxgen prefers literal, explainable signals over speculative reconstruction.

## Key emitted properties

### MCP package components

- `cdx:mcp:package=true`
- `cdx:mcp:official=true|false`
- `cdx:mcp:role=server-sdk|client-sdk|transport-sdk|sdk|integration`
- `cdx:mcp:catalogSource=official-sdk|known-integration|heuristic`

### MCP server and configured services

- `cdx:mcp:serviceType=server|client|gateway|endpoint|inferred-endpoint|configured-server`
- `cdx:mcp:transport=stdio|streamable-http|sse`
- `cdx:mcp:officialSdk=true|false`
- `cdx:mcp:capabilities:*`
- `cdx:mcp:toolCount`
- `cdx:mcp:promptCount`
- `cdx:mcp:resourceCount`
- `cdx:mcp:sdkImports`
- `cdx:mcp:modelNames`
- `cdx:mcp:modelFamilies`
- `cdx:mcp:providerNames`
- `cdx:mcp:providerFamilies`
- `cdx:mcp:outboundHosts`
- `cdx:mcp:usageSignals`
- `cdx:mcp:usageConfidence`
- `cdx:mcp:inventorySource`
- `cdx:mcp:exposureType`
- `cdx:mcp:configFormat`
- `cdx:mcp:configKey`
- `cdx:mcp:command`
- `cdx:mcp:packageRefs`
- `cdx:mcp:authPosture`
- `cdx:mcp:trustProfile`
- `cdx:mcp:credentialExposure`
- `cdx:mcp:credentialExposureFieldCount`
- `cdx:mcp:credentialIndicatorCount`
- `cdx:mcp:credentialReferenceCount`
- `cdx:mcp:credentialExposedServiceCount` (for config file components)
- `cdx:mcp:security:confusedDeputyRisk`
- `cdx:mcp:security:tokenPassthroughRisk`
- `cdx:mcp:reviewNeeded`
- `cdx:mcp:auth:*`

### MCP primitive components

- `cdx:mcp:role=tool|prompt|resource|resource-template`
- `cdx:mcp:serviceRef=<service bom-ref>`
- `cdx:mcp:description`
- `cdx:mcp:resourceUri`
- `cdx:mcp:toolAnnotations`

### Community agent/tool/skill components

- `cdx:agent:framework=opencode|nanocoder|langgraph|crewai`
- `cdx:agent:inventorySource=community-config`
- `cdx:agent:description`
- `cdx:agent:mode`
- `cdx:agent:model`
- `cdx:tool:description`
- `cdx:tool:category`
- `cdx:tool:tags`
- `cdx:tool:triggers`
- `cdx:skill:name`
- `cdx:skill:description`
- `cdx:skill:license`
- `cdx:langgraph:graphEntryPoint`
- `cdx:crewai:*`

## Example

```bash
cdxgen -t mcp /path/to/mcp-server -o bom.json --bom-audit --bom-audit-categories mcp-server
```

Things to inspect in the resulting BOM:

- `.services[]` for discovered MCP servers
- `.components[] | select(.properties[]?.name == "cdx:file:kind" and .properties[]?.value == "mcp-config")` for shipped MCP config files
- `.components[] | select(.properties[]?.name == "cdx:file:kind" and (.properties[]?.value == "agent-instructions" or .properties[]?.value == "skill-file"))` for shipped AI instruction/skill files
- `.components[] | select(.properties[]?.name == "cdx:mcp:role")` for tools/prompts/resources
- `.dependencies[] | select(.ref | startswith("urn:service:mcp:"))` for service-to-primitive links
- `.annotations[]` for MCP BOM-audit findings

## Security notes

The most important current security checks are:

- unauthenticated Streamable HTTP MCP servers
- unauthenticated MCP tool exposure
- network-exposed servers built on non-official MCP SDKs or wrappers
- networked MCP endpoints discovered only from configuration files
- inline credentials or token-forwarding settings in MCP configs
- dynamic client registration paired with static client identities in MCP configs
- public or tunneled MCP endpoints referenced only from AI agent files
- hidden Unicode in AI agent instruction and skill files
- agent-file MCP references that are not otherwise declared in package or source inventory
- build/post-build BOMs that contain shipped MCP configs or AI instruction/skill files

## Recommended release-review commands

Keep and flag the files:

```bash
cdxgen -t js \
  --bom-audit \
  --bom-audit-categories mcp-server,ai-agent \
  --tlp-classification AMBER \
  -o bom.json \
  /path/to/repo
```

Drop them for a package-only SBOM:

```bash
cdxgen -t js \
  --exclude-type ai-skill \
  --exclude-type mcp \
  -o bom.json \
  /path/to/repo
```

HTTP MCP endpoints should be authenticated, Origin-validated, and pinned to trusted SDK provenance before external exposure.

## Known limits

- the current implementation is strongest for literal ESM/CJS patterns and explicit object literals
- dynamically generated tool names, endpoints, or capability objects may be missed
- provider/model detection is best-effort and only records explicit literals
- stdio servers are inventoried, but HTTP-centric auth rules intentionally focus on network-exposed servers

## Gap analysis: server pinning, transport, and composition

This section records the gap between the current MCP inventory and what an
Agent BOM needs, and what cdxgen does about it. The CycloneDX working group's
agent-BOM proposal is still an open discussion (the `#895` reference in earlier
planning does not resolve to a published, ratified standard), so every new
field below is **experimental, off by default, and namespaced under `cdx:mcp:`**
so migration is mechanical when a standard lands.

### Relationship to `-t ai-provenance`

`-t ai-provenance` (aliases `ai-authorship`, `aicode`, `ai-codegen`) is a
distinct concern: it is an opt-in **generation-time property injector** that
runs `collectAiProvenance` / `collectAiOversight` over git history and CI
config and writes `cdx:ai:codegen:*` / `cdx:ai:oversight:*` to the document
root. It does not inventory MCP servers. The MCP inventory itself is produced
by the `mcp` / `js` / `python` project types via `lib/inventory/mcp*.js` and
`lib/inventory/analyzer.js`. The work below extends that inventory; it does not
change what `-t ai-provenance` emits.

### What already works

- **Local npm-package MCP servers are not opaque.** A server shipped as an npm
  package is produced by the normal language pipeline as one `library` component
  per installed package (server plus each transitive), each carrying its own
  purl and ssri integrity from the lockfile. Transitive dependencies are
  therefore already resolved. `enrichComponentWithMcpMetadata` only adds the
  `cdx:mcp:package` / `cdx:mcp:role` tags on top.
- **Transport and exposure are recorded for discovered _services_.** Config-file
  servers (`mcpConfigParser`) and source-code servers (`analyzer`) emit
  `cdx:mcp:transport` (`stdio` / `sse` / `streamable-http` / `websocket`) and
  `cdx:mcp:exposureType` (`local-only` / `networked-public`).

### The two real gaps

1. **Pinning is decorative without an explicit pinning state.** A package
   component may carry a hash, but nothing says _whether_ a given MCP server is
   pinned, and an unpinned or unhashable server can serialize identically to a
   pinned one. A remote server discovered only as a service has no package
   component and therefore no hash at all, yet nothing records that absence.
2. **Transport is not recorded on package components.** `mcp.js` stamps a _role_
   (`server-sdk`, `client-sdk`, `transport-sdk`, …) but never the transport
   mechanism, so a package-typed server cannot be distinguished from a
   transport-layer library without reading the service inventory.

### What cdxgen does about it (experimental)

Behind `--experimental-mcp-pinning` (or `CDXGEN_EXPERIMENTAL_MCP_PINNING=true`),
off by default:

- For every component tagged `cdx:mcp:package`, cdxgen records an explicit
  `cdx:mcp:pinning` property:
  - `pinned` when the component carries a `hashes[]` entry (or an ssri
    `_integrity` that `processHashes` converts),
  - `unpinned` when the component is a package but has no hash,
  - `unhashable` for servers discovered only as services with no resolvable
    package.
    Absence is never implied: an unhashable server is labelled, not left blank.
- One CycloneDX 1.7 citation covers every pinned package, recording that the
  integrity values came from the package registry. It is attributed to the
  cdxgen tool component, the only object in the BOM that can carry the claim;
  in a document with no cdxgen tool component the citation is omitted rather
  than pointed at an invented reference.
- Remote servers (no local package) additionally get
  `cdx:mcp:composition=unknown`, so a consumer never mistakes a
  composition-unknown remote for a fully-resolved local package.
- Package-typed servers that can be linked to a discovered service inherit the
  service's `cdx:mcp:transport`.

These properties are subject to change and will be renamed or removed to match
the eventual standard.
