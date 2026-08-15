/**
 * Data-export repository — docs/privacy.md commitment 4 (Phase 11 stage A):
 * a per-org, self-service JSON export covering the org's OWN data (profile,
 * preferences, saved/ignored/feedback with tender titles, digest
 * preferences). Deliberately does NOT include the global tender corpus
 * (notices/lots/CPV/geography) beyond the display fields already
 * denormalized onto the org's own rows — that data is public TED content,
 * not something a portability request needs to re-export.
 *
 * Every function requires `organizationId` (docs/security.md C6). Bounded:
 * `EXPORT_ROW_CAP` per collection keeps one export call's D1 read cost
 * fixed regardless of org age/activity — an org that has saved/fed-back on
 * more than that needs a follow-up export (documented in the response
 * shape via `truncated`), never an unbounded read.
 */
import { desc, eq } from 'drizzle-orm';
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
import { customerFeedback, ignoredTenders, savedTenders } from '../schema/engagement';
import { tenderLots } from '../schema/tender';

/** Per-collection row cap (config) — see module doc. */
export const EXPORT_ROW_CAP = 500;

export interface ExportSavedTenderRow {
  readonly lotId: string;
  readonly noticeId: string;
  readonly title: string;
  readonly savedAt: number;
}

export interface ExportIgnoredTenderRow {
  readonly lotId: string;
  readonly noticeId: string;
  readonly title: string;
  readonly reason: string | null;
  readonly ignoredAt: number;
}

export interface ExportFeedbackRow {
  readonly matchId: string;
  readonly verdict: string;
  readonly reasonsJson: string | null;
  readonly comment: string | null;
  readonly createdAt: number;
}

export interface OrgExportBundle {
  readonly organizationId: OrganizationId;
  readonly generatedAt: number;
  readonly profile: typeof companyProfiles.$inferSelect | null;
  readonly capabilities: (typeof companyCapabilities.$inferSelect)[];
  readonly certifications: (typeof companyCertifications.$inferSelect)[];
  readonly cpvPreferences: (typeof companyCpvPreferences.$inferSelect)[];
  readonly geographies: (typeof companyGeographies.$inferSelect)[];
  readonly keywords: (typeof companyKeywords.$inferSelect)[];
  readonly exclusions: (typeof companyExclusions.$inferSelect)[];
  readonly matchingPreferences: typeof matchingPreferences.$inferSelect | null;
  readonly digestPreferences: typeof digestPreferences.$inferSelect | null;
  readonly savedTenders: ExportSavedTenderRow[];
  readonly ignoredTenders: ExportIgnoredTenderRow[];
  readonly feedback: ExportFeedbackRow[];
  /** True when any collection was capped at `EXPORT_ROW_CAP` — a follow-up export covers the rest. */
  readonly truncated: boolean;
}

/**
 * Assembles the full export bundle for one organization. Every read is
 * `organizationId`-scoped; the saved/ignored joins pull `tender_lots.title`
 * for display (public TED content, safe to echo back) without exporting
 * the rest of the lot/notice corpus.
 */
export async function getOrgExportBundle(
  db: Db,
  organizationId: OrganizationId,
): Promise<OrgExportBundle> {
  const [
    profileRows,
    capabilities,
    certifications,
    cpvPreferences,
    geographies,
    keywords,
    exclusions,
    matchingPrefsRows,
    digestPrefsRows,
    savedRows,
    ignoredRows,
    feedbackRows,
  ] = await Promise.all([
    db.select().from(companyProfiles).where(eq(companyProfiles.organizationId, organizationId)),
    db
      .select()
      .from(companyCapabilities)
      .where(eq(companyCapabilities.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(companyCertifications)
      .where(eq(companyCertifications.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(companyCpvPreferences)
      .where(eq(companyCpvPreferences.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(companyGeographies)
      .where(eq(companyGeographies.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(companyKeywords)
      .where(eq(companyKeywords.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(companyExclusions)
      .where(eq(companyExclusions.organizationId, organizationId))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select()
      .from(matchingPreferences)
      .where(eq(matchingPreferences.organizationId, organizationId)),
    db.select().from(digestPreferences).where(eq(digestPreferences.organizationId, organizationId)),
    db
      .select({
        lotId: savedTenders.lotId,
        noticeId: savedTenders.noticeId,
        title: tenderLots.title,
        savedAt: savedTenders.createdAt,
      })
      .from(savedTenders)
      .innerJoin(tenderLots, eq(tenderLots.id, savedTenders.lotId))
      .where(eq(savedTenders.organizationId, organizationId))
      .orderBy(desc(savedTenders.createdAt))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select({
        lotId: ignoredTenders.lotId,
        noticeId: ignoredTenders.noticeId,
        title: tenderLots.title,
        reason: ignoredTenders.reason,
        ignoredAt: ignoredTenders.createdAt,
      })
      .from(ignoredTenders)
      .innerJoin(tenderLots, eq(tenderLots.id, ignoredTenders.lotId))
      .where(eq(ignoredTenders.organizationId, organizationId))
      .orderBy(desc(ignoredTenders.createdAt))
      .limit(EXPORT_ROW_CAP + 1),
    db
      .select({
        matchId: customerFeedback.matchId,
        verdict: customerFeedback.verdict,
        reasonsJson: customerFeedback.reasonsJson,
        comment: customerFeedback.comment,
        createdAt: customerFeedback.createdAt,
      })
      .from(customerFeedback)
      .where(eq(customerFeedback.organizationId, organizationId))
      .orderBy(desc(customerFeedback.createdAt))
      .limit(EXPORT_ROW_CAP + 1),
  ]);

  const cap = <T>(rows: T[]): { items: T[]; truncated: boolean } =>
    rows.length > EXPORT_ROW_CAP
      ? { items: rows.slice(0, EXPORT_ROW_CAP), truncated: true }
      : { items: rows, truncated: false };

  const cappedCapabilities = cap(capabilities);
  const cappedCertifications = cap(certifications);
  const cappedCpv = cap(cpvPreferences);
  const cappedGeo = cap(geographies);
  const cappedKeywords = cap(keywords);
  const cappedExclusions = cap(exclusions);
  const cappedSaved = cap(savedRows);
  const cappedIgnored = cap(ignoredRows);
  const cappedFeedback = cap(feedbackRows);

  const truncated = [
    cappedCapabilities,
    cappedCertifications,
    cappedCpv,
    cappedGeo,
    cappedKeywords,
    cappedExclusions,
    cappedSaved,
    cappedIgnored,
    cappedFeedback,
  ].some((c) => c.truncated);

  return {
    organizationId,
    generatedAt: Date.now(),
    profile: profileRows[0] ?? null,
    capabilities: cappedCapabilities.items,
    certifications: cappedCertifications.items,
    cpvPreferences: cappedCpv.items,
    geographies: cappedGeo.items,
    keywords: cappedKeywords.items,
    exclusions: cappedExclusions.items,
    matchingPreferences: matchingPrefsRows[0] ?? null,
    digestPreferences: digestPrefsRows[0] ?? null,
    savedTenders: cappedSaved.items,
    ignoredTenders: cappedIgnored.items,
    feedback: cappedFeedback.items,
    truncated,
  };
}
