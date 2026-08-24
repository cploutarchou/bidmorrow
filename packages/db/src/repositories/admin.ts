/**
 * ADMIN repository — Phase 10 stage A INTERNAL_ADMIN cross-tenant reads
 * (docs/security.md C6/C11).
 *
 * Every function in this file is reachable ONLY from `/api/admin/*`
 * (`apps/worker/src/routes/admin.ts`, gated by
 * `apps/worker/src/middleware/admin.ts`'s `requireInternalAdmin` allowlist
 * check + audit logging). This is a DELIBERATE, DOCUMENTED exception to the
 * "every tenant-owned repository function requires organizationId" contract
 * (docs/security.md C6): internal admin/ops tooling legitimately needs to
 * search/inspect/aggregate ACROSS every organization (find an org by name,
 * count subscriptions by status, list recent digest runs for every tenant,
 * etc.) — that is impossible if every read is pinned to a single
 * organizationId. No customer-facing route may ever import this module;
 * `tests/security/tenant-isolation-contract.test.ts` documents and enforces
 * that boundary (this file is classified as a GLOBAL file there, with an
 * explicit exemption comment, precisely BECAUSE it imports tenant schema
 * modules for cross-tenant reads — the opposite of every other GLOBAL
 * file's guarantee).
 *
 * Every function here is READ-ONLY except `getDbSizeEstimate` (also
 * read-only) — the two admin MUTATIONS this phase ships
 * (`suspendOrganization`/`unsuspendOrganization`) are contract-compliant
 * (they take `organizationId` as a normal tenant function would) and live
 * in `identity.ts`, not here.
 */
import { and, count, desc, eq, gte, like, lt, sql } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { auditEvents, supportNotes } from '../schema/ops';
import { companyProfiles, digestPreferences } from '../schema/company';
import { customerFeedback, digestRuns, emailDeliveries, savedTenders } from '../schema/engagement';
import { organizationMembers, organizations, users } from '../schema/identity';
import { ingestionErrors, ingestionRuns } from '../schema/ingestion';
import { tenderMatches } from '../schema/matching';
import { tenderLots, tenderNotices } from '../schema/tender';
import { subscriptions } from '../schema/billing';
import { normalizeLimit, toPage } from './shared';
import type { Page, Pagination } from './shared';

// ---------------------------------------------------------------------------
// Organization search/inspect
// ---------------------------------------------------------------------------

export interface OrgSearchRow {
  readonly organization: typeof organizations.$inferSelect;
  readonly memberCount: number;
  readonly subscription: typeof subscriptions.$inferSelect | null;
}

/** Case-insensitive substring search over org name (LIKE, no escaping needed — admin-only input, not a customer surface). */
export async function searchOrganizationsAdmin(
  db: Db,
  args: { query?: string } & Pagination,
): Promise<Page<OrgSearchRow>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [
    args.query === undefined || args.query.length === 0
      ? undefined
      : like(organizations.name, `%${args.query}%`),
    args.cursor === undefined ? undefined : lt(organizations.id, args.cursor),
  ];
  const rows = await db
    .select({ organization: organizations, subscription: subscriptions })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .where(and(...conditions))
    .orderBy(desc(organizations.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (last) => last.organization.id);

  if (page.items.length === 0) return { items: [], nextCursor: page.nextCursor };
  const orgIds = page.items.map((row) => row.organization.id);
  const memberCounts = await db
    .select({ organizationId: organizationMembers.organizationId, n: count() })
    .from(organizationMembers)
    .where(sql`${organizationMembers.organizationId} IN ${orgIds}`)
    .groupBy(organizationMembers.organizationId);
  const countByOrg = new Map(memberCounts.map((r) => [r.organizationId, r.n]));

  return {
    items: page.items.map((row) => ({
      organization: row.organization,
      subscription: row.subscription,
      memberCount: countByOrg.get(row.organization.id) ?? 0,
    })),
    nextCursor: page.nextCursor,
  };
}

export interface OrgAdminDetail {
  readonly organization: typeof organizations.$inferSelect;
  readonly profile: typeof companyProfiles.$inferSelect | null;
  readonly subscription: typeof subscriptions.$inferSelect | null;
  readonly digestPreferences: typeof digestPreferences.$inferSelect | null;
  readonly memberEmails: readonly string[];
  readonly counts: {
    readonly matches: number;
    readonly saved: number;
    readonly feedback: number;
  };
}

