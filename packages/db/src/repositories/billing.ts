/**
 * Billing repository — docs/data-model.md §9 (docs/security.md C6).
 *
 * `subscriptions` is [tenant-owned] 1:1 with the organization.
 * `billing_events` is the raw Stripe webhook ledger; its `organization_id`
 * is nullable (resolved via Stripe customer id, null when unresolvable), so
 * its insert takes an EXPLICIT `organizationId: OrganizationId | null`
 * rather than omitting the argument — the tenant linkage stays visible and
 * grep-auditable at every call site.
 */
import { and, eq } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { billingEvents, subscriptions } from '../schema/billing';
import { TenantMismatchError } from './errors';

export type Subscription = typeof subscriptions.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;

/** Mirrors Stripe (docs/data-model.md §9 CHECK). */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
export type SubscriptionPlan = 'founding' | 'standard';

export interface UpsertSubscriptionArgs {
  stripeCustomerId: string;
  /** Null between customer creation and checkout completion. */
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  /** Entitlement grace boundary (epoch millis). */
  currentPeriodEndAt: number | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Creates or updates the organization's subscription, keyed on the
 * `stripe_customer_id` unique (the webhook → organization resolution path).
 * The update arm is additionally guarded on `organization_id`, so a Stripe
 * customer id that belongs to a DIFFERENT organization is never overwritten
 * — that case throws `TenantMismatchError` instead of silently no-oping.
 */
export async function upsertSubscriptionByStripeCustomerId(
  db: Db,
  organizationId: OrganizationId,
  args: UpsertSubscriptionArgs,
): Promise<Subscription> {
  const now = Date.now();
  const values = {
    stripeSubscriptionId: args.stripeSubscriptionId,
    status: args.status,
    plan: args.plan,
    currentPeriodEndAt: args.currentPeriodEndAt,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd ? 1 : 0,
  };
  await db
    .insert(subscriptions)
    .values({
      id: newId(now),
      organizationId,
      stripeCustomerId: args.stripeCustomerId,
      ...values,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeCustomerId,
      set: { ...values, updatedAt: now },
      setWhere: eq(subscriptions.organizationId, organizationId),
    });

  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(subscriptions.stripeCustomerId, args.stripeCustomerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    // The conflicting stripe_customer_id row is owned by another org.
    throw new TenantMismatchError('subscriptions', organizationId);
  }
  return row;
}

/** Server-side entitlement read: the organization's subscription (1:1). */
export async function getSubscription(
  db: Db,
  organizationId: OrganizationId,
): Promise<Subscription | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export interface InsertBillingEventArgs {
  stripeEventId: string;
  /** e.g. `customer.subscription.updated`. */
  type: string;
  /** Resolved via Stripe customer id; null when unresolvable. */
  organizationId: OrganizationId | null;
  /** Full raw event payload. */
  payloadJson: string;
}

/**
 * Records a Stripe webhook event exactly once. The unique
 * `stripe_event_id` is the DB-enforced idempotency guard: returns true when
 * this call recorded the event (status `received`), false when it was
 * already recorded (or in flight) — the handler then returns 200 without
 * side effects (docs/data-model.md §9).
 */
export async function insertBillingEventIfNew(
  db: Db,
  args: InsertBillingEventArgs,
): Promise<boolean> {
  const now = Date.now();
  const inserted = await db
    .insert(billingEvents)
    .values({
      id: newId(now),
      stripeEventId: args.stripeEventId,
      type: args.type,
      organizationId: args.organizationId,
      payloadJson: args.payloadJson,
      status: 'received',
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: billingEvents.stripeEventId })
    .returning({ id: billingEvents.id });
  return inserted.length > 0;
}
