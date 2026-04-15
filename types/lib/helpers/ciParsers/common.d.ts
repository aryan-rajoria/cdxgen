/**
 * Ensure all step objects in the array are unique (CycloneDX `uniqueItems: true`).
 *
 * Identical steps are disambiguated by appending a ` (N)` counter to the step name.
 * The first occurrence is always left unchanged.
 *
 * @param {Object[]} steps
 * @returns {Object[]|undefined}
 */
export function disambiguateSteps(steps: Object[]): Object[] | undefined;
//# sourceMappingURL=common.d.ts.map