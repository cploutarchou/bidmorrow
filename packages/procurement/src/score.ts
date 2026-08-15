/**
 * Scoring orchestration: composes `@bidmorrow/matching`'s pure engine with
 * `@bidmorrow/db` repositories and `scoring-input.ts`'s mapper into a
 * bounded, idempotent (or hard-replacing, for corrections) org×lot scoring
 * pass. docs/matching-engine.md and docs/cost-model.md (CPV pre-filter
 * rationale) are the contract.
 */
import type { Logger } from '@bidmorrow/observability';
import type { Db, MatchComponentKey, MatchRiskFlagInput, TenderMatchInput } from '@bidmorrow/db';
import {
  insertTenderMatches,
  listOrgsEligibleForScoring,
  loadLotScoringBundlesByIds,
  loadLotScoringBundlesForNotices,
  recordError,
  replaceTenderMatches,
} from '@bidmorrow/db';
import type { LotScoringBundle } from '@bidmorrow/db';
import type { MatchClassification } from '@bidmorrow/domain';
import { ENGINE_VERSION, scoreLotForOrg } from '@bidmorrow/matching';
import type { ComponentResult, MatchComponentId, OrgProfile, RiskFlag } from '@bidmorrow/matching';

import { loadOrgProfile, mapLotToEngineInput } from './scoring-input';

/**
 * Hard cap on org×lot pairs CONSIDERED (before the CPV pre-filter, which is
 * the actual cost-cutter — docs/cost-model.md: the pre-filter removes ≥80%
 * of pairs) in one invocation. When exceeded the run stops and reports
 * `truncated: true`; the caller (worker queue consumer) enqueues a
 * continuation message for the remaining lots rather than ever blocking an
 * interactive request or a single invocation running unbounded.
 */
export const MAX_PAIRS_PER_INVOCATION = 5_000;

/** docs/matching-engine.md component-persistence rule: only these classifications get component/risk-flag rows. */
const CLASSIFICATIONS_WITH_COMPONENTS: readonly MatchClassification[] = [
  'STRONG_MATCH',
  'WORTH_REVIEWING',
  'POSSIBLE_MATCH',
];

/** Engine component keys that don't spell the same as the DB's `match_components.component_key` CHECK vocabulary. */
const COMPONENT_KEY_TO_DB: Record<MatchComponentId, MatchComponentKey> = {
  cpv: 'cpv',
  capability: 'capability',
  geography: 'geography',
  value: 'value',
  buyer: 'buyer',
  procedure: 'procedure_nature',
  deadline: 'deadline',
  eligibility: 'eligibility',
};

export interface ScoreLotsDeps {
  readonly db: Db;
  readonly logger: Logger;
  /** Injected clock (test seam; also used as `scoredAt`/deadline-runway reference) — defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface ScoreLotsArgs {
  /** Score exactly these lots (fresh-ingestion path). Mutually exclusive with `noticeIds`. */
  readonly lotIds?: readonly string[];
  /** Score the CURRENT-version lots of these notices (correction-recompute path). Mutually exclusive with `lotIds`. */
  readonly noticeIds?: readonly string[];
  readonly engineVersion?: string;
  /**
   * True for the correction-recompute path: uses `replaceTenderMatches`
   * (hard replace) instead of `insertTenderMatches` (idempotent
   * skip-if-exists) — a corrected notice's re-score must always win over a
   * stale pre-correction row.
   */
  readonly recompute?: boolean;
  /**
   * When this scoring pass runs inside an ingestion run (the normal
   * post-ingestion path), a `score`-stage `ingestion_errors` row is
   * recorded for lots with no main CPV. `ingestion_errors.ingestion_run_id`
   * is NOT NULL (docs/data-model.md §5), so without a run id (the future
   * admin-triggered bounded recompute — Phase 10) the same condition is
   * logged only, never silently dropped.
   */
  readonly ingestionRunId?: string;
}

export interface ScoreLotsResult {
  readonly pairsConsidered: number;
  /** Pairs that passed the CPV division pre-filter and were actually scored. */
  readonly pairsScored: number;
  readonly matchesWritten: number;
  readonly matchesSkipped: number;
  /** True when `MAX_PAIRS_PER_INVOCATION` was hit — caller must enqueue a continuation. */
  readonly truncated: boolean;
}

/** CPV division = first 2 digits of an 8-digit CPV code. */
function cpvDivisions(codes: readonly string[]): Set<string> {
  return new Set(codes.map((code) => code.slice(0, 2)).filter((division) => division.length === 2));
}

function intersects<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function toComponentInputs(components: readonly ComponentResult[]): {
  componentKey: MatchComponentKey;
  points: number;
  maxPoints: number;
  status: ComponentResult['status'];
  explanation: string;
}[] {
  return components.map((component) => ({
    componentKey: COMPONENT_KEY_TO_DB[component.key],
    points: component.points,
    maxPoints: component.maxPoints,
    status: component.status,
    explanation: component.explanation,
  }));
}

function toRiskFlagInputs(flags: readonly RiskFlag[]): MatchRiskFlagInput[] {
  return flags.map((flag) => ({
    type: flag.type,
    evidence: flag.evidence,
    sourceField: flag.sourceField,
    confidence: flag.confidence,
    explanation: flag.explanation,
  }));
}

