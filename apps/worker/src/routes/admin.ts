/**
 * `/api/admin/*` — INTERNAL_ADMIN surface (Phase 10 stage A). Gated entirely
 * by `requireInternalAdmin` (404 for every non-admin caller, and every
 * request audited — see that middleware's doc comment). Search/debug/ops
 * tooling for the team; never a customer-facing surface.
 *
 * CONFIRMATION PATTERN: every mutation route requires an exact-string
 * `confirm` field in its request body (a distinct literal per action,
 * defined below). Missing/mismatched `confirm` fails zod validation and
 * `@hono/zod-validator` returns 400 automatically, before the handler body
 * ever runs — this is a deliberate "type the action name" friction gate for
 * destructive/high-blast-radius admin actions (suspend an org, pause
 * ingestion/digest globally, flip a feature flag, trigger a backfill/
 * recompute), not a security boundary (that is `requireInternalAdmin`
 * alone) — it exists to make an admin's own mistake harder, not to stop an
 * attacker who has already cleared the allowlist gate.
 *
 * PAGINATION: every list route accepts `limit`/`cursor` and clamps to the
 * repository's normal [1,100]-but-defaulting-25 contract; this file
 * additionally caps the REQUESTED limit at 50 (docs instruction: "pagination
 * ≤50 everywhere") via `adminLimitSchema`.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  FEATURE_FLAG_KEYS,
  FLAG_DIGEST_PAUSED,
  FLAG_ENTITLEMENT_ENFORCED,
  FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED,
  FLAG_FOUNDING_CAP,
  FLAG_FOUNDING_PLAN_OPEN,
  FLAG_INGESTION_CPV_SCOPE,
  FLAG_INGESTION_PAUSED,
  FLAG_STRIPE_TAX,
  FLAG_PRELAUNCH,
  FLAG_LAUNCH_DATE,
} from '@bidmorrow/config';
import type { FeatureFlagKey } from '@bidmorrow/config';
import {
  countFetchRetriesByStatus,
  createDb,
  getFeatureFlag,
  getNoticeDebugBundle,
  getOrgAdminDetail,
  getRecentErrorCounts,
  getDbSizeEstimate,
  getTenderMatchByLot,
  getUsageCounts,
  insertAuditEvent,
  insertSupportNote,
  listAuditEventsAdmin,
  listDigestRunsAdmin,
  listEmailFailuresAdmin,
  listErrorsForRun,
  listFetchRetries,
  listRecentRuns,
  listSubscriptionsAdmin,
  listSupportNotes,
  loadLotScoringBundlesByIds,
  searchOrganizationsAdmin,
  searchUsersAdmin,
  setFeatureFlag,
  suspendOrganization,
  unsuspendOrganization,
} from '@bidmorrow/db';
import { assertNever, organizationId as toOrganizationId } from '@bidmorrow/domain';
import { ENGINE_VERSION, scoreLotForOrg } from '@bidmorrow/matching';
import { isDigestPaused, previewDigest } from '@bidmorrow/notifications';
import {
  isIngestionPaused,
  isIngestionStale,
  lastSuccessfulRunAt,
  loadOrgProfile,
  mapLotToEngineInput,
  parseIngestionScope,
} from '@bidmorrow/procurement';
import { TED_SOURCE_ID } from '@bidmorrow/ted';

import type { AppBindings, IngestQueueMessage, MatchQueueMessage } from '../env';
import { requireInternalAdmin } from '../middleware/admin';
import { createIpRateLimit } from '../middleware/rate-limit';

export const adminRoutes = new Hono<AppBindings>();

// P10-R-04: same IP-keyed limiter as the rest of the API surface, applied
// BEFORE the admin auth check so failed-auth hammering is throttled too.
adminRoutes.use('*', createIpRateLimit('/api/admin/*'));
adminRoutes.use('*', requireInternalAdmin);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Pagination query params — capped at 50 (instruction: "pagination ≤50 everywhere"). */
const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * Writes the action-specific audit row for an admin mutation.
 *
 * ACCEPTED TRADE-OFF (non-atomic, mutation-then-audit): every call site in
 * this file runs the mutation first (the `setFeatureFlag`/`suspendOrganization`/
 * `.send()` etc. calls above each `writeAdminAction` call), then calls this
 * function — the two are not wrapped in a single D1 transaction. If this
 * insert throws (D1 hiccup, malformed args), the route handler's error
 * propagates as a 500, but the mutation the audit row was meant to describe
 * has already committed; there is no automatic rollback and no specific
 * audit row recording exactly what changed. This is deliberate, not an
 * oversight: rolling back an already-committed mutation (e.g. an
 * already-sent `INGEST_QUEUE`/`MATCH_QUEUE` message, which cannot be
 * un-sent at all) to satisfy audit-write atomicity is not achievable for
 * every action this file performs, so no call site is held to it. The
 * generic `admin.request` row written by `requireInternalAdmin`'s own
 * try/finally (`middleware/admin.ts`, SEC-P10-02) still records that this
 * admin, this route, happened — it is coarser (no action-specific
 * before/after summary) but never lost to this failure mode, so a failed
 * audit insert here degrades observability, it does not erase the access
 * trail entirely.
 */
