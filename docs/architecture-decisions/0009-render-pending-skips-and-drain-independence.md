# ADR-0009: Render-pending skips leave the systemic threshold; the drain runs unless the failure was systemic

Status: Proposed (2026-08-20) — spec for immediate implementation of §1 and
§2. §3 was completed same-day when the batch-size probe (run 32337551926)
REFUTED the serialized-render-queue hypothesis: the anonymous render
pipeline is currently completing no renders at all, so no client-side
trigger strategy is designed. §5 frames — but deliberately does not decide
— the source-acquisition contingency; a ted-data investigation running in
parallel owns bringing that evidence. Partially supersedes ADR-0008:
replaces §2's counting of render-pending exhaustions toward the systemic
fetch-failure threshold (introduced by Amendment §A1) and Amendment §A2's
"skip the drain whenever catch-up ended `failed`" rule. All other ADR-0008
decisions stand.

## Context

ADR-0008 (amended 2026-08-19) went live for the **2026-08-20 05:00 UTC**
staging cron — its first production run — and the run falsified two of its
decisions with one data point.

**The run** (staging D1, window 2026-08-17): `notices_seen=156,
notices_upserted=0, notices_fetch_failed=32, status=failed`.
`ingestion_errors`: 32× `NOTICE_RENDER_PENDING` plus one
`FETCH_FAILURE_THRESHOLD_EXCEEDED` with detail
`{noticesFetchFailed:32, noticesSeen:156, ratio:0.2051, min:5,
maxRatio:0.2}`. `ingestion_fetch_retries`: 32 rows, all `pending`,
`attempts=0`. `tender_notices=0`, `tender_matches=0`.

**What actually happened upstream**: not one of the 156 notices returned
XML across 6 visits over ~8–10 minutes — zero parse errors, zero HTTP
errors, only 202/empty-body render-pending responses. TED was not blocking
us; TED was accepting every request and rendering nothing in our window.
(Contrast: the 2026-08-18 single-notice CI probe DID observe a render
complete — 200 + 12,953 bytes — minutes after its trigger. The same-day
batch-size probe subsequently showed batch size is NOT the variable and
that the render pipeline is currently completing no renders at all — see
§3 for the numbers and what they rule out.)

Two ADR-0008 decisions are thereby falsified:

1. **Amendment §A1 folded render-pending exhaustion into the §2 systemic
   counter without revisiting §2's rationale.** §2 was written when a fetch
   failure meant _losing_ the notice and when a failure was evidence of TED
   _refusing_ us (HTTP errors, network failures — each having already cost
   up to 5 HTTP attempts). Neither premise holds for render-pending: the §3
   retry table means a skip is no longer a loss, and a 202 is TED
   _cooperating_ — request accepted, render queued, just slow. Counting
   slow renders toward "TED is blocking us" misclassifies a slow-render day
   as a systemic refusal: the window fails at the 32nd exhaustion, the
   checkpoint holds, and the identical 156-notice trigger set re-runs — and
   re-fails — every day.
2. **Amendment §A2's drain-skip rule deadlocks with (1).** `catch-up.ts`
   skips `drainFetchRetries` whenever the catch-up ended `failed`, for
   _any_ reason. Today's 32 retry rows are therefore unreachable: the
   window threshold-fails every day, so the drain never runs, so rows built
   precisely to survive a failed window can never drain (`attempts=0`
   forever). Retries are checkpoint-independent by construction (ADR-0008
   §3); the blanket skip re-coupled them to window outcome through the back
   door. Even with (1) fixed, any genuinely failing window would strand
   retries for the failure's whole duration — including retries whose
   failure cause has nothing to do with the window's.

Constraints in force are unchanged from ADR-0008: checkpoint advance-only,
idempotent persistence, TED politeness (spacing, backoff,
`MAX_REQUESTS_PER_RUN = 2000`), 15-min cron/queue invocation ceiling
(docs/dependency-versions.md, verified 2026-08-14; subrequest cap re-verified
2026-08-19 at 10,000 — not binding), fixed infra < $100/month (target
$5–30), D1 10 GB with ≥40% 12-month headroom (ADR-0003). No new external
API surface is introduced, so no fresh docs verification is required beyond
what ADR-0003/0005/0006/0008 and docs/ted-data-source.md already record.

