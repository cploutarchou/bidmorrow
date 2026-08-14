/**
 * Matching results repository — docs/data-model.md §6 (docs/security.md C6).
 *
 * `tender_matches` is [tenant-owned]; `match_components` and
 * `match_risk_flags` inherit tenancy through `match_id`, so every read of
 * them goes through the org-checked parent match first.
 *
 * Idempotency: the unique `(organization_id, lot_id, engine_version)` makes
 * re-scoring a no-op per engine version. Each match plus its components and
 * risk flags is written in ONE D1 batch (a single SQL transaction), so a
 * match row can never exist without its decomposition.
 */
import { and, desc, eq, inArray, gte, lt, or } from 'drizzle-orm';
import type {
  ComponentStatus,
  MatchClassification,
  OrganizationId,
  RiskConfidence,
} from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { matchComponents, matchRiskFlags, tenderMatches } from '../schema/matching';
import { normalizeLimit, toBatch, toPage, type Page, type Pagination } from './shared';
import type { SqliteBatchItem } from './shared';

export type TenderMatch = typeof tenderMatches.$inferSelect;
export type MatchComponent = typeof matchComponents.$inferSelect;
export type MatchRiskFlag = typeof matchRiskFlags.$inferSelect;

export type MatchComponentKey =
  | 'cpv'
  | 'capability'
  | 'geography'
  | 'value'
  | 'buyer'
  | 'procedure_nature'
  | 'deadline'
  | 'eligibility';

export type RiskFlagType =
  | 'certification'
  | 'security_clearance'
  | 'insurance'
  | 'financial_turnover'
  | 'prior_experience'
  | 'framework_membership'
  | 'local_presence'
  | 'mandatory_references';

export interface MatchComponentInput {
  componentKey: MatchComponentKey;
  points: number;
  maxPoints: number;
  status: ComponentStatus;
  explanation: string;
}

export interface MatchRiskFlagInput {
  type: RiskFlagType;
  /** Quoted source snippet — evidence-backed only, never fabricated. */
  evidence: string;
  sourceField: string;
  confidence: RiskConfidence;
  explanation: string;
}

export interface TenderMatchInput {
  lotId: string;
  noticeId: string;
  engineVersion: string;
  /** Null when classification = EXCLUDED (no score shown). */
  score: number | null;
  classification: MatchClassification;
  exclusionRule?: string | null;
  exclusionEvidence?: string | null;
  /** Anchors deadline-runway reproducibility. */
  scoredAt: number;
  components?: MatchComponentInput[];
  riskFlags?: MatchRiskFlagInput[];
}

function isConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint|FOREIGN KEY constraint/i.test(error.message);
}

