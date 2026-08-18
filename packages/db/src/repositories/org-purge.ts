/**
 * GLOBAL repository — hard-deletes a soft-deleted organization's owned rows
 * after the retention grace period (docs/data-model.md §11 reconciliation,
 * docs/privacy.md commitments 2/3, Phase 11 stage A).
 *
 * Not a per-organization ("tenant-scoped") repository in the usual C6 sense
 * — this is the ADMIN/OPS-equivalent exception documented in `admin.ts`'s
 * header: it operates ACROSS organizations by design (a purge sweep must
 * find every eligible deleted org, not act within one caller's tenant).
 * Reachable ONLY from the daily retention cron path
 * (`apps/procurement/src/org-purge.ts` composes this with
 * `identity.ts`'s `listOrganizationsPendingPurge`/`tombstoneOrganization`),
 * never from a customer-facing route.
 *
 * FK-safe deletion order, enumerated from every table in docs/data-model.md
 * that carries `organization_id` (directly or, for `match_components`/
 * `match_risk_flags`/`digest_items`, transitively through a parent row this
 * function also owns the deletion of). `tender_matches` has TWO dependents
 * that are NOT its usual components/flags — `customer_feedback.match_id`
 * (NOT NULL FK) and `digest_items.match_id` — so both must be cleared
 * BEFORE `tender_matches` itself, ahead of where their step number below
 * would otherwise put them:
 *
 *  1. customer_feedback                     (organization_id — cleared early:
 *     its match_id FK would block deleting tender_matches otherwise)
 *  1. digest_items                          (by digest_run_id, runs owned by
 *     org — same reason: its match_id FK would block tender_matches)
 *  2. match_risk_flags, match_components   (by match_id, matches owned by org)
 *  2. tender_matches                        (organization_id)
 *  3. saved_tenders, ignored_tenders        (organization_id)
 *  3. digest_runs                           (organization_id — items already gone)
 *  4. email_deliveries                      (organization_id — digest sends only;
 *     the row is org-linked, not user-linked, for this org)
 *  5. company_profiles, company_capabilities, company_certifications,
 *     company_cpv_preferences, company_geographies, company_keywords,
 *     company_exclusions, matching_preferences, digest_preferences
 *  6. support_notes                         (organization_id)
 *  6. product_events                        (organization_id — deleted, not
 *     nulled: docs/privacy.md commitment 2 lists product events among what
 *     org deletion removes; unlike the anonymous/marketing rows this
 *     table also carries, an org-linked row has no purpose once the org
 *     that generated it is gone)
 *  7. organization_members                  (organization_id — any leftover
 *     membership rows; account deletion removes a user's OWN membership
 *     eagerly, but other members' rows survive until this purge)
 *
 * Deliberately NEVER deleted by this purge (see identity.ts
 * `tombstoneOrganization`'s doc for the FK reasoning):
 *  - `subscriptions` — billing/legal record, retained for accounting/
 *    dispute-resolution obligations beyond the life of the org relationship
 *    (docs/data-model.md §9 "D1 rows: life of org + accounting
 *    obligations").
 *  - `audit_events` / `billing_events` — append-only ledgers (security
 *    forensics, docs/security.md C8; Stripe webhook idempotency ledger);
 *    `organization_id` is retained on these rows even after the org is
 *    gone, exactly like `audit_events.actor_id` survives account deletion.
 *  - The `organizations` row itself — kept as a tombstone (name replaced,
 *    `status` stays `deleted`) so the above FKs never dangle.
 */
import { eq, inArray } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import {
  companyCapabilities,
  companyCertifications,
  companyCpvPreferences,
  companyExclusions,
  companyGeographies,
  companyKeywords,
  companyProfiles,
  digestPreferences,
  matchingPreferences,
} from '../schema/company';
import {
  customerFeedback,
  digestItems,
  digestRuns,
  emailDeliveries,
  ignoredTenders,
  savedTenders,
} from '../schema/engagement';
import { organizationMembers } from '../schema/identity';
import { matchComponents, matchRiskFlags, tenderMatches } from '../schema/matching';
import { productEvents, supportNotes } from '../schema/ops';

/** D1 chunk size for `inArray(...)` — stays well under SQLite's bound-parameter cap. */
const ID_CHUNK_SIZE = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface OrgPurgeCounts {
  readonly matchComponentsDeleted: number;
  readonly matchRiskFlagsDeleted: number;
  readonly tenderMatchesDeleted: number;
  readonly customerFeedbackDeleted: number;
  readonly savedTendersDeleted: number;
  readonly ignoredTendersDeleted: number;
  readonly digestItemsDeleted: number;
  readonly digestRunsDeleted: number;
  readonly emailDeliveriesDeleted: number;
  readonly companyRowsDeleted: number;
  readonly supportNotesDeleted: number;
  readonly productEventsDeleted: number;
  readonly organizationMembersDeleted: number;
}