/**
 * Runs the deterministic matching engine over org×lot pairs and persists
 * results per the component-persistence rule (docs/matching-engine.md):
 * EXCLUDED rows carry only the firing rule + evidence (no component rows);
 * scored rows ≥ POSSIBLE_MATCH carry full components + risk flags; LOW_FIT
 * rows carry only the total score + classification. Pairs whose lot CPV
 * divisions don't intersect the org's CPV-preference divisions are skipped
 * entirely — no match row is ever written for a pre-filtered-out pair
 * (docs/cost-model.md: this removes ≥80% of org×lot pairs before any
 * per-pair work happens).
 */
export async function scoreLotsForOrgs(
  deps: ScoreLotsDeps,
  args: ScoreLotsArgs,
): Promise<ScoreLotsResult> {
  const engineVersion = args.engineVersion ?? ENGINE_VERSION;
  const now = deps.now ?? Date.now;

  const lotBundles: LotScoringBundle[] =
    args.lotIds !== undefined
      ? await loadLotScoringBundlesByIds(deps.db, args.lotIds)
      : args.noticeIds !== undefined
        ? await loadLotScoringBundlesForNotices(deps.db, args.noticeIds)
        : [];

  const orgIds = await listOrgsEligibleForScoring(deps.db);
  const orgs = await Promise.all(
    orgIds.map(async (organizationId) => ({
      organizationId,
      profile: await loadOrgProfile(deps.db, organizationId),
    })),
  );
  const orgsWithDivisions = orgs.map((org) => ({
    ...org,
    divisions: cpvDivisions(org.profile.cpvPreferences),
  }));

  let pairsConsidered = 0;
  let pairsScored = 0;
  let matchesWritten = 0;
  let matchesSkipped = 0;
  let truncated = false;

  outer: for (const bundle of lotBundles) {
    const mapped = await mapLotToEngineInput(deps.db, bundle, now());
    if (mapped.kind === 'missing_main_cpv') {
      const message = `lot ${bundle.lot.id} has no main CPV code — cannot be scored`;
      if (args.ingestionRunId !== undefined) {
        await recordError(deps.db, {
          ingestionRunId: args.ingestionRunId,
          source: 'ted',
          sourceNoticeId: bundle.noticeId,
          stage: 'score',
          errorCode: 'MISSING_CPV',
          message,
        });
      } else {
        deps.logger.error('scoring.missing_main_cpv', {
          lot_id: bundle.lot.id,
          notice_id: bundle.noticeId,
        });
      }
      continue;
    }
    const lotDivisions = cpvDivisions([mapped.lot.cpv.main, ...mapped.lot.cpv.additional]);

    for (const org of orgsWithDivisions) {
      pairsConsidered += 1;
      if (pairsConsidered > MAX_PAIRS_PER_INVOCATION) {
        truncated = true;
        break outer;
      }
      // CPV division pre-filter: disjoint divisions -> skip entirely, no
      // match row of any kind (including EXCLUDED) is ever written for this
      // pair — it simply has no row.
      if (!intersects(lotDivisions, org.divisions)) {
        continue;
      }
      pairsScored += 1;

      const matchInput = scoreOnePair(
        org.profile,
        mapped.lot,
        bundle,
        engineVersion,
        now(),
        mapped.rateDate,
      );

      if (args.recompute === true) {
        const result = await replaceTenderMatches(deps.db, org.organizationId, {
          lotIds: [bundle.lot.id],
          engineVersion,
          matches: [matchInput],
        });
        matchesWritten += result.inserted;
      } else {
        const result = await insertTenderMatches(deps.db, org.organizationId, {
          matches: [matchInput],
        });
        matchesWritten += result.inserted;
        matchesSkipped += result.skipped;
      }
    }
  }

  deps.logger.info('scoring.run.completed', {
    pairs_considered: pairsConsidered,
    pairs_scored: pairsScored,
    matches_written: matchesWritten,
    matches_skipped: matchesSkipped,
    truncated,
    engine_version: engineVersion,
    recompute: args.recompute === true,
  });

  return { pairsConsidered, pairsScored, matchesWritten, matchesSkipped, truncated };
}

function scoreOnePair(
  orgProfile: OrgProfile,
  lot: import('@bidmorrow/matching').LotInput,
  bundle: LotScoringBundle,
  engineVersion: string,
  scoringTime: number,
  rateDate: string | null,
): TenderMatchInput {
  const result = scoreLotForOrg({ org: orgProfile, lot, scoringTime });

  if (result.kind === 'excluded') {
    return {
      lotId: bundle.lot.id,
      noticeId: bundle.noticeId,
      engineVersion,
      score: null,
      classification: 'EXCLUDED',
      exclusionRule: result.rule,
      exclusionEvidence: result.evidence,
      scoredAt: scoringTime,
    };
  }

  const includeBreakdown = CLASSIFICATIONS_WITH_COMPONENTS.includes(result.classification);
  const components = includeBreakdown
    ? result.components.map((component) =>
        component.key === 'value' && rateDate !== null
          ? {
              ...component,
              explanation: `${component.explanation} (≈ EUR at ECB reference rate ${rateDate}, for scoring only)`,
            }
          : component,
      )
    : [];

  return {
    lotId: bundle.lot.id,
    noticeId: bundle.noticeId,
    engineVersion,
    score: result.score,
    classification: result.classification,
    scoredAt: scoringTime,
    ...(includeBreakdown
      ? { components: toComponentInputs(components), riskFlags: toRiskFlagInputs(result.riskFlags) }
      : {}),
  };
}
