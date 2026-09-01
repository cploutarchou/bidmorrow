/**
 * `runFetchRetryDrainJob` — the HOURLY standalone fetch-retry drain
 * (ADR-0008 Amendment §A5) — against real local D1 + R2 (workerd) with a
 * FAKE TedClient. Its own file on purpose: vitest-pool-workers gives each
 * file an isolated database, and every assertion below about "which rows
 * the drain pulled" needs a table this file alone populates.
 *
 * Stand-down rules are the point of the job (the drain itself is covered
 * by ingestion.d1.test.ts): paused, attempts-suspended, or an ingestion run
 * already live all skip; an orphaned `running` row older than the horizon
 * does NOT; and the standalone cap is really the one applied.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import { TedClient } from '@bidmorrow/ted';
import type { TedFetch } from '@bidmorrow/ted';
import {
  FETCH_RETRY_STANDALONE_MAX_PER_RUN,
  FETCH_RETRY_FIRST_DELAY_MS,
} from '@bidmorrow/procurement';
import {
  createDb,
  createRun,
  finishRun,
  getNoticeByPublicationNumber,
  listRecentRuns,
  setFeatureFlag,
  upsertFetchRetry,
} from '@bidmorrow/db';
import { FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED, FLAG_INGESTION_PAUSED } from '@bidmorrow/config';

import { runFetchRetryDrainJob } from './ingestion';
import type { Env, MatchQueueMessage } from './env';

import normalXml from '../../../tests/fixtures/ted/1.15/normal.xml?raw';

const NOW = Date.parse('2026-09-01T05:40:00Z');
const ZERO_COUNTS = {
  noticesSeen: 0,
  noticesUpserted: 0,
  versionsCreated: 0,
  lotsCreated: 0,
  matchesScored: 0,
  errorsCount: 0,
} as const;

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function xmlResponse(body: string): FakeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/xml' : null) },
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  };
}

function notFoundResponse(): FakeResponse {
  // 404 is deliberately not a retryable status in TedClient, so a miss is
  // an immediate TedRequestError with no backoff sleeps.
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('not found')),
    text: () => Promise.resolve(''),
  };
}

/** Serves `normalXml` for exactly the given urls; everything else 404s. */
function makeClient(servedUrls: readonly string[]): { client: TedClient; hits: () => number } {
  let hits = 0;
  const fetchImpl: TedFetch = (url) => {
    hits += 1;
    return Promise.resolve(
      servedUrls.includes(url) ? xmlResponse(normalXml) : notFoundResponse(),
    ) as ReturnType<TedFetch>;
  };
  const client = new TedClient({
    fetch: fetchImpl,
    budget: { maxRequestsPerRun: 1_000 },
    minRequestSpacingMs: 0,
    logger: createLogger({ test: true }),
  });
  return { client, hits: () => hits };
}

