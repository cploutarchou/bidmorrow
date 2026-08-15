/**
 * Company profile & preferences repository — docs/data-model.md §2 plus
 * `digest_preferences` from §8 (docs/security.md C6).
 *
 * Every function REQUIRES `organizationId` as its first argument after `db`
 * and constrains every statement on it. Replace-style writes are
 * delete-all-then-insert within the organization, executed as one D1 batch
 * (a single SQL transaction), so a failed replace never leaves a half set.
 *
 * Caps (enforced here, before any statement runs): keywords ≤ 50, CPV
 * preferences ≤ 30 — violations throw `CapExceededError`.
 */
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { ContractNature, OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
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
import { organizations } from '../schema/identity';
import { CapExceededError } from './errors';
import {
  chunkForInsert,
  normalizeLimit,
  toBatch,
  toPage,
  type Page,
  type Pagination,
  type SqliteBatchItem,
} from './shared';

export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type CompanyCapability = typeof companyCapabilities.$inferSelect;
export type CompanyCertification = typeof companyCertifications.$inferSelect;
export type CompanyCpvPreference = typeof companyCpvPreferences.$inferSelect;
export type CompanyGeography = typeof companyGeographies.$inferSelect;
export type CompanyKeyword = typeof companyKeywords.$inferSelect;
export type CompanyExclusion = typeof companyExclusions.$inferSelect;
export type MatchingPreferences = typeof matchingPreferences.$inferSelect;
export type DigestPreferences = typeof digestPreferences.$inferSelect;

/** Per-organization caps (docs/product-scope.md input limits). */
export const COMPANY_KEYWORDS_CAP = 50;
export const COMPANY_CPV_PREFERENCES_CAP = 30;

export type CertificationCode = 'ISO_27001' | 'ISO_9001' | 'SOC2' | 'OTHER';
export type GeographyKind = 'preferred_nuts' | 'opportunity_country' | 'country_served';
export type KeywordKind = 'positive' | 'synonym';
export type ExclusionKind = 'cpv_family' | 'country' | 'nuts' | 'phrase' | 'contract_nature';
/** Lowest classification included in a digest — EXCLUDED is never digestable. */
export type DigestMinClassification =
  'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT';

// ---------------------------------------------------------------------------
// company_profiles (1:1 with organization)
// ---------------------------------------------------------------------------

export async function getCompanyProfile(
  db: Db,
  organizationId: OrganizationId,
): Promise<CompanyProfile | null> {
  const rows = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertCompanyProfileArgs {
  displayName: string | null;
  description: string | null;
  website: string | null;
  employeeBand: string | null;
  presetKey: string | null;
  /** Null until onboarding finished. */
  onboardingCompletedAt: number | null;
}

/** Full-row upsert keyed on the `organization_id` unique (1:1). */
export async function upsertCompanyProfile(
  db: Db,
  organizationId: OrganizationId,
  args: UpsertCompanyProfileArgs,
): Promise<CompanyProfile> {
  const now = Date.now();
  const rows = await db
    .insert(companyProfiles)
    .values({ id: newId(now), organizationId, ...args, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: companyProfiles.organizationId,
      set: { ...args, updatedAt: now },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('upsertCompanyProfile: upsert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Profile collection tables: list / replace within the organization
// ---------------------------------------------------------------------------

/**
 * Runs a replace as one atomic batch: the org-scoped delete followed by the
 * new rows, chunked under the bound-parameter budget.
 */
async function replaceBatch<TRow>(
  db: Db,
  deleteStatement: SqliteBatchItem,
  rows: TRow[],
  insert: (chunk: TRow[]) => SqliteBatchItem,
  columnCount: number,
): Promise<void> {
  const statements: SqliteBatchItem[] = [deleteStatement];
  for (const chunk of chunkForInsert(rows, columnCount)) {
    statements.push(insert(chunk));
  }
  await db.batch(toBatch(statements));
}

export async function listCompanyCapabilities(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyCapability>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyCapabilities.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyCapabilities.id, args.cursor));
  const rows = await db
    .select()
    .from(companyCapabilities)
    .where(and(...conditions))
    .orderBy(asc(companyCapabilities.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

/** Replaces the org's capability set (delete-all + insert, one transaction). */
export async function replaceCompanyCapabilities(
  db: Db,
  organizationId: OrganizationId,
  args: { labels: string[] },
): Promise<void> {
  const now = Date.now();
  const rows = args.labels.map((label) => ({
    id: newId(now),
    organizationId,
    label,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db.delete(companyCapabilities).where(eq(companyCapabilities.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyCapabilities).values(chunk),
    5,
  );
}

export async function listCompanyCertifications(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyCertification>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyCertifications.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyCertifications.id, args.cursor));
  const rows = await db
    .select()
    .from(companyCertifications)
    .where(and(...conditions))
    .orderBy(asc(companyCertifications.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

export async function replaceCompanyCertifications(
  db: Db,
  organizationId: OrganizationId,
  args: { certifications: { certificationCode: CertificationCode; label?: string | null }[] },
): Promise<void> {
  const now = Date.now();
  const rows = args.certifications.map((cert) => ({
    id: newId(now),
    organizationId,
    certificationCode: cert.certificationCode,
    label: cert.label ?? null,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db
      .delete(companyCertifications)
      .where(eq(companyCertifications.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyCertifications).values(chunk),
    6,
  );
}

export async function listCompanyCpvPreferences(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyCpvPreference>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyCpvPreferences.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyCpvPreferences.id, args.cursor));
  const rows = await db
    .select()
    .from(companyCpvPreferences)
    .where(and(...conditions))
    .orderBy(asc(companyCpvPreferences.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

/** @throws CapExceededError when more than 30 CPV codes are supplied. */
export async function replaceCompanyCpvPreferences(
  db: Db,
  organizationId: OrganizationId,
  args: { cpvCodes: string[] },
): Promise<void> {
  if (args.cpvCodes.length > COMPANY_CPV_PREFERENCES_CAP) {
    throw new CapExceededError(
      'company_cpv_preferences',
      COMPANY_CPV_PREFERENCES_CAP,
      args.cpvCodes.length,
    );
  }
  const now = Date.now();
  const rows = args.cpvCodes.map((cpvCode) => ({
    id: newId(now),
    organizationId,
    cpvCode,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db
      .delete(companyCpvPreferences)
      .where(eq(companyCpvPreferences.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyCpvPreferences).values(chunk),
    5,
  );
}

export async function listCompanyGeographies(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyGeography>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyGeographies.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyGeographies.id, args.cursor));
  const rows = await db
    .select()
    .from(companyGeographies)
    .where(and(...conditions))
    .orderBy(asc(companyGeographies.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

export async function replaceCompanyGeographies(
  db: Db,
  organizationId: OrganizationId,
  args: { geographies: { kind: GeographyKind; code: string }[] },
): Promise<void> {
  const now = Date.now();
  const rows = args.geographies.map((geo) => ({
    id: newId(now),
    organizationId,
    kind: geo.kind,
    code: geo.code,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db.delete(companyGeographies).where(eq(companyGeographies.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyGeographies).values(chunk),
    6,
  );
}

export async function listCompanyKeywords(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyKeyword>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyKeywords.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyKeywords.id, args.cursor));
  const rows = await db
    .select()
    .from(companyKeywords)
    .where(and(...conditions))
    .orderBy(asc(companyKeywords.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

export interface KeywordInput {
  kind: KeywordKind;
  /** Normalized (lower, diacritic-folded) phrase or word. */
  term: string;
  /** Required when kind = `synonym` (DB CHECK enforces consistency). */
  synonymGroup?: string | null;
  language?: string | null;
}

/** @throws CapExceededError when more than 50 keywords are supplied. */
export async function replaceCompanyKeywords(
  db: Db,
  organizationId: OrganizationId,
  args: { keywords: KeywordInput[] },
): Promise<void> {
  if (args.keywords.length > COMPANY_KEYWORDS_CAP) {
    throw new CapExceededError('company_keywords', COMPANY_KEYWORDS_CAP, args.keywords.length);
  }
  const now = Date.now();
  const rows = args.keywords.map((keyword) => ({
    id: newId(now),
    organizationId,
    kind: keyword.kind,
    term: keyword.term,
    synonymGroup: keyword.synonymGroup ?? null,
    language: keyword.language ?? null,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db.delete(companyKeywords).where(eq(companyKeywords.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyKeywords).values(chunk),
    8,
  );
}

export async function listCompanyExclusions(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<CompanyExclusion>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(companyExclusions.organizationId, organizationId)];
  if (args.cursor !== undefined) conditions.push(gt(companyExclusions.id, args.cursor));
  const rows = await db
    .select()
    .from(companyExclusions)
    .where(and(...conditions))
    .orderBy(asc(companyExclusions.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

export async function replaceCompanyExclusions(
  db: Db,
  organizationId: OrganizationId,
  args: { exclusions: { kind: ExclusionKind; value: string }[] },
): Promise<void> {
  const now = Date.now();
  const rows = args.exclusions.map((exclusion) => ({
    id: newId(now),
    organizationId,
    kind: exclusion.kind,
    value: exclusion.value,
    createdAt: now,
    updatedAt: now,
  }));
  await replaceBatch(
    db,
    db.delete(companyExclusions).where(eq(companyExclusions.organizationId, organizationId)),
    rows,
    (chunk) => db.insert(companyExclusions).values(chunk),
    6,
  );
}

// ---------------------------------------------------------------------------
// matching_preferences (1:1 with organization)
// ---------------------------------------------------------------------------

export async function getMatchingPreferences(
  db: Db,
  organizationId: OrganizationId,
): Promise<MatchingPreferences | null> {
  const rows = await db
    .select()
    .from(matchingPreferences)
    .where(eq(matchingPreferences.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertMatchingPreferencesArgs {
  /** Null = no bound. */
  minValueEur: number | null;
  /** Null = no bound. */
  maxValueEur: number | null;
  supportedContractNatures: ContractNature[];
  /** Null = threshold unset (deadline rule scores 0 instead of hard-excluding). */
  minimumDaysRemaining: number | null;
}

export async function upsertMatchingPreferences(
  db: Db,
  organizationId: OrganizationId,
  args: UpsertMatchingPreferencesArgs,
): Promise<MatchingPreferences> {
  const now = Date.now();
  const values = {
    minValueEur: args.minValueEur,
    maxValueEur: args.maxValueEur,
    supportedContractNaturesJson: JSON.stringify(args.supportedContractNatures),
    minimumDaysRemaining: args.minimumDaysRemaining,
  };
  const rows = await db
    .insert(matchingPreferences)
    .values({ id: newId(now), organizationId, ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: matchingPreferences.organizationId,
      set: { ...values, updatedAt: now },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('upsertMatchingPreferences: upsert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// digest_preferences (1:1 with organization; docs/data-model.md §8)
// ---------------------------------------------------------------------------

export async function getDigestPreferences(
  db: Db,
  organizationId: OrganizationId,
): Promise<DigestPreferences | null> {
  const rows = await db
    .select()
    .from(digestPreferences)
    .where(eq(digestPreferences.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertDigestPreferencesArgs {
  enabled: boolean;
  /** Send even when no meaningful matches exist. */
  sendEmpty: boolean;
  minClassification: DigestMinClassification;
  /** IANA timezone, e.g. `Europe/Nicosia`. */
  timezone: string;
}

export async function upsertDigestPreferences(
  db: Db,
  organizationId: OrganizationId,
  args: UpsertDigestPreferencesArgs,
): Promise<DigestPreferences> {
  const now = Date.now();
  const values = {
    enabled: args.enabled ? 1 : 0,
    sendEmpty: args.sendEmpty ? 1 : 0,
    minClassification: args.minClassification,
    timezone: args.timezone,
  };
  const rows = await db
    .insert(digestPreferences)
    .values({ id: newId(now), organizationId, ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: digestPreferences.organizationId,
      set: { ...values, updatedAt: now },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('upsertDigestPreferences: upsert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Digest eligibility (Phase 8): which orgs the digest scheduler considers
// ---------------------------------------------------------------------------

export interface DigestEnabledOrg {
  readonly organizationId: OrganizationId;
  /** IANA tz; drives which "day" a digest_date covers. */
  readonly timezone: string;
  readonly minClassification: DigestMinClassification;
  readonly sendEmpty: boolean;
}

/**
 * Every ACTIVE organization with digest sending enabled, across ALL
 * tenants — the digest scheduler equivalent of `listOrgsEligibleForScoring`
 * (same "enumerate every tenant" rationale, same unpaginated-is-fine
 * justification for V1's small customer count). Never reachable from a
 * per-request handler; only the hourly digest cron/queue-selection path
 * calls this.
 */
export async function listOrgsWithDigestEnabled(db: Db): Promise<DigestEnabledOrg[]> {
  const rows = await db
    .select({
      organizationId: digestPreferences.organizationId,
      timezone: digestPreferences.timezone,
      minClassification: digestPreferences.minClassification,
      sendEmpty: digestPreferences.sendEmpty,
    })
    .from(digestPreferences)
    .innerJoin(organizations, eq(organizations.id, digestPreferences.organizationId))
    .where(
      and(
        eq(digestPreferences.enabled, 1),
        eq(organizations.status, 'active'),
        isNull(organizations.suspendedAt),
      ),
    );
  return rows.map((row) => ({
    organizationId: row.organizationId as OrganizationId,
    timezone: row.timezone,
    minClassification: row.minClassification as DigestMinClassification,
    sendEmpty: row.sendEmpty === 1,
  }));
}

// ---------------------------------------------------------------------------
// Scoring eligibility (Phase 6): which orgs the matching engine considers
// ---------------------------------------------------------------------------

/**
 * Org ids eligible for scoring: has a `company_profiles` row AND at least
 * one `company_cpv_preferences` row. An org that has not onboarded (no
 * profile) or has not set any CPV preference (nothing for the CPV
 * pre-filter to compare against — every pair would either need a full-text
 * fallback or trivially match/skip everything) is never scored; this keeps
 * the eligibility rule identical to the CPV pre-filter's own prerequisite.
 * Unpaginated: V1 customer counts are small (docs/cost-model.md), so a
 * single query is correct and simple; revisit if the org count grows past
 * low thousands.
 */
export async function listOrgsEligibleForScoring(db: Db): Promise<OrganizationId[]> {
  const rows = await db
    .selectDistinct({ organizationId: companyProfiles.organizationId })
    .from(companyProfiles)
    .innerJoin(
      companyCpvPreferences,
      eq(companyCpvPreferences.organizationId, companyProfiles.organizationId),
    )
    .orderBy(asc(companyProfiles.organizationId));
  return rows.map((row) => row.organizationId as OrganizationId);
}