## Decision

### 1. Render-pending exhaustion is a tracked skip, not a systemic fetch failure

The failure taxonomy splits on what the origin's behavior _means_:

| Signal                                               | Meaning                                        | Counter                          | §2 threshold | Retry row |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------- | ------------ | --------- |
| `NOTICE_FETCH_HTTP_*` / `NOTICE_FETCH_NETWORK_ERROR` | origin refusing/failing us (possibly targeted) | `noticesFetchFailed` (unchanged) | yes (5/20%)  | yes       |
| `NOTICE_RENDER_PENDING` exhaustion                   | origin cooperating, render slow                | `noticesRenderPending` (new)     | **no**       | yes       |

Concretely:

- **Counter split.** `MutableCounts` gains `noticesRenderPending`;
  `ingestion_runs` gains a `notices_render_pending` integer column
  (default 0, trivial migration). The Amendment-§A1 exhaustion path
  increments the NEW counter and no longer increments `noticesFetchFailed`
  — so `notices_fetch_failed` reverts to its pre-amendment §5 semantics
  ("genuine fetch failures only"), which is what its consumers (watchdog
  condition (iii), admin ingestion views) were designed around.
  `recordFetchSkip` grows a discriminator (or splits into two thin
  wrappers): both paths still write the `ingestion_errors` row, the
  idempotent `ingestion_fetch_retries` upsert, and the warn log — **no
  skipped notice ever loses its retry row** — but only the genuine-failure
  path evaluates the §2 threshold.
- **The §2 threshold itself is unchanged** (`FETCH_FAILURE_FAIL_MIN = 5`,
  `FETCH_FAILURE_FAIL_RATIO = 0.2`, evaluated per skip over
  `noticesFetchFailed / noticesSeen`, abort + checkpoint hold on breach).
  Its rationale survives _for genuine failures_ even now that the retry
  table exists, for two reasons the retry table does not cover: (i)
  politeness — each genuine failure already cost up to 5 HTTP attempts, and
  aborting stops hammering an origin that is refusing us; (ii) a systemic
  refusal (block/outage) would also fail every drain re-attempt, burning
  the 5-attempt retry budget toward mass `NOTICE_FETCH_ABANDONED` — real
  data loss. Holding the checkpoint keeps the day intact for one full
  re-run after the block clears, spending zero retry attempts.
- **Render-pending has NO fail ceiling.** A 100%-render-pending window
  finishes `partial`, the checkpoint advances, and all skipped notices sit
  in the retry table. Failing the window instead would reproduce today's
  loop: re-trigger the identical 156-notice set daily, re-fail daily, and
  (before §2 of this ADR) never drain. Holding the checkpoint buys nothing
  for politeness either — 202s are cheap, _accepted_ requests.
- **An all-render-pending day still gets a distinct, loud signal** (it is a
  real upstream degradation even though it must not fail the window).
  Evaluated **once, at window end** (not per skip — there is no abort):
  when `noticesRenderPending >= RENDER_PENDING_DEGRADED_MIN` and
  `noticesRenderPending / noticesSeen > RENDER_PENDING_DEGRADED_RATIO`
  (new code constants, initial values 5 and 0.2 — same location rationale
  as ADR-0008 §2), write one durable `ingestion_errors` row with new
  stable code `RENDER_PENDING_DEGRADED` (stage `fetch`, no
  `sourceNoticeId`, detail
  `{noticesRenderPending, noticesSeen, ratio, min, minRatio}`) and one
  structured error log `ingestion.window.render_pending_degraded`. The
  window status is `partial` regardless.
- **Watchdog (health.ts) changes.** Condition (i)'s alertable-code list
  gains `RENDER_PENDING_DEGRADED`. Condition (ii) (pending backlog > 50)
  is unchanged — a 156-row day trips it correctly. Condition (iii)
  (consecutive runs with `notices_fetch_failed > 0`) deliberately stays on
  genuine failures only: a streak of days with one slow render each is
  normal TED behavior (measured 2026-08-19: 1/156), and render-pending
  health is already covered by (i)+`RENDER_PENDING_DEGRADED` and (ii).
  Admin ingestion views surface the new column alongside
  `notices_fetch_failed`.

