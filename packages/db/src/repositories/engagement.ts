/**
 * Customer actions, feedback & digest-run repository — docs/data-model.md
 * §7–§8 (docs/security.md C6).
 *
 * Save/unsave/ignore are idempotent by design: the DB uniques on
 * `(organization_id, lot_id)` absorb repeats, and the boolean return says
 * whether this call changed anything. `digest_runs` relies on the unique
 * `(organization_id, digest_date)` as the daily dedupe mechanism.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import {
  customerFeedback,
  digestItems,
  digestRuns,
  emailDeliveries,
  ignoredTenders,
  savedTenders,
} from '../schema/engagement';
import { tenderMatches } from '../schema/matching';
import { DuplicateDigestError, TenantMismatchError } from './errors';
import { assertIsoDate } from './shared';

export type SavedTender = typeof savedTenders.$inferSelect;
export type IgnoredTender = typeof ignoredTenders.$inferSelect;
export type CustomerFeedback = typeof customerFeedback.$inferSelect;
export type DigestRun = typeof digestRuns.$inferSelect;
export type DigestItem = typeof digestItems.$inferSelect;
export type EmailDelivery = typeof emailDeliveries.$inferSelect;

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

/**
 * Reads the (at most one) existing run for an org+date — the resume path
 * uses this after `createDigestRun` throws `DuplicateDigestError` to decide
 * whether the existing run is a genuine already-completed duplicate or an
 * interrupted `pending`/`failed` run safe to resume.
 */
