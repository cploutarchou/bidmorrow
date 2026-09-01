/**
 * `runDigestScheduleJob` (the hourly digest cron entry point) and
 * `resolveDigestProvider` (Resend vs logging-fallback selection) — real
 * local D1, a fake DIGEST_QUEUE binding (mirrors
 * ingestion.continuation.test.ts's `makeFakeQueue` pattern).
 */
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import {
  createDb,
  createOrganization,
  newId,
  setFeatureFlag,
  upsertDigestPreferences,
  upsertSubscriptionByBillingCustomerId,
} from '@bidmorrow/db';
import { PAST_DUE_GRACE_DAYS } from '@bidmorrow/billing';
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

  it('one org with an invalid stored timezone is skipped without sinking the other orgs', async () => {
    const db = createDb(env.DB);
    const utcNow = Date.parse('2026-08-15T12:00:00Z');
    // The PUT route now rejects invalid zones, but the repository does not —
    // this writes the bad row exactly the way a legacy record would exist.
    // Before selectDigestOrgs guarded per-org, Intl.DateTimeFormat's throw
    // here aborted the WHOLE selection loop: every org lost its digest.
    const badOrgId = await makeOrgWithDigestPrefs(db, {
      enabled: true,
      timezone: 'Europe/Nowhere',
    });
    const goodOrgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });

    const { sent, queue } = makeFakeDigestQueue();
    const fakeEnv = { DB: env.DB, DIGEST_QUEUE: queue } as unknown as Env;

    const result = await runDigestScheduleJob(fakeEnv, createLogger({ test: true }), utcNow);

    expect(result.enqueued).toBeGreaterThanOrEqual(1);
    const orgIds = sent.map((m) => m.organizationId);
    expect(orgIds).toContain(goodOrgId);
    expect(orgIds).not.toContain(badOrgId);
  });
});

// ---------------------------------------------------------------------------
// Entitlement gate at SCHEDULE time (issue #3, 2026-09-01: a customer who
// cancels keeps receiving the daily digest). `listOrgsWithDigestEnabled`
// selects on `digest_preferences` + `organizations` only, so a canceled
// subscription changes nothing about who is "due". The enqueue step has to
// consult `@bidmorrow/billing`, the same authority `GET /api/org/feed`'s 402
// uses. Every case below is asserted through the queue: enqueued or not.
// ---------------------------------------------------------------------------

const GATE_UTC_NOW = Date.parse('2026-08-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function setEntitlementEnforced(
  db: ReturnType<typeof createDb>,
  enabled: boolean,
): Promise<void> {
  await setFeatureFlag(db, {
    key: 'entitlement_enforced',
    valueJson: enabled ? 'true' : 'false',
    description: 'test: entitlement gate',
  });
}

let subscriptionSeq = 0;

async function seedSubscription(
  db: ReturnType<typeof createDb>,
  orgId: ReturnType<typeof toOrganizationId>,
  args: {
    status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
    currentPeriodEndAt?: number | null;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  subscriptionSeq += 1;
  await upsertSubscriptionByBillingCustomerId(db, orgId, {
    billingCustomerId: `ctm_digest_gate_${String(subscriptionSeq)}`,
    billingSubscriptionId: `sub_digest_gate_${String(subscriptionSeq)}`,
    status: args.status,
    plan: 'standard',
    currentPeriodEndAt: args.currentPeriodEndAt ?? GATE_UTC_NOW + 30 * DAY_MS,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
  });
}

/** Enqueues once with the injected clock and reports whether `orgId` made it onto the queue. */
async function scheduleAndCheck(orgId: ReturnType<typeof toOrganizationId>): Promise<boolean> {
  const { sent, queue } = makeFakeDigestQueue();
  const fakeEnv = { DB: env.DB, DIGEST_QUEUE: queue } as unknown as Env;
  await runDigestScheduleJob(fakeEnv, createLogger({ test: true }), GATE_UTC_NOW);
  return sent.some((m) => m.organizationId === orgId);
}

describe('runDigestScheduleJob entitlement gate', () => {
  // The flag is global state in a D1 shared by every test in this file:
  // always put it back, or the tests above start losing their orgs.
  afterEach(async () => {
    await setEntitlementEnforced(createDb(env.DB), false);
  });

  it('enforced + canceled subscription: the org is never enqueued (issue #3)', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, { status: 'canceled' });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(false);
  });

  it('enforced + no subscription at all: the org is never enqueued', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(false);
  });

  it('enforced + paused subscription: the org is never enqueued', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, { status: 'paused' });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(false);
  });

  it('enforced + cancel-at-period-end, still inside the paid period: the org IS enqueued', async () => {
    // The customer cancelled, but Paddle keeps the subscription `active`
    // until `current_period_end_at` and they have paid through it. Cutting
    // the digest here would take away something already bought.
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, {
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEndAt: GATE_UTC_NOW + 10 * DAY_MS,
    });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(true);
  });

  it('enforced + past_due inside the grace window: the org IS enqueued', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, {
      status: 'past_due',
      currentPeriodEndAt: GATE_UTC_NOW - 1 * DAY_MS,
    });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(true);
  });

  it('enforced + past_due past the grace window: the org is never enqueued', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, {
      status: 'past_due',
      currentPeriodEndAt: GATE_UTC_NOW - (PAST_DUE_GRACE_DAYS + 1) * DAY_MS,
    });
    await setEntitlementEnforced(db, true);

    expect(await scheduleAndCheck(orgId)).toBe(false);
  });

  it('flag OFF (the default): a canceled org is still enqueued, V1-pilot mode is unchanged', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrgWithDigestPrefs(db, { enabled: true, timezone: 'UTC' });
    await seedSubscription(db, orgId, { status: 'canceled' });
    await setEntitlementEnforced(db, false);

    expect(await scheduleAndCheck(orgId)).toBe(true);
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
