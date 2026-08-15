/**
 * Customer actions, feedback & digest-run repository — docs/data-model.md
 * §7–§8 (docs/security.md C6).
 *
 * Save/unsave/ignore are idempotent by design: the DB uniques on
 * `(organization_id, lot_id)` absorb repeats, and the boolean return says
 * whether this call changed anything. `digest_runs` relies on the unique
 * `(organization_id, digest_date)` as the daily dedupe mechanism.
 */
import { and, eq } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { customerFeedback, digestRuns, ignoredTenders, savedTenders } from '../schema/engagement';
import { tenderMatches } from '../schema/matching';
import { DuplicateDigestError, TenantMismatchError } from './errors';
import { assertIsoDate } from './shared';

export type SavedTender = typeof savedTenders.$inferSelect;
export type IgnoredTender = typeof ignoredTenders.$inferSelect;
export type CustomerFeedback = typeof customerFeedback.$inferSelect;
export type DigestRun = typeof digestRuns.$inferSelect;

export type FeedbackVerdict = 'useful' | 'not_useful';
export type FeedbackReason =
  | 'wrong_cpv'
  | 'wrong_geography'
  | 'too_large'
  | 'too_small'
  | 'not_our_work'
  | 'deadline_too_close'
  | 'other';
export type DigestRunStatus = 'pending' | 'sent' | 'skipped_empty' | 'skipped_paused' | 'failed';

// ---------------------------------------------------------------------------
// saved_tenders
// ---------------------------------------------------------------------------

/**
 * Saves a lot for the organization (pins its tender data against retention
 * purge). Idempotent: returns false when the lot was already saved — the
 * original saver and timestamp are kept.
 */
export async function saveTender(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string; noticeId: string; savedByUserId: string },
): Promise<boolean> {
  const now = Date.now();
  const inserted = await db
    .insert(savedTenders)
    .values({
      id: newId(now),
      organizationId,
      lotId: args.lotId,
      noticeId: args.noticeId,
      savedByUserId: args.savedByUserId,
      createdAt: now,
    })
    .onConflictDoNothing({ target: [savedTenders.organizationId, savedTenders.lotId] })
    .returning({ id: savedTenders.id });
  return inserted.length > 0;
}

/** Whether the org has saved this lot — for tender-detail state. */
export async function isTenderSaved(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string },
): Promise<boolean> {
  const rows = await db
    .select({ id: savedTenders.id })
    .from(savedTenders)
    .where(and(eq(savedTenders.organizationId, organizationId), eq(savedTenders.lotId, args.lotId)))
    .limit(1);
  return rows.length > 0;
}

