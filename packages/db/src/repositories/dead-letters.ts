/**
 * Dead-lettered queue messages (F-07, PRODUCTION_READINESS_AUDIT.md).
 *
 * GLOBAL, not tenant-scoped — see the note in
 * `tests/security/tenant-isolation-contract.test.ts`'s GLOBAL_FILES and the
 * header of `migrations/0012_dead_letter_messages.sql`. Written only by the
 * DLQ queue consumer, read only by INTERNAL_ADMIN.
 */
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../client';
import { newId } from '../id';
import { deadLetterMessages } from '../schema/ingestion';
import { normalizeLimit, type Pagination } from './shared';

export interface RecordDeadLetterArgs {
  /** Full DLQ name, e.g. `bidmorrow-ingest-dlq-staging`. */
  readonly queue: string;
  readonly providerMessageId: string;
  readonly bodyJson: string;
  readonly attempts: number;
  readonly deadLetteredAt: number;
}

export interface DeadLetterMessage {
  readonly id: string;
  readonly queue: string;
  readonly providerMessageId: string;
  readonly bodyJson: string;
  readonly attempts: number;
  readonly deadLetteredAt: number;
  readonly resolvedAt: number | null;
}

/**
 * Records a dead-lettered message. IDEMPOTENT at the database: delivery to
 * the DLQ consumer is at-least-once like every other queue, so
 * `provider_message_id` is unique and a redelivery does nothing rather than
 * inflating the depth count with duplicates of one failure.
 *
 * Deliberately `onConflictDoNothing` and NOT an upsert: re-recording would
 * reset an operator's `resolved_at` on a row they had already dealt with,
 * silently resurrecting closed work every time Cloudflare redelivered.
 */
export async function recordDeadLetter(db: Db, args: RecordDeadLetterArgs): Promise<void> {
  const now = Date.now();
  await db
    .insert(deadLetterMessages)
    .values({
      id: newId(now),
      queue: args.queue,
      providerMessageId: args.providerMessageId,
      bodyJson: args.bodyJson,
      attempts: args.attempts,
      deadLetteredAt: args.deadLetteredAt,
      resolvedAt: null,
      createdAt: now,
    })
    .onConflictDoNothing({ target: deadLetterMessages.providerMessageId });
}

export interface DeadLetterDepth {
  /** Unresolved rows — the number the admin health page calls "DLQ depth". */
  readonly unresolved: number;
  /** Unresolved, broken down by queue. Empty when there is nothing outstanding. */
  readonly byQueue: readonly { readonly queue: string; readonly count: number }[];
  /** Most recent dead-letter timestamp, resolved or not; null when none ever. */
  readonly lastDeadLetteredAt: number | null;
}

/**
 * "Depth" counts UNRESOLVED rows, not all-time history: the page exists to
 * show outstanding work, and a number that only ever grows would stop meaning
 * anything the first time something dead-lettered.
 */
export async function getDeadLetterDepth(db: Db): Promise<DeadLetterDepth> {
  const [unresolvedRows, byQueueRows, lastRows] = await db.batch([
    db
      .select({ value: count() })
      .from(deadLetterMessages)
      .where(isNull(deadLetterMessages.resolvedAt)),
    db
      .select({ queue: deadLetterMessages.queue, value: count() })
      .from(deadLetterMessages)
      .where(isNull(deadLetterMessages.resolvedAt))
      .groupBy(deadLetterMessages.queue),
    db
      .select({ value: sql<number | null>`MAX(${deadLetterMessages.deadLetteredAt})` })
      .from(deadLetterMessages),
  ]);

  return {
    unresolved: unresolvedRows[0]?.value ?? 0,
    byQueue: byQueueRows.map((row) => ({ queue: row.queue, count: row.value })),
    lastDeadLetteredAt: lastRows[0]?.value ?? null,
  };
}

export interface ListDeadLettersArgs extends Pagination {
  /** When true, only rows an operator has not yet dealt with. */
  readonly unresolvedOnly?: boolean;
}

/**
 * Newest first, BOUNDED RATHER THAN PAGINATED — deliberately returns a plain
 * array, not a `Page`. A cursor would have to be honoured by a matching
 * `after` argument to mean anything, and handing the admin UI a
 * `nextCursor` no endpoint consumes is worse than not offering one. A DLQ
 * with more outstanding rows than one screenful is an incident, not a
 * browsing problem: the depth count is the number that matters, and the fix
 * is to deal with the cause. Add real keyset pagination here if that stops
 * being true.
 */
export async function listDeadLetters(
  db: Db,
  args: ListDeadLettersArgs = {},
): Promise<DeadLetterMessage[]> {
  const rows = await db
    .select()
    .from(deadLetterMessages)
    .where(args.unresolvedOnly === true ? isNull(deadLetterMessages.resolvedAt) : undefined)
    .orderBy(desc(deadLetterMessages.deadLetteredAt))
    .limit(normalizeLimit(args.limit));
  return rows.map((row) => ({
    id: row.id,
    queue: row.queue,
    providerMessageId: row.providerMessageId,
    bodyJson: row.bodyJson,
    attempts: row.attempts,
    deadLetteredAt: row.deadLetteredAt,
    resolvedAt: row.resolvedAt,
  }));
}

/**
 * Marks one row resolved. Returns false when the id is unknown OR already
 * resolved, so the caller can tell a real state change from a no-op and does
 * not write an audit event for something that did not happen.
 */
export async function resolveDeadLetter(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(deadLetterMessages)
    .set({ resolvedAt: Date.now() })
    .where(and(eq(deadLetterMessages.id, id), isNull(deadLetterMessages.resolvedAt)))
    .returning({ id: deadLetterMessages.id });
  return rows.length > 0;
}
