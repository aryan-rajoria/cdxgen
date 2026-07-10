/**
 * Internal compliance rule catalog for cdx-validate.
 *
 * Implements OWASP SCVS (Software Component Verification Standard) controls
 * and selected EU Cyber Resilience Act (CRA) SBOM expectations as plain
 * JavaScript evaluators. Controls that are not automatable from a static
 * CycloneDX BOM (for example, process or organizational controls) are still
 * modelled so that benchmark reports can surface them as "manual review
 * required" items with a stable identifier.
 *
 * Each rule exports:
 *   id            - Stable short identifier (e.g. "SCVS-1.1").
 *   name          - Human readable short name.
 *   description   - Long description (wording taken from the source standard).
 *   standard      - Source standard key: "SCVS" or "CRA".
 *   standardRefs  - Array of canonical control identifiers.
 *   category      - Grouping used by --categories.
 *   severity      - Severity emitted for a failing automatable rule.
 *   scvsLevels    - For SCVS rules, the levels (L1/L2/L3) that require the
 *                   control. Non-SCVS rules use an empty array.
 *   automatable   - True when evaluate() returns a deterministic pass/fail
 *                   from the BOM alone. False means the rule is emitted as
 *                   severity "info" / status "manual" so downstream tooling
 *                   can track coverage.
 *   evaluate      - Function(bomJson) => RuleResult.
 *
 * RuleResult shape:
 *   {
 *     status: "pass" | "fail" | "manual",
 *     message: string,              // human readable summary
 *     mitigation?: string,
 *     locations?: Array<{ bomRef?, purl?, file? }>,
 *     evidence?: Record<string, any>
 *   }
 */
/**
 * Extract the first SPDX-ish license id from a CycloneDX component's licenses
 * block. Returns null when no license is declared.
 *
 * @param {object} comp CycloneDX component
 * @returns {string | null}
 */
declare function componentLicenseId(comp: object): string | null;
/**
 * Collect libraries/frameworks/applications worth evaluating for inventory
 * checks. Crypto-assets and data types are excluded because they are tracked
 * with different schemas in CycloneDX.
 *
 * @param {object} bomJson
 * @returns {Array<object>}
 */
declare function inventoryComponents(bomJson: object): Array<object>;
/**
 * Format a component identifier for console messages.
 *
 * @param {object} comp
 * @returns {string}
 */
declare function compLabel(comp: object): string;
/**
 * Build a Set of all bom-refs declared anywhere in the BOM so that we can
 * detect orphan components that are not reachable from the dependency tree.
 *
 * @param {object} bomJson
 * @returns {Set<string>}
 */
declare function collectReferencedRefs(bomJson: object): Set<string>;
/**
 * Validate that a license expression is syntactically a known SPDX identifier
 * or an expression built from SPDX operators. This is a best-effort check
 * that tokenises the expression first — avoiding backtracking-heavy regex
 * alternations — and then validates each token with a simple character-class
 * pattern.
 *
 * @param {string} expr
 * @returns {boolean}
 */
declare function looksLikeSpdx(expr: string): boolean;
/**
 * Returns the full catalog of compliance rules (SCVS + CRA).
 *
 * @returns {Array<object>}
 */
export declare function getAllComplianceRules(): Array<object>;
/**
 * Returns only SCVS rules.
 *
 * @returns {Array<object>}
 */
export declare function getScvsRules(): Array<object>;
/**
 * Returns only CRA rules.
 *
 * @returns {Array<object>}
 */
export declare function getCraRules(): Array<object>;
export declare const __test: {
    componentLicenseId: typeof componentLicenseId;
    inventoryComponents: typeof inventoryComponents;
    looksLikeSpdx: typeof looksLikeSpdx;
    collectReferencedRefs: typeof collectReferencedRefs;
    compLabel: typeof compLabel;
};
export {};
//# sourceMappingURL=complianceRules.d.ts.map