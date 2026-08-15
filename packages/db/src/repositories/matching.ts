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
import { and, desc, eq, exists, gt, inArray, gte, lt, lte, or, sql } from 'drizzle-orm';
import type {
  ComponentStatus,
  MatchClassification,
  OrganizationId,
  RiskConfidence,
} from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { matchComponents, matchRiskFlags, tenderMatches } from '../schema/matching';
import { ignoredTenders, savedTenders } from '../schema/engagement';
import {
  buyers,
  tenderCpvCodes,
  tenderGeographies,
  tenderLots,
  tenderNotices,
} from '../schema/tender';
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

/**
 * Recompute path (corrected notices / admin-triggered re-score): replaces
 * every existing `(organizationId, lotId ∈ lotIds, engineVersion)` match row
 * — and its components/risk-flags — with a fresh set, atomically. Unlike
 * `insertTenderMatches` (idempotent skip-if-exists), this is a hard
 * replace: a corrected notice's re-scored result must always win over a
 * stale pre-correction score. FK-safe delete order (children, then
 * parents) followed by inserts, all in ONE `db.batch` — a partial replace
 * can never be observed. Double-scoped: the delete filters on
 * `organization_id` AND the matched `lot_id` set.
 */
export async function replaceTenderMatches(
  db: Db,
  organizationId: OrganizationId,
  args: { lotIds: string[]; engineVersion: string; matches: TenderMatchInput[] },
): Promise<{ deleted: number; inserted: number }> {
  if (args.lotIds.length === 0) {
    return { deleted: 0, inserted: 0 };
  }

  const existing = await db
    .select({ id: tenderMatches.id })
    .from(tenderMatches)
    .where(
      and(
        eq(tenderMatches.organizationId, organizationId),
        inArray(tenderMatches.lotId, args.lotIds),
        eq(tenderMatches.engineVersion, args.engineVersion),
      ),
    );
  const existingIds = existing.map((row) => row.id);

  const now = Date.now();
  const statements: SqliteBatchItem[] = [];
  if (existingIds.length > 0) {
    statements.push(
      db.delete(matchComponents).where(inArray(matchComponents.matchId, existingIds)),
    );
    statements.push(db.delete(matchRiskFlags).where(inArray(matchRiskFlags.matchId, existingIds)));
    statements.push(
      db
        .delete(tenderMatches)
        .where(
          and(
            eq(tenderMatches.organizationId, organizationId),
            inArray(tenderMatches.id, existingIds),
          ),
        ),
    );
  }

  for (const match of args.matches) {
    const matchId = newId(now);
    statements.push(
      db.insert(tenderMatches).values({
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
      }),
    );
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
  }

  if (statements.length === 0) {
    return { deleted: 0, inserted: 0 };
  }
  await db.batch(toBatch(statements));
  return { deleted: existingIds.length, inserted: args.matches.length };
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

/**
 * Resolves the `(lotId, noticeId)` a match belongs to, org-checked. Used by
 * the save/ignore action handlers so `lotId`/`noticeId` are ALWAYS derived
 * server-side from the match row, never accepted from client input. Null
 * when the match does not exist IN THIS ORGANIZATION.
 */
export async function getTenderMatchLotNotice(
  db: Db,
  organizationId: OrganizationId,
  args: { matchId: string },
): Promise<{ lotId: string; noticeId: string } | null> {
  const rows = await db
    .select({ lotId: tenderMatches.lotId, noticeId: tenderMatches.noticeId })
    .from(tenderMatches)
    .where(
      and(eq(tenderMatches.organizationId, organizationId), eq(tenderMatches.id, args.matchId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Feed (Phase 7): the customer-facing list of matches, joined with the
// tender corpus and the org's own save/ignore state.
// ---------------------------------------------------------------------------

export type FeedTab = 'today' | 'strong' | 'worth_reviewing' | 'possible' | 'saved' | 'ignored';

export interface FeedFilters {
  readonly minScore?: number;
  /** ISO-3166-1 alpha-2. */
  readonly country?: string;
  /** CPV prefix (any length ≥ 2) — matched against main + additional CPV codes. */
  readonly cpvPrefix?: string;
  /** Case-insensitive substring match against the buyer name. */
  readonly buyerName?: string;
  readonly minValueEur?: number;
  readonly maxValueEur?: number;
  readonly deadlineBefore?: number;
  readonly deadlineAfter?: number;
  /** `YYYY-MM-DD`; matches notices published on/after this date. */
  readonly publishedAfter?: string;
}

export interface ListFeedArgs extends Pagination, FeedFilters {
  readonly tab: FeedTab;
  readonly engineVersion: string;
  /** Injected clock — `today` and expired-deadline exclusion are time-dependent. */
  readonly now: number;
}

export interface FeedComponentSummary {
  readonly componentKey: MatchComponentKey;
  readonly points: number;
  readonly explanation: string;
}

export interface FeedRiskFlagSummary {
  readonly type: RiskFlagType;
  readonly confidence: RiskConfidence;
  readonly explanation: string;
}

export interface FeedRow {
  readonly matchId: string;
  readonly lotId: string;
  readonly score: number | null;
  readonly classification: MatchClassification;
  readonly title: string;
  readonly buyerName: string | null;
  readonly country: string | null;
  readonly valueEur: number | null;
  readonly valueOriginalAmount: number | null;
  readonly valueOriginalCurrency: string | null;
  readonly deadlineAt: number | null;
  readonly scoredAt: number;
  /** Top 2 components by points, highest first — never the full breakdown (feed rows never carry description text). */
  readonly topComponents: readonly FeedComponentSummary[];
  readonly topRiskFlag: FeedRiskFlagSummary | null;
  readonly savedByYou: boolean;
  readonly ignoredByYou: boolean;
}

const MS_PER_DAY_FEED = 86_400_000;

/**
 * Escapes LIKE metacharacters (`%`, `_`, and the escape character itself, `\`)
 * in a value that will be embedded inside a LIKE pattern, so a literal `%`/`_`
 * typed by a customer (e.g. a buyer name containing "R&D 50%") is matched
 * literally rather than as an unintended wildcard (SEC-P7-03). Always paired
 * with an explicit `ESCAPE '\'` clause at the call site — the default SQLite
 * LIKE has no escape character otherwise.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Feed cursor: `${score}:${id}` of the last row — score DESC, id DESC is the deterministic order. */
function decodeScoreCursor(cursor: string): { score: number; id: string } {
  const separator = cursor.indexOf(':');
  const score = separator > 0 ? Number(cursor.slice(0, separator)) : Number.NaN;
  const id = separator > 0 ? cursor.slice(separator + 1) : '';
  if (!Number.isFinite(score) || id.length === 0) {
    throw new Error('listFeedRows: malformed cursor');
  }
  return { score, id };
}

/**
 * The customer feed query (docs/product-scope.md §5): org + latest engine
 * version, tab-scoped, filtered, deterministically ordered (score DESC, id
 * DESC tiebreak). `EXCLUDED` matches never appear (no score to show).
 * Expired-deadline lots are excluded from every tab EXCEPT `saved`/`ignored`
 * — a customer who explicitly saved or ignored a tender can still find it
 * after its deadline passes; the scored classification tabs stay
 * forward-looking only. Rows never carry the lot description (size —
 * docs/matching-engine.md component-persistence rationale mirrors this).
 */
export async function listFeedRows(
  db: Db,
  organizationId: OrganizationId,
  args: ListFeedArgs,
): Promise<Page<FeedRow>> {
  const limit = normalizeLimit(args.limit);

  const conditions = [
    eq(tenderMatches.organizationId, organizationId),
    eq(tenderMatches.engineVersion, args.engineVersion),
    sql`${tenderMatches.classification} <> 'EXCLUDED'`,
  ];

  switch (args.tab) {
    case 'today':
      conditions.push(gte(tenderMatches.scoredAt, args.now - MS_PER_DAY_FEED));
      break;
    case 'strong':
      conditions.push(eq(tenderMatches.classification, 'STRONG_MATCH'));
      break;
    case 'worth_reviewing':
      conditions.push(eq(tenderMatches.classification, 'WORTH_REVIEWING'));
      break;
    case 'possible':
      conditions.push(eq(tenderMatches.classification, 'POSSIBLE_MATCH'));
      break;
    case 'saved':
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(savedTenders)
            .where(
              and(
                eq(savedTenders.organizationId, organizationId),
                eq(savedTenders.lotId, tenderMatches.lotId),
              ),
            ),
        ),
      );
      break;
    case 'ignored':
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(ignoredTenders)
            .where(
              and(
                eq(ignoredTenders.organizationId, organizationId),
                eq(ignoredTenders.lotId, tenderMatches.lotId),
              ),
            ),
        ),
      );
      break;
  }

  const excludeExpired = args.tab !== 'saved' && args.tab !== 'ignored';
  if (excludeExpired) {
    conditions.push(
      sql`(${tenderLots.deadlineAt} IS NULL OR ${tenderLots.deadlineAt} >= ${args.now})`,
    );
  }

  if (args.minScore !== undefined) conditions.push(gte(tenderMatches.score, args.minScore));
  if (args.minValueEur !== undefined)
    conditions.push(gte(tenderLots.estimatedValueEur, args.minValueEur));
  if (args.maxValueEur !== undefined)
    conditions.push(lte(tenderLots.estimatedValueEur, args.maxValueEur));
  if (args.deadlineBefore !== undefined)
    conditions.push(lt(tenderLots.deadlineAt, args.deadlineBefore));
  if (args.deadlineAfter !== undefined)
    conditions.push(gt(tenderLots.deadlineAt, args.deadlineAfter));
  if (args.publishedAfter !== undefined)
    conditions.push(gte(tenderNotices.publicationDate, args.publishedAfter));
  if (args.buyerName !== undefined) {
    conditions.push(
      sql`${buyers.name} LIKE ${`%${escapeLikePattern(args.buyerName)}%`} ESCAPE '\\'`,
    );
  }
  if (args.country !== undefined) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(tenderGeographies)
          .where(
            and(
              eq(tenderGeographies.lotId, tenderLots.id),
              eq(tenderGeographies.countryCode, args.country),
            ),
          ),
      ),
    );
  }
  if (args.cpvPrefix !== undefined) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(tenderCpvCodes)
          .where(
            and(
              eq(tenderCpvCodes.lotId, tenderLots.id),
              sql`${tenderCpvCodes.cpvCode} LIKE ${`${escapeLikePattern(args.cpvPrefix)}%`} ESCAPE '\\'`,
            ),
          ),
      ),
    );
  }

  if (args.cursor !== undefined) {
    const cursor = decodeScoreCursor(args.cursor);
    const keyset = or(
      lt(tenderMatches.score, cursor.score),
      and(eq(tenderMatches.score, cursor.score), lt(tenderMatches.id, cursor.id)),
    );
    if (keyset !== undefined) conditions.push(keyset);
  }

  const rows = await db
    .select({ match: tenderMatches, lot: tenderLots, notice: tenderNotices, buyer: buyers })
    .from(tenderMatches)
    .innerJoin(tenderLots, eq(tenderMatches.lotId, tenderLots.id))
    .innerJoin(tenderNotices, eq(tenderMatches.noticeId, tenderNotices.id))
    .leftJoin(buyers, eq(tenderNotices.buyerId, buyers.id))
    .where(and(...conditions))
    .orderBy(desc(tenderMatches.score), desc(tenderMatches.id))
    .limit(limit + 1);

  const page = toPage(rows, limit, (last) => `${last.match.score}:${last.match.id}`);
  if (page.items.length === 0) {
    return { items: [], nextCursor: page.nextCursor };
  }

  const matchIds = page.items.map((row) => row.match.id);
  const lotIds = [...new Set(page.items.map((row) => row.lot.id))];

  const [componentRows, riskFlagRows, geoRows, savedRows, ignoredRows] = await db.batch([
    db
      .select()
      .from(matchComponents)
      .where(inArray(matchComponents.matchId, matchIds))
      .orderBy(desc(matchComponents.points)),
    db.select().from(matchRiskFlags).where(inArray(matchRiskFlags.matchId, matchIds)),
    db.select().from(tenderGeographies).where(inArray(tenderGeographies.lotId, lotIds)),
    db
      .select({ lotId: savedTenders.lotId })
      .from(savedTenders)
      .where(
        and(eq(savedTenders.organizationId, organizationId), inArray(savedTenders.lotId, lotIds)),
      ),
    db
      .select({ lotId: ignoredTenders.lotId })
      .from(ignoredTenders)
      .where(
        and(
          eq(ignoredTenders.organizationId, organizationId),
          inArray(ignoredTenders.lotId, lotIds),
        ),
      ),
  ]);

  const componentsByMatch = new Map<string, FeedComponentSummary[]>();
  for (const component of componentRows) {
    const list = componentsByMatch.get(component.matchId) ?? [];
    if (list.length < 2) {
      list.push({
        componentKey: component.componentKey as MatchComponentKey,
        points: component.points,
        explanation: component.explanation,
      });
    }
    componentsByMatch.set(component.matchId, list);
  }

  // "Top" risk flag: HIGH confidence before POSSIBLE, then earliest inserted.
  const riskFlagsByMatch = new Map<string, MatchRiskFlag>();
  for (const flag of riskFlagRows) {
    const current = riskFlagsByMatch.get(flag.matchId);
    if (
      current === undefined ||
      (current.confidence !== 'HIGH' && flag.confidence === 'HIGH') ||
      (current.confidence === flag.confidence && flag.id < current.id)
    ) {
      riskFlagsByMatch.set(flag.matchId, flag);
    }
  }

  const countryByLot = new Map<string, string>();
  for (const geo of geoRows) {
    const current = countryByLot.get(geo.lotId);
    if (current === undefined || geo.countryCode < current) {
      countryByLot.set(geo.lotId, geo.countryCode);
    }
  }

  const savedLotIds = new Set(savedRows.map((row) => row.lotId));
  const ignoredLotIds = new Set(ignoredRows.map((row) => row.lotId));

  const items: FeedRow[] = page.items.map((row) => {
    const flag = riskFlagsByMatch.get(row.match.id);
    return {
      matchId: row.match.id,
      lotId: row.lot.id,
      score: row.match.score,
      classification: row.match.classification as MatchClassification,
      title: row.lot.title,
      buyerName: row.buyer?.name ?? null,
      country: countryByLot.get(row.lot.id) ?? null,
      valueEur: row.lot.estimatedValueEur,
      valueOriginalAmount: row.lot.estimatedValueAmount,
      valueOriginalCurrency: row.lot.estimatedValueCurrency,
      deadlineAt: row.lot.deadlineAt,
      scoredAt: row.match.scoredAt,
      topComponents: componentsByMatch.get(row.match.id) ?? [],
      topRiskFlag:
        flag === undefined
          ? null
          : {
              type: flag.type as RiskFlagType,
              confidence: flag.confidence as RiskConfidence,
              explanation: flag.explanation,
            },
      savedByYou: savedLotIds.has(row.lot.id),
      ignoredByYou: ignoredLotIds.has(row.lot.id),
    };
  });

  return { items, nextCursor: page.nextCursor };
}
