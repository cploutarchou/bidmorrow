/**
 * @bidmorrow/auth — Better Auth configuration (ADR-0002, ADR-0007).
 *
 * `createAuth` wires Better Auth 1.6.x CORE (email/password auth, DB-backed
 * sessions, email verification, password reset, database-storage rate
 * limiting) over our own Drizzle/D1 schema via `@better-auth/drizzle-adapter`.
 * The organization plugin is deliberately NOT enabled — tenancy
 * (`organizations` / `organization_members`) stays domain-owned (ADR-0007);
 * this package owns authentication only.
 *
 * TABLE/FIELD MAPPING: Better Auth resolves a model's schema entry from the
 * `schema` object passed to `drizzleAdapter` using the string set in that
 * model's `modelName` (verified against
 * @better-auth/core/dist/db/adapter/get-model-name.mjs — `getModelName`
 * looks up `schema[modelName]` once a `modelName` override is configured).
 * We set `modelName` to our real snake_case table names and key the
 * `schema` object with those same strings, pointing each at our Drizzle
 * table object (whose own `sqliteTable(...)` first argument is the actual
 * SQL table name). Field names need NO explicit `fields` override: Better
 * Auth's Drizzle adapter maps a field by the property key on the Drizzle
 * table object (docs/adapters/drizzle.mdx "Modifying Field Names"), and our
 * table objects already use the same camelCase property keys Better Auth's
 * core schema documents (`emailVerified`, `userId`, `expiresAt`, …).
 */
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authVerifications,
  newId,
  users,
  type Db,
} from '@bidmorrow/db';

export const PACKAGE = '@bidmorrow/auth';

/**
 * Organization membership roles (docs/data-model.md `organization_members.role`).
 */
export const ORGANIZATION_ROLES = ['ORGANIZATION_OWNER', 'MEMBER'] as const;
export type Role = (typeof ORGANIZATION_ROLES)[number];

/**
 * INTERNAL_ADMIN is deliberately NOT part of {@link Role} and is never stored
 * as a membership row (docs/data-model.md §1): it is an app-level flag
 * resolved per request from the ADMIN_EMAILS allowlist held in configuration,
 * checked server-side and audited. This type exists so code can name the
 * concept without ever making it assignable to a membership role.
 */
export type InternalAdmin = 'INTERNAL_ADMIN';

/** The two auth emails this package sends via Better Auth's built-in hooks. */
export type AuthEmailKind = 'verification' | 'password_reset';

/**
 * Outbound-email hook signature required by `createAuth`. Implementations
 * MUST NEVER log `url`/`token` (docs/security.md C10) — only the composition
 * root decides how the email is actually delivered (dev: logging stub;
 * Phase 8: Resend).
 */
export interface AuthSendEmail {
  (msg: { to: string; kind: AuthEmailKind; url: string; token?: string }): Promise<void>;
}

export type AppEnv = 'development' | 'staging' | 'production';

export interface CreateAuthDeps {
  /** Schema-typed Drizzle D1 client from `@bidmorrow/db` `createDb`. */
  db: Db;
  /** `BETTER_AUTH_SECRET` — never a hardcoded/default value outside tests. */
  secret: string;
  /** Public base URL of the deployed app (used for links + trustedOrigins). */
  baseUrl: string;
  appEnv: AppEnv;
  sendEmail: AuthSendEmail;
}

/**
 * Creates the Better Auth instance. Call once per Worker invocation from the
 * composition root (`apps/worker`), passing bindings-derived config — never
 * construct this with hardcoded secrets.
 */
export function createAuth(deps: CreateAuthDeps) {
  return betterAuth({
    database: drizzleAdapter(deps.db, {
      provider: 'sqlite',
      // Adapter debug logs are useful locally and never contain secrets
      // (query shapes only); off in staging/production to keep logs quiet.
      debugLogs: deps.appEnv === 'development',
      schema: {
        users,
        auth_accounts: authAccounts,
        auth_sessions: authSessions,
        auth_verifications: authVerifications,
        auth_rate_limits: authRateLimits,
      },
    }),
    secret: deps.secret,
    baseURL: deps.baseUrl,
    trustedOrigins: [deps.baseUrl],
    user: {
      modelName: 'users',
      // Phase 4 stage B: account deletion (docs/security.md auth policy).
      // Disabled by default in Better Auth core — verified from installed
      // source (dist/api/routes/update-user.mjs `deleteUser` endpoint
      // throws 404 unless `user.deleteUser.enabled` is set). No password
      // confirmation/verification-email step in V1: the composition root
      // requires an authenticated session and applies its own domain-level
      // gate (sole-OWNER orgs cannot self-delete) before calling this API.
      deleteUser: { enabled: true },
    },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    emailAndPassword: {
      enabled: true,
      // Users must verify their email before signing in (ADR-0002 /
      // docs/security.md); every sign-in attempt for an unverified user
      // re-triggers sendVerificationEmail per Better Auth's documented
      // behavior.
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url, token }) => {
        // Not awaited: Better Auth's docs warn awaiting invites timing
        // attacks on the reset-password endpoint.
        //
        // SEC-P4-08 (documented, accepted for V1): fire-and-forget here is
        // fine for the current dev/test logging-only provider, but the
        // Phase 8 Resend provider MUST NOT rely on fire-and-forget on
        // Workers — an isolate can be torn down before this promise
        // settles, silently dropping the email. Phase 8 needs to route
        // this through `ExecutionContext.waitUntil` (or a durable queue)
        // instead, or verification/reset emails will be lost intermittently
        // in production.
        void deps.sendEmail({ to: user.email, kind: 'password_reset', url, token });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url, token }) => {
        // SEC-P4-08: same fire-and-forget caveat as sendResetPassword above.
        void deps.sendEmail({ to: user.email, kind: 'verification', url, token });
      },
    },
    rateLimit: {
      // In-memory (default) storage does not work across Workers isolates;
      // database storage is the only viable option here (ADR-0002).
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limits',
    },
    advanced: {
      database: {
        // Keep IDs consistent with the rest of the schema (TEXT ULIDs).
        generateId: () => newId(),
      },
      // P4-R-02: without this, Better Auth's rate limiter and audit
      // ipAddress fields key off `x-forwarded-for` by default (verified
      // from installed @better-auth/core/src/utils/ip.ts `DEFAULT_IP_HEADERS`
      // / `getIp`), which is a client-controlled header on Cloudflare
      // Workers — any caller could spoof it to split (or collide) rate-limit
      // buckets. Cloudflare's edge sets `cf-connecting-ip` itself and it
      // cannot be overridden by the client, so restrict resolution to that
      // header only; `getIp` walks `ipAddressHeaders` in order and does NOT
      // fall back to `x-forwarded-for` once this is set.
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The non-null shape returned by `auth.api.getSession({ headers })` —
 * `{ session, user }` per Better Auth core (verified from installed
 * `dist/api/index.d.mts`). The composition root's session middleware sets
 * this on the request context; never trust any client-supplied
 * user/organization identifier instead of reading this.
 */
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
