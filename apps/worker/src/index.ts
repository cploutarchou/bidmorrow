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
import { createLogger } from '@bidmorrow/observability';

import { createRequestAuth } from './auth-instance';
import type { AppBindings, Env } from './env';
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
    return c.json({ status: 'ok', db: 'ok' });
  } catch (cause) {
    c.get('logger').error('readiness check failed: D1 unreachable', { cause });
    return c.json({ status: 'degraded', db: 'error' }, 503);
  }
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

const worker = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;

export default worker;
