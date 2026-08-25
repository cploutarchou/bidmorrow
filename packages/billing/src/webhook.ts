/**
 * Paddle webhook processing — idempotent, order-independent event handling.
 * (Signature verification lives in webhook-signature.ts and runs in the
 * route BEFORE this module ever sees a payload.)
 *
 * Subscribed events (docs/dependency-versions.md § Paddle facts; the
 * staging notification destination was created with exactly this set):
 * `subscription.created|activated|trialing|updated|past_due|paused|
 * resumed|canceled`. Every one of them carries the full subscription
 * entity as `data`, and every one is handled the same way.
 *
 * ORDERING IS NOT GUARANTEED (Paddle: at-least-once, retries re-send the
 * same `event_id`). This processor never trusts a payload's `status` (or
 * any other mutable field) as current truth — every handled event triggers
 * a live `GET /subscriptions/{id}` re-fetch, and the re-fetch result is
 * what gets written. Out-of-order delivery can produce redundant writes but
 * never a wrong final state.
 *
 * Organization resolution is different from state: it is read from
 * `custom_data.organization_id`, which we set ourselves on the checkout
 * transaction (checkout.ts) and Paddle copies onto the subscription. A
 * Paddle signature only proves Paddle sent the event — the public
 * Paddle.js token lets anyone mint a subscription with arbitrary
 * `custom_data` (SEC-PDL-01) — so the id is trusted ONLY when its
 * `organization_sig` HMAC (provenance.ts) verifies. Unsigned or
 * mis-signed ids are `ignored`, never written and never used as an FK.
 * If the payload lacks it the re-fetched entity is consulted before
 * giving up.
 *
 * Idempotency: `insertBillingEventIfNew` (unique `provider_event_id`) runs
 * FIRST, before any other DB write or Paddle API call — a duplicate
 * delivery is acknowledged with zero side effects. Errors AFTER that insert
 * mark the row `failed` and rethrow (the route turns that into a 500 so
 * Paddle retries); reprocessing is always safe because the write path
 * re-fetches current state.
 */
import {
  getBillingEventByProviderId,
  getSubscription,
  insertBillingEventIfNew,
  insertProductEvent,
  markBillingEventStatus,
  upsertSubscriptionByBillingCustomerId,
  type Db,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId, type OrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';

import { blocksNewCheckout } from './checkout';
import { hasScheduledCancel } from './cancellation';
import {
  paddleTimestampToMillis,
  type PaddleSubscription,
  type SubscriptionsReadClient,
} from './paddle-client';
import { mapPaddleSubscriptionStatus, planFromPriceId, type PriceIds } from './plans';
import { ORGANIZATION_ID_KEY, verifyOrganizationProvenance } from './provenance';
import type { PaddleEvent } from './webhook-signature';

export const SUBSCRIBED_WEBHOOK_EVENT_TYPES = [
  'subscription.created',
  'subscription.activated',
  'subscription.trialing',
  'subscription.updated',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.canceled',
] as const;

export type HandledEventType = (typeof SUBSCRIBED_WEBHOOK_EVENT_TYPES)[number];

export interface SubscriptionEventData {
  readonly id: string;
  readonly custom_data?: Readonly<Record<string, unknown>> | null;
}

export type HandledEvent = PaddleEvent<SubscriptionEventData> & {
  readonly event_type: HandledEventType;
};

/** Pure, no DB/network — also checks the `data` shape so a handled type with a bogus body is `ignored`, not a crash. */
export function isHandledEvent(event: PaddleEvent): event is HandledEvent {
  if (!(SUBSCRIBED_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.event_type)) {
    return false;
  }
  const data = event.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { id?: unknown }).id === 'string' &&
    (data as { id: string }).id.length > 0
  );
}

/**
 * Resolves the organization from `custom_data` ONLY when the provenance
 * signature verifies (provenance.ts). Absent/blank/unsigned/mis-signed
 * data never throws — it resolves to null.
 */
