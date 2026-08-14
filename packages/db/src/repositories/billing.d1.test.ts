/**
 * billing_events integration tests against real D1 (workerd): the unique
 * `stripe_event_id` is the webhook idempotency guard (docs/data-model.md §9).
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { billingEvents } from '../schema/billing';
import { insertTestOrganization, testDb } from '../test/helpers';
import { insertBillingEventIfNew } from './billing';

describe('insertBillingEventIfNew', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('records an event once and returns false on the duplicate stripe_event_id', async () => {
    const { orgId } = await insertTestOrganization(db);
    const args = {
      stripeEventId: 'evt_1QaTest000000000000000001',
      type: 'customer.subscription.updated',
      organizationId: orgId,
      payloadJson: JSON.stringify({ id: 'evt_1QaTest000000000000000001', livemode: false }),
    };

    expect(await insertBillingEventIfNew(db, args)).toBe(true);
    // Redelivered webhook — same Stripe event id, even with a different payload.
    expect(
      await insertBillingEventIfNew(db, { ...args, payloadJson: JSON.stringify({ retry: true }) }),
    ).toBe(false);

    const rows = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, args.stripeEventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stripeEventId: args.stripeEventId,
      type: args.type,
      organizationId: orgId,
      // The first delivery's payload wins; the duplicate changed nothing.
      payloadJson: args.payloadJson,
      status: 'received',
      processedAt: null,
    });
  });

  it('accepts events with an unresolvable (null) organization', async () => {
    expect(
      await insertBillingEventIfNew(db, {
        stripeEventId: 'evt_1QaTest000000000000000002',
        type: 'charge.succeeded',
        organizationId: null,
        payloadJson: '{}',
      }),
    ).toBe(true);

    const rows = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, 'evt_1QaTest000000000000000002'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBeNull();
  });
});
