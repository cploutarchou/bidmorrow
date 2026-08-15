/**
 * SEC-P6-01: proves `enqueueScoreContinuation` re-enqueues
 * `ScoreLotsResult.remainingLotIds` to `MATCH_QUEUE` in ≤100-id batches with
 * the correct message kind, rather than the previous behavior (remaining
 * lots silently dropped when `MAX_PAIRS_PER_INVOCATION` truncated a run). A
 * fake `MATCH_QUEUE` binding is injected so this test never needs to
 * actually produce 5,000+ scored pairs to observe truncation — it exercises
 * the re-enqueue logic directly against a hand-built `ScoreLotsResult`.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import type { ScoreLotsResult } from '@bidmorrow/procurement';

import { enqueueScoreContinuation } from './ingestion';
import type { Env, MatchQueueMessage } from './env';

function makeFakeQueue(): { sent: MatchQueueMessage[]; queue: Queue<MatchQueueMessage> } {
  const sent: MatchQueueMessage[] = [];
  const queue: Queue<MatchQueueMessage> = {
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

function makeResult(remainingLotIds: readonly string[]): ScoreLotsResult {
  return {
    pairsConsidered: 5_000,
    pairsScored: 5_000,
    matchesWritten: 5_000,
    matchesSkipped: 0,
    truncated: remainingLotIds.length > 0,
    remainingLotIds,
  };
}

describe('enqueueScoreContinuation', () => {
  it('does nothing when remainingLotIds is empty (untruncated run)', async () => {
    const { sent, queue } = makeFakeQueue();
    const env = { MATCH_QUEUE: queue } as unknown as Env;
    await enqueueScoreContinuation(env, createLogger({ test: true }), makeResult([]), false);
    expect(sent).toEqual([]);
  });

  it('re-enqueues remaining lot ids as {kind:"score"} batches of at most 100 for the score path', async () => {
    const { sent, queue } = makeFakeQueue();
    const env = { MATCH_QUEUE: queue } as unknown as Env;
    const remaining = Array.from({ length: 250 }, (_, i) => `lot-${String(i)}`);

    await enqueueScoreContinuation(env, createLogger({ test: true }), makeResult(remaining), false);

    expect(sent).toHaveLength(3);
    for (const message of sent) {
      expect(message.kind).toBe('score');
      if (message.kind === 'score') {
        expect(message.lotIds.length).toBeLessThanOrEqual(100);
      }
    }
    const allIds = sent.flatMap((m) => (m.kind === 'score' ? m.lotIds : []));
    expect(allIds).toEqual(remaining);
  });

  it('re-enqueues remaining lot ids as {kind:"recompute_continuation"} for the recompute path (never a fresh recompute, to preserve hard-replace semantics)', async () => {
    const { sent, queue } = makeFakeQueue();
    const env = { MATCH_QUEUE: queue } as unknown as Env;
    const remaining = ['lot-a', 'lot-b'];

    await enqueueScoreContinuation(env, createLogger({ test: true }), makeResult(remaining), true);

    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message?.kind).toBe('recompute_continuation');
    if (message?.kind === 'recompute_continuation') {
      expect(message.lotIds).toEqual(remaining);
    }
  });
});
