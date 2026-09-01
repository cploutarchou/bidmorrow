# Operational Runbook

Day-to-day operations and incident diagnosis. **Status: Phase 0/1 — the
systems referenced (admin health page, run tables, pause flags) are designed
but not built.** Each procedure is the definitive one, validated when the
feature ships (admin/ops surface is Phase 10; production ops from Phase 13).
Security incidents and SEV classification: docs/incident-response.md.

## Daily health checklist [validate: Phase 10]

Open the admin health page (INTERNAL_ADMIN) and confirm:

- [ ] Last ingestion run: status `success`, within last 24 h, notice counts
      plausible vs the 150–300/day projection.
- [ ] `ingestion_errors`: no new unreviewed rows.
- [ ] Last digest batch: all due orgs processed; `email_deliveries` failure
      rate < 2%.
- [ ] Queue depth ~0 between runs; **DLQ count = 0** for all three DLQs.
- [ ] D1 size vs 10 GB limit — below the 60% alert line.
- [ ] Paddle webhook: no unprocessed/failed events (Paddle dashboard →
      Developer tools → Notifications → destination → Logs).
- [ ] Retention purge ran and recorded counts.
- [ ] Pause flags (`ingestion_paused`, `digest_paused`) and
      `fetch_retry_attempts_suspended` are OFF unless deliberately set — a
      forgotten pause or suspension is itself an incident.

## Emergency pause / unpause

Feature flags in the config table, togglable from the admin UI (or direct
D1 update via `wrangler d1 execute` in a pinch). Every toggle writes an
audit_events row.

- `ingestion_paused = true` — cron still fires but enqueues nothing; safe
  at any time; customer app unaffected.
- `digest_paused = true` — digest generation/sending stops; digests are
  **skipped, not queued up** — a missed day is not retro-sent (dedupe on
  (org, digest_date) makes accidental double-sends impossible on resume).

Use pauses first whenever a pipeline misbehaves: stopping the bleeding is
always safe; both pipelines resume idempotently.

### `fetch_retry_attempts_suspended` — confirmed upstream render outage

A third operator flag, narrower than the pauses (ADR-0010 §5.2). Set it to
`true` ONLY when a TED-side outage is confirmed — the signal is sustained
`RENDER_PENDING_DEGRADED` alerts, i.e. notices failing solely because TED
never renders their XML, not because of anything per-notice.

While set:

- the hourly standalone drain (`40 * * * *`, ADR-0008 §A5) stands down
  entirely — each hour's message logs `ingestion.fetch_retry_drain.skipped`
  with `reason: attempts_suspended` and is acked;
- the daily in-run `drainFetchRetries` pulls only 3 due rows instead of 25
  (the drain becomes a recovery probe — bounded at 18 requests/day), and
- does **not** increment `attempts` on render-pending outcomes, so the
  6-attempt abandonment clock (1/4/16/64/256 h ladder, ≈ 14 days reach)
  stops. Both `attempts` and `next_attempt_at` are left untouched, so those
  rows stay due and keep being re-probed.
- Genuine HTTP/network failures still burn attempts — those are per-notice
  evidence whether or not an outage is running.

Why it exists: without it, a multi-day upstream outage silently abandons
real procurement records for a failure that was never theirs. Clearing the
flag restores full drain behavior with nothing lost.

**Leaving it on is its own incident** — the retry backlog stops draining
while it is set. Check it alongside the pause flags in the daily review, and
clear it as soon as the render canary (`ted-render-canary` workflow) reports
RENDERED again.

## Common incidents

### Ingestion stale or failing

Symptoms: watchdog cron flags no successful run in >36 h, or health page red.

1. Check `ingestion_runs` — last row status: `running` too long (stuck),
   `failed` (see error), or absent (cron/enqueue problem).
2. Check `ingestion_errors` for the failing window: parse errors (new eForms
   schema variant?) vs HTTP errors (TED down/changed?).
3. Check TED status: is api.ted.europa.eu responding? (curl the search
   endpoint with the standard scoped query.)
4. Check `ingestion_paused` — was it left on?
5. Remediation: parse errors → capture the offending notice ID + snapshot,
   file a fixture, fix parser (malformed notices must be surfaced, never
   silently skipped). TED outage → see below, no action needed. Stuck run →
   inspect DLQ, then re-trigger; the checkpoint guarantees no window is
   skipped and idempotent writes make re-runs safe.

