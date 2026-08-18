/**
 * Retention purge job (docs/ted-ingestion-scope.md "Retention & archival
 * policy", ADR-0003, ted-ingestion-audit checklist item 8).
 *
 * NOT recorded as an `ingestion_runs` row: that table's `window_from`/
 * `window_to` columns model a publication-date ingestion window, which a
 * purge sweep has no equivalent of, and `ingestion_runs.source` is `ted`-only
 * in practice even though the column has no CHECK constraint — bending that
 * table's shape to fit an unrelated job would be exactly the kind of
 * schema-bending docs/project-guide.md forbids. The run is instead a single structured
 * log line carrying every count (`ops.log_line`-shaped: correlatable by
 * `request_id`/cron invocation, admin-queryable via the log pipeline, not
 * the `ingestion_runs` table). Revisit with a dedicated `purge_runs` table
 * if/when admin tooling needs to query purge history relationally
 * (Phase 10).
 */
import {
  deleteNoticesCascade,
  listCurrentVersionLots,
  listFeedbackPinnedLotIds,
  listSavedLotIds,
} from '@bidmorrow/db';
import type { Db, PurgeCounts } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';

import { selectEligibleNoticeIds } from './retention-eligibility';

/** Default per-run bound on notices purged (config). */
export const DEFAULT_PURGE_BATCH_LIMIT = 500;

/** Default retention window past the last lot deadline (config `RETENTION_DAYS`). */
export const DEFAULT_RETENTION_DAYS = 90;

export interface RunPurgeArgs {
  readonly db: Db;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly retentionDays?: number;
  readonly limit?: number;
}

export type RunPurgeResult = PurgeCounts & { readonly eligibleNoticeIds: readonly string[] };

export async function runPurge(args: RunPurgeArgs): Promise<RunPurgeResult> {
  const now = args.now ?? Date.now;
  const retentionDays = args.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const limit = args.limit ?? DEFAULT_PURGE_BATCH_LIMIT;

  const [lots, savedLotIds, feedbackPinnedLotIds] = await Promise.all([
    listCurrentVersionLots(args.db),
    listSavedLotIds(args.db),
    listFeedbackPinnedLotIds(args.db),
  ]);
  const pinnedLotIds = new Set<string>([...savedLotIds, ...feedbackPinnedLotIds]);

  const eligibleNoticeIds = selectEligibleNoticeIds({
    lots,
    pinnedLotIds,
    nowMs: now(),
    retentionDays,
    limit,
  });

  const counts = await deleteNoticesCascade(args.db, eligibleNoticeIds);

  args.logger.info('retention.purge.completed', {
    retention_days: retentionDays,
    limit,
    notices_deleted: counts.noticesDeleted,
    versions_deleted: counts.versionsDeleted,
    lots_deleted: counts.lotsDeleted,
    matches_deleted: counts.matchesDeleted,
    digest_items_detached: counts.digestItemsDetached,
  });

  return { ...counts, eligibleNoticeIds };
}
