/**
 * Validate a package name.
 *
 * @param {*} name Candidate package name
 * @returns {{validForNewPackages: boolean, validForOldPackages: boolean, warnings?: string[], errors?: string[]}}
 */
export default function validate(name: any): {
    validForNewPackages: boolean;
    validForOldPackages: boolean;
    warnings?: string[];
    errors?: string[];
};
//# sourceMappingURL=validate-npm-package-name.d.ts.map