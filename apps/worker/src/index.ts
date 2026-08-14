/**
 * @bidmorrow/worker — Cloudflare Worker composition root.
 *
 * Phase 4 stage A: Hono API with health endpoints, request-id correlation,
 * structured logging, security headers (strict CSP per docs/security.md
 * C3/C4), and Better Auth core (ADR-0002, ADR-0007) mounted at
 * `/api/auth/*`. Queue consumers and cron handlers arrive in later phases.
 */
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth, type AppEnv as AuthAppEnv } from '@bidmorrow/auth';
import { createDb } from '@bidmorrow/db';
import { createLoggingEmailProvider } from '@bidmorrow/notifications';
import { createLogger, type Logger } from '@bidmorrow/observability';

/**
 * Worker bindings declared in wrangler.jsonc, plus the secrets/config vars
 * supplied via `wrangler secret put` (staging/production) or `.dev.vars`
 * (local dev — see apps/worker/.dev.vars.example; never committed).
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

interface Variables {
  requestId: string;
  logger: Logger;
}

/** Maps `@bidmorrow/config` APP_ENV values to Better Auth's coarser split. */
function toAuthAppEnv(appEnv: string): AuthAppEnv {
  if (appEnv === 'production' || appEnv === 'staging') {
    return appEnv;
  }
  return 'development';
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

// Better Auth core (ADR-0002, ADR-0007: authentication only, no org
// plugin — tenancy stays in organizations/organization_members). One
// instance per request: cheap (no I/O until a handler runs) and avoids
// holding request-scoped bindings (env.DB, the logger) in module scope.
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const emailProvider = createLoggingEmailProvider(c.get('logger'));
  const auth = createAuth({
    db: createDb(c.env.DB),
    secret: c.env.BETTER_AUTH_SECRET,
    baseUrl: c.env.BETTER_AUTH_URL || c.env.APP_BASE_URL,
    appEnv: toAuthAppEnv(c.env.APP_ENV),
    sendEmail: async ({ to, kind, url }) => {
      const subject = kind === 'verification' ? 'Verify your email address' : 'Reset your password';
      // `text` (which contains the sensitive url/token) is passed to the
      // provider, never to the logger — createLoggingEmailProvider only
      // logs `kind`/`to` (docs/security.md C10).
      await emailProvider.send({
        to,
        kind: 'transactional',
        subject,
        text: `${subject}: ${url}`,
      });
    },
  });
  return auth.handler(c.req.raw);
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
