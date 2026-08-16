/**
 * Stripe-hosted Checkout session creation (`mode: 'subscription'`). No card
 * data ever touches our code — this only ever returns a Stripe-hosted URL.
 *
 * Customer/organization linking (verified from the installed SDK's
 * `esm/resources/Checkout/Sessions.d.ts` — `client_reference_id`: "A unique
 * string to reference the Checkout Session. This can be a customer ID... to
 * reconcile the session with your internal systems"): the session is
 * created with BOTH `client_reference_id` and `metadata.organizationId` set
 * to the organization id, AND `subscription_data.metadata.organizationId`
 * (also confirmed present on `SessionCreateParams.SubscriptionData` in the
 * same file) so the metadata is copied onto the Stripe Subscription object
 * itself at creation. That third copy is what makes org resolution
 * order-independent in the webhook processor (webhook.ts): a
 * `customer.subscription.*` event carries `object.metadata.organizationId`
 * directly, and an `invoice.paid`/`invoice.payment_failed` event carries an
 * immutable snapshot of it at `object.parent.subscription_details.metadata`
 * (per the SDK's doc comment on `Invoice.Parent.SubscriptionDetails.metadata`:
 * "Becomes an immutable snapshot of the subscription metadata at the time
 * of invoice finalization") — no event ever needs to look up a
 * not-yet-linked `stripe_customer_id` in our own DB to know which
 * organization it belongs to, regardless of Stripe's at-least-once,
 * order-NOT-guaranteed delivery.
 *
 * Reactivation after cancellation: `subscriptions.organization_id` is
 * DB-unique (docs/data-model.md §9, 1:1) so a canceled row cannot simply be
 * re-inserted with a brand-new Stripe customer — the existing
 * `stripe_customer_id` is passed as Checkout's `customer` param instead
 * (Checkout in `subscription` mode reuses rather than duplicates an
 * existing customer when one is supplied), so the eventual webhook upsert
 * still resolves via the SAME unique `stripe_customer_id` and updates the
 * same row rather than colliding on `organization_id`.
 */
import { getFeatureFlag, getSubscription, type Db } from '@bidmorrow/db';
import { FLAG_FOUNDING_CAP, FLAG_FOUNDING_PLAN_OPEN } from '@bidmorrow/config';
import type { OrganizationId } from '@bidmorrow/domain';
import { countNonCanceledSubscriptionsByPlan } from '@bidmorrow/db';

import { FoundingPlanUnavailableError, SubscriptionAlreadyExistsError } from './errors';
import {
  DEFAULT_FOUNDING_CAP,
  priceIdForPlan,
  type PriceIds,
  type SubscriptionPlan,
} from './plans';
import type { CheckoutStripeClient } from './stripe-types';

export interface CheckoutDeps {
  readonly db: Db;
  readonly stripe: CheckoutStripeClient;
  readonly priceIds: PriceIds;
  /** No trailing slash, e.g. `https://app.bidmorrow.com`. */
  readonly appBaseUrl: string;
}

export interface CreateCheckoutSessionArgs {
  readonly organizationId: OrganizationId;
  readonly plan: SubscriptionPlan;
}

export interface CheckoutSessionResult {
  readonly url: string;
  readonly stripeSessionId: string;
}

/**
 * Non-canceled statuses hold the organization's one-and-only subscription
 * slot (see file header) — pure so the guard is unit-testable with no DB.
 */
export function blocksNewCheckout(status: string): boolean {
  return (
    status === 'trialing' || status === 'active' || status === 'past_due' || status === 'unpaid'
  );
}

/** `flag.value_json` for `FLAG_FOUNDING_PLAN_OPEN` is a bare JSON boolean, e.g. `"true"`. Pure, no DB. */
export function isFoundingPlanOpenFlag(flag: { readonly valueJson: string } | null): boolean {
  return flag !== null && JSON.parse(flag.valueJson) === true;
}

/** `flag.value_json` for `FLAG_FOUNDING_CAP` is a bare JSON integer, e.g. `"20"`. Pure, no DB; malformed/negative falls back to the default rather than throwing. */
export function resolveFoundingCap(flag: { readonly valueJson: string } | null): number {
  if (flag === null) return DEFAULT_FOUNDING_CAP;
  const parsed = Number(JSON.parse(flag.valueJson));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FOUNDING_CAP;
}

