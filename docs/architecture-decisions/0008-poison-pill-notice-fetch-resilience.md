# ADR-0008: Poison-pill notice resilience (record-and-continue for per-notice fetch failures)

Status: Proposed (2026-08-18) — spec only; implementation not yet scheduled.

## Context

`runIngestionWindow` (packages/procurement/src/run-window.ts) treats failures
asymmetrically:

- Per-notice **parse** failures (`TedParseError`) and **oversized XML**
  (`TedXmlTooLargeError`) are recorded in `ingestion_errors`, the notice is
  skipped, and the window finishes `partial`. The checkpoint advances.
- Per-notice **XML fetch** failures (`TedRequestError` from
  `fetchNoticeXml` — an HTTP error surviving the client's 1+4 retries, a
  network-level failure, or TED's observed "HTTP 200 with empty body"
  refusal) are **window-fatal**: the run finishes `failed`, the checkpoint
  is held, and the identical window is retried in full the next day.

Window-fatality was deliberate: a _systemic_ fetch problem (TED rate-limiting
or blocking our client, a TED outage) must not advance the checkpoint past a
whole day of unfetched notices — `partial` there would silently drop the day.
But the same rule makes ONE persistently-unfetchable notice a **poison
pill**: every daily retry of the window re-fails on that notice, and that
publication day is blocked forever. On 2026-08-18 the first non-empty
staging window (1 notice) failed exactly this way; with N notices the blast
radius is the whole day, indefinitely.

PR #46 (merged) already gives window failures a durable `ingestion_errors`
diagnostic row with stable machine codes: `NOTICE_FETCH_HTTP_<status>`,
`NOTICE_FETCH_NETWORK_ERROR`, `SEARCH_FETCH_*`, `REQUEST_BUDGET_EXCEEDED`,
`UNEXPECTED_WINDOW_ERROR`. This ADR builds on those codes; it does not
change them.

Constraints in force: checkpoint advance-only (packages/db
`advanceCheckpoint`), idempotent persistence, TED politeness (spacing,
backoff, per-run request budget), fixed infra < $100/month (target $5–30,
docs/cost-model.md), D1 10 GB cap with ≥40% 12-month headroom (ADR-0003;
verified 2026-08-14). Volume: measured single digits/day in current staging
scope; 150–300 notices/day planning ceiling (docs/ted-ingestion-scope.md).
No new external API surface is introduced, so no fresh docs verification is
required beyond what ADR-0003/0005/0006 and docs/ted-data-source.md already
record.

## Decision

### 1. Per-notice fetch failures become record-and-continue

In `processOneNotice`, a `TedRequestError` thrown by
`client.fetchNoticeXml(row.xmlUrl)` is handled like a parse failure:

- one `ingestion_errors` row via `recordError` — stage `fetch`,
  `sourceNoticeId` set, **reusing the PR #46 machine codes**
  `NOTICE_FETCH_HTTP_<status>` / `NOTICE_FETCH_NETWORK_ERROR`, `detail`
  carrying `{url, status, attempts}` (values truncated via
  `truncateForDiagnostic`, as today);
- `counts.errorsCount` and a new `noticesFetchFailed` counter increment;
- the notice is skipped; the window continues and finishes `partial`.

The catch is `instanceof TedRequestError` **only**. `TedBudgetExceededError`
(which can surface through `fetchNoticeXml`) is not a `TedRequestError` and
must keep propagating to the window-level handler (§4). Search-page fetch
failures (`SEARCH_FETCH_*`, thrown while no notice is in flight) remain
window-fatal: they are positional — a page we cannot enumerate cannot be
"skipped per notice".

### 2. Systemic-failure threshold — record-and-continue is bounded

