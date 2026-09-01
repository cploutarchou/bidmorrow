# ADR-0008: Poison-pill notice resilience (record-and-continue for per-notice fetch failures)

Status: Accepted (2026-08-19) — implementation authorized by owner. Amended
2026-08-19 (render-pending exhaustion joins record-and-continue — see the
dated Amendment section at the end). Originally Proposed 2026-08-18 as spec
only. **Partially superseded by ADR-0009 (2026-08-20)**: render-pending
exhaustions no longer count toward the §2 systemic threshold (Amendment
§A1's counting rule is replaced), and Amendment §A2's "skip the drain
whenever catch-up ended `failed`" rule is replaced by cause-classified
skipping. First-production-run evidence (2026-08-20: 0/156 renders
completed, window threshold-failed on 32 render-pending skips, 32 retry
rows permanently undrainable) falsified both. All other decisions stand.

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

_Amended 2026-08-19: render-pending exhaustion (`TedRenderPendingError`
after `MAX_RENDER_VISITS`) joins this record-and-continue path — see
Amendment §A1._

### 2. Systemic-failure threshold — record-and-continue is bounded

> _Superseded in part by ADR-0009 §1 (2026-08-20): this threshold now
> applies to genuine fetch failures (`NOTICE_FETCH_HTTP_*` /
> `NOTICE_FETCH_NETWORK_ERROR`) ONLY. Render-pending exhaustions (folded
> in by Amendment §A1) are tracked in their own counter with no fail
> ceiling and a distinct alert signal._

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
  edits no other file). _Amended 2026-08-19: a drain attempt is now a full
  render-visit cycle, so the request delta rises to ≤150 req/day worst case
  (25 rows × 6 visits) — see Amendment §A2; docs/cost-model.md updated with
  both figures as part of the amendment._

_Amended 2026-08-19: drain attempts get in-run render-visit cycling
(trigger + collect, same `MAX_RENDER_VISITS` budget) instead of a single
fetch — see Amendment §A2. Table shape, backoff, give-up, and abandonment
semantics are unchanged._

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

---

## Amendment (2026-08-19): render-pending exhaustion joins record-and-continue

This amendment **extends §1** (a second trigger class for record-and-
continue) and **§3** (the shape of a drain attempt, and its request delta),
and re-checks §2's arithmetic under the extension. It contradicts no
recorded decision: §4's window-fatal set, §2's constants, and §3's table
shape, backoff, give-up, and abandonment semantics are unchanged.

### New evidence (post-dating the original spec)