/** Full admin detail bundle for one organization — the `GET /api/admin/orgs/:id` payload. */
export async function getOrgAdminDetail(
  db: Db,
  organizationId: OrganizationId,
): Promise<OrgAdminDetail | null> {
  const organization = (
    await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1)
  )[0];
  if (organization === undefined) return null;

  const [profile, subscription, prefs, members, matchCount, savedCount, feedbackCount] =
    await Promise.all([
      db
        .select()
        .from(companyProfiles)
        .where(eq(companyProfiles.organizationId, organizationId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(digestPreferences)
        .where(eq(digestPreferences.organizationId, organizationId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({ email: users.email })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId)),
      db
        .select({ n: count() })
        .from(tenderMatches)
        .where(eq(tenderMatches.organizationId, organizationId))
        .then((r) => r[0]?.n ?? 0),
      db
        .select({ n: count() })
        .from(savedTenders)
        .where(eq(savedTenders.organizationId, organizationId))
        .then((r) => r[0]?.n ?? 0),
      db
        .select({ n: count() })
        .from(customerFeedback)
        .where(eq(customerFeedback.organizationId, organizationId))
        .then((r) => r[0]?.n ?? 0),
    ]);

  return {
    organization,
    profile,
    subscription,
    digestPreferences: prefs,
    memberEmails: members.map((m) => m.email),
    counts: { matches: matchCount, saved: savedCount, feedback: feedbackCount },
  };
}

// ---------------------------------------------------------------------------
// User search
// ---------------------------------------------------------------------------

export interface UserSearchRow {
  readonly user: typeof users.$inferSelect;
  readonly organizationIds: readonly string[];
}

export async function searchUsersAdmin(
  db: Db,
  args: { query?: string } & Pagination,
): Promise<Page<UserSearchRow>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [
    args.query === undefined || args.query.length === 0
      ? undefined
      : like(users.email, `%${args.query}%`),
    args.cursor === undefined ? undefined : lt(users.id, args.cursor),
  ];
  const rows = await db
    .select()
    .from(users)
    .where(and(...conditions))
    .orderBy(desc(users.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (last) => last.id);
  if (page.items.length === 0) return { items: [], nextCursor: page.nextCursor };

  const userIds = page.items.map((u) => u.id);
  const memberships = await db
    .select({
      userId: organizationMembers.userId,
      organizationId: organizationMembers.organizationId,
    })
    .from(organizationMembers)
    .where(sql`${organizationMembers.userId} IN ${userIds}`);
  const orgsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = orgsByUser.get(m.userId) ?? [];
    list.push(m.organizationId);
    orgsByUser.set(m.userId, list);
  }
  return {
    items: page.items.map((user) => ({
      user,
      organizationIds: orgsByUser.get(user.id) ?? [],
    })),
    nextCursor: page.nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function listSubscriptionsAdmin(
  db: Db,
  args: { status?: string } & Pagination,
): Promise<Page<typeof subscriptions.$inferSelect>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        args.status === undefined ? undefined : eq(subscriptions.status, args.status),
        args.cursor === undefined ? undefined : lt(subscriptions.id, args.cursor),
      ),
    )
    .orderBy(desc(subscriptions.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

// ---------------------------------------------------------------------------
// Digest / email ops
// ---------------------------------------------------------------------------

export async function listDigestRunsAdmin(
  db: Db,
  args: Pagination = {},
): Promise<Page<typeof digestRuns.$inferSelect>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(digestRuns)
    .where(args.cursor === undefined ? undefined : lt(digestRuns.id, args.cursor))
    .orderBy(desc(digestRuns.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

export async function listEmailFailuresAdmin(
  db: Db,
  args: Pagination = {},
): Promise<Page<typeof emailDeliveries.$inferSelect>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.status, 'failed'),
        args.cursor === undefined ? undefined : lt(emailDeliveries.id, args.cursor),
      ),
    )
    .orderBy(desc(emailDeliveries.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

// ---------------------------------------------------------------------------
// Audit events (read side — writes stay in ops.ts)
// ---------------------------------------------------------------------------

export interface ListAuditEventsArgs extends Pagination {
  readonly actorId?: string;
  readonly action?: string;
  /** Inclusive lower bound on `occurred_at`. */
  readonly sinceMs?: number;
}

export async function listAuditEventsAdmin(
  db: Db,
  args: ListAuditEventsArgs = {},
): Promise<Page<typeof auditEvents.$inferSelect>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        args.actorId === undefined ? undefined : eq(auditEvents.actorId, args.actorId),
        args.action === undefined ? undefined : eq(auditEvents.action, args.action),
        args.sinceMs === undefined ? undefined : gte(auditEvents.occurredAt, args.sinceMs),
        args.cursor === undefined ? undefined : lt(auditEvents.id, args.cursor),
      ),
    )
    .orderBy(desc(auditEvents.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.id);
}

// ---------------------------------------------------------------------------
// Health/usage
// ---------------------------------------------------------------------------

export interface UsageCounts {
  readonly organizations: number;
  readonly users: number;
  readonly notices: number;
  readonly lots: number;
  readonly matches: number;
}

/** Row counts of the major tables — a cost proxy (docs/cost-model.md), not a billing figure. */
export async function getUsageCounts(db: Db): Promise<UsageCounts> {
  const [organizationsN, usersN, noticesN, lotsN, matchesN] = await Promise.all([
    db
      .select({ n: count() })
      .from(organizations)
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(users)
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(tenderNotices)
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(tenderLots)
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(tenderMatches)
      .then((r) => r[0]?.n ?? 0),
  ]);
  return {
    organizations: organizationsN,
    users: usersN,
    notices: noticesN,
    lots: lotsN,
    matches: matchesN,
  };
}

export interface RailCounts {
  readonly organizations: number;
  readonly users: number;
  readonly subscriptions: number;
  readonly ingestionRuns: number;
  readonly digestRuns: number;
  readonly supportNotes: number;
  readonly auditEvents: number;
}

/**
 * Per-section totals for the admin shell's rail (prototype's nav counts) —
 * plain COUNT(*)s in one D1 batch. Flags are not counted here: the flag set
 * is the static `FEATURE_FLAG_KEYS` enum, which the route layer owns.
 */
export async function getRailCounts(db: Db): Promise<RailCounts> {
  const [orgsN, usersN, subsN, ingestionN, digestN, supportN, auditN] = await db.batch([
    db.select({ n: count() }).from(organizations),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(subscriptions),
    db.select({ n: count() }).from(ingestionRuns),
    db.select({ n: count() }).from(digestRuns),
    db.select({ n: count() }).from(supportNotes),
    db.select({ n: count() }).from(auditEvents),
  ]);
  return {
    organizations: orgsN[0]?.n ?? 0,
    users: usersN[0]?.n ?? 0,
    subscriptions: subsN[0]?.n ?? 0,
    ingestionRuns: ingestionN[0]?.n ?? 0,
    digestRuns: digestN[0]?.n ?? 0,
    supportNotes: supportN[0]?.n ?? 0,
    auditEvents: auditN[0]?.n ?? 0,
  };
}

export interface RecentErrorCounts {
  readonly ingestionErrors24h: number;
  readonly emailFailures24h: number;
}

/** Error counts over the trailing 24h — feeds `GET /api/admin/health/details`. */
export async function getRecentErrorCounts(db: Db, nowMs: number): Promise<RecentErrorCounts> {
  const since = nowMs - 24 * 60 * 60 * 1000;
  const [ingestionN, emailN] = await Promise.all([
    db
      .select({ n: count() })
      .from(ingestionErrors)
      .where(gte(ingestionErrors.createdAt, since))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.status, 'failed'), gte(emailDeliveries.createdAt, since)))
      .then((r) => r[0]?.n ?? 0),
  ]);
  return { ingestionErrors24h: ingestionN, emailFailures24h: emailN };
}