/** Idempotent: returns false when the lot was not saved. */
export async function unsaveTender(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(savedTenders)
    .where(and(eq(savedTenders.organizationId, organizationId), eq(savedTenders.lotId, args.lotId)))
    .returning({ id: savedTenders.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// ignored_tenders
// ---------------------------------------------------------------------------

/**
 * Ignores a lot (removes it from all feed tabs; does NOT pin against
 * purge). Idempotent: returns false when already ignored — the original
 * row, including its reason, is kept.
 */
export async function ignoreTender(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string; noticeId: string; ignoredByUserId: string; reason?: string | null },
): Promise<boolean> {
  const now = Date.now();
  const inserted = await db
    .insert(ignoredTenders)
    .values({
      id: newId(now),
      organizationId,
      lotId: args.lotId,
      noticeId: args.noticeId,
      ignoredByUserId: args.ignoredByUserId,
      reason: args.reason ?? null,
      createdAt: now,
    })
    .onConflictDoNothing({ target: [ignoredTenders.organizationId, ignoredTenders.lotId] })
    .returning({ id: ignoredTenders.id });
  return inserted.length > 0;
}

/** Whether the org has ignored this lot — for tender-detail state. */
export async function isTenderIgnored(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string },
): Promise<boolean> {
  const rows = await db
    .select({ id: ignoredTenders.id })
    .from(ignoredTenders)
    .where(
      and(eq(ignoredTenders.organizationId, organizationId), eq(ignoredTenders.lotId, args.lotId)),
    )
    .limit(1);
  return rows.length > 0;
}

/** Idempotent: returns false when the lot was not ignored. */
export async function unignoreTender(
  db: Db,
  organizationId: OrganizationId,
  args: { lotId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(ignoredTenders)
    .where(
      and(eq(ignoredTenders.organizationId, organizationId), eq(ignoredTenders.lotId, args.lotId)),
    )
    .returning({ id: ignoredTenders.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// customer_feedback
// ---------------------------------------------------------------------------

export interface UpsertCustomerFeedbackArgs {
  matchId: string;
  userId: string;
  verdict: FeedbackVerdict;
  reasons?: FeedbackReason[];
  comment?: string | null;
}

/**
 * Records a Useful / Not-useful verdict. One live verdict per match
 * (unique `(organization_id, match_id)`): changing your mind upserts —
 * verdict, reasons, comment and attributed user are replaced, `updated_at`
 * tracks it (docs/data-model.md §7).
 */
export async function upsertCustomerFeedback(
  db: Db,
  organizationId: OrganizationId,
  args: UpsertCustomerFeedbackArgs,
): Promise<CustomerFeedback> {
  // SEC-P3-01: matchId is client-influenced in later phases — verify the
  // match belongs to this organization before writing a row that references
  // it, otherwise Org A could attach feedback to Org B's match.
  const match = await db
    .select({ id: tenderMatches.id })
    .from(tenderMatches)
    .where(
      and(eq(tenderMatches.id, args.matchId), eq(tenderMatches.organizationId, organizationId)),
    )
    .limit(1);
  if (match.length === 0) {
    throw new TenantMismatchError('customer_feedback', organizationId);
  }

  const now = Date.now();
  const values = {
    userId: args.userId,
    verdict: args.verdict,
    reasonsJson: args.reasons === undefined ? null : JSON.stringify(args.reasons),
    comment: args.comment ?? null,
  };
  const rows = await db
    .insert(customerFeedback)
    .values({
      id: newId(now),
      organizationId,
      matchId: args.matchId,
      ...values,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [customerFeedback.organizationId, customerFeedback.matchId],
      set: { ...values, updatedAt: now },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('upsertCustomerFeedback: upsert returned no row');
  }
  return row;
}

/** Reads the org's current feedback verdict for a match, if any — for tender-detail state. */
export async function getCustomerFeedback(
  db: Db,
  organizationId: OrganizationId,
  args: { matchId: string },
): Promise<CustomerFeedback | null> {
  const rows = await db
    .select()
    .from(customerFeedback)
    .where(
      and(
        eq(customerFeedback.organizationId, organizationId),
        eq(customerFeedback.matchId, args.matchId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// digest_runs
// ---------------------------------------------------------------------------

/**
 * Claims today's digest for the organization by inserting first — the
 * unique `(organization_id, digest_date)` is the dedupe mechanism
 * (docs/data-model.md §8). Losing the insert means another invocation owns
 * that day's digest, surfaced as a typed `DuplicateDigestError`.
 */
export async function createDigestRun(
  db: Db,
  organizationId: OrganizationId,
  args: { digestDate: string; matchesCount?: number },
): Promise<DigestRun> {
  assertIsoDate(args.digestDate, 'digestDate');
  const now = Date.now();
  const rows = await db
    .insert(digestRuns)
    .values({
      id: newId(now),
      organizationId,
      digestDate: args.digestDate,
      status: 'pending',
      matchesCount: args.matchesCount ?? 0,
      emailDeliveryId: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [digestRuns.organizationId, digestRuns.digestDate] })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new DuplicateDigestError(organizationId, args.digestDate);
  }
  return row;
}

export interface RecordDigestRunOutcomeArgs {
  digestRunId: string;
  status: Exclude<DigestRunStatus, 'pending'>;
  matchesCount?: number;
  /** The linked email_deliveries row when the digest was sent. */
  emailDeliveryId?: string | null;
  sentAt?: number | null;
}

/**
 * Records the terminal outcome of a digest run (status transition moves
 * `updated_at`). Constrained on organization AND row id; returns null when
 * the run does not exist in this organization.
 */
export async function recordDigestRunOutcome(
  db: Db,
  organizationId: OrganizationId,
  args: RecordDigestRunOutcomeArgs,
): Promise<DigestRun | null> {
  const set: Partial<typeof digestRuns.$inferInsert> = {
    status: args.status,
    updatedAt: Date.now(),
  };
  if (args.matchesCount !== undefined) set.matchesCount = args.matchesCount;
  if (args.emailDeliveryId !== undefined) set.emailDeliveryId = args.emailDeliveryId;
  if (args.sentAt !== undefined) set.sentAt = args.sentAt;
  const rows = await db
    .update(digestRuns)
    .set(set)
    .where(and(eq(digestRuns.organizationId, organizationId), eq(digestRuns.id, args.digestRunId)))
    .returning();
  return rows[0] ?? null;
}
