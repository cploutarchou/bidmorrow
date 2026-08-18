/**
 * Shared Better Auth instance factory (Phase 4 stage A + B). One instance
 * per request: cheap (no I/O until a handler runs) and avoids holding
 * request-scoped bindings (env.DB, the logger) in module scope. Used both by
 * the `/api/auth/*` mount and the session middleware, so both read the exact
 * same configuration (table mapping, deleteUser gate, trusted origins).
 */
import { createAuth, type AppEnv as AuthAppEnv, type AuthEmailKind } from '@bidmorrow/auth';
import { createDb } from '@bidmorrow/db';
import {
  createLoggingEmailProvider,
  createResendAuthEmailProvider,
  createTestMailboxProvider,
  type AuthEmailProvider,
} from '@bidmorrow/notifications';
import type { Logger } from '@bidmorrow/observability';

import type { Env } from './env';
import { isE2ETestHooksEnabled } from './test-hooks-gate';

/** Maps `@bidmorrow/config` APP_ENV values to Better Auth's coarser split. */
export function toAuthAppEnv(appEnv: string): AuthAppEnv {
  if (appEnv === 'production' || appEnv === 'staging') {
    return appEnv;
  }
  return 'development';
}

/**
 * Resolves the auth transactional-email provider: real Resend when
 * `RESEND_API_KEY` (and `EMAIL_FROM`) are configured, the logging stub
 * otherwise — same "configured vs. logged fallback" shape as
 * `resolveDigestProvider` (`apps/worker/src/digest.ts`), never a silent
 * misconfiguration (SEC-P11-02). Phase 12 stage A: the double-gated
 * (`isE2ETestHooksEnabled`) capture mailbox takes priority over both when
 * active — it exists specifically so Playwright E2E can read a real
 * verification/reset URL that the logging stub deliberately never exposes
 * (docs/security.md C10). The gate only ever evaluates true in `local`/
 * `test` `APP_ENV` (never staging/production), so this ordering cannot leak
 * into a real deploy even if `RESEND_API_KEY` were also set locally.
 */
function resolveAuthEmailProvider(env: Env, logger: Logger): AuthEmailProvider {
  if (isE2ETestHooksEnabled(env)) {
    return createTestMailboxProvider();
  }
  if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM !== undefined) {
    return createResendAuthEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  const logging = createLoggingEmailProvider(logger);
  return {
    async send({ to, kind, url }) {
      const subject = kind === 'verification' ? 'Verify your email address' : 'Reset your password';
      // `text` (which contains the sensitive url/token) is passed to the
      // provider, never to the logger — createLoggingEmailProvider only
      // logs `kind`/`to` (docs/security.md C10).
      await logging.send({ to, kind: 'transactional', subject, text: `${subject}: ${url}` });
    },
  };
}

/**
 * SEC-P11-02 / SEC-P4-08: Better Auth's `sendResetPassword` /
 * `sendVerificationEmail` hooks call `deps.sendEmail` fire-and-forget
 * (`void deps.sendEmail(...)`, `packages/auth/src/index.ts`) — Better Auth's
 * own docs warn AGAINST awaiting the reset-password send inline (a timing
 * side channel would reveal account existence via response latency), so
 * `packages/auth` cannot simply `await` it. On Cloudflare Workers a
 * fire-and-forget promise with nothing tracking it can be dropped when the
 * isolate is torn down before it settles, silently losing the email. This
 * wrapper registers the actual send with `ExecutionContext.waitUntil`
 * SYNCHRONOUSLY, before any `await` point, so calling it (even via `void`)
 * is enough to extend the isolate's lifetime until the send settles,
 * without changing `packages/auth`'s fire-and-forget call shape or
 * reintroducing the timing side channel. Failures are logged (kind/to only
 * — never url/token) rather than thrown, since nothing awaits this
 * function's rejection anyway.
 */
function createWaitUntilSendEmail(
  env: Env,
  logger: Logger,
  waitUntil: (promise: Promise<unknown>) => void,
): (msg: { to: string; kind: AuthEmailKind; url: string }) => Promise<void> {
  const provider = resolveAuthEmailProvider(env, logger);
  return async ({ to, kind, url }) => {
    const sendPromise = provider.send({ to, kind, url }).catch((cause: unknown) => {
      logger.error('auth.email.send_failed', {
        kind,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
    waitUntil(sendPromise);
    await sendPromise;
  };
}

/**
 * Only the one method this file needs from Hono's `c.executionCtx` — kept
 * minimal (rather than the full `ExecutionContext` type) so call sites don't
 * have to fight Hono's generic `ExecutionContext<unknown>` typing just to
 * pass this through.
 */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export function createRequestAuth(env: Env, logger: Logger, ctx: WaitUntilCtx) {
  const sendEmail = createWaitUntilSendEmail(env, logger, (promise) => ctx.waitUntil(promise));
  return createAuth({
    db: createDb(env.DB),
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL || env.APP_BASE_URL,
    appEnv: toAuthAppEnv(env.APP_ENV),
    sendEmail,
    // Same double gate as every E2E test-only capability: a Playwright run
    // performs many signup/login flows per minute against Better Auth's
    // sign-in/sign-up special rules (3 per 10s, shared bucket without a
    // client IP locally) — relax under E2E only, never staging/production.
    testRelaxedRateLimit: isE2ETestHooksEnabled(env),
  });
}