export interface DbSizeEstimate {
  /** True when `page_count`/`page_size` PRAGMAs were readable; false when this is a row-count-based estimate instead. */
  readonly measured: boolean;
  readonly approxBytes: number | null;
}

/**
 * DB-size proxy for `GET /api/admin/health/details`. D1's SQLite engine
 * supports the standard `PRAGMA page_count`/`PRAGMA page_size` read-only
 * pragmas over its `.prepare()` path, but this has NOT been round-tripped
 * against a real deployed D1 database from this dev environment (same
 * verification-gap category as the Phase 7 `_headers` caveat — Cloudflare
 * docs hosts are proxy-blocked here). Implemented defensively: on any
 * failure (pragma unsupported, network, etc.) this returns `measured:
 * false` with `approxBytes: null` rather than fabricating a number — the
 * caller must treat that as "size unknown", never silently show 0.
 */
export async function getDbSizeEstimate(db: Db): Promise<DbSizeEstimate> {
  try {
    const pageCountRow = await db.get<{ page_count: number }>(sql`PRAGMA page_count`);
    const pageSizeRow = await db.get<{ page_size: number }>(sql`PRAGMA page_size`);
    const pageCount = pageCountRow?.page_count;
    const pageSize = pageSizeRow?.page_size;
    if (
      typeof pageCount !== 'number' ||
      typeof pageSize !== 'number' ||
      !Number.isFinite(pageCount) ||
      !Number.isFinite(pageSize)
    ) {
      return { measured: false, approxBytes: null };
    }
    return { measured: true, approxBytes: pageCount * pageSize };
  } catch {
    return { measured: false, approxBytes: null };
  }
}
