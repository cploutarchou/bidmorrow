/**
 * Client-side CPV scope-overlap guardrail (onboarding-overhaul M1, fix for
 * ux-strategy.md F15/§3.4/C2): a live, non-blocking indicator on the CPV
 * screen so a user sees the "you'll never get any matches" risk BEFORE they
 * finish the wizard, not only in the completion warning.
 *
 * The divisions below are derived from the SAME public facts already stated
 * and copy-locked in `SCOPED_COVERAGE_STATEMENT` (../copy.ts) and documented
 * in docs/ted-ingestion-scope.md `DEFAULT_INGESTION_SCOPE` (72*, 48*,
 * 79417000 -> divisions {72, 48, 79}). This is a client-side HINT only — the
 * real ingestion scope is DB-configured server-side
 * (`packages/procurement/src/scope.ts` `loadIngestionScope`) and can drift
 * from these constants if an admin reconfigures it. The server's own
 * `scopeOverlapWarning` (returned by `POST /api/org/onboarding/complete`)
 * remains the sole authority; this client hint exists purely to move the
 * warning earlier in the flow (ux-strategy.md §3.4 "Open question O2" —
 * drift risk accepted for this cycle, server check is the backstop).
 */

/** Public V1 default ingestion-scope CPV divisions (first 2 digits). */
export const DEFAULT_SCOPE_DIVISIONS: readonly string[] = ['72', '48', '79'];

export interface CpvScopeOverlap {
  /** Total CPV codes currently selected. */
  readonly totalCount: number;
  /** How many of those codes fall within a scope division. */
  readonly inScopeCount: number;
  /** `true` when at least one selected code is in-scope. */
  readonly hasOverlap: boolean;
}

/** The CPV division (first 2 digits) a code belongs to — mirrors the
 * server's own `cpvDivisions` helper (`packages/procurement/src/score.ts`),
 * kept independent here since `apps/web` cannot depend on `packages/procurement`. */
export function cpvDivision(code: string): string {
  return code.slice(0, 2);
}

/** Computes the live scope-overlap indicator shown on the CPV screen. */
export function computeCpvScopeOverlap(
  cpvCodes: readonly string[],
  scopeDivisions: readonly string[] = DEFAULT_SCOPE_DIVISIONS,
): CpvScopeOverlap {
  const divisions = new Set(scopeDivisions);
  const inScopeCount = cpvCodes.filter((code) => divisions.has(cpvDivision(code))).length;
  return {
    totalCount: cpvCodes.length,
    inScopeCount,
    hasOverlap: inScopeCount > 0,
  };
}
