/**
 * Stripe webhook processing — signature verification + idempotent,
 * order-independent event handling.
 *
 * Recommended event set (docs/dependency-versions.md § Stripe facts, itself
 * cross-checked this session against the installed SDK's
 * `esm/resources/Events.d.ts` discriminated `Event` union — every type
 * below is a real member of it): `checkout.session.completed`,
 * `customer.subscription.created/updated/deleted`, `invoice.paid`,
 * `invoice.payment_failed`. docs.stripe.com itself was unreachable (egress
 * blocked) this session; a WebSearch cross-check independently confirmed
 * the same minimum set for Checkout + subscriptions (see the Phase 9
 * session notes in IMPLEMENTATION_LEDGER.md).
 *
 * ORDERING IS NOT GUARANTEED (Stripe: at-least-once, no ordering
 * guarantee). This processor never trusts a webhook payload's `status` (or
 * any other mutable subscription field) as current truth — every handled
 * event triggers a live `subscriptions.retrieve` re-fetch, and the re-fetch
 * result is what gets written. Whichever event a `MessageBatch`-style
 * at-least-once delivery happens to process last, the STORED state is
 * always whatever Stripe says RIGHT NOW, never whatever an individual
 * event's payload said at send time — so out-of-order delivery can produce
 * extra redundant writes but never a wrong final state.
 *
 * Organization resolution is different from state: it is read from
 * `metadata.organizationId`, which we set ourselves at checkout (see
 * checkout.ts's header comment for exactly where) and which Stripe echoes
 * back unchanged — an identity label, not mutable payment state, so trusting
 * the (signature-verified) payload for it is safe and avoids an extra API
 * call on every event.
 *
 * Idempotency: `insertBillingEventIfNew` (unique `stripe_event_id`) runs
 * FIRST, before any other DB write or Stripe API call — a duplicate
 * delivery is acknowledged with zero side effects and zero extra network
 * calls. Errors that happen AFTER that insert mark the row `failed` and
 * rethrow (the caller — the Worker route — turns that into a 500 so Stripe
 * retries); reprocessing is always safe because the write path re-fetches
 * current state rather than trusting anything about the failed attempt.
 */
import Stripe from 'stripe';
import {
  getBillingEventByStripeId,
  getSubscription,
  insertBillingEventIfNew,
  insertProductEvent,
  markBillingEventStatus,
  upsertSubscriptionByStripeCustomerId,
  type Db,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId, type OrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';

import { mapStripeSubscriptionStatus, planFromPriceId, type PriceIds } from './plans';
import type { WebhookStripeClient, WebhookVerifierClient } from './stripe-types';

export const RECOMMENDED_WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

export type HandledEvent =
  | Stripe.CheckoutSessionCompletedEvent
  | Stripe.CustomerSubscriptionCreatedEvent
  | Stripe.CustomerSubscriptionUpdatedEvent
  | Stripe.CustomerSubscriptionDeletedEvent
  | Stripe.InvoicePaidEvent
  | Stripe.InvoicePaymentFailedEvent;

/** Pure, no DB/network — unit-tested directly against real `Stripe.Event`-shaped fixtures. */
export function isHandledEvent(event: Stripe.Event): event is HandledEvent {
  return (RECOMMENDED_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.type);
}

/**
 * Verifies a webhook's `Stripe-Signature` header asynchronously (Workers
 * has no Node `crypto` module — `SubtleCryptoProvider` is Web Crypto-only,
 * verified from the installed SDK's `esm/crypto/SubtleCryptoProvider.d.ts`;
 * see stripe-client.ts's header comment for the full citation). Throws
 * `Stripe.errors.StripeSignatureVerificationError` on a missing/invalid
 * signature — callers must respond 400 with NO detail (never echo the
 * verification error back to the caller).
 */
export async function verifyStripeWebhookEvent(
  stripe: WebhookVerifierClient,
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  cryptoProvider?: Parameters<Stripe.Webhooks['constructEventAsync']>[4],
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signatureHeader,
    webhookSecret,
    undefined,
    // SEC-P9-01: default the Web Crypto provider explicitly so verification
    // is deterministic under every module-resolution condition (plain Node
    // for unit tests, `workerd` for the real Worker) instead of relying on
    // the SDK's export-condition default.
    cryptoProvider ?? Stripe.createSubtleCryptoProvider(),
  );
}

/** Safe wrapper: empty/whitespace-only metadata never throws, just resolves to null. */
function safeOrganizationId(raw: string | null | undefined): OrganizationId | null {
  if (raw === null || raw === undefined || raw.trim().length === 0) return null;
  return toOrganizationId(raw);
}

/**
 * Cheap, synchronous, no-network organization resolution straight from the
 * (signature-verified) event payload — see file header for why this is
 * safe to trust for IDENTITY even though subscription STATE never is.
 */
export function resolveOrganizationIdFromPayload(event: HandledEvent): OrganizationId | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      return safeOrganizationId(
        session.client_reference_id ?? session.metadata?.['organizationId'],
      );
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return safeOrganizationId(event.data.object.metadata['organizationId']);
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const details = event.data.object.parent?.subscription_details;
      return safeOrganizationId(details?.metadata?.['organizationId']);
    }
  }
}

