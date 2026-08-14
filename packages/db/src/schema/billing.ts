/**
 * Billing schema — docs/data-model.md §9. [tenant-owned]
 * (`billing_events.organization_id` is nullable: resolved via Stripe
 * customer id, null when unresolvable.)
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, INTEGER 0/1 booleans, TEXT + CHECK enums, `_json`
 * TEXT columns for opaque JSON payloads.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations } from './identity';

/**
 * 1:1 with organization (V1: exactly one subscription per org, created at
 * checkout). Server-side entitlements read this row; status/plan mirror
 * Stripe, so the row is mutable.
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    /** Null between customer creation and checkout completion. */
    stripeSubscriptionId: text('stripe_subscription_id'),
    /** Mirrors Stripe. */
    status: text('status').notNull(),
    plan: text('plan').notNull(),
    /** Entitlement grace boundary. */
    currentPeriodEndAt: integer('current_period_end_at'),
    cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_subscriptions__organization_id').on(t.organizationId),
    // The two Stripe uniques are the webhook → organization resolution path.
    uniqueIndex('uq_subscriptions__stripe_customer_id').on(t.stripeCustomerId),
    uniqueIndex('uq_subscriptions__stripe_subscription_id').on(t.stripeSubscriptionId),
    check(
      'ck_subscriptions__status',
      sql`${t.status} IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid')`,
    ),
    check('ck_subscriptions__plan', sql`${t.plan} IN ('founding', 'standard')`),
  ],
);

/**
 * Raw Stripe webhook ledger. Unique `stripe_event_id` is the DB-enforced
 * idempotency guard: handlers insert first; a conflict means the event was
 * already processed (or is in flight) and the webhook returns 200 without
 * side effects. Status transitions move `updated_at`.
 */
export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    stripeEventId: text('stripe_event_id').notNull(),
    /** e.g. `customer.subscription.updated`. */
    type: text('type').notNull(),
    /** Resolved via customer id, null when unresolvable. */
    organizationId: text('organization_id').references(() => organizations.id),
    /** Full event payload. */
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull(),
    processedAt: integer('processed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_billing_events__stripe_event_id').on(t.stripeEventId),
    // Admin billing debugging.
    index('idx_billing_events__organization_id_created_at').on(t.organizationId, t.createdAt),
    check(
      'ck_billing_events__status',
      sql`${t.status} IN ('received', 'processed', 'failed', 'ignored')`,
    ),
  ],
);