- TED's anonymous notice-XML front-end renders **asynchronously**
  (docs/ted-data-source.md, verified 2026-08-18): a GET answers HTTP 202 +
  empty body while queueing a server-side render; render latency can exceed
  several minutes; the resulting cache is short-lived (~4 min observed).
  PR #51 added `TedRenderPendingError` + requeue-cycling
  (`MAX_RENDER_VISITS = 4`, `RENDER_RETRY_DELAY_MS = 20s`) and explicitly
  reserved exhaustion semantics for this ADR ("never skip-and-advance;
  ADR-0008 owns any future record-and-continue").
- **2026-08-19 05:00 UTC staging run** (`ingestion_runs.started_at`
  1787115645955, window 2026-08-17): 156 notices seen, all renders
  triggered on pass 1, requeue cycling ran ~4 minutes. With a full queue
  and no render yet complete, every pass stays full-length (~80–120 s at
  156 notices × ≥500 ms spacing), so the first-queued notice
  (**566510-2026**) reached its 4th visit ≈ 4 minutes after its trigger —
  below TED's observed render latency — threw `TedRenderPendingError`
  exhaustion, and the window went fatal: **0 of 156 notices landed**,
  checkpoint held. This is the poison pill of the Context section
  generalized, with render-pending rather than `TedRequestError` as the
  trigger. One slow render must not cost the other 155 notices their day.

### A1. Render-pending exhaustion is a §1 fetch failure

> _Superseded in part by ADR-0009 §1 (2026-08-20): the skip itself
> (diagnostic row, retry row, drop-and-continue) stands, but the
> `noticesFetchFailed` increment — and therefore participation in the §2
> threshold and the `notices_fetch_failed` column — is replaced by a
> dedicated `noticesRenderPending` counter/column. The 2026-08-20 run
> proved a slow-render day threshold-fails as a false "TED is blocking
> us"._

A notice that exhausts `MAX_RENDER_VISITS` is skipped exactly like a §1
fetch failure. Handling lives at the Phase-2 requeue site in
`runIngestionWindow` (the catch site differs from §1's
`processOneNotice` catch, but the handling is identical):

- one `ingestion_errors` row via `recordError` — stage `fetch`, the
  **existing** stable code `NOTICE_RENDER_PENDING` (introduced by PR #51
  for the window-fatal diagnostic; reused unchanged), `sourceNoticeId` set,
  `detail: {url, status, visits}` (values via `truncateForDiagnostic`);
- `counts.errorsCount` and §1's `noticesFetchFailed` increment — so
  exhaustions count toward the §2 systemic threshold and the §5
  `notices_fetch_failed` run column;
- one idempotent `ingestion_fetch_retries` row with
  `last_error_code = 'NOTICE_RENDER_PENDING'` — **no schema change**; §3's
  table shape already fits (the column is an opaque code string);
- the notice is dropped from the work queue; the window continues and
  finishes `partial`.

Pre-exhaustion cycling is unchanged, and `describeWindowFailure`'s
`NOTICE_RENDER_PENDING` branch stays as defense-in-depth for any
`TedRenderPendingError` that escapes outside the cycling loop. Rationale:
render-pending exhaustion is notice-specific **by construction** — the
other 155 notices on the same origin and day differ only in render state,
so §1's asymmetry argument applies verbatim. A day where renders are
broadly slow is the systemic case and threshold-fails instead (A4); both
outcomes strictly dominate today's first-exhaustion-kills-all behavior.

### A2. Drain attempts are full render-visit cycles, not single fetches

A §3 drain attempt is a fresh GET against an async front-end with a ~4-min
cache and multi-minute render latency — a **single** attempt is therefore
deterministically a trigger-only 202: five single-fetch drains would burn
all `FETCH_RETRY_MAX_ATTEMPTS` and convert every render-pending skip into
a guaranteed `NOTICE_FETCH_ABANDONED`. Decision: drain rows get the same
in-run revisit budget as window notices.

- The drain's ≤ `FETCH_RETRY_MAX_PER_RUN = 25` due rows form their own
  requeue-cycling mini-queue: same `TedClient` instance (shared budget,
  spacing, backoff — §3 unchanged), same `MAX_RENDER_VISITS` per row, same
  `RENDER_RETRY_DELAY_MS` floor, identical `processOneNotice` path.
- One §3 `attempts` increment per **cycle**, not per visit: success →
  `recovered`; exhaustion within the cycle → `attempts += 1` and the
  existing linear daily backoff. No `ingestion_errors` row until
  `NOTICE_FETCH_ABANDONED` (§3 unchanged). Drain outcomes never feed the
  §2 threshold — that threshold is defined over a window's `noticesSeen`,
  and drain rows are windowless by design.
- **Ordering/skip rules** _(skip condition superseded by ADR-0009 §2,
  2026-08-20: skipping on ANY `failed` catch-up deadlocked with A1 — a
  daily-failing window made the retry rows permanently undrainable; the
  drain now skips only for systemic/budget failure codes)_: the drain runs
  after the catch-up loop in the same invocation, and is skipped when the
  catch-up ended `failed` or ingestion is paused — an origin that just
  failed a window systemically should not be hammered further (budget +
  politeness).
  `TedBudgetExceededError` during the drain terminates the drain only
  (logged; rows remain due tomorrow) — no window is in flight, so nothing
  is window-fatal.
- **Cost**: worst case 25 × 6 = **150 requests/run** (7.5% of
  `MAX_REQUESTS_PER_RUN = 2000`) and ≈ 2–3 min wall clock (25-row passes
  ≈ 12.5 s, so the 20 s delay floor dominates: ~5 delay-bound passes).
  Even a 3-window ceiling catch-up plus a full drain fits the budget
  (see A3). Supersedes the original §3 "≤25 extra requests/day" figure,
  which assumed one request per attempt.
- **Honest limit**: cycling at the 20 s floor collects renders completing
  within ~100 s of the drain's trigger. A notice whose render reliably
  exceeds that exhausts each drain day and is abandoned after 5 days with
  the §3 alert — the correct, loud outcome for a notice TED's front-end
  effectively will not serve.

### A3. Patience bump: `MAX_RENDER_VISITS` 4 → 6

With a full queue, a notice's visits are spaced by whole passes, so its
trigger-to-last-visit horizon ≈ (visits − 1) × pass length. The 2026-08-19
run proves 4 visits ≈ 4 min is insufficient for at least one real notice;
6 visits extends the full-queue horizon to **~8–10 min at current volume
(156/day)** — above every render latency observed so far — and gives the
short-queue tail (20 s floor) two extra collection chances.

Budget math — worst case is the all-202 systemic day, where notices march
through visits in lockstep, exhaustions first land in pass `V`, and the A4
threshold aborts at the 32nd:

- **156 notices (current measured)**: 156 × 5 + 32 ≈ **812 fetches**
  (+ ~2 search pages) — 41% of the 2,000 budget; wall clock ≈ 5 full
  passes + 32 fetches ≈ **7.5–10.5 min**, inside the 15-min cron/queue
  invocation ceiling (docs/dependency-versions.md, verified 2026-08-14)
  with margin.
- **300/day planning ceiling**: 300 × 5 + 61 ≈ 1,561 fetches < 2,000;
  wall clock 12.5–20 min — the 15-min ceiling can kill the invocation
  before the threshold diagnostic writes. The checkpoint is **held either
  way** (an unfinished run never advances it) and the ADR-0006 watchdog's
  stale-run detection covers the observability gap.
- **Happy path unchanged** at 2 visits/notice: ~314 requests at 156,
  ~604 at ceiling; a 3-window ceiling catch-up + full drain ≈
  3 × 604 + 150 + search ≈ 1,962 < 2,000.
- **Why not higher**: `MAX_RENDER_VISITS = 8` pushes the current-volume
  systemic abort to ~1,124 requests and ~12–14 min — no wall-clock margin
  at today's measured volume — to buy ~3 min of extra same-day horizon
  that the A2 drain's cross-day re-attempts already provide more cheaply.
  Patience competes with the whole window for wall clock; bounded patience
  - skip + drain is the design, not unbounded patience.

Remains a code constant; §2's location rationale applies unchanged.

**Verification resolved (2026-08-19, coordinator, via the official
Cloudflare docs MCP)**: the recalled 1,000-subrequest cap is STALE — since
2026-02-11 Workers Paid defaults to **10,000 subrequests per invocation**
(configurable up to 10M via `limits.subrequests`), and subrequests to
internal services (D1/R2/KV) now match the configured limit as well
(changelog 2026-02-11; workers/platform/limits). V = 6's numbers therefore
clear the platform bound with an order of magnitude of headroom, and the
binding constraints are exactly the ones A3 designed against: the 15-min
invocation wall clock and our own `MAX_REQUESTS_PER_RUN` politeness
budget. The same fact defuses the latent D1-calls concern noted at
amendment time (a fully successful 156-notice window's ~1,000–1,250 D1
calls sits far below 10,000). Recorded in docs/dependency-versions.md.

### A4. §2 threshold arithmetic re-checked with render-pending counting

> _Superseded by ADR-0009 §1 (2026-08-20): render-pending no longer
> counts toward the §2 threshold, so this section's all-202 arithmetic no
> longer describes production behavior (an all-202 day now finishes
> `partial` with a `RENDER_PENDING_DEGRADED` alert instead of
> threshold-failing). Kept for the historical record: the 2026-08-20 run
> matched this math exactly — abort at the 32nd exhaustion at 156 seen —
> which is precisely what proved the model wrong._

At 156 notices, `FETCH_FAILURE_FAIL_MIN = 5` and
`FETCH_FAILURE_FAIL_RATIO = 0.2` trip at the **32nd** fetch failure
(32 ≥ 5, 32/156 ≈ 20.5% > 20%). An all-notices-202 day (a TED render
outage) reaches 32 exhaustions early in pass 6 →
`FETCH_FAILURE_THRESHOLD_EXCEEDED`, run `failed`, **checkpoint held** —
exactly the systemic protection §2 exists for, at ~812 requests (vs ~469
for today's first-exhaustion fatality; the extra ~340 requests are the
price of distinguishing one slow render from an outage). Small windows:
5–24 notices all-202 trip both floor and ratio at the 5th exhaustion →
`failed`; ≤4 notices can never threshold-fail (the floor) → at most 4 rows
into the drain, a bounded loss — §2's floor rationale, unchanged. Mixed
days (render exhaustions + `TedRequestError`s) share the one
`noticesFetchFailed` counter, so combined systemic signal is seen.
**Confirmed: no constant changes needed.**

### A5. (2026-09-01) The drain runs hourly on its own trigger; first retry +20 min; hourly-geometric backoff; 6 attempts

**Status: accepted and implemented 2026-09-01 (post-launch incident #1).**
Supersedes, within §3/§A2 and ADR-0009 §2: the once-daily in-run drain as
the ONLY drain, the `next_attempt_at = now()` same-run second cycle, the
linear daily backoff, and the 5-attempt give-up count. Everything else in
§3 — table shape, `processOneNotice` path, windowless rows, abandonment
diagnostic + alert, the ADR-0010 §5.2 suspension posture — is unchanged.

#### Evidence (go-live + 1)

- **2026-09-01 05:00 UTC window, both environments:** 150 of 151 notices
  came back `NOTICE_RENDER_PENDING` after the full 6-visit cycle — on
  staging AND production, identically. Identical counts on two
  independent egress paths mean this is TED's morning render posture, not
  an environment fault. Production's first live weekday therefore produced
  an **empty feed**: every notice sat in `ingestion_fetch_retries`.
- **The same-run second cycle was a guaranteed miss.** With
  `next_attempt_at = now()` (ADR-0009 §2), the in-run drain re-cycled 25 of
  those rows ~8 minutes after their first exhaustion. TED's front-end cache
  window is ~2–4 min (ADR-0010 §2) and the render latency observed is
  hours, so that second cycle spent one of each row's five attempts on a
  certainty, then pushed them a full day out (`+1 day`, linear backoff):
  production's 150 rows became due 2026-09-02 05:09.
- **The queue never converged.** Inflow on a render-slow weekday is ~150
  rows/window; the drain cleared ≤25 rows/day. Staging, which had been
  ingesting since 08-17, was carrying **1,069 pending rows, 869 of them
  never attempted, the oldest 11 days old**. A queue that grows six times
  faster than it drains is not a backlog, it is a leak — and the "≥7
  calendar days to drain a fully-skipped day" caveat ADR-0009 §3 recorded
  was the optimistic case (one such day, no further inflow).

#### Decisions

1. **Hourly standalone drain.** New cron `40 * * * *` (5th trigger of the
   250/account Paid-plan limit, verified Cloudflare docs 2026-09-01)
   enqueues `{kind:'drain_fetch_retries'}` on `INGEST_QUEUE` (ADR-0006:
   crons enqueue, consumers run). Consumer `runFetchRetryDrainJob`
   (apps/worker/src/ingestion.ts) builds its own `TedClient` (same 2,000
   request budget and 500 ms spacing as the catch-up) and calls the SAME
   `drainFetchRetries` with `limit: FETCH_RETRY_STANDALONE_MAX_PER_RUN = 50`;
   recovered lots go to `MATCH_QUEUE` in the usual ≤100-id `score` batches.
   `:40` is 20 minutes after the 05:00 window's skips become due (below)
   and a minute no other trigger uses.
   **Stand-down rules** (result `skipped`, message acked — next hour is
   the retry): `ingestion_paused` (the emergency stop covers every
   TED-touching path); `fetch_retry_attempts_suspended` (during a confirmed
   outage the daily in-run drain is already the ADR-0010 §5.2 canary at
   ≤18 requests/day — an hourly probe would be 24× the traffic for no new
   information); and **an ingestion run live within 15 minutes**
   (`hasActiveIngestionRun`, new repository read over
   `idx_ingestion_runs__source_started_at`). `INGEST_QUEUE` declares no
   `max_concurrency`, so consumers may run concurrently; without the guard
   two `TedClient`s would hit TED at once with unshared spacing/budget and
   two drains could pull the same rows. The 15-minute horizon equals the
   Queues consumer wall-clock limit, so an orphaned `running` row (consumer
   killed before `finishRun`) can block at most one hour, never forever.
   The guard is check-then-act, not a lock: a millisecond race is possible
   and harmless — the rows' own `status = 'pending'` transitions make the
   loser throw on `markFetchRetryRecovered`, the message retries (bounded,
   DLQ'd, recorded — F-07), and the drain's own orphaned run row ages out.
2. **First retry is `FETCH_RETRY_FIRST_DELAY_MS = 20 min` after the skip**,
   not immediate (packages/procurement/src/run-window.ts
   `writeSkipDiagnostic`). The same invocation's in-run drain therefore no
   longer re-cycles what the window just exhausted; the next hourly drain
   does, once TED has had time to render. ADR-0009 §2's "25 notices/day get
   a same-day second cycle" is withdrawn — the same-day cycle now happens
   at +20 min to +80 min, for ALL of them, without spending an attempt on
   a cache-window certainty.
3. **Hourly-geometric backoff, 6 attempts.** `recordFetchRetryFailure`
   now schedules `1 h × 4^(n−1)` after the n-th failed cycle — **1 h, 4 h,
   16 h, 64 h, 256 h** — in one atomic SQL expression
   (`now + 3600000 × (1 << (2 × attempts))` on the pre-increment column),
   mirrored by the exported `fetchRetryBackoffMs(n)` so tests hold the two
   to one formula. `FETCH_RETRY_MAX_ATTEMPTS` rises 5 → 6. Four of the six
   cycles land inside the first ~21 hours — where the recoveries are — and
   the ladder's reach after the first drain cycle is ≈ 341 h ≈ **14 days**
   (was ≈ 10 under linear-daily), so the ADR-0010 §5.2 operator window for
   a confirmed outage did not shrink; it grew. Lifetime worst case per
   row: 6 cycles × 6 visits = 36 requests (was 30). Already-pending rows
   need no migration: `attempts ≤ 4` rows simply get more, denser chances;
   rows at ≥ 5 were already terminal.
4. **The daily in-run drain is unchanged** (25 rows, shared budget, after
   the catch-up, ADR-0009 §2 skip rule) and keeps its ADR-0010 §5.2 canary
   role — it is now the drain of last resort, not the drain.

#### Cost (cost-audit note)

- Standalone drain worst case **300 requests/run** (50 × 6 visits; 15% of
  the 2,000 budget), ≈ 2.5 min wall clock (six 50-row passes at 500 ms
  spacing — each pass already longer than the 20 s delay floor) against a
  15-minute consumer limit. **7,200 requests/day** is reachable only while
  ≥50 rows stay render-pending every hour all day — the confirmed-outage
  posture in which the operator sets the suspension flag and this drain
  stands down to zero. Expected render-slow weekday: ~150 rows × one to
  two cycles ≈ 900–1,800 drain requests/day on top of the window's own
  ≤936; a normal day: near zero. All outbound subrequests, $0 billing.
- +1 cron trigger (5 of 250), +24 queue messages/day (noise against the
  1M/month free operations), one indexed D1 read per hour. No new platform
  component, no new dependency; docs/cost-model.md updated.
- Convergence: 24 × 50 = **1,200 rows/day of drain capacity** against a
  ~150/weekday inflow. Staging's 1,069-row backlog is already due and
  self-drains in ≈ 1 day of hourly runs; no manual re-queue.

#### Honest limits

- A notice TED never renders now abandons after ≈ 14 days and 36 requests
  — still loud (`NOTICE_FETCH_ABANDONED`, §5 alert), still recoverable only
  via an ADR-0010 §5 channel.
- The standalone drain does not share the catch-up's request budget (they
  are different invocations); each is bounded on its own, and the active-run
  guard keeps them from overlapping in time.
- Nothing here changes what the window does at 05:00: it still triggers
  renders it cannot wait for. If TED's morning render latency is
  structurally > 1 h, the first hourly cycle also misses and the second
  (at +1 h) is the one that lands — the ladder was shaped for exactly that.

#### Tests

- packages/db `ingestion.d1.test.ts`: ladder rung-for-rung (SQL vs TS
  mirror, 1/4/16/64/256 h), `fetchRetryBackoffMs` domain guard,
  `hasActiveIngestionRun` (live / finished / orphan past horizon / source
  scoping).
- apps/worker `ingestion.d1.test.ts`: the former RV-0009-02 same-run pickup
  test is rewritten to its §A5 inverse (in-run drain does NOT touch the
  fresh row, `next_attempt_at = now + 20 min`, hits stay at 6; one second
  before due still untouched; once due, recovered on the 7th hit with the
  lot in `newLotIds`); F-3b / S-2 backoff assertions moved to rung 1; the
  abandonment loop advances by the ladder.
- apps/worker `fetch-retry-drain-job.d1.test.ts` (new, isolated D1): the
  three stand-downs, the orphan-run exception, the happy path with
  `MATCH_QUEUE` enqueue and a not-yet-due row untouched, and the standalone
  cap (55 due → exactly 50 attempted, overflow untouched).
- apps/worker `queue-dispatch.test.ts`: `drain_fetch_retries` routes and acks.

#### Doc touchpoints

docs/cost-model.md (drain arithmetic), docs/runbook.md (suspension flag
now also stands the hourly drain down; 6-attempt clock), docs/architecture.md
(background paths), packages/config feature-flag doc; ADR-0009 §2/§3 and
ADR-0010 §5.2 carry italic pointers here rather than edits to decided text.

### Doc touchpoints and transferred duties

- **docs/cost-model.md updated with this amendment** (the §3 deferral is
  now due, implementation being authorized): drain request delta ≤150/day
  worst case at V = 6; `ingestion_fetch_retries` 0.33 MB/year worst case
  unchanged — measured render-pending incidence on 2026-08-19 was
  1/156 ≈ 0.6%, inside §3's pessimistic 1% assumption; $0 marginal, no new
  platform component.
- The **coverage-methodology disclosure duty** (§Consequences: late
  arrival + abandonment wording in the ADR-0003 disclosure) **transfers to
  the documentation agent at phase close** — recorded here so the phase
  checklist, not this ADR, owns its execution.
- §Consequences' test list extends to: exhaustion-skip (`partial`, other
  notices land), threshold breach via pure exhaustions, drain-cycling
  recovery, drain exhaustion `attempts` accounting, and drain-skip after a
  failed catch-up.
