/**
 * Direct coverage for `queue()` in `index.ts` — the queue consumer message
 * dispatcher (routing by `message.body.kind`, per-message
 * try/retry/ack, poison-message handling for unrecognized kinds — SEC-P6-02/
 * SEC-P8-04 — and the SEC-P8-01 once-per-batch digest-provider hoist).
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
 * pattern for code that runs inside workerd via @cloudflare/vitest-pool-workers,
 * and inventing one for this file alone would risk silently-wrong coverage):
 * two of the real job functions are exercised UNMOCKED against real
 * bindings instead —
 *  - `{kind:'purge'}` -> `runRetentionPurgeJob`: DB-only, no network, so it
 *    is a real, deterministic SUCCESS path (proves `ack()`).
 *  - `{kind:'ingest'}` -> `runIngestCatchUpJob`: its first step
 *    (`refreshEcbRates`) makes a real `fetch()` call, which this sandboxed
 *    test runtime cannot complete (no network — the same fact
 *    `digest-schedule.d1.test.ts`'s real-Resend-provider test relies on to
 *    force a deterministic throw), so it is a real, deterministic FAILURE
 *    path (proves `retry()`, and that the batch keeps going afterward).
 */
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Importing the entry point makes watch mode re-run these tests when it changes.
import './index';
import type { DigestQueueMessage, IngestQueueMessage, MatchQueueMessage } from './env';

type AnyQueueMessage = IngestQueueMessage | MatchQueueMessage | DigestQueueMessage;

interface FakeMessage<T> extends Message<T> {
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
    messages,
    metadata: { queue: queueName, batchSize: messages.length } as unknown as MessageBatch<T>['metadata'],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

const FAKE_CTX = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('queue() dispatcher (src/index.ts)', () => {
  it('acks a successfully handled message ({kind:"purge"} against real D1, no network involved)', async () => {
    const message = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const batch = fakeBatch('INGEST_QUEUE', [message]);

    await exports.default.queue(batch, env, FAKE_CTX);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries, and never acks, an unrecognized message kind (poison message, SEC-P6-02/SEC-P8-04)', async () => {
    const message = fakeMessage(
      { kind: 'not_a_real_kind' } as unknown as IngestQueueMessage,
    );
    const batch = fakeBatch('INGEST_QUEUE', [message]);

    await exports.default.queue(batch, env, FAKE_CTX);

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('retries a message whose handler throws, and still processes the next message in the same batch', async () => {
    // `{kind:'ingest'}` -> runIngestCatchUpJob -> refreshEcbRates makes a
    // real fetch() first, which this sandboxed runtime cannot complete.
    const failing = fakeMessage<IngestQueueMessage>({ kind: 'ingest' });
    const succeeding = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const batch = fakeBatch('INGEST_QUEUE', [failing, succeeding]);

    await exports.default.queue(batch, env, FAKE_CTX);

    expect(failing.retry).toHaveBeenCalledTimes(1);
    expect(failing.ack).not.toHaveBeenCalled();
    // The loop must not have stopped at the first failing message.
    expect(succeeding.ack).toHaveBeenCalledTimes(1);
    expect(succeeding.retry).not.toHaveBeenCalled();
  });
});

describe('queue() digest-provider hoisting (SEC-P8-01)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn<Console, 'warn'>>;

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
    // `queue()` never exposes directly. If the provider were resolved
    // per-message (rather than hoisted once, per the doc comment above the
    // `for` loop in index.ts), this batch of two NON-digest messages would
    // still log the fallback message zero times per the (wrong) per-message
    // design, or twice if resolution were moved inside the loop without
    // gating on kind — either way, not exactly once.
    const first = fakeMessage<IngestQueueMessage>({ kind: 'purge' });
    const second = fakeMessage(
      { kind: 'not_a_real_kind' } as unknown as IngestQueueMessage,
    );
    const batch = fakeBatch('INGEST_QUEUE', [first, second]);

    await exports.default.queue(batch, env, FAKE_CTX);

    const fallbackLogs = warnSpy.mock.calls.filter(([line]: unknown[]) =>
      typeof line === 'string' && line.includes('digest.provider.logging_fallback'),
    );
    expect(fallbackLogs).toHaveLength(1);
  });
});
