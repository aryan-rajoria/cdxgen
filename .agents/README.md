# Project Agent Customizations

This directory contains workspace configurations, instructions, and modular skills for AI coding agents (such as Antigravity, Claude Code, and other ACS-compatible tools) interacting with the `cdxgen` repository.

## Naming Conventions

- Custom workspace rules and overall guide rules are appended to [AGENTS.md](../AGENTS.md) in the root.
- Specialized capabilities are defined under `skills/<skill_name>/` containing a `SKILL.md` file (which includes trigger YAML frontmatter and instruction steps).

---

## Skills Index

| Skill Name      | Trigger / Purpose                                                                                                                             | Path                                                                                                         |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **BOM Slimmer** | Guide the review and lightweight replacement of direct dependencies using SBOM data, occurrences/callstack profiling, and license evaluation. | [`skills/bom-slimmer/SKILL.md`](file:///Users/prabhu/work/cdxgen/cdxgen/.agents/skills/bom-slimmer/SKILL.md) |
