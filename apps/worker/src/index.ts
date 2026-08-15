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
import { createLogger } from '@bidmorrow/observability';
import { isIngestionStale, lastSuccessfulRunAt } from '@bidmorrow/procurement';

import { createRequestAuth } from './auth-instance';
import type { AppBindings, Env, IngestQueueMessage, MatchQueueMessage } from './env';
import {
  runIngestCatchUpJob,
  runRecomputeContinuationJob,
  runRecomputeJob,
  runRetentionPurgeJob,
  runScoreJob,
} from './ingestion';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { orgRoutes } from './routes/org';

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

// Better Auth core (ADR-0002, ADR-0007: authentication only, no org
// plugin — tenancy stays in organizations/organization_members).
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const auth = createRequestAuth(c.env, c.get('logger'));
  return auth.handler(c.req.raw);
});

// Phase 4 stage B: tenant-scoped, admin, and account routes.
app.route('/api/org', orgRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/account', accountRoutes);

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
// (09:00). Dispatch by exact pattern string — see ADR-0006.
const CRON_INGEST = '0 5 * * *';
const CRON_RETENTION = '30 6 * * *';
const CRON_WATCHDOG = '0 9 * * *';

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
      const lastSuccess = await lastSuccessfulRunAt(createDb(env.DB));
      if (isIngestionStale(lastSuccess, Date.now())) {
        logger.error('ingestion.stale', { last_successful_run_at: lastSuccess });
      } else {
        logger.info('ingestion.watchdog.ok', { last_successful_run_at: lastSuccess });
      }
      return;
    }
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
  batch: MessageBatch<IngestQueueMessage | MatchQueueMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const logger = createLogger({ queue: batch.queue });
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
        default: {
          // SEC-P6-02: an unrecognized `kind` is a poison message (a producer
          // bug or a message from a version this consumer doesn't know about)
          // — never silently ack it. Throwing routes it through the same
          // catch below as any other failure: bounded `message.retry()` up to
          // wrangler.jsonc `max_retries`, then the DLQ, so it is investigated
          // rather than dropped.
          throw new Error(`unrecognized MATCH_QUEUE/INGEST_QUEUE message kind`);
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