/** Subscription id relevant to the event, or null when there is none to re-fetch (e.g. a non-subscription checkout). */
export function resolveSubscriptionId(event: HandledEvent): string | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const { subscription } = event.data.object;
      if (subscription === null) return null;
      return typeof subscription === 'string' ? subscription : subscription.id;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return event.data.object.id;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const details = event.data.object.parent?.subscription_details;
      if (details === undefined || details === null) return null;
      return typeof details.subscription === 'string'
        ? details.subscription
        : details.subscription.id;
    }
  }
}

export interface WebhookDeps {
  readonly db: Db;
  readonly stripe: WebhookStripeClient;
  readonly priceIds: PriceIds;
  readonly logger?: Logger;
}

export type ProcessOutcome = 'processed' | 'duplicate' | 'ignored';

/**
 * Re-fetches the subscription's CURRENT state from Stripe (never the event
 * payload) and upserts it. Fires `subscription_started`/
 * `subscription_canceled` product events on the relevant transitions,
 * computed from the PRE-upsert row's status vs. the newly-fetched one — the
 * single place that comparison happens, so both packages/billing's own
 * tests and the Worker's D1 integration tests exercise the same logic.
 */
async function syncSubscriptionState(
  deps: WebhookDeps,
  organizationId: OrganizationId,
  subscriptionId: string,
): Promise<void> {
  const before = await getSubscription(deps.db, organizationId);

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  const plan = priceId !== undefined ? planFromPriceId(deps.priceIds, priceId) : null;
  if (plan === null) {
    // P9-R-01: an unknown price id means OUR env price-id config is wrong.
    // Throwing marks the billing_events row `failed` and returns 500 so
    // Stripe keeps retrying — once the config is fixed, the retry (or the
    // failed-row reprocess path) syncs the subscription. Returning quietly
    // here would ack the event as processed and silently never write the
    // subscription.
    deps.logger?.error('billing.webhook.unknown_price_id', {
      subscriptionId,
      priceId: priceId ?? null,
    });
    throw new Error(`unknown Stripe price id for subscription ${subscriptionId}`);
  }
  const status = mapStripeSubscriptionStatus(subscription.status);
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  await upsertSubscriptionByStripeCustomerId(deps.db, organizationId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status,
    plan,
    // `current_period_end` moved from the Subscription object to each
    // SubscriptionItem as of this API version (verified from the installed
    // SDK: `esm/resources/Subscriptions.d.ts` has no top-level
    // `current_period_end`; `esm/resources/SubscriptionItems.d.ts` does) —
    // we sell exactly one price per subscription, so the first item's value
    // is the whole subscription's period end. Stripe timestamps are Unix
    // seconds; the column is epoch millis.
    currentPeriodEndAt: item !== undefined ? item.current_period_end * 1000 : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
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
}

async function handleEvent(deps: WebhookDeps, event: HandledEvent): Promise<ProcessOutcome> {
  const organizationId = resolveOrganizationIdFromPayload(event);
  const subscriptionId = resolveSubscriptionId(event);
  if (organizationId === null || subscriptionId === null) {
    deps.logger?.warn('billing.webhook.unresolvable', {
      stripe_event_id: event.id,
      type: event.type,
      has_org: organizationId !== null,
      has_subscription: subscriptionId !== null,
    });
    return 'ignored';
  }
  await syncSubscriptionState(deps, organizationId, subscriptionId);
  return 'processed';
}

/**
 * Processes one already signature-verified Stripe event. Idempotent: a
 * duplicate delivery of an event already `processed`/`ignored` is a
 * guaranteed no-op — ack with zero side effects, zero extra Stripe API
 * calls. A RETRY of an event that previously ended in `failed` (or was
 * stuck at `received` by a crash between the insert and its terminal
 * status write — the at-least-once-delivery edge case, same acceptance as
 * SEC-P8-02's digest-send equivalent) is NOT treated as a duplicate: it is
 * reprocessed, because Stripe's own retry behavior for a non-2xx response
 * is to redeliver the SAME `event.id` — if we ack'd that redelivery as a
 * plain duplicate, a transient failure (e.g. a momentary Stripe API
 * outage) would wedge the row at `failed` forever with no path to
 * `processed`. Never throws for an unknown/duplicate/unresolvable event —
 * only for a genuine processing failure (network error,
 * {@link TenantMismatchError}) AFTER the event was recorded, so the caller
 * can turn that into a 500 for Stripe to retry.
 */
export async function processStripeEvent(
  deps: WebhookDeps,
  event: Stripe.Event,
): Promise<ProcessOutcome> {
  const cheapOrganizationId = isHandledEvent(event)
    ? resolveOrganizationIdFromPayload(event)
    : null;
  const isNew = await insertBillingEventIfNew(deps.db, {
    stripeEventId: event.id,
    type: event.type,
    organizationId: cheapOrganizationId,
    payloadJson: JSON.stringify(event),
  });
  if (!isNew) {
    const existing = await getBillingEventByStripeId(deps.db, event.id);
    const terminal = existing?.status === 'processed' || existing?.status === 'ignored';
    if (terminal) {
      return 'duplicate';
    }
    // status is `failed` or a crash-stuck `received` — fall through and
    // reprocess exactly as a first attempt would.
  }

  if (!isHandledEvent(event)) {
    await markBillingEventStatus(deps.db, event.id, 'ignored');
    return 'ignored';
  }

  try {
    const outcome = await handleEvent(deps, event);
    await markBillingEventStatus(
      deps.db,
      event.id,
      outcome === 'processed' ? 'processed' : 'ignored',
    );
    return outcome;
  } catch (cause) {
    await markBillingEventStatus(deps.db, event.id, 'failed');
    throw cause;
  }
}
