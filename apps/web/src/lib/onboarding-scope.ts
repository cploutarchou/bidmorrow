/**
 * Client-side CPV scope-overlap guardrail (onboarding-overhaul M1, fix for
 * ux-strategy.md F15/§3.4/C2): a live, non-blocking indicator on the CPV
 * screen so a user sees the "you'll never get any matches" risk BEFORE they
 * finish the wizard, not only in the completion warning.
 *
 * The divisions below are derived from the SAME public facts already stated
 * and copy-locked in `SCOPED_COVERAGE_STATEMENT` (../copy.ts) and documented
 * in docs/ted-ingestion-scope.md `DEFAULT_INGESTION_SCOPE` (72*, 48*,
 * 79417000 -> divisions {72, 48, 79}). This is a client-side HINT only; the
 * real ingestion scope is DB-configured server-side
 * (`packages/procurement/src/scope.ts` `loadIngestionScope`) and can drift
 * from these constants if an admin reconfigures it. The server's own
 * `scopeOverlapWarning` (returned by `POST /api/org/onboarding/complete`)
 * remains the sole authority; this client hint exists purely to move the
 * warning earlier in the flow (ux-strategy.md §3.4 "Open question O2":
 * drift risk accepted for this cycle, server check is the backstop).
 */

/**
 * Public V1 default ingestion scope, in the SAME shape the server uses
 * (`DEFAULT_INGESTION_SCOPE.cpvFamilies`, packages/procurement/src/scope.ts):
 * a short entry is a family prefix, a full 8-digit entry matches exactly.
 *
 * This replaces an earlier `['72','48','79']` division list. Reducing
 * `79417000` to the division `79` made the whole of division 79 read as
 * covered, which it is not: ingestion takes that one code and nothing else
 * around it (the query builder emits `79417000`, never `79417000*`). That
 * was harmless while onboarding only offered the IT presets, whose only 79
 * code IS 79417000; it stopped being harmless the moment the sector picker
 * started offering business services, whose codes are mostly 79 and mostly
 * NOT ingested. Telling those users they were in scope would have been a
 * false promise aimed at exactly the people the picker exists to serve. */
export const DEFAULT_INGESTED_CPV_FAMILIES: readonly string[] = ['72', '48', '79417000'];

export interface CpvScopeOverlap {
  /** Total CPV codes currently selected. */
  readonly totalCount: number;
  /** How many of those codes fall within a scope division. */
  readonly inScopeCount: number;
  /** `true` when at least one selected code is in-scope. */
  readonly hasOverlap: boolean;
}

/** The CPV division (first 2 digits) a code belongs to; mirrors the
 * server's own `cpvDivisions` helper (`packages/procurement/src/score.ts`),
 * kept independent here since `apps/web` cannot depend on `packages/procurement`. */
export function cpvDivision(code: string): string {
  return code.slice(0, 2);
}

/**
 * Whether a CPV code is inside the ingestion scope, using the same
 * family-or-exact rule as the ingestion query builder: an entry shorter than
 * 8 characters is a prefix, a full 8-digit entry is exact.
 *
 * Pass the families from the scope-estimate response to follow the LIVE flag;
 * the default is only a fallback for when that has not loaded yet.
 */
export function isIngestedCpvCode(
  cpvCode: string,
  families: readonly string[] = DEFAULT_INGESTED_CPV_FAMILIES,
): boolean {
  return families.some((entry) =>
    entry.length >= 8 ? cpvCode === entry : cpvCode.startsWith(entry),
  );
}

/** Computes the live scope-overlap indicator shown on the CPV screen. */
export function computeCpvScopeOverlap(
  cpvCodes: readonly string[],
  scopeFamilies: readonly string[] = DEFAULT_INGESTED_CPV_FAMILIES,
): CpvScopeOverlap {
  const inScopeCount = cpvCodes.filter((code) => isIngestedCpvCode(code, scopeFamilies)).length;
  return {
    totalCount: cpvCodes.length,
    inScopeCount,
    hasOverlap: inScopeCount > 0,
  };
}
