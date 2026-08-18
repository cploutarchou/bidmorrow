/**
 * Exact-match confirmation helper for the admin "type the action name"
 * friction gate (apps/worker/src/routes/admin.ts CONFIRMATION PATTERN doc
 * comment: not a security boundary, just makes an admin's own mistake
 * harder). Pure so it is unit-testable without a DOM harness — every admin
 * mutation button disables itself until `confirmationMatches` is true.
 */
export function confirmationMatches(expected: string, typed: string): boolean {
  return typed === expected;
}
