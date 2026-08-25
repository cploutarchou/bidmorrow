-- 0011_paddle_billing — provider-neutral billing columns + `paused` status
-- (ADR-0011: Paddle Billing, as Merchant of Record, replaces Stripe).
--
-- What changes:
--   subscriptions.stripe_customer_id      -> billing_customer_id
--   subscriptions.stripe_subscription_id  -> billing_subscription_id
--   subscriptions.status CHECK            -> adds 'paused', drops 'unpaid'
--   billing_events.stripe_event_id        -> provider_event_id
-- Indexes are renamed to match. Everything else (types, nullability,
-- defaults, FKs, the org/plan CHECKs, the org+created_at index) is
-- unchanged.
--
-- Why a rebuild: SQLite cannot alter a CHECK constraint in place, and the
-- unique indexes are named after the old columns, so both tables use the
-- create-new -> copy -> swap pattern (migration-safety rule 2). RENAME
-- COLUMN alone would leave the stale CHECK on `subscriptions`.
--
-- Data: production has NEVER had a subscription — verified 2026-08-25
-- against the live database (0 rows in both tables; the prelaunch gate
-- has kept POST /api/billing/checkout closed since 2026-08-21). Staging
-- may hold Stripe TEST-MODE rows from earlier phases; those migrate
-- losslessly through the copy steps below (ids are opaque strings) with
-- one deliberate exception: any `unpaid` row is rewritten to `canceled`
-- (that Stripe-only status has no Paddle equivalent and was never
-- entitled). Such rows reference Stripe customers that no longer route
-- anywhere, which is exactly the "canceled, re-checkout creates a fresh
-- Paddle customer" path the billing package already handles. No other
-- value is transformed.
--
-- Destructive statements: two DROP TABLEs on the OLD tables after their
-- rows have been copied into the replacements. Nothing is lost.
--
-- `--` line comments only (migration-safety rule 6).

CREATE TABLE `subscriptions__new` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_customer_id` text NOT NULL,
	`billing_subscription_id` text,
	`status` text NOT NULL,
	`plan` text NOT NULL,
	`current_period_end_at` integer,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_subscriptions__status" CHECK("subscriptions__new"."status" IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
	CONSTRAINT "ck_subscriptions__plan" CHECK("subscriptions__new"."plan" IN ('founding', 'standard'))
);

INSERT INTO `subscriptions__new` (
	`id`, `organization_id`, `billing_customer_id`, `billing_subscription_id`,
	`status`, `plan`, `current_period_end_at`, `cancel_at_period_end`,
	`created_at`, `updated_at`
)
SELECT
	`id`, `organization_id`, `stripe_customer_id`, `stripe_subscription_id`,
	CASE WHEN `status` = 'unpaid' THEN 'canceled' ELSE `status` END,
	`plan`, `current_period_end_at`, `cancel_at_period_end`,
	`created_at`, `updated_at`
FROM `subscriptions`;

DROP TABLE `subscriptions`;

ALTER TABLE `subscriptions__new` RENAME TO `subscriptions`;

CREATE UNIQUE INDEX `uq_subscriptions__organization_id` ON `subscriptions` (`organization_id`);
CREATE UNIQUE INDEX `uq_subscriptions__billing_customer_id` ON `subscriptions` (`billing_customer_id`);
CREATE UNIQUE INDEX `uq_subscriptions__billing_subscription_id` ON `subscriptions` (`billing_subscription_id`);

CREATE TABLE `billing_events__new` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_id` text NOT NULL,
	`type` text NOT NULL,
	`organization_id` text,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_billing_events__status" CHECK("billing_events__new"."status" IN ('received', 'processed', 'failed', 'ignored'))
);

INSERT INTO `billing_events__new` (
	`id`, `provider_event_id`, `type`, `organization_id`, `payload_json`,
	`status`, `processed_at`, `created_at`, `updated_at`
)
SELECT
	`id`, `stripe_event_id`, `type`, `organization_id`, `payload_json`,
	`status`, `processed_at`, `created_at`, `updated_at`
FROM `billing_events`;

DROP TABLE `billing_events`;

ALTER TABLE `billing_events__new` RENAME TO `billing_events`;

CREATE UNIQUE INDEX `uq_billing_events__provider_event_id` ON `billing_events` (`provider_event_id`);
CREATE INDEX `idx_billing_events__organization_id_created_at` ON `billing_events` (`organization_id`,`created_at`);