export async function getDigestRunByDate(
  db: Db,
  organizationId: OrganizationId,
  digestDate: string,
): Promise<DigestRun | null> {
  assertIsoDate(digestDate, 'digestDate');
  const rows = await db
    .select()
    .from(digestRuns)
    .where(
      and(eq(digestRuns.organizationId, organizationId), eq(digestRuns.digestDate, digestDate)),
    )
    .limit(1);
  return rows[0] ?? null;
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

// ---------------------------------------------------------------------------
// digest_items (SEC-P3-03: tenancy inherited through digest_run_id — every
// access here first re-verifies the parent run belongs to this org, exactly
// like customer_feedback's matchId check above)
// ---------------------------------------------------------------------------

export interface DigestItemInput {
  /** Null only after retention purge SET NULLs it — never written null here. */
  matchId: string;
  rank: number;
  titleSnapshot: string;
  scoreSnapshot: number | null;
  classificationSnapshot: string;
}

async function assertDigestRunOwnedByOrg(
  db: Db,
  organizationId: OrganizationId,
  digestRunId: string,
): Promise<void> {
  const rows = await db
    .select({ id: digestRuns.id })
    .from(digestRuns)
    .where(and(eq(digestRuns.organizationId, organizationId), eq(digestRuns.id, digestRunId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TenantMismatchError('digest_items', organizationId);
  }
}

/**
 * Writes the digest's item snapshots (what it actually contained — display
 * fields, not a live join, so the row stays meaningful after retention
 * purges the underlying match). Org-checked via the parent run first.
 */
export async function insertDigestItems(
  db: Db,
  organizationId: OrganizationId,
  args: { digestRunId: string; items: DigestItemInput[] },
): Promise<DigestItem[]> {
  await assertDigestRunOwnedByOrg(db, organizationId, args.digestRunId);
  if (args.items.length === 0) return [];
  const now = Date.now();
  return db
    .insert(digestItems)
    .values(
      args.items.map((item) => ({
        id: newId(now),
        digestRunId: args.digestRunId,
        matchId: item.matchId,
        rank: item.rank,
        titleSnapshot: item.titleSnapshot,
        scoreSnapshot: item.scoreSnapshot,
        classificationSnapshot: item.classificationSnapshot,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();
}

/**
 * Reads a run's stored item snapshots, rank-ordered — the resume path's
 * source of truth (re-render without re-collecting candidates, so a
 * queue-retried send can never duplicate items). Org-checked via the parent
 * run first.
 */
export async function listDigestItems(
  db: Db,
  organizationId: OrganizationId,
  args: { digestRunId: string },
): Promise<DigestItem[]> {
  await assertDigestRunOwnedByOrg(db, organizationId, args.digestRunId);
  return db
    .select()
    .from(digestItems)
    .where(eq(digestItems.digestRunId, args.digestRunId))
    .orderBy(asc(digestItems.rank));
}

// ---------------------------------------------------------------------------
// email_deliveries (org-scoped subset — digest sends only; auth/billing mail
// is user-scoped and out of this repository's remit)
// ---------------------------------------------------------------------------

export type EmailDeliveryStatus =
  'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';

/** Creates a `queued` delivery row before attempting the provider send. */
export async function createEmailDelivery(
  db: Db,
  organizationId: OrganizationId,
  args: { kind: 'digest'; toEmail: string; provider: string },
): Promise<EmailDelivery> {
  const now = Date.now();
  const rows = await db
    .insert(emailDeliveries)
    .values({
      id: newId(now),
      organizationId,
      userId: null,
      kind: args.kind,
      toEmail: args.toEmail,
      provider: args.provider,
      providerMessageId: null,
      status: 'queued',
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('createEmailDelivery: insert returned no row');
  }
  return row;
}

/** Updates a delivery's terminal provider status. Double-scoped (org AND id). */
export async function updateEmailDeliveryStatus(
  db: Db,
  organizationId: OrganizationId,
  args: {
    emailDeliveryId: string;
    status: EmailDeliveryStatus;
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<EmailDelivery | null> {
  const set: Partial<typeof emailDeliveries.$inferInsert> = {
    status: args.status,
    updatedAt: Date.now(),
  };
  if (args.providerMessageId !== undefined) set.providerMessageId = args.providerMessageId;
  if (args.error !== undefined) set.error = args.error;
  const rows = await db
    .update(emailDeliveries)
    .set(set)
    .where(
      and(
        eq(emailDeliveries.organizationId, organizationId),
        eq(emailDeliveries.id, args.emailDeliveryId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Account-deletion FK safety (Phase 11 privacy reconciliation, migration
// 0005): `saved_by_user_id`/`ignored_by_user_id`/`customer_feedback.user_id`
// are attribution fields on ORG-owned rows, nullable so a departing member's
// account can be deleted without either (a) violating the FK to `users`, or
// (b) deleting org data another member still relies on.
// ---------------------------------------------------------------------------

export interface NullifyUserAuthorshipCounts {
  readonly savedTendersNulled: number;
  readonly ignoredTendersNulled: number;
  readonly customerFeedbackNulled: number;
}

/**
 * SET NULLs `userId`'s authorship attribution on `saved_tenders` /
 * `ignored_tenders` / `customer_feedback` rows, restricted to the given
 * organizations AND that user's own authored rows — never a bare `userId`
 * match with no organization scope, so this can never touch another org's
 * data by construction. Called by `routes/account.ts` immediately before
 * removing the membership rows for those same organizations, so the FK to
 * `users` is clear before Better Auth's `deleteUser` runs.
 */
export async function nullifyUserAuthorship(
  db: Db,
  userId: string,
  organizationIds: readonly OrganizationId[],
): Promise<NullifyUserAuthorshipCounts> {
  if (organizationIds.length === 0) {
    return { savedTendersNulled: 0, ignoredTendersNulled: 0, customerFeedbackNulled: 0 };
  }
  const now = Date.now();
  const orgIds = [...organizationIds];
  const [savedRows, ignoredRows, feedbackRows] = await db.batch([
    db
      .update(savedTenders)
      .set({ savedByUserId: null })
      .where(
        and(inArray(savedTenders.organizationId, orgIds), eq(savedTenders.savedByUserId, userId)),
      )
      .returning({ id: savedTenders.id }),
    db
      .update(ignoredTenders)
      .set({ ignoredByUserId: null })
      .where(
        and(
          inArray(ignoredTenders.organizationId, orgIds),
          eq(ignoredTenders.ignoredByUserId, userId),
        ),
      )
      .returning({ id: ignoredTenders.id }),
    db
      .update(customerFeedback)
      .set({ userId: null, updatedAt: now })
      .where(
        and(inArray(customerFeedback.organizationId, orgIds), eq(customerFeedback.userId, userId)),
      )
      .returning({ id: customerFeedback.id }),
  ]);
  return {
    savedTendersNulled: savedRows.length,
    ignoredTendersNulled: ignoredRows.length,
    customerFeedbackNulled: feedbackRows.length,
  };
}
