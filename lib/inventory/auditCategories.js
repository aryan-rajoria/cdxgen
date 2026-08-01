import { shouldRunPredictiveBomAudit } from "../core/env.js";

export const HBOM_AUDIT_CATEGORIES = Object.freeze([
  "hbom-security",
  "hbom-performance",
  "hbom-compliance",
]);

export const CBOM_AUDIT_CATEGORIES = Object.freeze([
  "cbom-security",
  "cbom-compliance",
]);

export const HOST_TOPOLOGY_AUDIT_CATEGORIES = Object.freeze(["host-topology"]);

export const GOLEM_AUDIT_CATEGORIES = Object.freeze([
  "golem-security",
  "golem-performance",
  "golem-compliance",
]);

export const AI_BOM_AUDIT_CATEGORIES = Object.freeze([
  "ai-governance",
  "ai-security",
  "ai-performance",
]);

export const DEFAULT_HBOM_AUDIT_CATEGORIES = HBOM_AUDIT_CATEGORIES.join(",");

export const BOM_AUDIT_CATEGORY_ALIASES = Object.freeze({
  "ai-inventory": ["ai-agent", "mcp-server"],
  aibom: [...AI_BOM_AUDIT_CATEGORIES, "ai-agent", "mcp-server"],
  "ai-bom": [...AI_BOM_AUDIT_CATEGORIES, "ai-agent", "mcp-server"],
  "ai-provenance": ["ai-provenance", "ai-oversight"],
  "ai-oversight": ["ai-oversight"],
  cbom: [...CBOM_AUDIT_CATEGORIES],
  "crypto-bom": [...CBOM_AUDIT_CATEGORIES],
  golem: [...GOLEM_AUDIT_CATEGORIES],
  hbom: [...HBOM_AUDIT_CATEGORIES],
  host: [...HBOM_AUDIT_CATEGORIES, ...HOST_TOPOLOGY_AUDIT_CATEGORIES],
});

function uniqueNonEmptyCategories(categories) {
  return [...new Set((categories || []).filter(Boolean))];
}

export function normalizeBomAuditCategories(categories) {
  if (Array.isArray(categories)) {
    return uniqueNonEmptyCategories(
      categories.map((category) => String(category).trim()).filter(Boolean),
    );
  }
  if (typeof categories !== "string") {
    return [];
  }
  return uniqueNonEmptyCategories(
    categories
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean),
  );
}

export function expandBomAuditCategories(categories) {
  const normalizedCategories = normalizeBomAuditCategories(categories);
  const expandedCategories = [];
  for (const category of normalizedCategories) {
    if (BOM_AUDIT_CATEGORY_ALIASES[category]?.length) {
      expandedCategories.push(...BOM_AUDIT_CATEGORY_ALIASES[category]);
      continue;
    }
    expandedCategories.push(category);
  }
  return uniqueNonEmptyCategories(expandedCategories);
}

export function availableBomAuditCategories(rules) {
  return uniqueNonEmptyCategories(
    (rules || []).map((rule) => rule?.category).filter(Boolean),
  ).sort();
}

function formatBomAuditCategoryOption(category) {
  const aliasedCategories = BOM_AUDIT_CATEGORY_ALIASES[category];
  if (!aliasedCategories?.length) {
    return category;
  }
  return `${category} (alias for ${aliasedCategories.join(",")})`;
}

export function validateBomAuditCategories(categories, rules) {
  const normalizedCategories = normalizeBomAuditCategories(categories);
  const validCategories = availableBomAuditCategories(rules);
  const allowedCategories = new Set([
    ...validCategories,
    ...Object.keys(BOM_AUDIT_CATEGORY_ALIASES),
  ]);
  const invalidCategories = normalizedCategories.filter(
    (category) => !allowedCategories.has(category),
  );
  if (invalidCategories.length) {
    const validCategoryOptions = [...allowedCategories]
      .sort()
      .map((category) => formatBomAuditCategoryOption(category));
    throw new Error(
      `Unknown BOM audit categor${invalidCategories.length === 1 ? "y" : "ies"}: ${invalidCategories.join(", ")}. Valid categories: ${validCategoryOptions.join(", ")}.`,
    );
  }
  return {
    categories: normalizedCategories,
    expandedCategories: expandBomAuditCategories(normalizedCategories),
    validCategories,
  };
}

/**
 * Determine the default BOM audit categories for the current CLI invocation.
 *
 * OBOM-focused runs should default to the runtime-specific rule pack unless the
 * user explicitly requests other categories.
 *
 * @param {object} options CLI options
 * @param {string} [commandPath] Invoked command path or name
 * @returns {string | undefined} Default category string, if any
 */
export function getDefaultBomAuditCategories(options, commandPath) {
  const normalizedCommandPath = `${commandPath || ""}`.toLowerCase();
  const defaultHbomCategories = options?.includeRuntime
    ? `${DEFAULT_HBOM_AUDIT_CATEGORIES},host-topology`
    : DEFAULT_HBOM_AUDIT_CATEGORIES;
  if (normalizedCommandPath.includes("hbom")) {
    return defaultHbomCategories;
  }
  const projectTypes = Array.isArray(options?.projectType)
    ? options.projectType
    : typeof options?.projectType === "string"
      ? options.projectType.split(",")
      : [];
  const normalizedProjectTypes = projectTypes
    .map((projectType) => `${projectType || ""}`.trim().toLowerCase())
    .filter(Boolean);
  if (
    normalizedProjectTypes.length &&
    normalizedProjectTypes.every((projectType) =>
      ["hbom", "hardware"].includes(projectType),
    )
  ) {
    return defaultHbomCategories;
  }
  if (!shouldRunPredictiveBomAudit(options, commandPath)) {
    return "obom-runtime";
  }
  return undefined;
}