The original protection ("TED blocking us must not advance the checkpoint
past a day of unfetched notices") is preserved by a threshold: the window
FAILS (checkpoint held, run status `failed`) when fetch failures look
systemic rather than notice-specific.

- **Rule, evaluated after each notice**: if
  `noticesFetchFailed >= FETCH_FAILURE_FAIL_MIN` **and**
  `noticesFetchFailed / noticesSeen > FETCH_FAILURE_FAIL_RATIO`, abort the
  window immediately by throwing an internal `FetchFailureThresholdError`,
  which the existing window-level catch maps to a durable diagnostic with a
  new stable code `FETCH_FAILURE_THRESHOLD_EXCEEDED` (stage `fetch`,
  `detail: {noticesFetchFailed, noticesSeen, ratio, min, maxRatio}`).
- **Defaults**: `FETCH_FAILURE_FAIL_MIN = 5`,
  `FETCH_FAILURE_FAIL_RATIO = 0.2`. Rationale: the absolute floor of 5 means
  a 1–4-notice window (the 2026-08-18 staging case) can never threshold-fail
  on a single poison pill — worst case 4 notices are skipped into the retry
  mechanism (§3), a bounded loss. At the 150–300/day planning ceiling, 20%
  is 30–60 failed fetches — unambiguously systemic, and each failure already
  cost up to 5 HTTP attempts, so aborting early also protects the request
  budget and TED politeness (we stop hammering an origin that is refusing
  us).
- **Location: code constants** (exported from
  packages/procurement/src/run-window.ts), not a `feature_flags` entry. The
  `ingestion_cpv_scope` precedent covers levers an operator must move at
  runtime; this threshold is a correctness parameter we expect never to tune
  in production, and the runtime emergency lever already exists
  (`ingestion_paused`). A flag would add a parse/validation path and admin
  surface for no operational need. If real incidents show the values need
  live tuning, promote to a flag in a superseding ADR.

### 3. Retry story for skipped notices: a bounded `ingestion_fetch_retries` table

Because the checkpoint advances past a `partial` window, a skipped notice
would otherwise never be retried — and the existing admin backfill cannot
help, since backfilling a window at-or-behind the checkpoint violates the
advance-only rule by design (apps/worker/src/ingestion.ts). Decision:
**option (b), a fetch-retry table**, drained inside the daily ingestion run.

- **New table `ingestion_fetch_retries`** (global operational metadata, no
  `organization_id`, single-writer like the other §5 tables):
  `{id, source, source_notice_id (unique with source), xml_url,
publication_date, attempts, next_attempt_at, last_error_code,
status ('pending'|'recovered'|'abandoned'), created_at, updated_at}`.
  A row is inserted (idempotently, on the unique key) whenever §1 skips a
  notice.
- **Drain**: the daily ingestion cron, in the same run as the window (same
  `TedClient` instance → shared budget, spacing, backoff), processes up to
  `FETCH_RETRY_MAX_PER_RUN = 25` due rows (`next_attempt_at <= now`,
  oldest first) through the **identical `processOneNotice` path**
  (idempotent upserts; recovered lots are enqueued to `MATCH_QUEUE` like any
  new lots). Success → `recovered`. Failure → `attempts += 1`,
  `next_attempt_at = now + attempts days` (linear daily backoff).
- **Give-up**: after `FETCH_RETRY_MAX_ATTEMPTS = 5` failed re-attempts
  (≈ two weeks of coverage with the backoff), the row becomes `abandoned`
  and one durable `ingestion_errors` row with new stable code
  `NOTICE_FETCH_ABANDONED` is written (referencing the retry row's history in
  `detail`). Abandonment is an alerting event (§5), never silent.
- **Checkpoints are untouched** by retry processing — retries are
  by-notice, not by-window.
- **Cost/size**: rows exist only for failures. Pessimistic 1% failure rate
  at the 300/day ceiling = 3 rows/day × ~300 bytes ≈ **0.33 MB/year**
  worst case before cleanup (terminal rows purged by the existing retention
  job after 90 days → steady state a few KB) — negligible against the 10 GB
  D1 cap and the ADR-0003 headroom rule. TED traffic: ≤25 extra requests/day,
  inside the existing per-run budget; $0 marginal infra. Rejected
  alternative (a) — re-querying a recent N-day look-back for notices absent
  from `tender_notices` — costs ~5–9 extra search pages _every day forever_
  at ceiling volume, and cannot distinguish "absent because parse-failed"
  (already terminal in `ingestion_errors`) from "absent because
  fetch-skipped" without exactly the bookkeeping this table provides.
  Rejected alternative (c) — manual backfill as the only path — is not
  actually available behind the checkpoint (advance-only), so it would mean
  "skipped = lost unless an operator hand-crafts a recovery"; incompatible
  with a paying-customer coverage promise.
- cost-audit note: no new platform service or dependency; deltas are within
  existing line items. docs/cost-model.md gets the 0.33 MB/12-month and
  ≤25 req/day figures at implementation time (this ADR is spec-only and
  edits no other file).

### 4. Budget exhaustion stays window-fatal

`TedBudgetExceededError` (`REQUEST_BUDGET_EXCEEDED`) remains window-fatal
with the checkpoint held, regardless of where in the window it surfaces. It
is **positional, not notice-specific**: the budget dying on notice k says
nothing about notice k, and "skipping" it would skip every remaining notice
in the window. Same reasoning keeps `SEARCH_FETCH_*` and
`UNEXPECTED_WINDOW_ERROR` window-fatal (§1).

### 5. Observability and alerting hooks

To let stale-ingestion detection distinguish "healthy partial" from
"systemically degraded":

- **New `ingestion_runs` column** `notices_fetch_failed` (integer, default
  0; trivial migration) alongside the existing counters, populated by §1.
  Also derivable from `ingestion_errors` by the `NOTICE_FETCH_` code prefix,
  but a run-level counter makes watchdog and admin queries one indexed read.
- **Log lines** (structured, counts/metadata only, never bodies):
  `ingestion.notice_fetch.skipped` (warn: source_notice_id, error_code,
  attempts), `ingestion.window.fetch_failure_threshold` (error: the §2
  detail), `ingestion.fetch_retry.attempt` / `.recovered` / `.abandoned`
  (info/info/error: source_notice_id, attempts).
- **Watchdog cron** (ADR-0006) additionally alerts on: (i) any
  `FETCH_FAILURE_THRESHOLD_EXCEEDED` or `NOTICE_FETCH_ABANDONED` in the last
  24 h; (ii) pending retry backlog > 50 rows; (iii) 3+ consecutive runs with
  `notices_fetch_failed > 0`. Healthy partial = isolated skips, draining
  backlog, zero abandonments; degraded = any of (i)–(iii).
- Admin ingestion views surface `notices_fetch_failed` and the retry table
  (read-only list + counts) via the existing admin routes pattern.

### 6. Out of scope

No changes to: checkpoint advance-only semantics; persistence idempotency;
TED politeness (spacing, backoff, retry counts, per-run budget,
`TED_USER_AGENT`); the PR #46 durable window-failure diagnostics or their
machine codes; parse-failure and oversized-XML handling; ADR-0003 scope or
retention rules.

## Consequences

Positive:

- One unfetchable notice can no longer block a publication day forever; the
  blast radius of a poison pill is exactly one notice, with 5 bounded
  re-attempts and a durable, alertable abandonment record.
- The systemic-failure protection survives, and improves: threshold aborts
  stop hammering a refusing origin earlier than today's full-window retry
  loop, saving budget and politeness.
- Every skip, retry, recovery, and abandonment is queryable from D1
  (`ingestion_errors` + `ingestion_fetch_retries` + run counters) — no
  live-log archaeology, consistent with the PR #46 direction.
- ~$0 marginal cost; D1 growth ≈0.33 MB/year worst case.

Negative:

- A `partial` window now also means "some notices may arrive days late (or
  never, if abandoned)" — the coverage-methodology disclosure (ADR-0003)
  must mention late arrival and abandonment.
