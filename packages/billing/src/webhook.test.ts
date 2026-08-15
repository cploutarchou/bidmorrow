/**
 * Pure logic tests: payload-only organization/subscription-id resolution
 * and the handled-event-type check — no DB, no network, no real Stripe key.
 * `processStripeEvent`'s DB-coupled idempotency/re-fetch/tenant-guard/
 * failure-retry behavior is D1-integration-tested at the apps/worker level
 * (apps/worker/src/billing.d1.test.ts) with a fake injected Stripe client,
 * per this repo's established split for DB-touching orchestration (see
 * packages/procurement/src/score.ts vs. its own D1 test).
 *
 * Fixtures are cast via `as unknown as Stripe.XEvent` — real Stripe events
 * carry dozens of fields irrelevant to the functions under test; only the
 * fields these pure functions actually read are populated (same pattern as
 * packages/procurement/src/scoring-input.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import { isHandledEvent, resolveOrganizationIdFromPayload, resolveSubscriptionId } from './webhook';

const ORG_ID = 'org_test_01J0BILLING';

function checkoutSessionCompletedEvent(overrides: {
  clientReferenceId?: string | null;
  metadataOrgId?: string;
  subscription?: string | null;
}): Stripe.CheckoutSessionCompletedEvent {
  return {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: overrides.clientReferenceId ?? null,
        metadata:
          overrides.metadataOrgId !== undefined
            ? { organizationId: overrides.metadataOrgId }
            : null,
        subscription: overrides.subscription === undefined ? 'sub_test' : overrides.subscription,
      },
    },
  } as unknown as Stripe.CheckoutSessionCompletedEvent;
}

function subscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: { metadata?: Record<string, string>; id?: string },
): Stripe.CustomerSubscriptionCreatedEvent {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        id: overrides.id ?? 'sub_test',
        metadata: overrides.metadata ?? {},
      },
    },
  } as unknown as Stripe.CustomerSubscriptionCreatedEvent;
}

function invoiceEvent(
  type: 'invoice.paid' | 'invoice.payment_failed',
  overrides: {
    subscription?: string | null;
    metadata?: Record<string, string> | null;
    noParent?: boolean;
  },
): Stripe.InvoicePaidEvent {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        parent: overrides.noParent
          ? null
          : {
              subscription_details: {
                subscription: overrides.subscription ?? 'sub_test',
                metadata: overrides.metadata ?? { organizationId: ORG_ID },
              },
            },
      },
    },
  } as unknown as Stripe.InvoicePaidEvent;
}

describe('isHandledEvent', () => {
  it('accepts every event in the recommended set', () => {
    for (const type of [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
    ] as const) {
      expect(isHandledEvent({ type } as Stripe.Event)).toBe(true);
    }
  });

  it('rejects an event type outside the recommended set (record + ack, no processing)', () => {
    expect(isHandledEvent({ type: 'payment_intent.succeeded' } as unknown as Stripe.Event)).toBe(
      false,
    );
  });
});

describe('resolveOrganizationIdFromPayload — checkout.session.completed', () => {
  it('prefers client_reference_id', () => {
    const event = checkoutSessionCompletedEvent({
      clientReferenceId: ORG_ID,
      metadataOrgId: 'org_other',
    });
    expect(resolveOrganizationIdFromPayload(event)).toBe(ORG_ID);
  });

  it('falls back to metadata.organizationId when client_reference_id is absent', () => {
    const event = checkoutSessionCompletedEvent({ clientReferenceId: null, metadataOrgId: ORG_ID });
    expect(resolveOrganizationIdFromPayload(event)).toBe(ORG_ID);
  });

  it('is unresolvable when neither is set', () => {
    const event = checkoutSessionCompletedEvent({ clientReferenceId: null });
    expect(resolveOrganizationIdFromPayload(event)).toBeNull();
  });
});

describe('resolveOrganizationIdFromPayload — customer.subscription.*', () => {
  it('reads metadata.organizationId directly off the subscription object (order-independent)', () => {
    const event = subscriptionEvent('customer.subscription.created', {
      metadata: { organizationId: ORG_ID },
    });
    expect(resolveOrganizationIdFromPayload(event)).toBe(ORG_ID);
  });

  it('is unresolvable when the subscription carries no organizationId metadata', () => {
    const event = subscriptionEvent('customer.subscription.updated', { metadata: {} });
    expect(resolveOrganizationIdFromPayload(event)).toBeNull();
  });
});

describe('resolveOrganizationIdFromPayload — invoice.*', () => {
  it('reads the immutable subscription-metadata snapshot at parent.subscription_details.metadata', () => {
    const event = invoiceEvent('invoice.paid', { metadata: { organizationId: ORG_ID } });
    expect(resolveOrganizationIdFromPayload(event)).toBe(ORG_ID);
  });

  it('is unresolvable for a non-subscription invoice (no parent)', () => {
    const event = invoiceEvent('invoice.payment_failed', { noParent: true });
    expect(resolveOrganizationIdFromPayload(event)).toBeNull();
  });
});

describe('resolveSubscriptionId', () => {
  it('reads the checkout session subscription id (string form)', () => {
    const event = checkoutSessionCompletedEvent({ subscription: 'sub_abc' });
    expect(resolveSubscriptionId(event)).toBe('sub_abc');
  });

  it('is null for a checkout session with no subscription (not our subscription-mode flow)', () => {
    const event = checkoutSessionCompletedEvent({ subscription: null });
    expect(resolveSubscriptionId(event)).toBeNull();
  });

  it('reads the subscription object id directly for customer.subscription.* events', () => {
    const event = subscriptionEvent('customer.subscription.deleted', { id: 'sub_deleted' });
    expect(resolveSubscriptionId(event)).toBe('sub_deleted');
  });

  it('reads the subscription id off invoice.parent.subscription_details', () => {
    const event = invoiceEvent('invoice.paid', { subscription: 'sub_from_invoice' });
    expect(resolveSubscriptionId(event)).toBe('sub_from_invoice');
  });

  it('is null for an invoice with no subscription parent', () => {
    const event = invoiceEvent('invoice.payment_failed', { noParent: true });
    expect(resolveSubscriptionId(event)).toBeNull();
  });
});
