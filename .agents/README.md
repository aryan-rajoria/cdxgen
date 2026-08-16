# Project Agent Customizations

This directory contains workspace configurations, instructions, and modular skills for AI coding agents (such as Antigravity, Claude Code, and other ACS-compatible tools) interacting with the `cdxgen` repository.

## Naming Conventions

- Custom workspace rules and overall guide rules are appended to [AGENTS.md](../AGENTS.md) in the root.
- Specialized capabilities are defined under `skills/<skill_name>/` containing a `SKILL.md` file (which includes trigger YAML frontmatter and instruction steps).

---

## Skills Index

Skills follow the [Agent Skills](https://agentskills.io/specification) open standard: one directory per skill under `skills/<skill-name>/`, each containing a `SKILL.md` file with `name` and `description` YAML frontmatter. These are discovered by Agent Skills-compatible tools (GitHub Copilot, opencode, Claude Code, and others) from `.agents/skills/`.

| Skill Name | Trigger / Purpose | Path |
| :--- | :--- | :--- |
| **BOM Slimmer** | Guide the review and lightweight replacement of direct dependencies using SBOM data, occurrences/callstack profiling, and license evaluation. | [`skills/bom-slimmer/SKILL.md`](skills/bom-slimmer/SKILL.md) |
| **CycloneDX Spec Reviewer** | Review changes for CycloneDX schema compliance, semantic correctness, and unnecessary custom properties, including AI-BOM modeling. | [`skills/cyclonedx-spec-reviewer/SKILL.md`](skills/cyclonedx-spec-reviewer/SKILL.md) |
| **Ecosystem Onboarding** | Add support for a new language, package manager, or lockfile format: aliases, parsers, dispatch, purls, fixtures, tests, and docs. | [`skills/ecosystem-onboarding/SKILL.md`](skills/ecosystem-onboarding/SKILL.md) |
| **Custom Property Author** | Define and emit new `cdx:` properties safely: naming, value hygiene, and the `docs/CUSTOM_PROPERTIES.md` documentation gate. | [`skills/custom-property-author/SKILL.md`](skills/custom-property-author/SKILL.md) |
