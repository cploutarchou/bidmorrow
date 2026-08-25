# ADR-0006: Cloudflare Queues + Cron Triggers, not Workflows

Status: Accepted (2026-08-14)

## Context

Async needs: (a) daily bounded TED ingestion with checkpointing, (b) match
computation fan-out, (c) daily digest generation/delivery, (d) retention
purge. Cloudflare Workflows is GA and would give per-step durable
execution — but since ~2026-08 it bills per step ($0.80/100k after 500k/mo)
plus state storage, and its strengths (long sleeps, waitForEvent,
human-approval) are not needs we have.

## Decision

**Cron Triggers + Queues (+ DLQs).** Crons initiate bounded runs; queues
carry the fan-out; our own `ingestion_checkpoints` / `ingestion_runs` /
`digest_runs` tables provide durability and resumability, which we need as
first-class, queryable, admin-visible domain data anyway.

- Delivery is at-least-once → every consumer is idempotent by construction
  (DB unique constraints: notice source-ID+version, (org,lot,engine_version)
  matches, (org,digest_date) digests, billing-provider event IDs).
- Bounded: batch ≤ configured cap, max retries small, DLQ per queue,
  emergency pause flags checked by every consumer.
- A stale-ingestion watchdog cron alerts when no successful run lands within
  the expected interval — replacing Workflows' built-in observability with
  an explicit, admin-visible mechanism.

## Consequences

- We own checkpoint correctness (tested explicitly: checkpoint advances only
  on full-window success) instead of leaning on per-step replay.
- Cost stays inside the $5/mo included 1M queue ops (~3 ops/message →
  ~300k delivered messages/mo headroom, far above projected volume).
- If orchestration complexity materially grows (multi-day waits, human
  approval steps), revisit with a superseding ADR.

## Alternatives considered

- Workflows: elegant step retries, but new per-step billing, less queryable
  run state, and our pipelines are 1–2 steps deep.
- Durable Objects alarms: more machinery for the same cron semantics.
- In-request processing: violates the "background work never blocks
  interactive requests" rule.
