/**
 * Load and validate rules from a directory of YAML files
 * @param {string} rulesDir - Path to directory containing .yaml rule files
 * @returns {Promise<Array>} Array of parsed rule objects
 */
export function loadRules(rulesDir: string): Promise<any[]>;
/**
 * Evaluate a single rule against the BOM using JSONata
 * @param {Object} rule - Parsed rule object
 * @param {Object} bomJson - Full CycloneDX BOM object
 * @returns {Promise<Array>} Array of matched findings
 */
export function evaluateRule(rule: Object, bomJson: Object): Promise<any[]>;
/**
 * Evaluate all rules against a BOM
 */
export function evaluateRules(rules: any, bomJson: any): Promise<any[]>;
//# sourceMappingURL=ruleEngine.d.ts.map