### Digest failures

1. `digest_runs` for the date: which orgs failed, at generation or send?
2. `email_deliveries`: provider errors (4xx = our payload/key, 5xx/timeouts
   = Resend side). Check Resend status page + dashboard logs.
3. Dedupe conflicts (unique (org, digest_date) violation) mean a retry hit
   an already-sent digest — that is the idempotency working; not an error
   to "fix", but investigate why the first attempt was retried.
4. Remediation: Resend outage → let bounded retries run; auth/key errors →
   rotate/verify `RESEND_API_KEY`; systematic template failure →
   `digest_paused = true`, fix, unpause (missed day is skipped by design).

### Queue backlog / DLQ growth

1. Which queue? Ingest/match/digest have different consumers.
2. Backlog with consumer errors → read the error in logs (`wrangler tail
--env production`); a poison message will retry to max then DLQ.
3. DLQ > 0: inspect messages, fix root cause, re-enqueue from DLQ (admin
   tool, Phase 10) — consumers are idempotent so replay is safe.
4. Backlog without errors → throughput; check for an unbounded enqueue
   (backfill without budget?) — pause the producing pipeline if so.

### Paddle webhook failures

Distinguish the two failure classes:

- **Signature errors** (400 at our endpoint): wrong `PADDLE_WEBHOOK_SECRET`
  (each notification destination has its own `pdl_ntfset_…` secret —
  sandbox vs live mixup, or the destination was recreated) or wrong
  destination URL (`/api/webhooks/paddle`). Fix via the GitHub environment
  secret + redeploy, or `wrangler secret put PADDLE_WEBHOOK_SECRET --env
production`. A clock more than 5 minutes off also 400s (tolerance).
- **Processing errors** (our handler 5xx): check logs by `billing_event_id`;
  state is re-fetched from Paddle so ordering issues shouldn't occur — a
  repeated failure is a code bug or an unknown price id
  (`billing.webhook.unknown_price_id` → `PADDLE_PRICE_*` misconfigured).
  Paddle retries non-2xx (sandbox: 3 attempts/~15 min; live: 60 attempts
  over ~3 days). Remediation: after the fix, **replay from the Paddle
  dashboard** (Developer tools → Notifications → destination → Logs →
  Replay). Event-ID idempotency makes replays safe. Meanwhile entitlement
  drift is possible — reconcile affected orgs against Paddle subscription
  state (admin tool, Phase 10).

**`billing.webhook.duplicate_checkout_reconciled` in the logs** means an
organization completed two concurrent checkouts; the processor cancelled
the second Paddle subscription immediately, but Paddle does NOT refund it
automatically. Action: open the duplicate subscription's transaction in
the Paddle dashboard and issue a full refund (sandbox auto-approves;
live refunds may need Paddle approval). Later `subscription.updated`/
`canceled` events for that duplicate are acknowledged as
`duplicate_reconciled` without further calls.

### D1 size approaching limit (60% alert)

1. Verify the retention purge job is actually running and pruning (counts
   in its run rows) — a silently dead purge is the most likely cause.
2. Check table sizes: match/component tables dominate by design; compare
   against the cost-model projection.
3. Levers, in order: fix/re-run purge → tighten `RETENTION_DAYS` → review
   ingestion scope (docs/ted-ingestion-scope.md — country filter, CPV trim)
   → compact component rows to JSON column (recorded option in data-model).
4. Never let it hit 10 GB: writes fail at the limit.

### Rate-limit complaints

1. Identify the endpoint + limiter (native binding vs Better Auth limiter).
2. Legitimate user pattern (e.g. fast pagination)? → adjust that binding's
   limit/period in wrangler.jsonc, deploy.
3. Abuse? → keep limits, consider tightening; check audit/product events
   for the source; note per-colo best-effort semantics — limits are
   approximate, not exact counters.

### TED outage

No customer-facing action required — login/dashboard/digests of existing
data are unaffected (ingestion is fully async). Ingestion runs fail and are
recorded; when TED returns, the next run **resumes from the checkpoint** and
catches up window by window within its budget (multi-day outages may take
several runs). Only communicate to customers if data staleness exceeds ~48 h
("data current as of" is shown in-app).
