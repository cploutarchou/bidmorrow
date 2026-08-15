/**
 * Pure retention-eligibility logic (docs/ted-ingestion-scope.md "Retention &
 * archival policy", ADR-0003) — no database access, unit-testable in
 * isolation. `@bidmorrow/db`'s `repositories/retention.ts` fetches the raw
 * rows and performs the cascade delete; this module decides WHICH notices
 * qualify.
 */
import type { RetentionLotRow } from '@bidmorrow/db';

const MS_PER_DAY = 86_400_000;

/** Notices with no deadline retain 180 days past first publication (fixed policy constant). */
export const NO_DEADLINE_RETENTION_DAYS = 180;

/**
 * A lot is expired when:
 *  - it has a deadline: `deadlineAt + retentionDays` has passed, or
 *  - it has none: `publicationDate + NO_DEADLINE_RETENTION_DAYS` has passed.
 */
export function isLotExpired(
  nowMs: number,
  deadlineAt: number | null,
  publicationDate: string,
  retentionDays: number,
): boolean {
  if (deadlineAt !== null) {
    return nowMs > deadlineAt + retentionDays * MS_PER_DAY;
  }
  const publishedMs = Date.parse(`${publicationDate}T00:00:00Z`);
  return nowMs > publishedMs + NO_DEADLINE_RETENTION_DAYS * MS_PER_DAY;
}

export interface RetentionEligibilityArgs {
  readonly lots: readonly RetentionLotRow[];
  readonly pinnedLotIds: ReadonlySet<string>;
  readonly nowMs: number;
  readonly retentionDays: number;
  /** Bound on the number of NOTICES returned (default purge batch size). */
  readonly limit: number;
}

/**
 * Groups current-version lots by notice and selects notices where EVERY lot
 * is both expired and unpinned (saved / has customer feedback) — a notice
 * with even one pinned or not-yet-expired lot is never touched, since purge
 * deletes at notice granularity (docs/data-model.md §11). Bounded to
 * `limit` notices; deterministic order (ascending notice id) so repeated
 * runs make steady progress.
 */
export function selectEligibleNoticeIds(args: RetentionEligibilityArgs): string[] {
  const byNotice = new Map<string, RetentionLotRow[]>();
  for (const lot of args.lots) {
    const group = byNotice.get(lot.noticeId);
    if (group === undefined) {
      byNotice.set(lot.noticeId, [lot]);
    } else {
      group.push(lot);
    }
  }

  const eligible: string[] = [];
  for (const [noticeId, lots] of [...byNotice.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const allExpiredAndUnpinned = lots.every(
      (lot) =>
        !args.pinnedLotIds.has(lot.lotId) &&
        isLotExpired(args.nowMs, lot.deadlineAt, lot.publicationDate, args.retentionDays),
    );
    if (allExpiredAndUnpinned) {
      eligible.push(noticeId);
      if (eligible.length >= args.limit) {
        break;
      }
    }
  }
  return eligible;
}