export async function organizationIdFromCustomData(
  provenanceSecret: string,
  customData: Readonly<Record<string, unknown>> | null | undefined,
): Promise<OrganizationId | null> {
  if (!(await verifyOrganizationProvenance(provenanceSecret, customData))) return null;
  const raw = customData?.[ORGANIZATION_ID_KEY];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return toOrganizationId(raw);
}

/** No-network organization resolution from the (Paddle-signed AND provenance-signed) payload. */
export function resolveOrganizationIdFromPayload(
  provenanceSecret: string,
  event: HandledEvent,
): Promise<OrganizationId | null> {
  return organizationIdFromCustomData(provenanceSecret, event.data.custom_data);
}

export function resolveSubscriptionId(event: HandledEvent): string {
  return event.data.id;
}

export interface WebhookDeps {
  readonly db: Db;
  readonly paddle: { readonly subscriptions: SubscriptionsReadClient };
  readonly priceIds: PriceIds;
  /** Verifies `custom_data.organization_sig` (provenance.ts) — the notification-destination secret. */
  readonly provenanceSecret: string;
  readonly logger?: Logger;
}

export type ProcessOutcome = 'processed' | 'duplicate' | 'ignored' | 'duplicate_reconciled';

/**
 * SEC-P9-03: an organization with no subscription row yet can open two
 * concurrent checkouts; if the owner completes both, Paddle ends up with
 * two live customers + subscriptions for one organization, but our table
 * has room for exactly one row per org. Whichever webhook is processed
 * SECOND hits this with a customer id that differs from the on-file row.
 * If that row is still non-canceled it is authoritative: the INCOMING
 * subscription is the duplicate — cancel it immediately via the API, log
 * loudly for follow-up, and ack (never strand the event in Paddle's retry
 * loop behind a unique-constraint violation).
 */
async function reconcileDuplicateCustomer(
  deps: WebhookDeps,
  organizationId: OrganizationId,
  before: { readonly billingCustomerId: string; readonly status: string },
  duplicate: PaddleSubscription,
): Promise<void> {
  deps.logger?.error('billing.webhook.duplicate_checkout_reconciled', {
    organizationId,
    keptBillingCustomerId: before.billingCustomerId,
    duplicateBillingCustomerId: duplicate.customer_id,
    duplicateBillingSubscriptionId: duplicate.id,
  });
  await deps.paddle.subscriptions.cancel(duplicate.id, { effective_from: 'immediately' });
}

/**
 * Re-fetches the subscription's CURRENT state from Paddle (never the event
 * payload) and upserts it. Fires `subscription_started`/
 * `subscription_canceled` product events on the relevant transitions,
 * computed from the PRE-upsert row's status vs. the newly-fetched one.
 */