At the 2026-08-20 numbers this yields: 32 render-pending skips → 32 retry
rows, `notices_render_pending = 32`, ratio 20.5% → one
`RENDER_PENDING_DEGRADED` alert row, window `partial`, checkpoint advances,
124 remaining notices ingest normally the moment TED serves their renders —
and the drain (§2) picks up the 32 the same run and daily thereafter.

### 2. The drain runs unless the window failed for a systemic or budget reason

Amendment §A2's blanket "skip the drain when catch-up ended `failed`" is
replaced with a **cause-classified** rule. The protections the blanket rule
was actually defending are (i) politeness toward an origin that just
refused a whole window and (ii) not spinning up a drain when the shared
request budget is already gone. Only failure causes that evidence one of
those two justify skipping.

- `RunWindowResult` gains `failureCode: string | null` — the
  `describeWindowFailure` error code for a `failed` window, `null`
  otherwise. A new exported pure helper
  `isSystemicWindowFailure(code)` classifies it:
  - **skip the drain** for `REQUEST_BUDGET_EXCEEDED`,
    `FETCH_FAILURE_THRESHOLD_EXCEEDED`, and any `SEARCH_FETCH_*` or
    `NOTICE_FETCH_*` code (a `TedRequestError` reaching window level —
    normally impossible under §1 record-and-continue, but the
    defense-in-depth branch exists, and if it fires the origin is refusing
    us);
  - **run the drain** for everything else — `UNEXPECTED_WINDOW_ERROR`
    (a persistence/normalization bug says nothing about TED; if
    persistence is genuinely down the drain's own writes fail loudly,
    which is correct surface-don't-swallow behavior) and the
    defense-in-depth `NOTICE_RENDER_PENDING` window-level code (origin
    cooperating by definition).
- `catch-up.ts` rule becomes: **the drain runs whenever ingestion is not
  paused AND the catch-up did not end `failed` with a systemic/budget
  `failureCode`.** Ordering is unchanged (drain after the catch-up loop,
  same `TedClient` — shared budget, spacing, backoff). The paused skip and
  the "no due rows → empty result" behavior are unchanged. If a
  non-systemic failure lets the drain run with little budget left,
  `TedBudgetExceededError` already terminates the drain gracefully
  (rows stay due tomorrow — existing §A2 handling, unchanged).
- **Deadlock resolution + remediation of the stranded rows.** No manual
  remediation is needed: with §1 deployed, the next daily run re-processes
  window 2026-08-17 → `partial` (skips are idempotent upserts onto the
  existing 32 rows), the checkpoint advances, and the drain runs in the
  same invocation, attempting up to 25 of the rows with a fresh 6-visit
  cycle. Note `recordFetchSkip` sets `next_attempt_at = now()`, so a
  window's skips are deliberately eligible for the _same run's_ drain —
  25 notices/day get a same-day second cycle. Each such cycle burns one of
  the 5 retry attempts; whether that same-day attempt is worth its budget
  on systemically slow days is §3's question and may be revised there.

### 3. Window trigger strategy — PLACEHOLDER, EVIDENCE PENDING

> **DO NOT IMPLEMENT anything from this section; it records the open
> question only.** A CI probe (running as of 2026-08-20) compares a
> 5-notice trigger batch against a 50-notice trigger batch, measuring
> render completion at +60/+120/+180 s, to test the hypothesis that TED's
> render capacity is per-client and serialized — i.e. that a 156-notice
> trigger set starves itself and _no_ notice completes (consistent with
> 2026-08-20: 0/156 in ~8–10 min) while a small set completes (consistent
> with 2026-08-18: 1/1 in minutes).
>
> Candidate designs to be weighed **only once the probe data arrives**:
> (a) batch-and-wait within a run — trigger K, collect K, advance — with K
> and the wait derived from measured render latency; (b) deliberately
> carrying the remainder of a window into the retry table as the primary
> throughput mechanism (drain caps re-sized accordingly); (c) multi-run
> convergence with an explicitly documented "a publication day lands over
> N days" coverage consequence. This section will be completed (with
> request-budget and 15-min wall-clock math per candidate) when the
> coordinator delivers the probe results. Until then the §1/§2 model —
> full-window trigger set, skip on exhaustion, drain daily — is the
> operative behavior.

