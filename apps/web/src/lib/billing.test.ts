/**
 * `pollForSubscription` — the retry behaviour behind the post-checkout
 * confirmation page (/app/billing/success).
 *
 * This is the part with real failure modes: the Paddle webhook writes the
 * subscription row asynchronously, so the page has to distinguish "not written
 * yet" from "never going to be written" without ever telling a paying customer
 * their payment failed.
 */
import { describe, expect, it } from 'vitest';
import { pollForSubscription, SUBSCRIPTION_POLL_DELAYS_MS, type BillingStatus } from './billing';

const EMPTY: BillingStatus = {
  entitlement: { active: false, plan: null, status: null, reason: 'no_subscription' },
  subscription: null,
  foundingAvailable: true,
  foundingRemaining: 100,
  foundingCap: 100,
};

const SUBSCRIBED: BillingStatus = {
  entitlement: { active: true, plan: 'founding', status: 'active', reason: 'active' },
  subscription: {
    plan: 'founding',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEndAt: 1_800_000_000_000,
    price: { amountMinorUnits: 2900, currency: 'eur', interval: 'month', taxInclusive: true },
    paymentState: 'active',
  },
  foundingAvailable: true,
  foundingRemaining: 100,
  foundingCap: 100,
};

/** Records the delays asked for instead of actually waiting. */
function harness(responses: (BillingStatus | Error)[], cancelAfter = Number.POSITIVE_INFINITY) {
  const slept: number[] = [];
  let calls = 0;
  return {
    slept,
    get calls() {
      return calls;
    },
    deps: {
      fetchStatus: () => {
        // The last entry repeats, so a single-element list means "always this".
        const next = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        if (next === undefined) throw new Error('harness: empty response list');
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
      sleep: (ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      },
      isCancelled: () => calls >= cancelAfter,
    },
  };
}

describe('pollForSubscription', () => {
  it('confirms immediately when the row already exists, without sleeping', async () => {
    const h = harness([SUBSCRIBED]);
    const outcome = await pollForSubscription(h.deps);
    expect(outcome).toEqual({ kind: 'confirmed', status: SUBSCRIBED });
    expect(h.calls).toBe(1);
    expect(h.slept).toEqual([]);
  });

  it('keeps polling while the webhook has not landed, then confirms', async () => {
    const h = harness([EMPTY, EMPTY, SUBSCRIBED]);
    const outcome = await pollForSubscription(h.deps);
    expect(outcome.kind).toBe('confirmed');
    expect(h.calls).toBe(3);
    // Backs off between attempts rather than hammering the endpoint.
    expect(h.slept).toEqual([1000, 2000]);
  });

  it('treats a failed request like "not yet", never as a payment failure', async () => {
    const h = harness([new Error('network'), new Error('network'), SUBSCRIBED]);
    const outcome = await pollForSubscription(h.deps);
    expect(outcome.kind).toBe('confirmed');
    expect(h.calls).toBe(3);
  });

  it('ends in "not-yet" — never a failure state — when attempts run out', async () => {
    const h = harness([EMPTY]);
    const outcome = await pollForSubscription(h.deps);
    expect(outcome).toEqual({ kind: 'not-yet' });
    // One attempt per delay, plus the initial one.
    expect(h.calls).toBe(SUBSCRIPTION_POLL_DELAYS_MS.length + 1);
    expect(h.slept).toEqual([...SUBSCRIPTION_POLL_DELAYS_MS]);
  });

  it('does not sleep after the final attempt', async () => {
    const h = harness([EMPTY]);
    await pollForSubscription(h.deps, [10, 20]);
    expect(h.calls).toBe(3);
    expect(h.slept).toEqual([10, 20]);
  });

  it('stops early once cancelled, so an unmounted page issues no more requests', async () => {
    const h = harness([EMPTY], 2);
    const outcome = await pollForSubscription(h.deps);
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(h.calls).toBe(2);
  });

  it('errors alone never yield a confirmation', async () => {
    const h = harness([new Error('down')]);
    const outcome = await pollForSubscription(h.deps, [1]);
    expect(outcome).toEqual({ kind: 'not-yet' });
  });
});
