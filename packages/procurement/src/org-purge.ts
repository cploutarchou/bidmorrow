/**
 * Deleted-organization purge job (docs/privacy.md commitments 2/3, Phase 11
 * stage A) — the tenant-data counterpart to `purge.ts`'s tender-corpus
 * retention sweep. Both are invoked from the same daily retention cron path
 * (`apps/worker/src/ingestion.ts` `runRetentionPurgeJob`), one after the
 * other; neither depends on the other's outcome.
 *
 * Not recorded as an `ingestion_runs` row — same rationale as `purge.ts`'s
 * header: this is a single structured log line carrying every count.
 */
import {
  listOrganizationsPendingPurge,
  purgeOrganizationOwnedRows,
  tombstoneOrganization,
} from '@bidmorrow/db';
import type { Db, OrgPurgeCounts } from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';

/** Default grace period after soft-delete before a hard purge (config, docs/privacy.md commitment 2). */
export const DEFAULT_ORG_PURGE_GRACE_DAYS = 30;

/** Default per-run bound on organizations purged (config). */
export const DEFAULT_ORG_PURGE_BATCH_LIMIT = 50;

export interface RunOrgPurgeArgs {
  readonly db: Db;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly graceDays?: number;
  readonly limit?: number;
}

export interface RunOrgPurgeResult {
  readonly organizationsPurged: number;
  readonly totals: OrgPurgeCounts;
}

const EMPTY_TOTALS: OrgPurgeCounts = {
  matchComponentsDeleted: 0,
  matchRiskFlagsDeleted: 0,
  tenderMatchesDeleted: 0,
  customerFeedbackDeleted: 0,
  savedTendersDeleted: 0,
  ignoredTendersDeleted: 0,
  digestItemsDeleted: 0,
  digestRunsDeleted: 0,
  emailDeliveriesDeleted: 0,
  companyRowsDeleted: 0,
  supportNotesDeleted: 0,
  productEventsDeleted: 0,
  organizationMembersDeleted: 0,
};

function addCounts(a: OrgPurgeCounts, b: OrgPurgeCounts): OrgPurgeCounts {
  return {
    matchComponentsDeleted: a.matchComponentsDeleted + b.matchComponentsDeleted,
    matchRiskFlagsDeleted: a.matchRiskFlagsDeleted + b.matchRiskFlagsDeleted,
    tenderMatchesDeleted: a.tenderMatchesDeleted + b.tenderMatchesDeleted,
    customerFeedbackDeleted: a.customerFeedbackDeleted + b.customerFeedbackDeleted,
    savedTendersDeleted: a.savedTendersDeleted + b.savedTendersDeleted,
    ignoredTendersDeleted: a.ignoredTendersDeleted + b.ignoredTendersDeleted,
    digestItemsDeleted: a.digestItemsDeleted + b.digestItemsDeleted,
    digestRunsDeleted: a.digestRunsDeleted + b.digestRunsDeleted,
    emailDeliveriesDeleted: a.emailDeliveriesDeleted + b.emailDeliveriesDeleted,
    companyRowsDeleted: a.companyRowsDeleted + b.companyRowsDeleted,
    supportNotesDeleted: a.supportNotesDeleted + b.supportNotesDeleted,
    productEventsDeleted: a.productEventsDeleted + b.productEventsDeleted,
    organizationMembersDeleted: a.organizationMembersDeleted + b.organizationMembersDeleted,
  };
}

/**
 * Hard-purges every organization that has been `status = 'deleted'` for at
 * least `graceDays` (default 30 — reversal-window equivalent; V1 has no
 * self-service "undelete" so this is purely a safety buffer for support to
 * catch an accidental deletion before data is unrecoverable), bounded to
 * `limit` organizations per run. For each: deletes every owned row
 * (`purgeOrganizationOwnedRows`, FK-safe order documented there), then
 * tombstones the `organizations` row (name → `deleted-<id>`, `status`
 * stays `deleted`) — the tombstone rename is what makes the next run's
 * `listOrganizationsPendingPurge` scan skip it permanently.
 */
export async function runOrgPurge(args: RunOrgPurgeArgs): Promise<RunOrgPurgeResult> {
  const now = args.now ?? Date.now;
  const graceDays = args.graceDays ?? DEFAULT_ORG_PURGE_GRACE_DAYS;
  const limit = args.limit ?? DEFAULT_ORG_PURGE_BATCH_LIMIT;

  const pending = await listOrganizationsPendingPurge(args.db, {
    graceDays,
    limit,
    now: now(),
  });

  let totals = EMPTY_TOTALS;
  for (const org of pending) {
    const organizationId = toOrganizationId(org.id);
    const counts = await purgeOrganizationOwnedRows(args.db, organizationId);
    totals = addCounts(totals, counts);
    await tombstoneOrganization(args.db, organizationId);
  }

  args.logger.info('org_purge.completed', {
    grace_days: graceDays,
    limit,
    organizations_purged: pending.length,
    ...totals,
  });

  return { organizationsPurged: pending.length, totals };
}
