/**
 * Direct coverage for `queue()` in `index.ts` — the queue consumer message
 * dispatcher (routing by `message.body.kind`, per-message
 * try/retry/ack, poison-message handling for unrecognized kinds — SEC-P6-02/
 * SEC-P8-04 — and the SEC-P8-01 once-per-batch digest-provider hoist).
 *
 * `worker.queue(...)` is called directly via a plain default import of
 * `./index` (NOT `exports.default` from `cloudflare:workers` —
 * `Cloudflare.GlobalProps.mainModule` only types/exposes the RPC-style
 * `fetch` entrypoint on that stub, matching every other `*.test.ts` file in
 * this package; `queue`/`scheduled` are invoked by the runtime directly,
 * never through a service-binding RPC surface) with a hand-built
 * `MessageBatch` (plain object, `vi.fn()` ack/retry per message) rather than
 * the real queue-delivery protocol — `queue()` is a plain JS function
 * running in this same isolate, so no host-side message validation is
 * involved either way.
 *
 * Deliberately NOT mocked (this package has no established `vi.mock` module
 * pattern for code that runs inside workerd via
 * @cloudflare/vitest-pool-workers, and inventing one for this file alone
 * would risk silently-wrong coverage): the real job functions are exercised
 * UNMOCKED against real bindings instead —
 *  - `{kind:'purge'}` -> `runRetentionPurgeJob`: DB-only, no network, so
 *    against the real local D1 binding it is a real, deterministic SUCCESS
 *    path (proves `ack()`).
 *  - For the "handler throws" case, this sandboxed runtime turns out to
 *    have real outbound network reachability to TED's public host (it
 *    returns a real HTTP 403, not a thrown network error — see the job's
 *    own per-window error handling, which CATCHES that and returns a
 *    `status:'failed'` result rather than throwing), so `{kind:'ingest'}`
 *    cannot be relied on to throw. Instead, `{kind:'purge'}` is run against
 *    a deliberately broken `DB` binding (`undefined`) for that one test —
 *    `runRetentionPurgeJob`'s first D1 query throws a real `TypeError`, a
 *    faithful stand-in for "the handler threw" that needs no mocking.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from './index';
import type { DigestQueueMessage, Env, IngestQueueMessage, MatchQueueMessage } from './env';

type AnyQueueMessage = IngestQueueMessage | MatchQueueMessage | DigestQueueMessage;

interface FakeMessage<T> {
  id: string;
  timestamp: Date;
  body: T;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function fakeMessage<T extends AnyQueueMessage>(body: T): FakeMessage<T> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeBatch<T extends AnyQueueMessage>(
  queueName: string,
  messages: readonly FakeMessage<T>[],
): MessageBatch<T> {
  return {
    queue: queueName,
    messages: messages as unknown as readonly Message<T>[],
    metadata: { queue: queueName } as unknown as MessageBatchMetadata,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

const FAKE_CTX = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function runQueue<T extends AnyQueueMessage>(
  batch: MessageBatch<T>,
  envOverride?: Partial<Env>,
): Promise<void> {
  if (worker.queue === undefined) {
    throw new Error('worker.queue is not defined — index.ts export shape changed');
  }
  const targetEnv = envOverride === undefined ? env : { ...env, ...envOverride };
  await worker.queue(batch, targetEnv as unknown as Env, FAKE_CTX);
}

describe('queue() dispatcher (src/index.ts)', () => {
  it('acks a successfully handled message ({kind:"purge"} against real D1, no network involved)', async () => {
    const message = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const batch = fakeBatch('INGEST_QUEUE', [message]);

    await runQueue(batch);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries, and never acks, an unrecognized message kind (poison message, SEC-P6-02/SEC-P8-04)', async () => {
    const message = fakeMessage({ kind: 'not_a_real_kind' } as unknown as IngestQueueMessage);
    const batch = fakeBatch('INGEST_QUEUE', [message]);

    await runQueue(batch);

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('retries a message whose handler throws, and still processes the next message in the same batch', async () => {
    // Both messages are {kind:'purge'} against a deliberately broken `DB`
    // binding (undefined) — runRetentionPurgeJob's first D1 query throws a
    // real TypeError for BOTH. This is enough to prove the requirement:
    // message 2's `.retry()` firing at all proves the `for` loop kept going
    // past message 1's uncaught throw (a `break`/rethrow that aborted the
    // whole batch would leave message 2 untouched — neither acked nor
    // retried).
    const first = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const second = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const batch = fakeBatch('INGEST_QUEUE', [first, second]);

    await runQueue(batch, { DB: undefined as unknown as D1Database });

    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();
    expect(second.retry).toHaveBeenCalledTimes(1);
    expect(second.ack).not.toHaveBeenCalled();
  });
});

describe('queue() digest-provider hoisting (SEC-P8-01)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves the digest provider exactly once per batch, even with zero digest messages in it', async () => {
    // This test file's vitest.config.ts bindings never set RESEND_API_KEY/
    // EMAIL_FROM, so `resolveDigestProvider` always takes the logging
    // fallback and logs `digest.provider.logging_fallback` (via
    // logger.info -> console.warn, per @bidmorrow/observability's lint
    // policy) — a proxy for observing the call count of a function
    // `queue()` never exposes directly. The doc comment above the `for`
    // loop in index.ts claims this build is hoisted once per batch, cheap
    // enough to apply even when the batch has zero digest messages — this
    // batch of two NON-digest messages exercises exactly that claim.
    const first = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const second = fakeMessage({ kind: 'not_a_real_kind' } as unknown as IngestQueueMessage);
    const batch = fakeBatch('INGEST_QUEUE', [first, second]);

    await runQueue(batch);

    const fallbackLogs = warnSpy.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('digest.provider.logging_fallback'),
    );
    expect(fallbackLogs).toHaveLength(1);
  });
});