/**
 * Hard-deletes every owned row for ONE organization, in the FK-safe order
 * documented above. The caller (packages/procurement `org-purge.ts`) is
 * responsible for verifying the organization is actually eligible
 * (`status = 'deleted'`, past grace) before calling this — this function
 * performs no eligibility check, only the mechanical cascade, mirroring
 * `retention.ts`'s `deleteNoticesCascade`.
 */
export async function purgeOrganizationOwnedRows(
  db: Db,
  organizationId: OrganizationId,
): Promise<OrgPurgeCounts> {
  // 1: `tender_matches` has TWO dependents that must be cleared BEFORE the
  // match rows themselves — `customer_feedback.match_id` (NOT NULL FK) and
  // `digest_items.match_id` (nullable FK, but this purge deletes the whole
  // `digest_items` row, not just the reference). Both are deleted here,
  // ahead of `match_components`/`match_risk_flags`/`tender_matches`, or the
  // D1 FK constraint rejects the `tender_matches` delete.
  const matchIds = (
    await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, organizationId))
  ).map((r) => r.id);

  const customerFeedbackDeleted = (
    await db
      .delete(customerFeedback)
      .where(eq(customerFeedback.organizationId, organizationId))
      .returning({ id: customerFeedback.id })
  ).length;

  const digestRunIds = (
    await db
      .select({ id: digestRuns.id })
      .from(digestRuns)
      .where(eq(digestRuns.organizationId, organizationId))
  ).map((r) => r.id);
  let digestItemsDeleted = 0;
  for (const idsChunk of chunk(digestRunIds, ID_CHUNK_SIZE)) {
    digestItemsDeleted += (
      await db
        .delete(digestItems)
        .where(inArray(digestItems.digestRunId, idsChunk))
        .returning({ id: digestItems.id })
    ).length;
  }

  // 2: components/flags, then the match rows themselves.
  let matchComponentsDeleted = 0;
  let matchRiskFlagsDeleted = 0;
  for (const idsChunk of chunk(matchIds, ID_CHUNK_SIZE)) {
    matchComponentsDeleted += (
      await db
        .delete(matchComponents)
        .where(inArray(matchComponents.matchId, idsChunk))
        .returning({ id: matchComponents.id })
    ).length;
    matchRiskFlagsDeleted += (
      await db
        .delete(matchRiskFlags)
        .where(inArray(matchRiskFlags.matchId, idsChunk))
        .returning({ id: matchRiskFlags.id })
    ).length;
  }

  const tenderMatchesDeleted = (
    await db
      .delete(tenderMatches)
      .where(eq(tenderMatches.organizationId, organizationId))
      .returning({ id: tenderMatches.id })
  ).length;

  // 3-4: the rest of customer actions + digest runs (items already cleared above).
  const savedTendersDeleted = (
    await db
      .delete(savedTenders)
      .where(eq(savedTenders.organizationId, organizationId))
      .returning({ id: savedTenders.id })
  ).length;
  const ignoredTendersDeleted = (
    await db
      .delete(ignoredTenders)
      .where(eq(ignoredTenders.organizationId, organizationId))
      .returning({ id: ignoredTenders.id })
  ).length;
  const digestRunsDeleted = (
    await db
      .delete(digestRuns)
      .where(eq(digestRuns.organizationId, organizationId))
      .returning({ id: digestRuns.id })
  ).length;

  // 5: outbound digest email log for this org.
  const emailDeliveriesDeleted = (
    await db
      .delete(emailDeliveries)
      .where(eq(emailDeliveries.organizationId, organizationId))
      .returning({ id: emailDeliveries.id })
  ).length;

  // 6: company profile & preference tables (small, ≤ tens of rows each).
  let companyRowsDeleted = 0;
  for (const table of [
    companyProfiles,
    companyCapabilities,
    companyCertifications,
    companyCpvPreferences,
    companyGeographies,
    companyKeywords,
    companyExclusions,
    matchingPreferences,
    digestPreferences,
  ] as const) {
    companyRowsDeleted += (
      await db
        .delete(table)
        .where(eq(table.organizationId, organizationId))
        .returning({ id: table.id })
    ).length;
  }

  // 7: admin/analytics rows linked to this org.
  const supportNotesDeleted = (
    await db
      .delete(supportNotes)
      .where(eq(supportNotes.organizationId, organizationId))
      .returning({ id: supportNotes.id })
  ).length;
  const productEventsDeleted = (
    await db
      .delete(productEvents)
      .where(eq(productEvents.organizationId, organizationId))
      .returning({ id: productEvents.id })
  ).length;

  // 8: any membership rows other members left behind (the deleting OWNER's
  // own membership may already be gone if they also deleted their account;
  // this is idempotent either way).
  const organizationMembersDeleted = (
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))
      .returning({ id: organizationMembers.id })
  ).length;

  return {
    matchComponentsDeleted,
    matchRiskFlagsDeleted,
    tenderMatchesDeleted,
    customerFeedbackDeleted,
    savedTendersDeleted,
    ignoredTendersDeleted,
    digestItemsDeleted,
    digestRunsDeleted,
    emailDeliveriesDeleted,
    companyRowsDeleted,
    supportNotesDeleted,
    productEventsDeleted,
    organizationMembersDeleted,
  };
}
