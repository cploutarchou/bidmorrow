/**
 * Billing schema — docs/data-model.md §9. [tenant-owned]
 * (`billing_events.organization_id` is nullable: resolved via the provider
 * customer id, null when unresolvable.)
 *
 * Provider-neutral column names (`billing_*`, `provider_event_id`) since
 * migration 0011 (ADR-0011: Paddle replaces Stripe). Values are Paddle ids
 * today (`ctm_…`, `sub_…`, `evt_…`).
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
 * the provider, so the row is mutable.
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    billingCustomerId: text('billing_customer_id').notNull(),
    /** Null between customer creation and checkout completion. */
    billingSubscriptionId: text('billing_subscription_id'),
    /** Mirrors the provider's subscription status. */
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
    // The two provider uniques are the webhook → organization resolution path.
    uniqueIndex('uq_subscriptions__billing_customer_id').on(t.billingCustomerId),
    uniqueIndex('uq_subscriptions__billing_subscription_id').on(t.billingSubscriptionId),
    check(
      'ck_subscriptions__status',
      sql`${t.status} IN ('trialing', 'active', 'past_due', 'paused', 'canceled')`,
    ),
    check('ck_subscriptions__plan', sql`${t.plan} IN ('founding', 'standard')`),
  ],
);

/**
 * Raw provider webhook ledger. Unique `provider_event_id` is the DB-enforced
 * idempotency guard: handlers insert first; a conflict means the event was
 * already processed (or is in flight) and the webhook returns 200 without
 * side effects. Status transitions move `updated_at`.
 */
export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    providerEventId: text('provider_event_id').notNull(),
    /** e.g. `subscription.updated`. */
    type: text('type').notNull(),
    /** Resolved via custom_data/customer id, null when unresolvable. */
    organizationId: text('organization_id').references(() => organizations.id),
    /** Full event payload. */
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull(),
    processedAt: integer('processed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_billing_events__provider_event_id').on(t.providerEventId),
    // Admin billing debugging.
    index('idx_billing_events__organization_id_created_at').on(t.organizationId, t.createdAt),
    check(
      'ck_billing_events__status',
      sql`${t.status} IN ('received', 'processed', 'failed', 'ignored')`,
    ),
  ],
);