### 4. `MAX_RENDER_VISITS = 6` and `RENDER_RETRY_DELAY_MS = 20s` are retained pending §3

The 2026-08-20 evidence shows 6 visits / ~8–10 min was insufficient for
_every_ notice in a 156-notice trigger set — which under the §3 hypothesis
is a property of the trigger-set size, not of the per-notice patience, so
retuning patience now would be tuning the wrong variable on one data
point. Under §1 an exhaustion is cheap (skip + retry row, ~$0, no window
failure), so the cost of the constants being wrong has collapsed. Both
constants are re-decided in §3 once the probe fixes the model; if §3
adopts batch-and-wait, the full-queue-pass arithmetic behind A3's "6"
(visit horizon ≈ (visits − 1) × pass length) stops applying entirely.

### 5. Coverage-methodology disclosure

A publication day may now land **incrementally**: a `partial` window
advances the checkpoint while up to all of its notices arrive over
subsequent drain days (or never, if abandoned — alerting, never silent).
The ADR-0003 coverage-disclosure duty (docs/product-scope.md: "coverage is
scoped and documented — never imply exhaustive coverage") therefore
extends beyond ADR-0008's "late arrival + abandonment" wording to state
that same-day completeness of a publication day is not guaranteed and that
notices can arrive over the following days. As with the ADR-0008
amendment, execution of the wording change **transfers to the
documentation agent at phase close**; §3's outcome may tighten or loosen
the "N days" bound and must be reflected in the same pass.

### 6. Out of scope / unchanged

ADR-0008 §1 (record-and-continue for genuine fetch failures), §3 (retry
table shape, 25/run cap, 5-attempt give-up, `NOTICE_FETCH_ABANDONED`
alerting, checkpoint independence), §4 (budget exhaustion and
`SEARCH_FETCH_*` window-fatal), Amendment §A2's drain-cycle mechanics
(full render-visit cycles, shared work queue, budget termination), and the
pre-exhaustion requeue-cycling of PR #51. Checkpoint advance-only
semantics, persistence idempotency, TED politeness parameters, retention
rules, and every stable error code already shipped.

## Consequences

Positive:

- A slow-render day is no longer misclassified as "TED is blocking us":
  the 2026-08-20 failure mode (daily re-trigger, daily threshold-fail,
  zero ingestion, drain never runs) becomes `partial` + retry rows +
  distinct `RENDER_PENDING_DEGRADED` alert + a drain that actually runs.
- The retry table's checkpoint independence is real again: rows strand
  only while ingestion is paused, the budget is spent, or the origin is
  actively refusing us — the exact cases where not draining is correct.
- `notices_fetch_failed` regains clean semantics for its existing
  consumers; watchdog conditions (i)–(iii) keep their intent with one
  code added to (i).
- ~$0 marginal cost; no new platform component (cost-audit: see below).

Negative / accepted costs:

- **An all-202 window now runs to completion instead of aborting at the
  32nd exhaustion**: at 156 notices ≈ 936 notice fetches (+2 search pages)
  ≈ 47% of the 2,000 budget, wall clock ~8–12 min — inside the 15-min
  ceiling at current volume. At the 300/day planning ceiling an all-202
  day is ~1,800 fetches (< 2,000) but ~15+ min of passes — the invocation
  can be wall-clock-killed mid-run, leaving the run `running` and the
  checkpoint held, covered by the ADR-0006 watchdog's stale-run detection.
  This ceiling-volume gap existed under A3 too (its own note) and is a
  primary input to §3, which is the mechanism that bounds pass length.
- A publication day lands incrementally (§5 disclosure duty), and drain
  throughput (25 rows/day) means a fully-skipped 156-notice day takes ≥7
  calendar days to drain at current caps — acceptable only as a degraded
  mode; §3 owns making it either rare (batch-and-wait) or fast
  (re-sized drain as primary throughput).
- One new `ingestion_runs` column, one new counter, two new constants, one
  new stable error code, one new `RunWindowResult` field + pure
  classifier. **12-month D1 projection** (ground rule): the new integer
  column adds ~8 bytes × ~730 run rows/year ≈ **6 KB/year** — noise.
  `ingestion_fetch_retries` re-projected now that the 1% incidence
  assumption is falsified for burst days (2026-08-20: 32/156 ≈ 20.5%;
  sustained worst case 100%): 300 rows/day × 90-day terminal purge ×
  ~300 B ≈ **8 MB steady-state absolute worst case** — still negligible
  against the 10 GB cap; ADR-0003's ≥40% headroom is unaffected.
- Test surface: counter split (render-pending increments the new counter
  only, never the threshold), no-ceiling behavior (100%-render-pending
  window → `partial`, checkpoint advances, N retry rows),
  `RENDER_PENDING_DEGRADED` emission at/below/above min+ratio, genuine
  threshold unchanged (pure `TedRequestError` day still fails at 5/20%),
  mixed days (genuine failures alone drive the threshold),
  `isSystemicWindowFailure` classification table, drain-runs-after-
  non-systemic-failure, drain-skipped-after-threshold/budget/search
  failure, same-run drain pickup of a window's fresh skips, and the
  watchdog (i)/(iii) changes.

Cost-audit summary (no full recompute needed — no new platform service,
no new dependency, request/storage deltas within existing line items): the
docs/cost-model.md ingestion-assumption bullet gains the no-early-abort
worst case (~936 fetches/day at 156, ~1,800 at ceiling — inside the 2,000
budget) and the retry-table bullet gains the corrected incidence/worst-case
figures above. Nothing approaches the $60–80 alert band; totals unchanged.

## What remains unverified

- **Why zero renders completed** on 2026-08-20 (per-client serialized
  render capacity is a hypothesis; the probe now running is the test).
  §3 and §4 are explicitly blocked on this.
- **Whether the drain's ~100 s collection horizon recovers the current 32
  rows**: the drain triggers only ≤25 renders at once, which under the
  hypothesis should complete where 156 did not — but this is exactly the
  unproven hypothesis. If the first post-deploy drains recover nothing,
  that is itself probe-grade evidence for §3.
- `RENDER_PENDING_DEGRADED_MIN/RATIO` initial values (5 / 0.2) are
  judgment values mirroring §2's constants; alert-only, so mis-tuning
  costs noise, not data.
- Whether burning a retry attempt on the same-run drain cycle is the right
  spend on systemically slow days (§2 last bullet; revisit in §3).

## Alternatives considered

- **Keep render-pending in the shared counter with a higher ratio** (e.g.
  0.5): still conflates cooperation with refusal — any chosen ratio just
  moves the misclassification boundary, and a genuinely slow day above it
  re-creates the 2026-08-20 daily-fail loop. Rejected.
- **A separate fail ceiling for render-pending** (fail the window at e.g.
  80% pending): failing re-triggers the identical set tomorrow — the
  observed pathological loop — while protecting nothing (202s are cheap
  accepted requests; the notices are already durably in the retry table).
  Rejected.
- **No distinct signal for degraded-render days**: an all-202 day would
  surface only via the backlog alert a day later; a real upstream
  degradation deserves a same-day, code-stable alert. Rejected.
- **Drain unconditionally, no skip at all**: after a
  `FETCH_FAILURE_THRESHOLD_EXCEEDED` or `SEARCH_FETCH_*` window the origin
  is refusing us and drain attempts both hammer it and burn retry-attempt
  budget toward spurious abandonment; after budget exhaustion the drain is
  a guaranteed no-op that still creates a run row. Cause-classification
  keeps exactly these protections. Rejected.
- **Drain on its own cron/schedule**: decouples fully but needs its own
  `TedClient` budget accounting (splitting the shared politeness budget),
  a second schedule, and more composition surface — for a problem the
  cause-classified skip solves inside the existing invocation (consistent
  with ADR-0006's queues+cron minimalism). Rejected.
- **Guessing §3 now** (e.g. committing to batch-and-wait before the probe
  reports): the 2026-08-19 amendment already shows the cost of designing
  against an unmeasured render model — A3's patience bump was reasoned
  correctly from the data available and still did not survive first
  contact. Explicitly deferred instead.
