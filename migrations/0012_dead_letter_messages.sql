-- 0012_dead_letter_messages — durable record of every dead-lettered queue
-- message, so a poison message stops being invisible.
--
-- Purpose (PRODUCTION_READINESS_AUDIT.md F-07). The three queues declare
-- `dead_letter_queue` targets in apps/worker/wrangler.jsonc, but nothing has
-- ever consumed them. A message that exhausted its retries therefore landed
-- in a queue nobody drains and nobody reads: not merely absent from the admin
-- health page — nobody ever found out it happened. `docs/production-checklist.md`
-- asks the health page to show queue/DLQ depth, and a DLQ's contents are not
-- readable from the Worker runtime, so the fix is to consume the DLQs and
-- record what arrives. "Depth" then becomes `COUNT(*) WHERE resolved_at IS
-- NULL`, a number this database owns, with no Cloudflare API token and no
-- outbound call on the request path.
--
-- GLOBAL, NOT ORGANIZATION-OWNED. Like `ingestion_runs` / `ingestion_errors`,
-- this is operator infrastructure: rows are written by the queue consumer and
-- read only by INTERNAL_ADMIN. It has no `organization_id` column, and
-- `packages/db/src/repositories/dead-letters.ts` is classified in the
-- tenant-isolation contract's GLOBAL_FILES for exactly that reason. A digest
-- message's payload happens to name an organization inside `body_json`, but
-- that is opaque captured content, not a scoping column, and nothing joins on
-- it.
--
-- `provider_message_id` is UNIQUE: delivery to the DLQ consumer is
-- at-least-once like every other queue, so the same dead-lettered message can
-- arrive twice. The unique index makes the recording idempotent at the
-- database rather than in application logic, matching the
-- `uq_billing_events__provider_event_id` precedent. Added at creation time —
-- SQLite cannot add a unique constraint later without a table rebuild.
--
-- `resolved_at` is nullable and operator-set: an operator marks a row
-- resolved once they have dealt with the underlying cause. Unresolved rows
-- are what "depth" counts, so the number reflects outstanding work rather
-- than all-time history, while the history itself is never deleted here (the
-- ledger purge job ages these rows out on its own schedule).
--
-- `body_json` captures the message payload verbatim so the failure can be
-- diagnosed and, if appropriate, replayed by hand. Payloads are our own
-- enqueued control messages (`{kind, ...}`), never procurement content — but
-- they are still rendered as escaped text and never as HTML, per the standing
-- untrusted-input rule.
--
-- No data is dropped or retyped by this migration; it creates one new table.

CREATE TABLE dead_letter_messages (
  id TEXT PRIMARY KEY,
  -- Which DLQ it arrived on, e.g. `bidmorrow-ingest-dlq-staging`. Stored as
  -- the full queue name rather than a normalized enum: the environment suffix
  -- is part of what an operator needs to see, and a CHECK over per-environment
  -- names would need a migration every time an environment is added.
  queue TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  -- Cloudflare's own delivery attempt count at the time it dead-lettered.
  attempts INTEGER NOT NULL,
  dead_lettered_at INTEGER NOT NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_dead_letter_messages__provider_message_id
  ON dead_letter_messages (provider_message_id);

CREATE INDEX idx_dead_letter_messages__resolved_at
  ON dead_letter_messages (resolved_at);

CREATE INDEX idx_dead_letter_messages__queue_dead_lettered_at
  ON dead_letter_messages (queue, dead_lettered_at);
