/**
 * @bidmorrow/worker — Cloudflare Worker composition root.
 *
 * Phase 2 skeleton: Hono API with health endpoints, request-id correlation,
 * structured logging, and security headers (strict CSP per docs/security.md
 * C3/C4). Auth, queue consumers, and cron handlers are wired here in their
 * own phases.
 */
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createLogger, type Logger } from '@bidmorrow/observability';

/** Worker bindings declared in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface Variables {
  requestId: string;
  logger: Logger;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// Liveness: process is up and serving requests.
app.get('/api/health/live', (c) => c.json({ status: 'ok' }));

// Readiness: dependencies are reachable. Failure details are logged
// server-side only — the response never leaks them.
app.get('/api/health/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok', db: 'ok' });
  } catch (cause) {
    c.get('logger').error('readiness check failed: D1 unreachable', { cause });
    return c.json({ status: 'degraded', db: 'error' }, 503);
  }
});

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

const worker = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;

export default worker;
