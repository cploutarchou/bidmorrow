/**
 * @bidmorrow/worker — Cloudflare Worker composition root.
 *
 * Phase 4 stage A: Hono API with health endpoints, request-id correlation,
 * structured logging, security headers (strict CSP per docs/security.md
 * C3/C4), and Better Auth core (ADR-0002, ADR-0007) mounted at
 * `/api/auth/*`.
 *
 * Phase 4 stage B: organization context (`/api/org/*`), the INTERNAL_ADMIN
 * allowlist gate (`/api/admin/*`), and account deletion (`/api/account`) —
 * see src/middleware/* and src/routes/*. Queue consumers and cron handlers
 * arrive in later phases.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { createDb } from '@bidmorrow/db';
import { readPrelaunchState } from './prelaunch';
import { createLogger } from '@bidmorrow/observability';
import {
  checkFetchResilienceAlerts,
  isIngestionStale,
  lastSuccessfulRunAt,
} from '@bidmorrow/procurement';

import { createRequestAuth } from './auth-instance';
import type {
  AppBindings,
  DigestQueueMessage,
  Env,
  IngestQueueMessage,
  MatchQueueMessage,
} from './env';
import { resolveDigestProvider, runDigestJob, runDigestScheduleJob } from './digest';
import {
  runBackfillWindowJob,
  runIngestCatchUpJob,
  runRecomputeContinuationJob,
  runRecomputeJob,
  runRetentionPurgeJob,
  runScoreJob,
} from './ingestion';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { billingRoutes } from './routes/billing';
import { feedRoutes } from './routes/feed';
import { orgRoutes } from './routes/org';
import { tendersRoutes } from './routes/tenders';
import { testHookRoutes } from './routes/test-hooks';
import { webhookRoutes } from './routes/webhooks';

export type { Env, Variables } from './env';

const app = new Hono<AppBindings>();

// Correlation: every request gets a UUID, stored on the context, echoed as
// the `x-request-id` response header, and bound to the structured logger so
// every log line for this request carries request_id.
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('logger', createLogger({ request_id: requestId }));
  c.header('x-request-id', requestId);
  await next();
});

// Security headers per docs/security.md C3 (strict CSP: default-src 'self',
// no unsafe-inline scripts, frame-ancestors 'none') and C4 (HSTS,
// X-Content-Type-Options, Referrer-Policy, Permissions-Policy — HSTS/XCTO/
// Referrer-Policy come from secureHeaders defaults).
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
    },
    xFrameOptions: 'DENY',
    permissionsPolicy: {
      camera: [],
      geolocation: [],
      microphone: [],
    },
  }),
);

// SEC-P4-02: bound every /api/* request body to 128 KB before any handler
// reads it — procurement content and org input are untrusted, and Workers
// has no platform-level body-size cap of its own. Applied ahead of every
// route mount below.
const MAX_API_BODY_BYTES = 128 * 1024;
app.use(
  '/api/*',
  bodyLimit({
    maxSize: MAX_API_BODY_BYTES,
    onError: (c) => c.json({ error: 'payload_too_large', request_id: c.get('requestId') }, 413),
  }),
);

// Liveness: process is up and serving requests.
app.get('/api/health/live', (c) => c.json({ status: 'ok' }));

// Readiness: dependencies are reachable. Failure details are logged
// server-side only — the response never leaks them.
app.get('/api/health/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch (cause) {
    c.get('logger').error('readiness check failed: D1 unreachable', { cause });
    return c.json({ status: 'degraded', db: 'error' }, 503);
  }
  // Ingestion staleness never fails readiness (it is a background-pipeline
  // signal, not a request-path dependency) — it is surfaced alongside `ok`
  // for the admin surface / uptime monitor to alert on separately.
  let lastSuccessfulIngestionAt: number | null = null;
  let stale = true;
  try {
    lastSuccessfulIngestionAt = await lastSuccessfulRunAt(createDb(c.env.DB));
    stale = isIngestionStale(lastSuccessfulIngestionAt, Date.now());
  } catch (cause) {
    c.get('logger').error('readiness: ingestion staleness check failed', { cause });
  }
  return c.json({ status: 'ok', db: 'ok', lastSuccessfulIngestionAt, stale });
});

// Public runtime config for the SPA — unauthenticated by design and
// secret-free: only the pre-launch gate state and the countdown target
// (apps/web lib/public-config.ts). Cached briefly so marketing traffic
// doesn't turn into a D1 read per pageview.
app.get('/api/public-config', async (c) => {
  const state = await readPrelaunchState(createDb(c.env.DB), c.env.APP_ENV);
  c.header('cache-control', 'public, max-age=60');
  return c.json(state);
});

// Pre-launch gate (prelaunch.ts): NEW account creation is closed while
// pre-launch is active (production default until the go-live flag flip).
// Registered BEFORE the Better Auth mount so the request never reaches it;
// every other /api/auth/* flow (log-in, verification, password reset)
// passes through untouched.
app.use('/api/auth/sign-up/email', async (c, next) => {
  if (c.req.method === 'POST') {
    const { prelaunch } = await readPrelaunchState(createDb(c.env.DB), c.env.APP_ENV);
    if (prelaunch) {
      return c.json(
        {
          error: 'signups_closed',
          message: 'Registrations open at launch — see the countdown on the homepage.',
        },
        403,
      );
    }
  }
  await next();
});

// Better Auth core (ADR-0002, ADR-0007: authentication only, no org
// plugin — tenancy stays in organizations/organization_members).
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const auth = createRequestAuth(c.env, c.get('logger'), c.executionCtx);
  return auth.handler(c.req.raw);
});

// Phase 4 stage B: tenant-scoped, admin, and account routes.
app.route('/api/org', orgRoutes);
// Phase 7: feed + tender detail/actions, mounted at the same /api/org prefix
// as distinct sub-routers (each carries its own requireSession/
// requireOrganization chain) so org.ts stays focused on the profile bundle.
app.route('/api/org', feedRoutes);
app.route('/api/org', tendersRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/account', accountRoutes);
// Phase 9: billing (session/org-scoped) and the Stripe webhook (the one
// deliberately unauthenticated-by-session route — see routes/webhooks.ts).
app.route('/api/billing', billingRoutes);
app.route('/api/webhooks', webhookRoutes);
// Phase 12 stage A: E2E test-only hooks, double-gated to 404 everywhere
// except a local/test env with E2E_TEST_HOOKS=true — see routes/test-hooks.ts.
app.route('/api/test', testHookRoutes);

// Unknown routes: run_worker_first routes only /api/* to this Worker in
// production (everything else is served by Static Assets with SPA fallback),
// so any unmatched request here gets a JSON 404.
app.notFound((c) => c.json({ error: 'not_found', request_id: c.get('requestId') }, 404));

// Last-resort error handler: log with correlation context, respond without
// leaking internals.
app.onError((err, c) => {
  c.get('logger').error('unhandled error', { error: err });
  return c.json({ error: 'internal_error', request_id: c.get('requestId') }, 500);
});

// Cron patterns (wrangler.jsonc `triggers.crons`, UTC): daily ingestion
// catch-up (05:00), daily retention purge (06:30), stale-ingestion watchdog
// (09:00), hourly digest scheduling (Phase 8 — timezones roll over at
// different UTC hours, so a once-daily cron cannot serve every org at a
// consistent LOCAL send time; see @bidmorrow/notifications
// digest-orchestration.ts for the per-org due/resume logic this triggers).
// Dispatch by exact pattern string — see ADR-0006.
const CRON_INGEST = '0 5 * * *';
const CRON_RETENTION = '30 6 * * *';
const CRON_WATCHDOG = '0 9 * * *';
const CRON_DIGEST_SCHEDULE = '15 * * * *';

/**
 * Cron entry point. Ingestion is enqueued (bounded, retried, DLQ'd via
 * Queues — ADR-0006) rather than run inline, so a slow TED response never
 * risks the cron's own execution-time limit. Retention runs inline: it is a
 * bounded, single D1 transaction-shaped job with no external HTTP calls.
 * The watchdog only reads and logs — no mutation.
 */
