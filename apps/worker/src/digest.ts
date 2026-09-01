/**
 * Digest composition (Phase 8): wires `@bidmorrow/notifications` against
 * the Worker's real bindings (`env.DB`, `env.DIGEST_QUEUE`,
 * `env.RESEND_API_KEY`) for the cron/queue handlers in `index.ts`. Kept out
 * of `index.ts` so it stays independently testable — mirrors
 * `src/ingestion.ts`'s composition pattern.
 */
import { getEntitlement, isEntitlementEnforced } from '@bidmorrow/billing';
import type { EntitlementReason } from '@bidmorrow/billing';
import { createDb } from '@bidmorrow/db';
import type { Db } from '@bidmorrow/db';
import { ENGINE_VERSION } from '@bidmorrow/matching';
import type { Logger } from '@bidmorrow/observability';
import {
  createLoggingDigestEmailProvider,
  createResendEmailProvider,
  generateDigest,
  selectDigestOrgs,
} from '@bidmorrow/notifications';
import type { DigestEmailProvider, DigestOutcome } from '@bidmorrow/notifications';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import type { OrganizationId } from '@bidmorrow/domain';

import type { DigestQueueMessage, Env } from './env';

/** Digest emails to enqueue per cron invocation batch. */
const DIGEST_MESSAGE_BATCH = 100;

/**
 * The digest's entitlement rule, shared by BOTH entry points below so the
 * scheduler and the consumer can never drift into two different answers,
 * and it is the SAME authority `GET /api/org/feed`'s 402 uses
 * (`@bidmorrow/billing` `getEntitlement`), never a digest-only second
 * opinion. Returns the blocking reason when this organization must NOT
 * receive a digest, `null` when it may.
 *
 * `enforced` is a parameter rather than a read inside, so the schedule job
 * reads the `entitlement_enforced` flag once per cron invocation instead of
 * once per due org. Flag off (the default) always returns `null`: the API
 * does not paywall in V1-pilot mode, so the digest must not either.
 *
 * `now` is the caller's clock, so a `past_due` org's 7-day grace window
 * (`PAST_DUE_GRACE_DAYS`) is measured against the same instant the rest of
 * that job uses instead of a second, slightly different `Date.now()`.
 */