async function syncSubscriptionState(
  deps: WebhookDeps,
  payloadOrganizationId: OrganizationId | null,
  subscriptionId: string,
  event: HandledEvent,
): Promise<ProcessOutcome> {
  const subscription = await deps.paddle.subscriptions.get(subscriptionId);

  const organizationId =
    payloadOrganizationId ??
    (await organizationIdFromCustomData(deps.provenanceSecret, subscription.custom_data));
  if (organizationId === null) {
    deps.logger?.warn('billing.webhook.unresolvable', {
      provider_event_id: event.event_id,
      type: event.event_type,
      subscription_id: subscriptionId,
    });
    return 'ignored';
  }

  const before = await getSubscription(deps.db, organizationId);

  const priceId = subscription.items[0]?.price.id;
  const plan = priceId !== undefined ? planFromPriceId(deps.priceIds, priceId) : null;
  if (plan === null) {
    // P9-R-01: an unknown price id means OUR env price-id config is wrong.
    // Throwing marks the billing_events row `failed` and returns 500 so
    // Paddle keeps retrying — once the config is fixed, the retry syncs the
    // subscription. Acking quietly would silently never write the row.
    deps.logger?.error('billing.webhook.unknown_price_id', {
      subscriptionId,
      priceId: priceId ?? null,
    });
    throw new Error(`unknown Paddle price id for subscription ${subscriptionId}`);
  }
  const status = mapPaddleSubscriptionStatus(subscription.status);

  if (
    before !== null &&
    before.billingCustomerId !== subscription.customer_id &&
    blocksNewCheckout(before.status)
  ) {
    if (status === 'canceled') {
      // Already reconciled (or canceled by the customer): Paddle keeps
      // sending `subscription.updated`/`canceled` for the duplicate, and a
      // second cancel call would be rejected → `failed` row → 3-day retry
      // storm. Acknowledge without touching Paddle or the org's row.
      deps.logger?.info('billing.webhook.duplicate_already_canceled', {
        organizationId,
        duplicateBillingSubscriptionId: subscription.id,
      });
      return 'duplicate_reconciled';
    }
    await reconcileDuplicateCustomer(deps, organizationId, before, subscription);
    return 'duplicate_reconciled';
  }

  await upsertSubscriptionByBillingCustomerId(deps.db, organizationId, {
    billingCustomerId: subscription.customer_id,
    billingSubscriptionId: subscription.id,
    status,
    plan,
    currentPeriodEndAt: paddleTimestampToMillis(subscription.current_billing_period?.ends_at),
    cancelAtPeriodEnd: hasScheduledCancel(subscription),
  });

  const wasActiveLike =
    before !== null && (before.status === 'active' || before.status === 'trialing');
  const isActiveLike = status === 'active' || status === 'trialing';
  if (!wasActiveLike && isActiveLike) {
    await insertProductEvent(deps.db, {
      organizationId,
      userId: null,
      name: 'subscription_started',
    });
  } else if (before?.status !== 'canceled' && status === 'canceled') {
    await insertProductEvent(deps.db, {
      organizationId,
      userId: null,
      name: 'subscription_canceled',
    });
  }
  return 'processed';
}

/**
 * Processes one already signature-verified Paddle event. Idempotent: a
 * duplicate delivery of an event already `processed`/`ignored` is a
 * guaranteed no-op. A RETRY of an event that previously ended in `failed`
 * (or was stuck at `received` by a crash) is NOT a duplicate: it is
 * reprocessed, because Paddle redelivers the SAME `event_id` after a
 * non-2xx — acking that as a duplicate would wedge the row at `failed`
 * forever. Never throws for an unknown/duplicate/unresolvable event — only
 * for a genuine processing failure AFTER the event was recorded, so the
 * caller can turn that into a 500 for Paddle to retry.
 */
export async function processPaddleEvent(
  deps: WebhookDeps,
  event: PaddleEvent,
): Promise<ProcessOutcome> {
  const handled = isHandledEvent(event);
  // Only a provenance-verified id is ever written (it is an FK on
  // billing_events) — an attacker-chosen value must not be able to turn
  // the insert into a constraint error and a 3-day retry loop.
  const cheapOrganizationId = handled
    ? await resolveOrganizationIdFromPayload(deps.provenanceSecret, event)
    : null;
  const isNew = await insertBillingEventIfNew(deps.db, {
    providerEventId: event.event_id,
    type: event.event_type,
    organizationId: cheapOrganizationId,
    payloadJson: JSON.stringify(event),
  });
  if (!isNew) {
    const existing = await getBillingEventByProviderId(deps.db, event.event_id);
    const terminal = existing?.status === 'processed' || existing?.status === 'ignored';
    if (terminal) {
      return 'duplicate';
    }
    // `failed` or a crash-stuck `received` — fall through and reprocess.
  }

  if (!handled) {
    await markBillingEventStatus(deps.db, event.event_id, 'ignored');
    return 'ignored';
  }

  try {
    const outcome = await syncSubscriptionState(
      deps,
      cheapOrganizationId,
      resolveSubscriptionId(event),
      event,
    );
    await markBillingEventStatus(
      deps.db,
      event.event_id,
      outcome === 'ignored' ? 'ignored' : 'processed',
    );
    return outcome;
  } catch (cause) {
    await markBillingEventStatus(deps.db, event.event_id, 'failed');
    throw cause;
  }
}