async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const logger = createLogger({ cron: event.cron });
  switch (event.cron) {
    case CRON_INGEST:
      await env.INGEST_QUEUE.send({ kind: 'ingest' });
      logger.info('cron.ingest.enqueued', {});
      return;
    case CRON_RETENTION:
      ctx.waitUntil(
        runRetentionPurgeJob(env, logger).catch((cause: unknown) => {
          logger.error('cron.retention.failed', {
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }),
      );
      return;
    case CRON_WATCHDOG: {
      const db = createDb(env.DB);
      const nowMs = Date.now();
      const lastSuccess = await lastSuccessfulRunAt(db);
      if (isIngestionStale(lastSuccess, nowMs)) {
        logger.error('ingestion.stale', { last_successful_run_at: lastSuccess });
      } else {
        logger.info('ingestion.watchdog.ok', { last_successful_run_at: lastSuccess });
      }
      // ADR-0008 §5: three additional fetch-resilience alert conditions,
      // independent of staleness — a healthy `partial` day must not alert,
      // but a systemic threshold breach, an abandonment, a growing pending
      // backlog, or a run of degraded windows must.
      const alerts = await checkFetchResilienceAlerts(db, nowMs);
      if (alerts.degraded) {
        logger.error('ingestion.watchdog.fetch_resilience_degraded', {
          threshold_or_abandonment: alerts.thresholdOrAbandonment,
          pending_retry_backlog: alerts.pendingRetryBacklog,
          consecutive_fetch_failed_runs: alerts.consecutiveFetchFailedRuns,
        });
      } else {
        logger.info('ingestion.watchdog.fetch_resilience_ok', {});
      }
      return;
    }
    case CRON_DIGEST_SCHEDULE:
      // Enqueues only — digest generation/sending happens in the queue
      // consumer below, never inline in the cron (a slow send must never
      // risk the cron's own execution budget).
      ctx.waitUntil(
        runDigestScheduleJob(env, logger).catch((cause: unknown) => {
          logger.error('cron.digest_schedule.failed', {
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }),
      );
      return;
    default:
      logger.error('cron.unrecognized_pattern', { cron: event.cron });
  }
}

/**
 * Queue consumer (ADR-0006): delivery is at-least-once, so every handler is
 * idempotent by construction (checkpointed upserts / unique constraints
 * downstream) — safe to `ack` every message that ran to completion and let
 * an unhandled throw retry (bounded by wrangler.jsonc `max_retries`, then
 * DLQ). One handler serves both `INGEST_QUEUE` and `MATCH_QUEUE` — the
 * message `kind` discriminates, not the queue binding name, so a single
 * exported `queue` function (the only shape Workers allows per default
 * export) can dispatch both.
 */
async function queue(
  batch: MessageBatch<IngestQueueMessage | MatchQueueMessage | DigestQueueMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const logger = createLogger({ queue: batch.queue });
  // SEC-P8-01: one provider instance for the whole batch, not one per
  // message — `createResendEmailProvider`'s internal send-spacing timer is
  // per-instance, so a fresh instance per digest message would let several
  // digests in the same batch send in rapid succession (only spaced within
  // each org's own recipient loop, never across orgs). Hoisting here means
  // Resend's documented 2 req/s spacing holds across every digest send in
  // this invocation, not just within one org's `generateDigest` call. Never
  // shared across the digest-preview logging fallback path either — cheap
  // to construct, so this build applies even to batches with zero digest
  // messages.
  const digestProvider = resolveDigestProvider(env, logger);
  for (const message of batch.messages) {
    try {
      switch (message.body.kind) {
        case 'ingest': {
          const result = await runIngestCatchUpJob(env, logger);
          logger.info('queue.ingest.completed', {
            paused: result.paused,
            windows_processed: result.results.length,
            statuses: result.results.map((r) => r.status),
          });
          break;
        }
        case 'purge': {
          const result = await runRetentionPurgeJob(env, logger);
          logger.info('queue.purge.completed', { notices_deleted: result.noticesDeleted });
          break;
        }
        case 'backfill_window': {
          const result = await runBackfillWindowJob(env, logger, {
            windowFrom: message.body.windowFrom,
            windowTo: message.body.windowTo,
          });
          logger.info('queue.backfill_window.completed', {
            status: result === null ? 'skipped_paused' : result.status,
            new_lot_count: result === null ? 0 : result.newLotIds.length,
          });
          break;
        }
        case 'score': {
          const result = await runScoreJob(env, logger, message.body.lotIds);
          logger.info('queue.score.completed', {
            pairs_considered: result.pairsConsidered,
            pairs_scored: result.pairsScored,
            matches_written: result.matchesWritten,
            truncated: result.truncated,
          });
          break;
        }
        case 'recompute': {
          const result = await runRecomputeJob(env, logger, message.body.noticeIds);
          logger.info('queue.recompute.completed', {
            pairs_considered: result.pairsConsidered,
            pairs_scored: result.pairsScored,
            matches_written: result.matchesWritten,
            truncated: result.truncated,
          });
          break;
        }
        case 'recompute_continuation': {
          const result = await runRecomputeContinuationJob(env, logger, message.body.lotIds);
          logger.info('queue.recompute_continuation.completed', {
            pairs_considered: result.pairsConsidered,
            pairs_scored: result.pairsScored,
            matches_written: result.matchesWritten,
            truncated: result.truncated,
          });
          break;
        }
        case 'digest': {
          const result = await runDigestJob(env, logger, message.body, digestProvider);
          logger.info('queue.digest.completed', {
            status: result.status,
            resumed: result.resumed,
            matches_count: result.matchesCount,
          });
          break;
        }
        default: {
          // SEC-P6-02: an unrecognized `kind` is a poison message (a producer
          // bug or a message from a version this consumer doesn't know about)
          // — never silently ack it. Throwing routes it through the same
          // catch below as any other failure: bounded `message.retry()` up to
          // wrangler.jsonc `max_retries`, then the DLQ, so it is investigated
          // rather than dropped.
          // SEC-P8-04: this one handler now serves INGEST_QUEUE, MATCH_QUEUE,
          // AND DIGEST_QUEUE (see the doc comment above) — the error text
          // must not name only the first two queues, or an investigator
          // chasing a DIGEST_QUEUE poison message gets misled about where it
          // came from.
          throw new Error(`unrecognized queue message kind`);
        }
      }
      message.ack();
    } catch (cause) {
      logger.error('queue.message.failed', {
        kind: message.body.kind,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      message.retry();
    }
  }
}

const worker = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled,
  queue: queue as ExportedHandlerQueueHandler<Env>,
} satisfies ExportedHandler<Env>;

export default worker;
