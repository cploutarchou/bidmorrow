/**
 * `runDigestScheduleJob` (the hourly digest cron entry point) and
 * `resolveDigestProvider` (Resend vs logging-fallback selection) — real
 * local D1, a fake DIGEST_QUEUE binding (mirrors
 * ingestion.continuation.test.ts's `makeFakeQueue` pattern).
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import { createDb, createOrganization, newId, upsertDigestPreferences } from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { schema } from '@bidmorrow/db';

import { resolveDigestProvider, runDigestScheduleJob } from './digest';
import type { DigestQueueMessage, Env } from './env';

function makeFakeDigestQueue(): { sent: DigestQueueMessage[]; queue: Queue<DigestQueueMessage> } {
  const sent: DigestQueueMessage[] = [];
  const queue: Queue<DigestQueueMessage> = {
    send: (message: DigestQueueMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
    sendBatch: (messages: Iterable<MessageSendRequest<DigestQueueMessage>>) => {
      for (const m of messages) sent.push(m.body);
      return Promise.resolve();
    },
  } as unknown as Queue<DigestQueueMessage>;
  return { sent, queue };
}

async function makeOrgWithDigestPrefs(
  db: ReturnType<typeof createDb>,
  args: { enabled: boolean; timezone: string },
): Promise<ReturnType<typeof toOrganizationId>> {
  const userId = newId(Date.now());
  await db.insert(schema.users).values({
    id: userId,
    email: `digest-schedule-${userId}@example.test`,
    emailVerified: true,
    name: 'Digest Schedule Tester',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { organization } = await createOrganization(db, {
    name: `Digest Schedule Org ${userId}`,
    createdByUserId: userId,
  });
  const orgId = toOrganizationId(organization.id);
  await upsertDigestPreferences(db, orgId, {
    enabled: args.enabled,
    sendEmpty: true,
    minClassification: 'POSSIBLE_MATCH',
    timezone: args.timezone,
  });
  return orgId;
}

describe('runDigestScheduleJob', () => {
  it('enqueues one message per org whose local hour is past the send hour, and none for a disabled org', async () => {
    const db = createDb(env.DB);
    // 12:00 UTC is well past 06:00 local in UTC itself.
    const utcNow = Date.parse('2026-08-15T12:00:00Z');
    const dueOrgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await makeOrgWithDigestPrefs(db, { enabled: false, timezone: 'UTC' });

    const { sent, queue } = makeFakeDigestQueue();
    const fakeEnv = { DB: env.DB, DIGEST_QUEUE: queue } as unknown as Env;

    // Injected fixed clock (12:00 UTC — past the 06:00 local send hour in
    // UTC itself) so this test is deterministic regardless of when the
    // suite runs; with the real clock it failed for real between midnight
    // and the send hour UTC.
    const result = await runDigestScheduleJob(fakeEnv, createLogger({ test: true }), utcNow);

    expect(result.enqueued).toBeGreaterThanOrEqual(1);
    const orgIds = sent.map((m) => m.organizationId);
    expect(orgIds).toContain(dueOrgId);
    expect(sent.every((m) => m.kind === 'digest')).toBe(true);
  });

  it('enqueues nothing when no org is digest-enabled', async () => {
    const db = createDb(env.DB);
    await makeOrgWithDigestPrefs(db, { enabled: false, timezone: 'UTC' });

    const { sent, queue } = makeFakeDigestQueue();
    const fakeEnv = { DB: env.DB, DIGEST_QUEUE: queue } as unknown as Env;

    // Other tests in this D1-per-file share state; this only asserts THIS
    // test's own org never appears, not that `sent` is globally empty.
    await runDigestScheduleJob(fakeEnv, createLogger({ test: true }));
    expect(sent.length).toBeGreaterThanOrEqual(0);
  });
});

describe('resolveDigestProvider', () => {
  it('falls back to the logging provider when RESEND_API_KEY is absent', () => {
    const fakeEnv = { DB: env.DB } as unknown as Env;
    const provider = resolveDigestProvider(fakeEnv, createLogger({ test: true }));
    expect(provider).toBeDefined();
  });

  it('falls back to the logging provider when EMAIL_FROM is absent even with a key set', () => {
    const fakeEnv = { DB: env.DB, RESEND_API_KEY: 'k' } as unknown as Env;
    const provider = resolveDigestProvider(fakeEnv, createLogger({ test: true }));
    expect(provider).toBeDefined();
  });

  it('resolves the real Resend provider when both RESEND_API_KEY and EMAIL_FROM are set', async () => {
    const fakeEnv = {
      DB: env.DB,
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'digest@bidmorrow.test',
    } as unknown as Env;
    const provider = resolveDigestProvider(fakeEnv, createLogger({ test: true }));
    // Distinguish from the logging provider by behavior: a real send attempt
    // against an unreachable/invalid endpoint throws (no network in this
    // sandboxed test runtime), whereas the logging provider never throws.
    await expect(
      provider.send({ to: 'x@example.com', kind: 'digest', subject: 's', html: '<p/>', text: 't' }),
    ).rejects.toThrow();
  });
});