/**
 * Non-throwing read of the same guard `createCheckoutSession` enforces —
 * used by `GET /api/billing/status` so the UI knows whether to show the
 * founding Subscribe button at all (never inferred client-side).
 */
export async function isFoundingPlanAvailable(db: Db): Promise<boolean> {
  const openFlag = await getFeatureFlag(db, FLAG_FOUNDING_PLAN_OPEN);
  if (!isFoundingPlanOpenFlag(openFlag)) return false;
  const capFlag = await getFeatureFlag(db, FLAG_FOUNDING_CAP);
  const cap = resolveFoundingCap(capFlag);
  const count = await countNonCanceledSubscriptionsByPlan(db, 'founding');
  return count < cap;
}

async function assertFoundingPlanOpen(db: Db): Promise<void> {
  const openFlag = await getFeatureFlag(db, FLAG_FOUNDING_PLAN_OPEN);
  if (!isFoundingPlanOpenFlag(openFlag)) {
    throw new FoundingPlanUnavailableError('flag_closed');
  }
  const capFlag = await getFeatureFlag(db, FLAG_FOUNDING_CAP);
  const cap = resolveFoundingCap(capFlag);
  const count = await countNonCanceledSubscriptionsByPlan(db, 'founding');
  if (count >= cap) {
    throw new FoundingPlanUnavailableError('cap_reached');
  }
}

/**
 * Creates a Stripe-hosted Checkout session for a new (or reactivating)
 * subscription. Throws {@link SubscriptionAlreadyExistsError} (409 at the
 * route layer) or {@link FoundingPlanUnavailableError} (409/422) before any
 * Stripe API call — guards run against our own DB only.
 */
export async function createCheckoutSession(
  deps: CheckoutDeps,
  args: CreateCheckoutSessionArgs,
): Promise<CheckoutSessionResult> {
  const existing = await getSubscription(deps.db, args.organizationId);
  if (existing !== null && blocksNewCheckout(existing.status)) {
    throw new SubscriptionAlreadyExistsError(args.organizationId);
  }

  if (args.plan === 'founding') {
    await assertFoundingPlanOpen(deps.db);
  }

  const priceId = priceIdForPlan(deps.priceIds, args.plan);
  const metadata = { organizationId: args.organizationId, plan: args.plan };

  // SEC-P9-03: re-read immediately before the Stripe network call. This
  // narrows — but cannot close — the classic check-then-act race: two
  // concurrent requests can both pass the FIRST `getSubscription` guard
  // above (neither sees a row yet), and both still reach this point before
  // either's Checkout session is completed by the owner. This second read
  // shrinks the window from "guard + the full Stripe API round trip" down
  // to just this DB round trip, which is not zero but is the cheapest
  // narrowing available without a distributed lock or a schema change (both
  // out of scope here). The residual race is closed authoritatively
  // server-side in the webhook processor, not here: if the owner completes
  // BOTH sessions anyway, `webhook.ts`'s `syncSubscriptionState` detects the
  // second webhook's Stripe customer id doesn't match this organization's
  // existing (still non-canceled) row and cancels+reconciles the duplicate
  // Stripe subscription automatically, so a still-open window here can
  // never wedge a webhook or orphan a live subscription undetected.
  const recheck = await getSubscription(deps.db, args.organizationId);
  if (recheck !== null && blocksNewCheckout(recheck.status)) {
    throw new SubscriptionAlreadyExistsError(args.organizationId);
  }

  // Deliberately reads off `recheck` (the freshest row), not `existing`
  // (the first, staler read) — if a row appeared between the two reads
  // (e.g. a canceled row written by a webhook that raced this request),
  // reusing its `stripe_customer_id` here is exactly the reactivation
  // behavior described in this file's header, and it also means the
  // second read above is not wasted on the happy path.
  const session = await deps.stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: args.organizationId,
    ...(recheck?.stripeCustomerId !== undefined ? { customer: recheck.stripeCustomerId } : {}),
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    subscription_data: { metadata },
    success_url: `${deps.appBaseUrl}/app/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${deps.appBaseUrl}/app/settings?checkout=cancelled`,
  });

  if (session.url === null) {
    // Never happens for a `hosted_page` (default) subscription-mode
    // session, but the SDK types it nullable — fail loudly rather than
    // return an unusable empty string to the client.
    throw new Error('createCheckoutSession: Stripe returned a session with no url');
  }
  return { url: session.url, stripeSessionId: session.id };
}
