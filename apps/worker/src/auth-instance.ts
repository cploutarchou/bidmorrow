/**
 * Shared Better Auth instance factory (Phase 4 stage A + B). One instance
 * per request: cheap (no I/O until a handler runs) and avoids holding
 * request-scoped bindings (env.DB, the logger) in module scope. Used both by
 * the `/api/auth/*` mount and the session middleware, so both read the exact
 * same configuration (table mapping, deleteUser gate, trusted origins).
 */
import { createAuth, type AppEnv as AuthAppEnv } from '@bidmorrow/auth';
import { createDb } from '@bidmorrow/db';
import { createLoggingEmailProvider } from '@bidmorrow/notifications';
import type { Logger } from '@bidmorrow/observability';

import type { Env } from './env';

/** Maps `@bidmorrow/config` APP_ENV values to Better Auth's coarser split. */
export function toAuthAppEnv(appEnv: string): AuthAppEnv {
  if (appEnv === 'production' || appEnv === 'staging') {
    return appEnv;
  }
  return 'development';
}

export function createRequestAuth(env: Env, logger: Logger) {
  const emailProvider = createLoggingEmailProvider(logger);
  return createAuth({
    db: createDb(env.DB),
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL || env.APP_BASE_URL,
    appEnv: toAuthAppEnv(env.APP_ENV),
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
}