function makeFakeQueue(): { sent: MatchQueueMessage[]; queue: Queue<MatchQueueMessage> } {
  const sent: MatchQueueMessage[] = [];
  const queue = {
    send: (message: MatchQueueMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
    sendBatch: (messages: Iterable<MessageSendRequest<MatchQueueMessage>>) => {
      for (const m of messages) sent.push(m.body);
      return Promise.resolve();
    },
  } as unknown as Queue<MatchQueueMessage>;
  return { sent, queue };
}

function jobEnv(queue: Queue<MatchQueueMessage>): Env {
  return { ...env, MATCH_QUEUE: queue } as unknown as Env;
}

async function seedRetry(
  sourceNoticeId: string,
  nextAttemptAt: number,
): Promise<{ xmlUrl: string }> {
  const xmlUrl = `https://ted.europa.eu/notice/${sourceNoticeId}.xml`;
  await upsertFetchRetry(createDb(env.DB), {
    source: 'ted',
    sourceNoticeId,
    xmlUrl,
    publicationDate: '2026-09-01',
    errorCode: 'NOTICE_RENDER_PENDING',
    nextAttemptAt,
    now: nextAttemptAt,
  });
  return { xmlUrl };
}

function retryRowOf(sourceNoticeId: string) {
  return env.DB.prepare(
    "SELECT status, attempts, next_attempt_at FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = ?",
  )
    .bind(sourceNoticeId)
    .first<{ status: string; attempts: number; next_attempt_at: number }>();
}

type FlagKey = Parameters<typeof setFeatureFlag>[1]['key'];

async function withFlag<T>(key: FlagKey, run: () => Promise<T>): Promise<T> {
  const db = createDb(env.DB);
  await setFeatureFlag(db, { key, valueJson: 'true', description: 'test' });
  try {
    return await run();
  } finally {
    await setFeatureFlag(db, { key, valueJson: 'false', description: 'test: cleared' });
  }
}

async function runCount(): Promise<number> {
  return (await listRecentRuns(createDb(env.DB), { source: 'ted', limit: 100 })).items.length;
}

describe('runFetchRetryDrainJob (ADR-0008 §A5 hourly standalone drain)', () => {
  it('stands down while ingestion_paused — no run row, no fetch, message still completes', async () => {
    await seedRetry('paused-1', NOW - 1);
    const { client, hits } = makeClient([]);
    const { sent, queue } = makeFakeQueue();
    const runsBefore = await runCount();

    const result = await withFlag(FLAG_INGESTION_PAUSED, () =>
      runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
        client,
        now: () => NOW,
        renderRetryDelayMs: 0,
      }),
    );

    expect(result).toEqual({ skipped: 'paused', drain: null });
    expect(hits()).toBe(0);
    expect(sent).toEqual([]);
    expect(await runCount()).toBe(runsBefore);
    expect((await retryRowOf('paused-1'))?.attempts).toBe(0);
  });

  it('stands down while fetch_retry_attempts_suspended — the daily in-run canary probe is the only drain during a confirmed outage', async () => {
    await seedRetry('suspended-1', NOW - 1);
    const { client, hits } = makeClient([]);
    const { queue } = makeFakeQueue();
    const runsBefore = await runCount();

    const result = await withFlag(FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED, () =>
      runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
        client,
        now: () => NOW,
        renderRetryDelayMs: 0,
      }),
    );

    expect(result).toEqual({ skipped: 'attempts_suspended', drain: null });
    expect(hits()).toBe(0);
    expect(await runCount()).toBe(runsBefore);
  });

  it('stands down while an ingestion run is live, but not for an orphaned running row older than the 15-minute horizon', async () => {
    const db = createDb(env.DB);
    const { xmlUrl } = await seedRetry('guard-1', NOW - 1);
    const { queue } = makeFakeQueue();

    const live = await createRun(db, {
      source: 'ted',
      windowFrom: '2026-09-01',
      windowTo: '2026-09-01',
      startedAt: NOW - 60_000,
    });
    try {
      const blocked = await runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
        client: makeClient([xmlUrl]).client,
        now: () => NOW,
        renderRetryDelayMs: 0,
      });
      expect(blocked).toEqual({ skipped: 'ingestion_running', drain: null });
      expect((await retryRowOf('guard-1'))?.status).toBe('pending');
    } finally {
      await finishRun(db, { runId: live.id, status: 'succeeded', counts: ZERO_COUNTS });
    }

    // A consumer killed mid-run leaves its row `running` forever. Sixteen
    // minutes old is past the Queues wall-clock limit, so it cannot be live
    // — and it must not block the drain for the rest of time.
    await createRun(db, {
      source: 'ted',
      windowFrom: '2026-09-01',
      windowTo: '2026-09-01',
      startedAt: NOW - 16 * 60_000,
    });
    const { client, hits } = makeClient([xmlUrl]);
    const ran = await runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
      client,
      now: () => NOW,
      renderRetryDelayMs: 0,
    });
    expect(ran.skipped).toBeNull();
    // >= 1, not exactly 1: this file shares one D1 across its tests, so the
    // still-pending rows the stand-down tests above seeded are due too and
    // are swept (404 -> one burnt attempt each) in the same batch.
    expect(hits()).toBeGreaterThanOrEqual(1);
    expect((await retryRowOf('guard-1'))?.status).toBe('recovered');
  });

  it('recovers a due row through the normal pipeline and enqueues its lot to MATCH_QUEUE; a row not yet due (first-delay) is untouched', async () => {
    const db = createDb(env.DB);
    const { xmlUrl } = await seedRetry('happy-1', NOW - 1);
    // Skipped by a window "just now": due FETCH_RETRY_FIRST_DELAY_MS later.
    await seedRetry('happy-not-yet', NOW + FETCH_RETRY_FIRST_DELAY_MS);
    const { client, hits } = makeClient([xmlUrl]);
    const { sent, queue } = makeFakeQueue();

    const result = await runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
      client,
      now: () => NOW,
      renderRetryDelayMs: 0,
    });

    expect(result.skipped).toBeNull();
    expect(result.drain?.recovered).toBeGreaterThanOrEqual(1);
    expect(result.drain?.runId).not.toBeNull();
    expect(hits()).toBeGreaterThanOrEqual(1);
    expect((await retryRowOf('happy-1'))?.status).toBe('recovered');

    const notYet = await retryRowOf('happy-not-yet');
    expect(notYet?.status).toBe('pending');
    expect(notYet?.attempts).toBe(0);
    expect(notYet?.next_attempt_at).toBe(NOW + FETCH_RETRY_FIRST_DELAY_MS);

    const notice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'happy-1',
    });
    expect(notice).not.toBeNull();
    const lot = await env.DB.prepare(
      'SELECT id FROM tender_lots WHERE notice_version_id = (SELECT current_version_id FROM tender_notices WHERE id = ?)',
    )
      .bind(notice?.id)
      .first<{ id: string }>();
    expect(lot?.id).toBeDefined();
    const scored = sent.flatMap((m) => (m.kind === 'score' ? m.lotIds : []));
    expect(scored).toContain(lot?.id);
  });

  it('applies FETCH_RETRY_STANDALONE_MAX_PER_RUN, not the in-run cap, and leaves the overflow due for the next hour', async () => {
    const overflow = 5;
    const total = FETCH_RETRY_STANDALONE_MAX_PER_RUN + overflow;
    // Back-dated past every other row this file seeds, in a deterministic
    // order, so exactly these rows fill the batch oldest-first.
    const base = NOW - 10 * 60 * 60_000;
    for (let i = 0; i < total; i += 1) {
      await seedRetry(`cap-${String(i).padStart(3, '0')}`, base + i);
    }
    const { client, hits } = makeClient([]);
    const { queue } = makeFakeQueue();

    const result = await runFetchRetryDrainJob(jobEnv(queue), createLogger({ test: true }), {
      client,
      now: () => NOW,
      renderRetryDelayMs: 0,
    });

    expect(result.skipped).toBeNull();
    expect(result.drain?.attempted).toBe(FETCH_RETRY_STANDALONE_MAX_PER_RUN);
    expect(hits()).toBe(FETCH_RETRY_STANDALONE_MAX_PER_RUN);
    // The first 50 by due time each burnt one attempt (404 -> ladder rung 1);
    // the 5 youngest are exactly as seeded.
    expect((await retryRowOf('cap-000'))?.attempts).toBe(1);
    expect(
      (await retryRowOf(`cap-${String(FETCH_RETRY_STANDALONE_MAX_PER_RUN - 1).padStart(3, '0')}`))
        ?.attempts,
    ).toBe(1);
    for (let i = FETCH_RETRY_STANDALONE_MAX_PER_RUN; i < total; i += 1) {
      const row = await retryRowOf(`cap-${String(i).padStart(3, '0')}`);
      expect(row?.attempts).toBe(0);
      expect(row?.next_attempt_at).toBe(base + i);
    }
  });
});
