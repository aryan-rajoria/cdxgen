/**
 * Shared severity ordering for finding and confidence ladders.
 *
 * Lives in the core layer so modules below the audit layer can order labels
 * such as `low`/`medium`/`high` without importing the audit package; the audit
 * scoring module re-exports this constant under its historical name.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const SEVERITY_ORDER = Object.freeze({
  none: -1,
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});