- Two new stable error codes, one new table, one new run column, and
  threshold/retry constants to test: checkpoint-hold on threshold breach,
  budget-error passthrough in the per-notice catch, retry idempotency, and
  give-up behavior all need explicit tests.
- Threshold constants are judgment values until Phase 5 volume measurement;
  they are code constants, so tuning requires a deploy (accepted trade-off,
  §2).

## Alternatives considered

- **Status quo** (fetch failures window-fatal): one poison pill blocks a day
  of ingestion indefinitely — the 2026-08-18 incident generalized. Rejected.
- **Unlimited skip-and-continue, no threshold**: a TED block/outage would
  advance the checkpoint past an entire day marked `partial`, silently
  degrading into "skip everything" with only the retry table (capped at 25
  attempts/day) standing between us and permanent data loss. Rejected — the
  systemic case must hold the checkpoint.
- **Look-back re-query of recent N days** (option a): pays ~5–9 search
  pages/day forever at ceiling volume, retries parse-terminal notices
  pointlessly, and has no per-notice attempt accounting. Rejected on cost
  and precision.
- **Manual backfill as the only re-attempt path** (option c): unavailable
  behind the checkpoint under the advance-only rule; silent-loss risk.
  Rejected.
- **Cloudflare Queue with per-message retries/DLQ instead of a table**:
  queue delivery retries operate on minutes-scale, not the days-scale
  backoff a TED-side failure needs; a D1 table is queryable by admin/watchdog
  and already the established durability pattern (ADR-0006). Rejected.
- **Threshold in `feature_flags`**: runtime tunability we do not need, plus
  a validation path and admin surface; `ingestion_paused` already covers the
  emergency case. Rejected for now (promotable later by superseding ADR).