async function writeAdminAction(
  c: Context<AppBindings>,
  args: {
    action: string;
    targetType: string;
    targetId?: string | null;
    organizationId?: string | null;
    beforeSummary?: string | null;
    afterSummary?: string | null;
  },
): Promise<void> {
  const session = c.get('session');
  if (session === undefined) return;
  const db = createDb(c.env.DB);
  await insertAuditEvent(db, {
    actorType: 'admin',
    actorId: session.user.id,
    organizationId:
      args.organizationId === undefined || args.organizationId === null
        ? null
        : toOrganizationId(args.organizationId),
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId ?? null,
    beforeSummary: args.beforeSummary ?? null,
    afterSummary: args.afterSummary ?? null,
    occurredAt: Date.now(),
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// 2. Search/inspect
// ---------------------------------------------------------------------------

const orgSearchQuerySchema = paginationQuerySchema.extend({
  query: z.string().trim().max(200).optional(),
});

adminRoutes.get('/orgs', zValidator('query', orgSearchQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await searchOrganizationsAdmin(db, {
    ...(q.query !== undefined ? { query: q.query } : {}),
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({
    items: page.items.map((row) => ({
      id: row.organization.id,
      name: row.organization.name,
      status: row.organization.status,
      suspendedAt: row.organization.suspendedAt,
      memberCount: row.memberCount,
      subscription:
        row.subscription === null
          ? null
          : { status: row.subscription.status, plan: row.subscription.plan },
    })),
    nextCursor: page.nextCursor,
  });
});

const orgIdParamSchema = z.object({ id: z.string().trim().min(1).max(64) }).strict();

adminRoutes.get('/orgs/:id', zValidator('param', orgIdParamSchema), async (c) => {
  const db = createDb(c.env.DB);
  const { id } = c.req.valid('param');
  const detail = await getOrgAdminDetail(db, toOrganizationId(id));
  if (detail === null) return c.json({ error: 'not_found' }, 404);
  return c.json({
    organization: {
      id: detail.organization.id,
      name: detail.organization.name,
      status: detail.organization.status,
      suspendedAt: detail.organization.suspendedAt,
      createdAt: detail.organization.createdAt,
    },
    profile: detail.profile,
    subscription: detail.subscription,
    digestPreferences: detail.digestPreferences,
    memberEmails: detail.memberEmails,
    counts: detail.counts,
  });
});

const userSearchQuerySchema = paginationQuerySchema.extend({
  query: z.string().trim().max(320).optional(),
});

adminRoutes.get('/users', zValidator('query', userSearchQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await searchUsersAdmin(db, {
    ...(q.query !== undefined ? { query: q.query } : {}),
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({
    items: page.items.map((row) => ({
      id: row.user.id,
      email: row.user.email,
      emailVerified: row.user.emailVerified,
      organizationIds: row.organizationIds,
    })),
    nextCursor: page.nextCursor,
  });
});

const subscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'unpaid']).optional(),
});

adminRoutes.get('/subscriptions', zValidator('query', subscriptionsQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listSubscriptionsAdmin(db, {
    ...(q.status !== undefined ? { status: q.status } : {}),
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

// ---------------------------------------------------------------------------
// 3. Ingestion ops
// ---------------------------------------------------------------------------

adminRoutes.get('/ingestion/runs', zValidator('query', paginationQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listRecentRuns(db, {
    source: TED_SOURCE_ID,
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

const ingestionErrorsQuerySchema = paginationQuerySchema.extend({
  runId: z.string().trim().min(1).max(64),
});

adminRoutes.get('/ingestion/errors', zValidator('query', ingestionErrorsQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listErrorsForRun(db, {
    ingestionRunId: q.runId,
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

const fetchRetriesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'recovered', 'abandoned']).optional(),
});

/**
 * ADR-0008 §5 admin surface: read-only view of the fetch-retry queue —
 * status counts (pending backlog / recovered / abandoned totals) plus a
 * bounded, optionally status-filtered, newest-first list of individual
 * rows. Same pagination contract (`limit`<=50, `cursor`) as every other
 * admin list route.
 */
adminRoutes.get(
  '/ingestion/fetch-retries',
  zValidator('query', fetchRetriesQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const q = c.req.valid('query');
    const [counts, page] = await Promise.all([
      countFetchRetriesByStatus(db),
      listFetchRetries(db, {
        ...(q.status !== undefined ? { status: q.status } : {}),
        limit: q.limit ?? 25,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      }),
    ]);
    return c.json({ counts, items: page.items, nextCursor: page.nextCursor });
  },
);

const noticeParamSchema = z.object({ sourceNoticeId: z.string().trim().min(1).max(120) }).strict();

adminRoutes.get('/notices/:sourceNoticeId', zValidator('param', noticeParamSchema), async (c) => {
  const db = createDb(c.env.DB);
  const { sourceNoticeId } = c.req.valid('param');
  const bundle = await getNoticeDebugBundle(db, { source: TED_SOURCE_ID, sourceNoticeId });
  if (bundle === null) return c.json({ error: 'not_found' }, 404);
  return c.json({
    notice: bundle.notice,
    versions: bundle.versions.map((version) => ({
      ...version,
      lots: (bundle.lotsByVersion.get(version.id) ?? []).map((lot) => ({
        id: lot.id,
        lotNumber: lot.lotNumber,
        title: lot.title,
      })),
    })),
    snapshots: bundle.snapshots.map((s) => ({
      versionNumber: s.versionNumber,
      r2Key: s.r2Key,
      sizeBytes: s.sizeBytes,
      deletedAt: s.deletedAt,
    })),
  });
});

const confirmSchema = (literal: string) => z.object({ confirm: z.literal(literal) }).strict();

adminRoutes.post(
  '/ingestion/pause',
  zValidator('json', confirmSchema('PAUSE_INGESTION')),
  async (c) => {
    const db = createDb(c.env.DB);
    const session = c.get('session');
    await setFeatureFlag(db, {
      key: FLAG_INGESTION_PAUSED,
      valueJson: 'true',
      description: 'Emergency stop for the TED ingestion pipeline (admin-set).',
      updatedByUserId: session?.user.id ?? null,
    });
    await writeAdminAction(c, {
      action: 'ingestion.paused',
      targetType: 'feature_flag',
      targetId: FLAG_INGESTION_PAUSED,
      afterSummary: 'true',
    });
    return c.json({ paused: true });
  },
);

adminRoutes.post(
  '/ingestion/resume',
  zValidator('json', confirmSchema('RESUME_INGESTION')),
  async (c) => {
    const db = createDb(c.env.DB);
    const session = c.get('session');
    await setFeatureFlag(db, {
      key: FLAG_INGESTION_PAUSED,
      valueJson: 'false',
      description: 'Emergency stop for the TED ingestion pipeline (admin-set).',
      updatedByUserId: session?.user.id ?? null,
    });
    await writeAdminAction(c, {
      action: 'ingestion.resumed',
      targetType: 'feature_flag',
      targetId: FLAG_INGESTION_PAUSED,
      afterSummary: 'false',
    });
    return c.json({ paused: false });
  },
);

const MAX_SCOPE_FAMILIES = 20;
const ingestionScopeSchema = z
  .object({
    cpvFamilies: z.array(z.string().trim().min(2).max(8)).min(1).max(MAX_SCOPE_FAMILIES),
    countries: z.array(z.string().trim().length(2)).max(50).optional(),
    confirm: z.literal('UPDATE_INGESTION_SCOPE'),
  })
  .strict();

adminRoutes.post('/ingestion/scope', zValidator('json', ingestionScopeSchema), async (c) => {
  const db = createDb(c.env.DB);
  const session = c.get('session');
  const body = c.req.valid('json');
  const valueJson = JSON.stringify({
    cpvFamilies: body.cpvFamilies,
    countries: body.countries ?? [],
  });
  // Re-validated through the same parser the ingestion pipeline itself
  // uses, so an admin can never persist a shape the pipeline would then
  // fail to load at cron time.
  const scope = parseIngestionScope(valueJson);
  await setFeatureFlag(db, {
    key: FLAG_INGESTION_CPV_SCOPE,
    valueJson,
    description:
      'Ingestion CPV families + country filter (admin-set), docs/ted-ingestion-scope.md.',
    updatedByUserId: session?.user.id ?? null,
  });
  await writeAdminAction(c, {
    action: 'ingestion.scope_updated',
    targetType: 'feature_flag',
    targetId: FLAG_INGESTION_CPV_SCOPE,
    afterSummary: valueJson.slice(0, 200),
  });
  return c.json({ scope });
});

const MAX_BACKFILL_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const backfillSchema = z
  .object({
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    confirm: z.literal('RUN_BACKFILL'),
  })
  .strict();

function enumerateDays(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  let cursor = new Date(`${fromDate}T00:00:00Z`).getTime();
  const end = new Date(`${toDate}T00:00:00Z`).getTime();
  while (cursor <= end) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_DAY;
  }
  return days;
}

adminRoutes.post('/ingestion/backfill', zValidator('json', backfillSchema), async (c) => {
  const body = c.req.valid('json');
  if (body.toDate < body.fromDate) {
    return c.json({ error: 'invalid_range', message: 'toDate must be >= fromDate' }, 400);
  }
  // P10-R-02: the emergency pause covers backfills too — reject enqueue
  // while paused so an admin can't (accidentally) run 90 windows of TED
  // traffic during an incident. The consumer re-checks as a second layer.
  if (await isIngestionPaused(createDb(c.env.DB), c.get('logger'))) {
    return c.json(
      { error: 'ingestion_paused', message: 'resume ingestion before backfilling' },
      409,
    );
  }
  const days = enumerateDays(body.fromDate, body.toDate);
  if (days.length > MAX_BACKFILL_DAYS) {
    return c.json(
      { error: 'range_too_large', message: `backfill is bounded to ${MAX_BACKFILL_DAYS} days` },
      400,
    );
  }
  for (const day of days) {
    const message: IngestQueueMessage = { kind: 'backfill_window', windowFrom: day, windowTo: day };
    await c.env.INGEST_QUEUE.send(message);
  }
  await writeAdminAction(c, {
    action: 'ingestion.backfill_enqueued',
    targetType: 'ingestion_backfill',
    afterSummary: `${body.fromDate}..${body.toDate} (${days.length} windows)`,
  });
  return c.json({ enqueuedWindows: days.length });
});

// ---------------------------------------------------------------------------
// 4. Match debugging
// ---------------------------------------------------------------------------

const matchTraceQuerySchema = z
  .object({
    organizationId: z.string().trim().min(1).max(64),
    lotId: z.string().trim().min(1).max(64),
  })
  .strict();

adminRoutes.get('/match-trace', zValidator('query', matchTraceQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const { organizationId, lotId } = c.req.valid('query');
  const orgId = toOrganizationId(organizationId);

  const stored = await getTenderMatchByLot(db, orgId, { lotId });

  const bundles = await loadLotScoringBundlesByIds(db, [lotId]);
  const bundle = bundles[0];
  if (bundle === undefined) {
    return c.json({ stored, live: null, note: 'lot no longer resolves (purged/deleted)' });
  }

  const orgProfile = await loadOrgProfile(db, orgId, c.get('logger'));
  const scoringTime = stored?.match.scoredAt ?? Date.now();
  const mapped = await mapLotToEngineInput(db, bundle, scoringTime, c.get('logger'));
  if (mapped.kind === 'missing_main_cpv') {
    return c.json({ stored, orgProfile, live: null, note: 'lot has no main CPV — cannot score' });
  }
  const live = scoreLotForOrg({ org: orgProfile, lot: mapped.lot, scoringTime });

  return c.json({
    stored:
      stored === null
        ? null
        : {
            match: stored.match,
            components: stored.components,
            riskFlags: stored.riskFlags,
          },
    orgProfile,
    lotInput: mapped.lot,
    engineVersion: ENGINE_VERSION,
    live,
  });
});

const recomputeSchema = z
  .object({
    noticeIds: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
    lotIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    confirm: z.literal('RECOMPUTE_MATCHES'),
  })
  .strict()
  .refine(
    (v) =>
      (v.noticeIds !== undefined && v.noticeIds.length > 0) !==
      (v.lotIds !== undefined && v.lotIds.length > 0),
    { message: 'exactly one of noticeIds or lotIds must be provided' },
  );

adminRoutes.post('/matching/recompute', zValidator('json', recomputeSchema), async (c) => {
  const body = c.req.valid('json');
  let messages = 0;
  if (body.noticeIds !== undefined && body.noticeIds.length > 0) {
    for (const batch of chunk(body.noticeIds, 100)) {
      const message: MatchQueueMessage = { kind: 'recompute', noticeIds: batch };
      await c.env.MATCH_QUEUE.send(message);
      messages += 1;
    }
  } else if (body.lotIds !== undefined && body.lotIds.length > 0) {
    // Reuses the recompute-CONTINUATION consumer (packages/procurement
    // scoreLotsForOrgs with recompute:true, keyed by lot id) — functionally
    // identical to what an admin-triggered lot-id recompute needs (hard
    // replace, not idempotent-skip), so no new queue consumer was needed.
    for (const batch of chunk(body.lotIds, 100)) {
      const message: MatchQueueMessage = { kind: 'recompute_continuation', lotIds: batch };
      await c.env.MATCH_QUEUE.send(message);
      messages += 1;
    }
  }
  await writeAdminAction(c, {
    action: 'matching.recompute_enqueued',
    targetType: 'matching_recompute',
    afterSummary: `messages=${messages}`,
  });
  return c.json({ enqueuedMessages: messages });
});

// ---------------------------------------------------------------------------
// 5. Digest ops
// ---------------------------------------------------------------------------

adminRoutes.get('/digest/runs', zValidator('query', paginationQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listDigestRunsAdmin(db, {
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

const digestPreviewQuerySchema = z
  .object({
    organizationId: z.string().trim().min(1).max(64),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  })
  .strict();

adminRoutes.get('/digest/preview', zValidator('query', digestPreviewQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const { organizationId, date } = c.req.valid('query');
  const result = await previewDigest(
    { db, appBaseUrl: c.env.APP_BASE_URL, engineVersion: ENGINE_VERSION },
    toOrganizationId(organizationId),
    { localDate: date, utcNow: Date.now() },
  );
  if (result.kind === 'no_organization') return c.json({ error: 'not_found' }, 404);
  if (result.kind === 'no_preferences') {
    return c.json({ error: 'no_digest_preferences' }, 404);
  }
  return c.json({ rendered: result.rendered });
});

adminRoutes.get('/email/failures', zValidator('query', paginationQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listEmailFailuresAdmin(db, {
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

adminRoutes.post('/digest/pause', zValidator('json', confirmSchema('PAUSE_DIGEST')), async (c) => {
  const db = createDb(c.env.DB);
  const session = c.get('session');
  await setFeatureFlag(db, {
    key: FLAG_DIGEST_PAUSED,
    valueJson: 'true',
    description: 'Emergency stop for outbound digest emails (admin-set).',
    updatedByUserId: session?.user.id ?? null,
  });
  await writeAdminAction(c, {
    action: 'digest.paused',
    targetType: 'feature_flag',
    targetId: FLAG_DIGEST_PAUSED,
    afterSummary: 'true',
  });
  return c.json({ paused: true });
});

adminRoutes.post(
  '/digest/resume',
  zValidator('json', confirmSchema('RESUME_DIGEST')),
  async (c) => {
    const db = createDb(c.env.DB);
    const session = c.get('session');
    await setFeatureFlag(db, {
      key: FLAG_DIGEST_PAUSED,
      valueJson: 'false',
      description: 'Emergency stop for outbound digest emails (admin-set).',
      updatedByUserId: session?.user.id ?? null,
    });
    await writeAdminAction(c, {
      action: 'digest.resumed',
      targetType: 'feature_flag',
      targetId: FLAG_DIGEST_PAUSED,
      afterSummary: 'false',
    });
    return c.json({ paused: false });
  },
);

// ---------------------------------------------------------------------------
// 6. Support & governance
// ---------------------------------------------------------------------------

const supportNotesQuerySchema = paginationQuerySchema.extend({
  organizationId: z.string().trim().min(1).max(64),
});

adminRoutes.get('/support-notes', zValidator('query', supportNotesQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listSupportNotes(db, toOrganizationId(q.organizationId), {
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

const createSupportNoteSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(64),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

adminRoutes.post('/support-notes', zValidator('json', createSupportNoteSchema), async (c) => {
  const db = createDb(c.env.DB);
  const session = c.get('session');
  if (session === undefined) return c.json({ error: 'unauthenticated' }, 401);
  const body = c.req.valid('json');
  const note = await insertSupportNote(db, toOrganizationId(body.organizationId), {
    authorUserId: session.user.id,
    body: body.body,
  });
  await writeAdminAction(c, {
    action: 'support_note.created',
    targetType: 'support_note',
    targetId: note.id,
    organizationId: body.organizationId,
  });
  return c.json({ note });
});

const auditEventsQuerySchema = paginationQuerySchema.extend({
  actorId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(200).optional(),
  sinceMs: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/audit-events', zValidator('query', auditEventsQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.valid('query');
  const page = await listAuditEventsAdmin(db, {
    ...(q.actorId !== undefined ? { actorId: q.actorId } : {}),
    ...(q.action !== undefined ? { action: q.action } : {}),
    ...(q.sinceMs !== undefined ? { sinceMs: q.sinceMs } : {}),
    limit: q.limit ?? 25,
    ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
  });
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

const suspendSchema = confirmSchema('SUSPEND_ORGANIZATION');
const unsuspendSchema = confirmSchema('UNSUSPEND_ORGANIZATION');

adminRoutes.post(
  '/orgs/:id/suspend',
  zValidator('param', orgIdParamSchema),
  zValidator('json', suspendSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const { id } = c.req.valid('param');
    const updated = await suspendOrganization(db, toOrganizationId(id));
    if (updated === null) return c.json({ error: 'not_found' }, 404);
    await writeAdminAction(c, {
      action: 'org.suspended',
      targetType: 'organization',
      targetId: id,
      organizationId: id,
    });
    return c.json({ suspended: true, suspendedAt: updated.suspendedAt });
  },
);

adminRoutes.post(
  '/orgs/:id/unsuspend',
  zValidator('param', orgIdParamSchema),
  zValidator('json', unsuspendSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const { id } = c.req.valid('param');
    const updated = await unsuspendOrganization(db, toOrganizationId(id));
    if (updated === null) return c.json({ error: 'not_found' }, 404);
    await writeAdminAction(c, {
      action: 'org.unsuspended',
      targetType: 'organization',
      targetId: id,
      organizationId: id,
    });
    return c.json({ suspended: false });
  },
);

// ---------------------------------------------------------------------------
// 7. Health/usage
// ---------------------------------------------------------------------------

adminRoutes.get('/health-details', async (c) => {
  const db = createDb(c.env.DB);
  const now = Date.now();
  const [lastRun, ingestionPaused, digestPaused, errorCounts, dbSize, flagStates] =
    await Promise.all([
      lastSuccessfulRunAt(db),
      isIngestionPaused(db, c.get('logger')),
      isDigestPaused(db, c.get('logger')),
      getRecentErrorCounts(db, now),
      getDbSizeEstimate(db),
      Promise.all(FEATURE_FLAG_KEYS.map((key) => getFeatureFlag(db, key))),
    ]);
  const recentDigestRuns = await listDigestRunsAdmin(db, { limit: 20 });
  // A DLQ's contents are not directly readable from the Worker runtime — a
  // dead-lettered message only shows up as a Cloudflare dashboard / `wrangler
  // queues` metric outside this API. Documented honestly rather than faked.
  return c.json({
    ingestion: {
      lastSuccessfulRunAt: lastRun,
      stale: isIngestionStale(lastRun, now),
      paused: ingestionPaused,
      errors24h: errorCounts.ingestionErrors24h,
    },
    digest: {
      paused: digestPaused,
      recentRuns: recentDigestRuns.items.map((r) => ({
        organizationId: r.organizationId,
        digestDate: r.digestDate,
        status: r.status,
      })),
    },
    email: { failures24h: errorCounts.emailFailures24h },
    db: dbSize,
    dlq: {
      note: 'not directly readable from the Worker runtime — see Cloudflare dashboard / wrangler queues list-dlq',
    },
    flags: FEATURE_FLAG_KEYS.map((key, i) => ({
      key,
      value: flagStates[i]?.valueJson ?? null,
    })),
  });
});

adminRoutes.get('/usage', async (c) => {
  const db = createDb(c.env.DB);
  const usage = await getUsageCounts(db);
  return c.json(usage);
});

// ---------------------------------------------------------------------------
// 8. Feature flags
// ---------------------------------------------------------------------------

adminRoutes.get('/flags', async (c) => {
  const db = createDb(c.env.DB);
  const flags = await Promise.all(FEATURE_FLAG_KEYS.map((key) => getFeatureFlag(db, key)));
  return c.json({
    items: FEATURE_FLAG_KEYS.map((key, i) => ({
      key,
      value: flags[i]?.valueJson ?? null,
      description: flags[i]?.description ?? null,
      updatedAt: flags[i]?.updatedAt ?? null,
    })),
  });
});

const flagKeyParamSchema = z.object({ key: z.enum(FEATURE_FLAG_KEYS) }).strict();
const flagUpdateSchema = z
  .object({
    value: z.unknown(),
    description: z.string().trim().min(1).max(500).optional(),
    confirm: z.literal('UPDATE_FLAG'),
  })
  .strict();

// SEC-P10-01: the generic PUT must never persist a value shape the
// consuming pipeline fails to load (a malformed ingestion scope would break
// the daily cron until manually fixed). Per-key value validation; the
// ingestion scope reuses the SAME parser the pipeline loads with.
function validateFlagValue(key: FeatureFlagKey, value: unknown): string | null {
  const valueJson = JSON.stringify(value);
  switch (key) {
    case FLAG_FOUNDING_PLAN_OPEN:
    case FLAG_INGESTION_PAUSED:
    case FLAG_DIGEST_PAUSED:
    case FLAG_ENTITLEMENT_ENFORCED:
    case FLAG_STRIPE_TAX:
    case FLAG_PRELAUNCH:
    case FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED:
      return typeof value === 'boolean' ? valueJson : null;
    case FLAG_LAUNCH_DATE:
      // ISO-8601 instant the countdown targets (prelaunch.ts) — a bad
      // date must never wedge the public-config endpoint.
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? valueJson : null;
    case FLAG_FOUNDING_CAP:
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000
        ? valueJson
        : null;
    case FLAG_INGESTION_CPV_SCOPE:
      try {
        parseIngestionScope(valueJson);
        return valueJson;
      } catch {
        return null;
      }
    default:
      return assertNever(key);
  }
}

adminRoutes.put(
  '/flags/:key',
  zValidator('param', flagKeyParamSchema),
  zValidator('json', flagUpdateSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const session = c.get('session');
    const { key } = c.req.valid('param') as { key: FeatureFlagKey };
    const body = c.req.valid('json');
    const valueJson = validateFlagValue(key, body.value);
    if (valueJson === null) {
      return c.json({ error: 'invalid_flag_value', key }, 400);
    }
    const updated = await setFeatureFlag(db, {
      key,
      valueJson,
      description: body.description ?? `Admin-set flag ${key}.`,
      updatedByUserId: session?.user.id ?? null,
    });
    await writeAdminAction(c, {
      action: 'feature_flag.updated',
      targetType: 'feature_flag',
      targetId: key,
      afterSummary: valueJson.slice(0, 200),
    });
    return c.json({ flag: updated });
  },
);
