/**
 * Worker bindings + Hono context variables shared across the composition
 * root, middleware, and route modules (Phase 4 stage A + B). Split out of
 * `index.ts` so middleware/route files can import the types without
 * creating a circular import back through the composition root.
 */
import type { AuthSession } from '@bidmorrow/auth';
import type { OrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';
import type { OrganizationMemberRole } from '@bidmorrow/db';

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
  /** TED Search API origin (docs/dependency-versions.md); optional — TedClient defaults to TED_API_BASE. */
  TED_API_BASE_URL?: string;
  /**
   * Comma-separated allowlist of INTERNAL_ADMIN emails (docs/security.md
   * C6). Never a wrangler.jsonc `vars` entry (those are committed,
   * non-secret config) — always `wrangler secret put` / `.dev.vars`.
   * Optional: undefined/empty means no admin surface is reachable.
   */
  ADMIN_EMAILS?: string;
  /**
   * Native Workers rate-limit binding (docs/security.md C7). Optional: some
   * test/runtime environments may not provision it — middleware must
   * tolerate its absence rather than fail closed or open silently (it logs
   * once and skips limiting).
   */
  API_RATE_LIMITER?: RateLimit;
  /** Raw eForms XML snapshot bucket (ADR-0005), private, per-environment. */
  SNAPSHOTS: R2Bucket;
  /** Ingestion-run queue producer (ADR-0006) — the daily cron enqueues `{kind:'ingest'}`/`{kind:'purge'}` messages. */
  INGEST_QUEUE: Queue<IngestQueueMessage>;
  /**
   * Scoring queue producer (Phase 6): the ingestion queue consumer enqueues
   * `{kind:'score', lotIds}` batches (≤100 lot ids/message) after a
   * successful/partial ingestion window, and `{kind:'recompute',
   * noticeIds}` for the correction-recompute path (TED-P5-03). Bounded,
   * retried, DLQ'd — never scored inline in the ingestion path.
   */
  MATCH_QUEUE: Queue<MatchQueueMessage>;
  /**
   * Digest queue producer (Phase 8): the hourly digest cron enqueues one
   * `{kind:'digest', organizationId, localDate}` message per due org (see
   * `@bidmorrow/notifications` `selectDigestOrgs`). Bounded, retried, DLQ'd
   * — same shape as MATCH_QUEUE.
   */
  DIGEST_QUEUE: Queue<DigestQueueMessage>;
  /**
   * Resend API key (docs/dependency-versions.md). Optional: absent in
   * local/test envs falls back to `createLoggingDigestEmailProvider`
   * (never a real send) — required in staging/production
   * (`@bidmorrow/config` `DEPLOYED_REQUIRED_NAMES`).
   */
  RESEND_API_KEY?: string;
  /** Verified Resend sender, e.g. `BidMorrow <digest@bidmorrow.com>`. */
  EMAIL_FROM?: string;
  /**
   * Stripe secret key (test-mode only outside production — never real
   * credentials in this repo, HUMAN_DECISION_BLOCKERS.md item 4). Optional
   * in local/test: absent means `/api/billing/*` and the webhook endpoint
   * respond `not_configured` rather than construct a client with an empty
   * key. REQUIRED in staging/production (`@bidmorrow/config`
   * `DEPLOYED_REQUIRED_NAMES`).
   */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret (`whsec_...`) — verifies `stripe-signature`. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Stripe Price id for `BIDMORROW_FOUNDING_MONTHLY` ($29/mo, capped). Never invented (HUMAN_DECISION_BLOCKERS.md item 4). */
  STRIPE_PRICE_FOUNDING_MONTHLY?: string;
  /** Stripe Price id for `BIDMORROW_STANDARD_MONTHLY` ($49/mo). Never invented (HUMAN_DECISION_BLOCKERS.md item 4). */
  STRIPE_PRICE_STANDARD_MONTHLY?: string;
}

/** Message shape carried on DIGEST_QUEUE. */
export type DigestQueueMessage = {
  readonly kind: 'digest';
  readonly organizationId: string;
  /** `YYYY-MM-DD`, the org-local date this digest covers. */
  readonly localDate: string;
};

/**
 * Message shape carried on INGEST_QUEUE (src/index.ts `queue()` dispatches
 * on `kind`). `backfill_window` (Phase 10 stage A, `POST
 * /api/admin/ingestion/backfill`) reuses `runIngestionWindow` — the SAME
 * per-window pipeline the daily catch-up cron uses — for one explicit,
 * admin-supplied `YYYY-MM-DD` day, so a backfill is never a second,
 * divergent ingestion code path.
 */
export type IngestQueueMessage =
  | { readonly kind: 'ingest' }
  | { readonly kind: 'purge' }
  | { readonly kind: 'backfill_window'; readonly windowFrom: string; readonly windowTo: string };

/**
 * Message shape carried on MATCH_QUEUE (src/index.ts `queue()` dispatches on
 * `kind`). `recompute_continuation` is distinct from `recompute` (rather than
 * an optional-field variant of it) so the discriminated union stays
 * unambiguous: a truncated `{kind:'recompute'}` run (SEC-P6-01,
 * `ScoreLotsResult.remainingLotIds`) already resolved notice ids to their
 * CURRENT-version lot ids, so its continuation re-enqueues by lot id, not
 * notice id, while still hard-replacing (`recompute: true` in
 * `scoreLotsForOrgs`).
 */
export type MatchQueueMessage =
  | { readonly kind: 'score'; readonly lotIds: readonly string[] }
  | { readonly kind: 'recompute'; readonly noticeIds: readonly string[] }
  | { readonly kind: 'recompute_continuation'; readonly lotIds: readonly string[] };

export interface Variables {
  requestId: string;
  logger: Logger;
  /** Set by the session middleware; absent until it has run. */
  session?: AuthSession;
  /** Set by the organization-context middleware; absent until it has run. */
  organizationId?: OrganizationId;
  role?: OrganizationMemberRole;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