async function entitlementBlock(
  db: Db,
  enforced: boolean,
  organizationId: OrganizationId,
  now: number,
): Promise<EntitlementReason | null> {
  if (!enforced) return null;
  const entitlement = await getEntitlement(db, organizationId, now);
  return entitlement.active ? null : entitlement.reason;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Resolves the digest email provider: real Resend when `RESEND_API_KEY`
 * (and `EMAIL_FROM`) are configured, the logging stub otherwise — never a
 * silent misconfiguration, always a logged, type-safe fallback (documented
 * in env.ts, `.dev.vars.example`).
 */
export function resolveDigestProvider(env: Env, logger: Logger): DigestEmailProvider {
  if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM !== undefined) {
    return createResendEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  logger.info('digest.provider.logging_fallback', {
    reason: env.RESEND_API_KEY === undefined ? 'missing_resend_api_key' : 'missing_email_from',
  });
  return createLoggingDigestEmailProvider(logger);
}

/**
 * Hourly digest cron entry point: finds every org due for a digest right
 * now (docs on the send-hour/timezone model live in
 * `@bidmorrow/notifications` `digest-orchestration.ts`) and enqueues one
 * `{kind:'digest'}` message per org, batched. Never generates a digest
 * inline — a slow send must never risk the cron's own execution budget.
 */
export async function runDigestScheduleJob(
  env: Env,
  logger: Logger,
  // Injectable clock (defaults to the real one) so tests are deterministic —
  // with a hardwired Date.now() the schedule test fails for real whenever
  // the suite runs between midnight and the send hour UTC.
  utcNow: number = Date.now(),
): Promise<{ enqueued: number }> {
  const db = createDb(env.DB);
  const due = await selectDigestOrgs(db, { utcNow }, logger);
  // `selectDigestOrgs` answers "does this org want a digest today", never
  // "is this org still entitled to one". `listOrgsWithDigestEnabled` reads
  // `digest_preferences` and `organizations` only, and a canceled
  // subscription changes neither. Entitlement is therefore applied HERE, at
  // enqueue time, IN ADDITION to the consumer's own check (below), not
  // instead of it: without this, an unentitled org's message is produced
  // again every hour, all day, for as long as its digest preference stays
  // enabled.
  const enforced = await isEntitlementEnforced(db);
  const messages: DigestQueueMessage[] = [];
  for (const org of due) {
    const blocked = await entitlementBlock(db, enforced, org.organizationId, utcNow);
    if (blocked !== null) {
      // Simply not enqueued: deliberately NO `digest_runs` row. That
      // table's status CHECK constraint
      // (`pending|sent|skipped_empty|skipped_paused|failed`, migration
      // 0002) has no value for "not entitled", and adding one is a
      // migration, a one-way door owned by the `database` agent, and it is
      // not worth opening for a composition-root gate this log line already
      // makes visible. Same "no row at all" shape as every other reason an
      // org is not due (send hour not reached yet, unusable stored
      // timezone). Logged with the org id and the entitlement reason only,
      // never a recipient address.
      logger.info('digest.schedule.skipped.no_entitlement', {
        organization_id: org.organizationId,
        reason: blocked,
      });
      continue;
    }
    messages.push({
      kind: 'digest',
      organizationId: org.organizationId,
      localDate: org.localDate,
    });
  }
  for (const batch of chunk(messages, DIGEST_MESSAGE_BATCH)) {
    await env.DIGEST_QUEUE.sendBatch(batch.map((body) => ({ body })));
  }
  if (messages.length > 0) {
    logger.info('digest.schedule.enqueued', { due_count: messages.length });
  }
  return { enqueued: messages.length };
}

/**
 * `DIGEST_QUEUE` `{kind:'digest'}` consumer: generates/resumes one org's
 * digest. SEC-P8-01: `provider` is an optional injection point — the
 * queue() consumer in `index.ts` hoists ONE provider instance per
 * `queue()` invocation (not per message) and passes it into every
 * `runDigestJob` call for that batch, so `createResendEmailProvider`'s
 * internal `lastSendAt` rate-limit spacing spans the whole batch of digest
 * messages, not just the sends within a single org's `generateDigest` call.
 * Falls back to resolving its own provider when called standalone (e.g.
 * tests), so the default behavior is unchanged.
 */
export async function runDigestJob(
  env: Env,
  logger: Logger,
  message: DigestQueueMessage,
  provider?: DigestEmailProvider,
): Promise<DigestOutcome> {
  const db = createDb(env.DB);

  const organizationId = toOrganizationId(message.organizationId);

  // Phase 9 ENTITLEMENT_ENFORCED gate (docs/architecture.md § billing):
  // flag-off (default) preserves V1-pilot mode (manual provisioning
  // continues, nothing gated here). Kept even though
  // `runDigestScheduleJob` now applies the same rule at enqueue time: a
  // message can be produced before a cancellation lands and sit on the
  // queue across it, and at-least-once delivery can redeliver one. Checked
  // BEFORE `generateDigest` is ever called — same "no digest_runs row at
  // all" shape as the existing `digest_paused` global-pause check inside
  // `generateDigest` itself (Phase 8), just resolved one layer up since the
  // gate depends on `@bidmorrow/billing`, which `@bidmorrow/notifications`
  // does not (and should not) depend on — apps/worker is the sole
  // composition root that wires both. Reuses the `skipped_paused` outcome
  // status rather than adding a new one to packages/notifications'
  // vocabulary for a composition-root-level gate.
  const blocked = await entitlementBlock(
    db,
    await isEntitlementEnforced(db),
    organizationId,
    Date.now(),
  );
  if (blocked !== null) {
    logger.info('digest.skipped.no_entitlement', {
      organization_id: organizationId,
      reason: blocked,
    });
    return { status: 'skipped_paused', resumed: false, matchesCount: 0 };
  }

  return generateDigest(
    {
      db,
      logger,
      provider: provider ?? resolveDigestProvider(env, logger),
      appBaseUrl: env.APP_BASE_URL,
      engineVersion: ENGINE_VERSION,
      unsubscribeSecret: env.BETTER_AUTH_SECRET,
    },
    organizationId,
    { localDate: message.localDate, utcNow: Date.now() },
  );
}