async function matchExists(
  db: Db,
  organizationId: OrganizationId,
  match: TenderMatchInput,
): Promise<boolean> {
  const rows = await db
    .select({ id: tenderMatches.id })
    .from(tenderMatches)
    .where(
      and(
        eq(tenderMatches.organizationId, organizationId),
        eq(tenderMatches.lotId, match.lotId),
        eq(tenderMatches.engineVersion, match.engineVersion),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Inserts scored matches with their components and risk flags. Idempotent:
 * a match whose `(organization_id, lot_id, engine_version)` already exists
 * is skipped (its previously written decomposition is kept — earlier writes
 * were atomic). Uses `onConflictDoNothing` on that unique; a concurrent
 * duplicate scorer loses the insert and is counted as skipped.
 */
export async function insertTenderMatches(
  db: Db,
  organizationId: OrganizationId,
  args: { matches: TenderMatchInput[] },
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const match of args.matches) {
    if (await matchExists(db, organizationId, match)) {
      skipped += 1;
      continue;
    }

    const now = Date.now();
    const matchId = newId(now);
    const statements: SqliteBatchItem[] = [
      db
        .insert(tenderMatches)
        .values({
          id: matchId,
          organizationId,
          lotId: match.lotId,
          noticeId: match.noticeId,
          engineVersion: match.engineVersion,
          score: match.score,
          classification: match.classification,
          exclusionRule: match.exclusionRule ?? null,
          exclusionEvidence: match.exclusionEvidence ?? null,
          scoredAt: match.scoredAt,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [tenderMatches.organizationId, tenderMatches.lotId, tenderMatches.engineVersion],
        })
        .returning({ id: tenderMatches.id }),
    ];
    const components = match.components ?? [];
    if (components.length > 0) {
      statements.push(
        db.insert(matchComponents).values(
          components.map((component) => ({
            id: newId(now),
            matchId,
            componentKey: component.componentKey,
            points: component.points,
            maxPoints: component.maxPoints,
            status: component.status,
            explanation: component.explanation,
            createdAt: now,
          })),
        ),
      );
    }
    const riskFlags = match.riskFlags ?? [];
    if (riskFlags.length > 0) {
      statements.push(
        db.insert(matchRiskFlags).values(
          riskFlags.map((flag) => ({
            id: newId(now),
            matchId,
            type: flag.type,
            evidence: flag.evidence,
            sourceField: flag.sourceField,
            confidence: flag.confidence,
            explanation: flag.explanation,
            createdAt: now,
          })),
        ),
      );
    }

    try {
      const results = await db.batch(toBatch(statements));
      const insertedRows = results[0] as { id: string }[];
      if (insertedRows.length > 0) {
        inserted += 1;
      } else {
        // Childless match lost the insert to a concurrent scorer.
        skipped += 1;
      }
    } catch (error) {
      // A concurrent scorer can win between the existence check and the
      // batch: our match insert no-ops, the child inserts then fail their FK
      // (parent id never materialized) and the batch rolls back atomically.
      // Only swallow when the row verifiably exists now — anything else is a
      // real integrity error and must surface.
      if (isConstraintViolation(error) && (await matchExists(db, organizationId, match))) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { inserted, skipped };
}

/** Feed cursor: `${scoredAt}:${id}` of the last row (order is stable). */
function decodeFeedCursor(cursor: string): { scoredAt: number; id: string } {
  const separator = cursor.indexOf(':');
  const scoredAt = separator > 0 ? Number(cursor.slice(0, separator)) : Number.NaN;
  const id = separator > 0 ? cursor.slice(separator + 1) : '';
  if (!Number.isFinite(scoredAt) || id.length === 0) {
    throw new Error('listTenderMatchesForFeed: malformed cursor');
  }
  return { scoredAt, id };
}

export interface ListMatchesForFeedArgs extends Pagination {
  /** The engine version whose scores the feed shows (e.g. `1`). */
  engineVersion: string;
  /** Classification tab filter; omit for all classifications. */
  classifications?: MatchClassification[];
  /** Minimum score; rows with null score (EXCLUDED) never pass this filter. */
  minScore?: number;
}

/**
 * The feed query: org + engine version (+ classification tab, + min score),
 * newest `scored_at` first, id as deterministic tiebreaker. Backed by
 * `idx_tender_matches__organization_id_engine_version_classification_scored_at`.
 */
export async function listTenderMatchesForFeed(
  db: Db,
  organizationId: OrganizationId,
  args: ListMatchesForFeedArgs,
): Promise<Page<TenderMatch>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [
    eq(tenderMatches.organizationId, organizationId),
    eq(tenderMatches.engineVersion, args.engineVersion),
  ];
  if (args.classifications !== undefined && args.classifications.length > 0) {
    conditions.push(inArray(tenderMatches.classification, args.classifications));
  }
  if (args.minScore !== undefined) {
    conditions.push(gte(tenderMatches.score, args.minScore));
  }
  if (args.cursor !== undefined) {
    const cursor = decodeFeedCursor(args.cursor);
    const keyset = or(
      lt(tenderMatches.scoredAt, cursor.scoredAt),
      and(eq(tenderMatches.scoredAt, cursor.scoredAt), lt(tenderMatches.id, cursor.id)),
    );
    if (keyset !== undefined) conditions.push(keyset);
  }
  const rows = await db
    .select()
    .from(tenderMatches)
    .where(and(...conditions))
    .orderBy(desc(tenderMatches.scoredAt), desc(tenderMatches.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => `${last.scoredAt}:${last.id}`);
}

export interface TenderMatchWithComponents {
  match: TenderMatch;
  /** Ordered by component key for stable rendering. */
  components: MatchComponent[];
  riskFlags: MatchRiskFlag[];
}

/**
 * Loads one match with its score decomposition and risk flags. The parent
 * match is org-checked first; components/flags inherit tenancy through the
 * verified `match_id` (docs/data-model.md §6). Null when the match does not
 * exist IN THIS ORGANIZATION.
 */
export async function getTenderMatchWithComponents(
  db: Db,
  organizationId: OrganizationId,
  args: { matchId: string },
): Promise<TenderMatchWithComponents | null> {
  const matches = await db
    .select()
    .from(tenderMatches)
    .where(
      and(eq(tenderMatches.organizationId, organizationId), eq(tenderMatches.id, args.matchId)),
    )
    .limit(1);
  const match = matches[0];
  if (match === undefined) return null;

  const [components, riskFlags] = await db.batch([
    db
      .select()
      .from(matchComponents)
      .where(eq(matchComponents.matchId, match.id))
      .orderBy(matchComponents.componentKey),
    db
      .select()
      .from(matchRiskFlags)
      .where(eq(matchRiskFlags.matchId, match.id))
      .orderBy(matchRiskFlags.id),
  ]);
  return { match, components, riskFlags };
}
