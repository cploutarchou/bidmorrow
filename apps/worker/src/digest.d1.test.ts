/**
 * Digest pipeline integration tests: real local D1 (workerd via
 * @cloudflare/vitest-pool-workers), a fake `DigestEmailProvider` (no real
 * network send). Proves the full happy path, DB-enforced dedupe, the
 * empty/sendEmpty rules, the minClassification filter, ignored-match
 * exclusion, the retryable-failure resume path (KEY test — no duplicate
 * items on retry), permanent failure, and the global pause flag.
 *
 * Notice/lot/buyer rows are seeded directly (bypassing the full TED
 * ingestion pipeline, already covered end-to-end in scoring.d1.test.ts) —
 * only `tender_matches`/`digest_*` behavior is under test here.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import { ENGINE_VERSION } from '@bidmorrow/matching';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { PermanentEmailError, RetryableEmailError, generateDigest } from '@bidmorrow/notifications';
import type { DigestSendMessage, DigestSendResult } from '@bidmorrow/notifications';
import {
  addOrganizationMember,
  createDb,
  createOrganization,
  getDigestRunByDate,
  ignoreTender,
  insertTenderMatches,
  newId,
  setFeatureFlag,
  upsertDigestPreferences,
  upsertSubscriptionByBillingCustomerId,
} from '@bidmorrow/db';
import { schema } from '@bidmorrow/db';

import { runDigestJob } from './digest';
import type { Env } from './env';

const ORG_TZ = 'UTC';

let orgCounter = 0;
let userCounter = 0;

async function makeOrg(
  db: ReturnType<typeof createDb>,
): Promise<{ orgId: ReturnType<typeof toOrganizationId>; userId: string }> {
  orgCounter += 1;
  userCounter += 1;
  const userId = newId(Date.now());
  await db.insert(schema.users).values({
    id: userId,
    email: `digest-test-${String(userCounter)}@example.test`,
    emailVerified: true,
    name: `Digest Tester ${String(userCounter)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { organization } = await createOrganization(db, {
    name: `Digest Test Org ${String(orgCounter)}`,
    createdByUserId: userId,
  });
  return { orgId: toOrganizationId(organization.id), userId };
}

let lotCounter = 0;

/** Seeds a minimal notice/version/lot/buyer chain, bypassing the ingestion pipeline. */
async function seedLot(
  db: ReturnType<typeof createDb>,
  args: { title: string; deadlineAt: number | null; buyerName?: string },
): Promise<{ lotId: string; noticeId: string }> {
  lotCounter += 1;
  const now = Date.now();
  const sourceNoticeId = `digest-test-notice-${String(lotCounter)}`;

  const buyerId =
    args.buyerName === undefined
      ? null
      : ((
          await db
            .insert(schema.buyers)
            .values({
              id: newId(now),
              source: 'ted',
              sourceBuyerId: null,
              name: args.buyerName,
              countryCode: 'IE',
              buyerLegalType: null,
              buyerActivity: null,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: schema.buyers.id })
        )[0]?.id ?? null);

  const snapshotId = newId(now);
  await db.insert(schema.sourceSnapshots).values({
    id: snapshotId,
    source: 'ted',
    sourceNoticeId,
    versionNumber: 1,
    r2Key: `ted/2026/08/${sourceNoticeId}/v1.xml`,
    contentHash: `hash-${sourceNoticeId}`,
    sizeBytes: 100,
    contentType: 'application/xml',
    retainedUntilAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const noticeId = newId(now);
  const versionId = newId(now);
  // Circular FK pair (tender_notices.current_version_id <->
  // tender_notice_versions.notice_id): insert the notice with a null
  // current_version_id first, then the version, then repoint — mirrors
  // upsertNoticeWithVersion's own insert order (D1 enforces FKs immediately,
  // not deferred).
  await db.insert(schema.tenderNotices).values({
    id: noticeId,
    source: 'ted',
    sourceNoticeId,
    currentVersionId: null,
    buyerId,
    noticeType: 'competition',
    procedureType: 'open',
    eformsSdkVersion: '1.15',
    sourceLanguagesJson: JSON.stringify(['eng']),
    sourceUrl: `https://ted.europa.eu/notice/${sourceNoticeId}`,
    publicationDate: '2026-08-10',
    retrievedAt: now,
    contentHash: `hash-${sourceNoticeId}`,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.tenderNoticeVersions).values({
    id: versionId,
    noticeId,
    versionNumber: 1,
    publicationDate: '2026-08-10',
    contentHash: `hash-${sourceNoticeId}`,
    snapshotId,
    eformsSdkVersion: '1.15',
    ingestionRunId: null,
    createdAt: now,
  });
  await env.DB.prepare('UPDATE tender_notices SET current_version_id = ? WHERE id = ?')
    .bind(versionId, noticeId)
    .run();

  const lotId = newId(now);
  await db.insert(schema.tenderLots).values({
    id: lotId,
    noticeVersionId: versionId,
    lotNumber: '1',
    title: args.title,
    description: null,
    contractNature: 'services',
    estimatedValueAmount: 100_000,
    estimatedValueCurrency: 'EUR',
    estimatedValueEur: 100_000,
    valueIsDerived: 0,
    deadlineAt: args.deadlineAt,
    createdAt: now,
  });

  return { lotId, noticeId };
}

async function seedMatch(
  db: ReturnType<typeof createDb>,
  organizationId: ReturnType<typeof toOrganizationId>,
  args: {
    title: string;
    classification: 'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT';
    score: number;
    scoredAt: number;
    deadlineAt?: number | null;
    buyerName?: string;
  },
): Promise<{ matchId: string; lotId: string }> {
  const { lotId, noticeId } = await seedLot(db, {
    title: args.title,
    deadlineAt: args.deadlineAt ?? Date.now() + 30 * 86_400_000,
    ...(args.buyerName === undefined ? {} : { buyerName: args.buyerName }),
  });
  await insertTenderMatches(db, organizationId, {
    matches: [
      {
        lotId,
        noticeId,
        engineVersion: ENGINE_VERSION,
        score: args.score,
        classification: args.classification,
        scoredAt: args.scoredAt,
        components: [
          {
            componentKey: 'cpv',
            points: 20,
            maxPoints: 25,
            status: 'MATCHED',
            explanation: 'CPV match',
          },
          {
            componentKey: 'geography',
            points: 10,
            maxPoints: 10,
            status: 'MATCHED',
            explanation: 'In your geography',
          },
        ],
      },
    ],
  });
  const row = await env.DB.prepare(
    'SELECT id FROM tender_matches WHERE organization_id = ? AND lot_id = ? AND engine_version = ?',
  )
    .bind(organizationId, lotId, ENGINE_VERSION)
    .first<{ id: string }>();
  if (row === null) throw new Error('seedMatch: match row not found after insert');
  return { matchId: row.id, lotId };
}

// `email_deliveries` has a real DB unique constraint on
// (provider, provider_message_id) — module-level so every fake message id
// across every test in this file (which share one D1 per file, per the
// pool-workers per-file isolation convention) is unique.
let fakeMessageIdCounter = 0;

class FakeDigestProvider {
  readonly sent: DigestSendMessage[] = [];
  private readonly behavior: 'ok' | 'retryable' | 'permanent';

  constructor(behavior: 'ok' | 'retryable' | 'permanent' = 'ok') {
    this.behavior = behavior;
  }

  send(message: DigestSendMessage): Promise<DigestSendResult> {
    this.sent.push(message);
    if (this.behavior === 'retryable') {
      return Promise.reject(new RetryableEmailError('simulated transient failure'));
    }
    if (this.behavior === 'permanent') {
      return Promise.reject(new PermanentEmailError('simulated permanent failure', 422));
    }
    fakeMessageIdCounter += 1;
    return Promise.resolve({ providerMessageId: `fake-${String(fakeMessageIdCounter)}` });
  }
}

const NOW = Date.parse('2026-08-15T12:00:00Z');
const APP_BASE_URL = 'https://app.bidmorrow.test';

const TEST_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';

describe('generateDigest', () => {
  it('happy path: creates a run, items, a sent email delivery, and status=sent', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    await seedMatch(db, orgId, {
      title: 'Cybersecurity audit services',
      classification: 'STRONG_MATCH',
      score: 88,
      scoredAt: NOW - 3_600_000,
      buyerName: 'City Council',
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('sent');
    expect(outcome.matchesCount).toBe(1);
    expect(provider.sent).toHaveLength(1);
    const sentHtml = provider.sent[0]?.html ?? '';
    const sentText = provider.sent[0]?.text ?? '';
    expect(sentHtml).toContain('Cybersecurity audit services');
    // P8-R-01 (masking gap): the normal/non-resumed send path must render
    // buyer, a deadline, and at least one component-explanation reason line
    // — not just the title. Proves the fresh-path render (straight from
    // listDigestCandidateMatches) actually carries this detail through,
    // since digest_items itself has no columns for it.
    expect(sentHtml).toContain('Buyer: City Council');
    expect(sentHtml).toMatch(/Deadline: \d{4}-\d{2}-\d{2}/);
    expect(sentHtml).toContain('CPV match');
    expect(sentText).toContain('Buyer: City Council');
    expect(sentText).toMatch(/Deadline: \d{4}-\d{2}-\d{2}/);
    expect(sentText).toContain('CPV match');

    const run = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(run?.status).toBe('sent');
    expect(run?.matchesCount).toBe(1);
    expect(run?.emailDeliveryId).not.toBeNull();

    const delivery = await env.DB.prepare(
      'SELECT status, provider_message_id FROM email_deliveries WHERE id = ?',
    )
      .bind(run?.emailDeliveryId)
      .first<{ status: string; provider_message_id: string }>();
    expect(delivery?.status).toBe('sent');
    expect(delivery?.provider_message_id).toMatch(/^fake-\d+$/);

    const items = await env.DB.prepare(
      'SELECT rank, title_snapshot FROM digest_items WHERE digest_run_id = ?',
    )
      .bind(run?.id)
      .all<{ rank: number; title_snapshot: string }>();
    expect(items.results).toHaveLength(1);
    expect(items.results[0]?.title_snapshot).toBe('Cybersecurity audit services');
  });

  it('DB-enforced dedupe: a second createDigestRun for the same org+date throws DuplicateDigestError', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'LOW_FIT',
      timezone: ORG_TZ,
    });

    const provider = new FakeDigestProvider('ok');
    const deps = {
      db,
      logger: createLogger({ test: true }),
      provider,
      appBaseUrl: APP_BASE_URL,
      engineVersion: ENGINE_VERSION,
      unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
    };
    const first = await generateDigest(deps, orgId, { localDate: '2026-08-15', utcNow: NOW });
    expect(first.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);

    // A second FULL invocation (as if two cron/queue firings raced) must not
    // send a second email — it resolves as an already-terminal duplicate.
    const second = await generateDigest(deps, orgId, { localDate: '2026-08-15', utcNow: NOW });
    expect(second.status).toBe('sent');
    expect(provider.sent).toHaveLength(1); // no new send
  });

  it('empty + !sendEmpty → skipped_empty, no email sent', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('skipped_empty');
    expect(provider.sent).toHaveLength(0);
    const run = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(run?.status).toBe('skipped_empty');
  });

  it('empty + sendEmpty → sends anyway', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.html).toContain('No new matches met your digest threshold today.');
  });

  it('minClassification filter: a POSSIBLE_MATCH is excluded when the org requires WORTH_REVIEWING+', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'WORTH_REVIEWING',
      timezone: ORG_TZ,
    });
    await seedMatch(db, orgId, {
      title: 'Below threshold lot',
      classification: 'POSSIBLE_MATCH',
      score: 50,
      scoredAt: NOW - 3_600_000,
    });
    await seedMatch(db, orgId, {
      title: 'Above threshold lot',
      classification: 'STRONG_MATCH',
      score: 85,
      scoredAt: NOW - 3_600_000,
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.matchesCount).toBe(1);
    expect(provider.sent[0]?.html).toContain('Above threshold lot');
    expect(provider.sent[0]?.html).not.toContain('Below threshold lot');
  });

  it('ignored matches are excluded from the digest', async () => {
    const db = createDb(env.DB);
    const { orgId, userId: ownerUserId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    const { matchId: _matchId, lotId } = await seedMatch(db, orgId, {
      title: 'Ignored lot',
      classification: 'STRONG_MATCH',
      score: 90,
      scoredAt: NOW - 3_600_000,
    });
    const noticeRow = await env.DB.prepare('SELECT notice_id FROM tender_matches WHERE lot_id = ?')
      .bind(lotId)
      .first<{ notice_id: string }>();
    await ignoreTender(db, orgId, {
      lotId,
      noticeId: noticeRow?.notice_id ?? '',
      ignoredByUserId: ownerUserId,
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.matchesCount).toBe(0);
    expect(outcome.status).toBe('sent'); // sendEmpty=true above
  });

  it('KEY: a retryable send failure marks the run failed, and a resumed retry never duplicates digest_items', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    await seedMatch(db, orgId, {
      title: 'Retry-path lot',
      classification: 'STRONG_MATCH',
      score: 90,
      scoredAt: NOW - 3_600_000,
    });

    const failingProvider = new FakeDigestProvider('retryable');
    const logger = createLogger({ test: true });

    await expect(
      generateDigest(
        {
          db,
          logger,
          provider: failingProvider,
          appBaseUrl: APP_BASE_URL,
          engineVersion: ENGINE_VERSION,
          unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
        },
        orgId,
        { localDate: '2026-08-15', utcNow: NOW },
      ),
    ).rejects.toBeInstanceOf(RetryableEmailError);

    const runAfterFailure = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(runAfterFailure?.status).toBe('failed');
    const itemsAfterFailure = await env.DB.prepare(
      'SELECT id FROM digest_items WHERE digest_run_id = ?',
    )
      .bind(runAfterFailure?.id)
      .all();
    expect(itemsAfterFailure.results).toHaveLength(1);

    // Queue retry: same organization/localDate, this time the provider
    // succeeds. createDigestRun collides (DuplicateDigestError) -> resume.
    const succeedingProvider = new FakeDigestProvider('ok');
    const resumedOutcome = await generateDigest(
      {
        db,
        logger,
        provider: succeedingProvider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(resumedOutcome.status).toBe('sent');
    expect(resumedOutcome.resumed).toBe(true);
    expect(resumedOutcome.matchesCount).toBe(1);
    // P8-R-01: the resume path is honestly degraded, not silently thinner —
    // the rendered item explicitly says detail is unavailable rather than
    // looking like a normal (but incomplete) digest.
    expect(succeedingProvider.sent[0]?.html).toContain('(details unavailable — resent digest)');

    const itemsAfterResume = await env.DB.prepare(
      'SELECT id FROM digest_items WHERE digest_run_id = ?',
    )
      .bind(runAfterFailure?.id)
      .all();
    // Still exactly one row — the resume path re-rendered from the SAME
    // stored items, never re-collected/duplicated candidates.
    expect(itemsAfterResume.results).toHaveLength(1);

    const runAfterResume = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(runAfterResume?.status).toBe('sent');
  });

  it('a permanent send failure marks the run failed and does NOT throw (no queue retry)', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    await seedMatch(db, orgId, {
      title: 'Permanent failure lot',
      classification: 'STRONG_MATCH',
      score: 90,
      scoredAt: NOW - 3_600_000,
    });

    const provider = new FakeDigestProvider('permanent');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('failed');
    const run = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(run?.status).toBe('failed');
  });

  it('P8-R-02: emails every org member — N members yields N provider sends and N email_deliveries rows', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    await seedMatch(db, orgId, {
      title: 'Multi-recipient lot',
      classification: 'STRONG_MATCH',
      score: 91,
      scoredAt: NOW - 3_600_000,
    });

    // makeOrg already creates the OWNER member; add two more members.
    const extraEmails: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      userCounter += 1;
      const userId = newId(Date.now());
      const email = `digest-member-${String(userCounter)}@example.test`;
      await db.insert(schema.users).values({
        id: userId,
        email,
        emailVerified: true,
        name: `Digest Member ${String(userCounter)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await addOrganizationMember(db, orgId, { userId, role: 'MEMBER' });
      extraEmails.push(email);
    }

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('sent');
    // Owner (from makeOrg) + 2 extra members = 3 recipients, 3 provider sends.
    expect(provider.sent).toHaveLength(3);
    const sentTo = provider.sent.map((message) => message.to);
    for (const email of extraEmails) {
      expect(sentTo).toContain(email);
    }
    expect(new Set(sentTo).size).toBe(3); // every recipient got exactly one send

    const run = await getDigestRunByDate(db, orgId, '2026-08-15');
    const deliveries = await env.DB.prepare(
      'SELECT to_email, status FROM email_deliveries WHERE organization_id = ? AND kind = ?',
    )
      .bind(orgId, 'digest')
      .all<{ to_email: string; status: string }>();
    // One email_deliveries row per recipient (P8-R-02's chosen representation).
    expect(deliveries.results).toHaveLength(3);
    expect(deliveries.results.every((row) => row.status === 'sent')).toBe(true);
    expect(run?.status).toBe('sent');
  });

  it('the digest_paused global flag skips generation entirely — no digest_runs row at all', async () => {
    const db = createDb(env.DB);
    const { orgId } = await makeOrg(db);
    await upsertDigestPreferences(db, orgId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'POSSIBLE_MATCH',
      timezone: ORG_TZ,
    });
    await setFeatureFlag(db, {
      key: 'digest_paused',
      valueJson: 'true',
      description: 'test pause',
    });

    const provider = new FakeDigestProvider('ok');
    const outcome = await generateDigest(
      {
        db,
        logger: createLogger({ test: true }),
        provider,
        appBaseUrl: APP_BASE_URL,
        engineVersion: ENGINE_VERSION,
        unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
      },
      orgId,
      { localDate: '2026-08-15', utcNow: NOW },
    );

    expect(outcome.status).toBe('skipped_paused');
    expect(provider.sent).toHaveLength(0);
    const run = await getDigestRunByDate(db, orgId, '2026-08-15');
    expect(run).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Entitlement gate at CONSUME time (issue #3). `runDigestJob` is the
// composition-root wrapper the queue consumer actually calls; every test
// above exercises `generateDigest` directly and therefore skips this gate
// entirely, which is how it stayed untested. These lock it in: a message
// enqueued before a cancellation landed must not turn into an email.
// `runDigestJob` uses the real clock, so subscription periods and scored-at
// timestamps here are relative to `Date.now()`, not the fixed `NOW` above.
// ---------------------------------------------------------------------------

const CONSUME_DAY_MS = 24 * 60 * 60 * 1000;
let consumeSubscriptionSeq = 0;

function fakeDigestEnv(): Env {
  return {
    DB: env.DB,
    APP_BASE_URL,
    BETTER_AUTH_SECRET: TEST_UNSUBSCRIBE_SECRET,
  } as unknown as Env;
}

async function seedConsumeSubscription(
  db: ReturnType<typeof createDb>,
  orgId: ReturnType<typeof toOrganizationId>,
  args: {
    status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
    currentPeriodEndAt?: number | null;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  consumeSubscriptionSeq += 1;
  await upsertSubscriptionByBillingCustomerId(db, orgId, {
    billingCustomerId: `ctm_digest_consume_${String(consumeSubscriptionSeq)}`,
    billingSubscriptionId: `sub_digest_consume_${String(consumeSubscriptionSeq)}`,
    status: args.status,
    plan: 'standard',
    currentPeriodEndAt: args.currentPeriodEndAt ?? Date.now() + 30 * CONSUME_DAY_MS,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
  });
}

/** An org that wants a digest today and has one real match to put in it. */
async function makeDigestReadyOrg(
  db: ReturnType<typeof createDb>,
): Promise<ReturnType<typeof toOrganizationId>> {
  const { orgId } = await makeOrg(db);
  await upsertDigestPreferences(db, orgId, {
    enabled: true,
    sendEmpty: true,
    minClassification: 'POSSIBLE_MATCH',
    timezone: ORG_TZ,
  });
  await seedMatch(db, orgId, {
    title: 'Municipal fibre rollout',
    classification: 'STRONG_MATCH',
    score: 91,
    scoredAt: Date.now() - 3_600_000,
    buyerName: 'City Council',
  });
  return orgId;
}

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

describe('runDigestJob entitlement gate', () => {
  // The `digest_paused` test above leaves that global flag ON; clear it so
  // these tests observe the entitlement gate and not the pause gate.
  beforeEach(async () => {
    await setFeatureFlag(createDb(env.DB), {
      key: 'digest_paused',
      valueJson: 'false',
      description: 'test: unpaused',
    });
  });

  afterEach(async () => {
    await setEntitlementEnforced(createDb(env.DB), false);
  });

  it('enforced + canceled subscription: no email, no digest_runs row (issue #3)', async () => {
    const db = createDb(env.DB);
    const orgId = await makeDigestReadyOrg(db);
    await seedConsumeSubscription(db, orgId, { status: 'canceled' });
    await setEntitlementEnforced(db, true);

    const provider = new FakeDigestProvider('ok');
    const outcome = await runDigestJob(
      fakeDigestEnv(),
      createLogger({ test: true }),
      { kind: 'digest', organizationId: orgId, localDate: '2026-09-01' },
      provider,
    );

    expect(outcome.status).toBe('skipped_paused');
    expect(provider.sent).toHaveLength(0);
    expect(await getDigestRunByDate(db, orgId, '2026-09-01')).toBeNull();
  });

  it('enforced + cancel-at-period-end, still inside the paid period: the digest is sent', async () => {
    const db = createDb(env.DB);
    const orgId = await makeDigestReadyOrg(db);
    await seedConsumeSubscription(db, orgId, {
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEndAt: Date.now() + 10 * CONSUME_DAY_MS,
    });
    await setEntitlementEnforced(db, true);

    const provider = new FakeDigestProvider('ok');
    const outcome = await runDigestJob(
      fakeDigestEnv(),
      createLogger({ test: true }),
      { kind: 'digest', organizationId: orgId, localDate: '2026-09-01' },
      provider,
    );

    expect(outcome.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
  });

  it('flag OFF (the default): a canceled org still gets its digest, V1-pilot mode is unchanged', async () => {
    const db = createDb(env.DB);
    const orgId = await makeDigestReadyOrg(db);
    await seedConsumeSubscription(db, orgId, { status: 'canceled' });
    await setEntitlementEnforced(db, false);

    const provider = new FakeDigestProvider('ok');
    const outcome = await runDigestJob(
      fakeDigestEnv(),
      createLogger({ test: true }),
      { kind: 'digest', organizationId: orgId, localDate: '2026-09-01' },
      provider,
    );

    expect(outcome.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
  });
});
