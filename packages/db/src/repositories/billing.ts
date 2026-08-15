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
import { and, eq, ne, sql } from 'drizzle-orm';
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

/**
 * Reads a previously-recorded billing event by its unique `stripe_event_id`
 * — used by the webhook processor to distinguish a TRUE duplicate (already
 * `processed`/`ignored`, ack with zero side effects) from a RETRYABLE
 * `failed` (or a `received` row stuck by a crash between insert and its
 * terminal status write) — the latter two get reprocessed rather than
 * silently ack'd, which is what makes the "failure marks the row and a
 * retry succeeds" path actually retry instead of getting permanently stuck
 * behind the unique-`stripe_event_id` insert-dedup.
 */
export async function getBillingEventByStripeId(
  db: Db,
  stripeEventId: string,
): Promise<BillingEvent | null> {
  const rows = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.stripeEventId, stripeEventId))
    .limit(1);
  return rows[0] ?? null;
}

export type BillingEventStatus = 'processed' | 'failed' | 'ignored';

/**
 * Moves a previously-recorded billing event to a terminal status
 * (`insertBillingEventIfNew` always writes `received` first). Keyed on the
 * unique `stripe_event_id`, not organization — the row may have
 * `organization_id: null` (unresolvable at insert time), and marking it
 * done never needs to touch tenant data. `processed_at` moves with every
 * transition, including `failed` (records the last attempt time, not a
 * success time).
 */
export async function markBillingEventStatus(
  db: Db,
  stripeEventId: string,
  status: BillingEventStatus,
): Promise<void> {
  const now = Date.now();
  await db
    .update(billingEvents)
    .set({ status, processedAt: now, updatedAt: now })
    .where(eq(billingEvents.stripeEventId, stripeEventId));
}

/**
 * Cross-tenant count of non-canceled subscriptions on a given plan — used
 * ONLY to enforce the founding-plan seat cap (docs/product-scope.md: "first
 * 20 customers") at checkout time. This is the billing equivalent of
 * `company.ts`'s `listOrgsEligibleForScoring`/`listOrgsWithDigestEnabled`
 * exemptions: a global count across every tenant, never reachable from a
 * per-tenant request path, and it returns a bare number — no tenant-owned
 * row data. A canceled subscription frees its seat; every other status
 * (`trialing`/`active`/`past_due`/`unpaid`) still occupies one, since the
 * founding price is retained for the subscription's life
 * (docs/product-scope.md).
 */
export async function countNonCanceledSubscriptionsByPlan(
  db: Db,
  plan: SubscriptionPlan,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(and(eq(subscriptions.plan, plan), ne(subscriptions.status, 'canceled')));
  return Number(rows[0]?.count ?? 0);
}
