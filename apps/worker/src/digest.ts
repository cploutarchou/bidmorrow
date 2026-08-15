/**
 * Digest composition (Phase 8): wires `@bidmorrow/notifications` against
 * the Worker's real bindings (`env.DB`, `env.DIGEST_QUEUE`,
 * `env.RESEND_API_KEY`) for the cron/queue handlers in `index.ts`. Kept out
 * of `index.ts` so it stays independently testable — mirrors
 * `src/ingestion.ts`'s composition pattern.
 */
import { createDb } from '@bidmorrow/db';
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

import type { DigestQueueMessage, Env } from './env';

/** Digest emails to enqueue per cron invocation batch. */
const DIGEST_MESSAGE_BATCH = 100;

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
): Promise<{ enqueued: number }> {
  const db = createDb(env.DB);
  const due = await selectDigestOrgs(db, { utcNow: Date.now() });
  const messages: DigestQueueMessage[] = due.map((org) => ({
    kind: 'digest',
    organizationId: org.organizationId,
    localDate: org.localDate,
  }));
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
  return generateDigest(
    {
      db,
      logger,
      provider: provider ?? resolveDigestProvider(env, logger),
      appBaseUrl: env.APP_BASE_URL,
      engineVersion: ENGINE_VERSION,
    },
    toOrganizationId(message.organizationId),
    { localDate: message.localDate, utcNow: Date.now() },
  );
}
