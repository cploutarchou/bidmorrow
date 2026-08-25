/**
 * Checkout = a SERVER-created Paddle transaction, opened client-side by
 * Paddle.js (`Paddle.Checkout.open({ transactionId })`). No card data ever
 * touches our code — the overlay is Paddle-hosted.
 *
 * Why a transaction rather than letting the SPA pass `items` to Paddle.js:
 * the server stays the sole authority on WHAT is bought and FOR WHOM. The
 * transaction carries `items: [{ price_id }]` chosen from our env-supplied
 * price ids, and `custom_data.organization_id` — which Paddle copies onto
 * the subscription it creates when the transaction completes. That copy is
 * what makes organization resolution in the webhook processor
 * (webhook.ts) order-independent: every `subscription.*` event carries
 * `data.custom_data.organization_id` directly, so no event ever needs to
 * look up a not-yet-linked customer id in our own DB, regardless of
 * Paddle's at-least-once, order-NOT-guaranteed delivery.
 *
 * Reactivation after cancellation: `subscriptions.organization_id` is
 * DB-unique (docs/data-model.md §9, 1:1) so a canceled row cannot simply be
 * re-inserted under a brand-new Paddle customer — the existing
 * `billing_customer_id` is passed as the transaction's `customer_id`, so
 * the eventual webhook upsert resolves via the SAME unique customer id and
 * updates the same row rather than colliding on `organization_id`.
 *
 * Tax: Paddle is Merchant of Record. Prices are `tax_mode: external`
 * (tax-exclusive, owner decision 2026-08-25); VAT is computed and collected
 * by Paddle at checkout for the customer's country. Nothing tax-related is
 * configurable from this code path — the previous Stripe Tax flag is gone.
 */
import { getFeatureFlag, getSubscription, type Db } from '@bidmorrow/db';
import { FLAG_FOUNDING_CAP, FLAG_FOUNDING_PLAN_OPEN } from '@bidmorrow/config';
import type { OrganizationId } from '@bidmorrow/domain';
import { countNonCanceledSubscriptionsByPlan } from '@bidmorrow/db';

import { FoundingPlanUnavailableError, SubscriptionAlreadyExistsError } from './errors';
import type { TransactionsClient } from './paddle-client';
import {
  ORGANIZATION_ID_KEY,
  ORGANIZATION_SIG_KEY,
  signOrganizationProvenance,
} from './provenance';
import {
  DEFAULT_FOUNDING_CAP,
  priceIdForPlan,
  type PriceIds,
  type SubscriptionPlan,
} from './plans';

export interface CheckoutDeps {
  readonly db: Db;
  readonly paddle: { readonly transactions: Pick<TransactionsClient, 'create'> };
  readonly priceIds: PriceIds;
  /** Signs `custom_data.organization_id` so the webhook can prove WE created the transaction (provenance.ts). */
  readonly provenanceSecret: string;
}

export interface CreateCheckoutArgs {
  readonly organizationId: OrganizationId;
  readonly plan: SubscriptionPlan;
}

export interface CheckoutResult {
  /** `txn_…` — the SPA passes this to `Paddle.Checkout.open({ transactionId })`. */
  readonly transactionId: string;
}

/**
 * Non-canceled statuses hold the organization's one-and-only subscription
 * slot (see file header) — pure so the guard is unit-testable with no DB.
 */
export function blocksNewCheckout(status: string): boolean {
  return (
    status === 'trialing' || status === 'active' || status === 'past_due' || status === 'paused'
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
 * Non-throwing read of the same guard `createCheckoutTransaction` enforces —
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
 * Creates the Paddle transaction for a new (or reactivating) subscription.
 * Throws {@link SubscriptionAlreadyExistsError} (409 at the route layer) or
 * {@link FoundingPlanUnavailableError} (409) before any Paddle API call —
 * guards run against our own DB only.
 */
export async function createCheckoutTransaction(
  deps: CheckoutDeps,
  args: CreateCheckoutArgs,
): Promise<CheckoutResult> {
  const existing = await getSubscription(deps.db, args.organizationId);
  if (existing !== null && blocksNewCheckout(existing.status)) {
    throw new SubscriptionAlreadyExistsError(args.organizationId);
  }

  if (args.plan === 'founding') {
    await assertFoundingPlanOpen(deps.db);
  }

  const priceId = priceIdForPlan(deps.priceIds, args.plan);

  // SEC-P9-03: re-read immediately before the network call. This narrows —
  // but cannot close — the check-then-act race between two concurrent
  // checkouts for the same org. The residual race is closed
  // authoritatively in the webhook processor: `syncSubscriptionState`
  // detects a second live subscription under a different customer id and
  // cancels + reconciles it (see webhook.ts `reconcileDuplicateCustomer`).
  const recheck = await getSubscription(deps.db, args.organizationId);
  if (recheck !== null && blocksNewCheckout(recheck.status)) {
    throw new SubscriptionAlreadyExistsError(args.organizationId);
  }
  const reactivatingCustomer = recheck?.billingCustomerId;

  const transaction = await deps.paddle.transactions.create({
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: {
      [ORGANIZATION_ID_KEY]: args.organizationId,
      [ORGANIZATION_SIG_KEY]: await signOrganizationProvenance(
        deps.provenanceSecret,
        args.organizationId,
      ),
      plan: args.plan,
    },
    currency_code: 'EUR',
    ...(reactivatingCustomer !== undefined ? { customer_id: reactivatingCustomer } : {}),
  });

  if (typeof transaction.id !== 'string' || transaction.id.length === 0) {
    throw new Error('createCheckoutTransaction: Paddle returned a transaction with no id');
  }
  return { transactionId: transaction.id };
}
