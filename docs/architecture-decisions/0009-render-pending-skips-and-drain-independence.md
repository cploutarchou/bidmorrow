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
  — so `notices_fetch_failed` reverts to its pre-amendment ADR-0008 §5
  semantics
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

Replayed against 2026-08-20 this yields: no abort at the 32nd exhaustion —
the window runs to completion, and while the §3 outage persists all 156
notices skip into retry rows (`notices_render_pending = 156`, ratio 100% →
one `RENDER_PENDING_DEGRADED` alert row), the window finishes `partial`,
the checkpoint advances, and the drain (§2) re-attempts up to 25 rows the
same run and daily thereafter — recovering them automatically if/when TED
resumes rendering. On a merely _slow_ day (the pre-outage model), only the
genuinely slow notices skip and the rest ingest normally.

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

### 3. Window trigger strategy: NO client-side strategy — the hypothesis is refuted, the origin is not rendering

**Probe evidence** (CI run 32337551926, 2026-08-20 05:56–06:12 UTC, Azure
egress — a _different_ network than the worker's Cloudflare egress —
anonymous, ~1 s spacing, identifying UA), testing whether TED's render
capacity is per-client and serialized (i.e. whether a 156-notice trigger
set starves itself while a small set completes):

| Batch          | pass 1                 | +60 s | +120 s | +180 s |
| -------------- | ---------------------- | ----- | ------ | ------ |
| A — 5 notices  | rendered 0, pending 5  | 0/5   | 0/5    | 0/5    |
| B — 50 notices | rendered 0, pending 50 | 0/50  | 0/50   | 0/50   |

`other=0` in every pass: no 4xx/5xx, no rate-limit signal — every response
was 202 or empty-200.

**The per-client-serialized-render-queue hypothesis is REFUTED.** Batch
size is not the variable: a 5-notice set starved exactly as completely as
a 50-notice set (over ~6.5 and ~9 minutes respectively), from a different
egress than the worker. Combined with the 2026-08-18 single-notice probe
that DID collect a render (200 + 12,953 bytes), the evidence says TED's
anonymous notice-XML render pipeline **stopped completing renders entirely
somewhere between 2026-08-18 and 2026-08-20** — an upstream outage or
behavior change, not a load or client-identity effect on our side.

**Decision: no batch-and-wait, no pacing, no patience tuning is designed.**
Every candidate previously listed here (batch-and-wait with derived K,
retry-table-as-primary-throughput with re-sized drain caps, multi-run
convergence) presupposed that _some_ trigger-set size or wait produces
renders. The data shows none does right now: no client-side strategy can
fix an origin that never completes renders, and tuning our behavior
against an outage would encode the outage into the architecture. The
operative behavior remains exactly §1/§2 — full-window trigger set, skip
on exhaustion, retry rows, daily drain — which is the correct posture for
an upstream outage: the checkpoint keeps advancing, the backlog
accumulates as durable retry rows, and the drain harvests them
automatically if/when TED recovers, with `RENDER_PENDING_DEGRADED` +
backlog alerts marking every day the outage persists. If TED recovers with
a _degraded_ (slow-but-working) render pipeline and measured latencies
then justify a trigger strategy, that is a new decision on new evidence —
a superseding ADR, not a revival of this section's candidates. The
channel-viability question the outage raises is §5's.

### 4. `MAX_RENDER_VISITS = 6` and `RENDER_RETRY_DELAY_MS = 20s` are retained — as cheap insurance, not a throughput lever

Under the §3 finding these constants cannot currently affect throughput at
all: while the origin completes no renders, 2 visits and 20 visits collect
equally nothing, and once §1 makes exhaustion cheap (skip + retry row, no
window failure, ~$0) the only costs of visits are requests and wall clock.
They are retained because they are the right shape for the states around
the outage: against a _transient_ pending state (the pre-2026-08-18
behavior, where renders completed in minutes) 6 visits is bounded patience
that collects same-run what would otherwise wait a day for the drain;
against the current outage they cost a bounded ~936 fetches/day at 156
notices (inside the 2,000 budget, $0 — outbound subrequests) as the price
of automatically detecting recovery the moment it happens, with no deploy.
Lowering them mid-outage would save requests we do not need to save and
slow recovery detection; raising them buys nothing (§3). If the
ceiling-volume wall-clock risk (Consequences) materializes before TED
recovers, the lever is the source-acquisition contingency (§5), not
patience arithmetic.

### 5. Source-acquisition contingency — FRAMED, NOT DECIDED

> **This section decides nothing.** A ted-data investigation is starting
> in parallel and will bring the evidence; this section fixes its target
> list so the investigation answers the questions the architecture
> actually needs answered.

If the render front-end's outage persists (or recurs), it may no longer be
a viable **primary content channel** — and it is currently the _only_
content channel (docs/ted-data-source.md, verified 2026-08-18: there is no
authenticated notice-XML endpoint; the front-end route is THE supported
path). Two candidate alternatives exist, to be kept source-agnostic behind
the `ProcurementSource` boundary (the domain model must not become
channel-shaped any more than it is TED-shaped):

- **(a) Request the needed eForms fields directly from the Search API's
  `fields` array.** docs/ted-data-source.md (verified 2026-08-14) records
  that `fields` accepts BT ids/kebab-case aliases and caps at
  `len(fields) × limit ≤ 10,000` per page — so ~20 fields × 250
  notices/page is within budget, on the API that is demonstrably still
  healthy. This bypasses rendering entirely. Open questions for the
  investigation: **field coverage** — can the Search API deliver
  everything `packages/ted`'s parser output and the matching engine's
  inputs consume (multilingual titles/descriptions, per-lot
  CPV/NUTS/values/deadlines, buyer identity/legal type, notice/procedure
  types, SDK version), and with what fidelity vs the XML (per-lot
  granularity, language coverage, truncation)? **Snapshot/provenance
  duty** — ADR-0005's R2 raw-XML snapshot (audit trail, re-parse
  capability) has no raw XML in this channel: does a canonicalized JSON
  response snapshot satisfy ADR-0005's intent, or does ADR-0005 need a
  superseding decision? **Cost**: same API, similar-or-fewer
  requests/day — no new component expected, but response sizes must be
  confirmed against the D1/R2 line items.
- **(b) TED bulk XML download packages (daily/monthly OJ S archives)** — a
  different acquisition channel entirely. Open questions: the surface as
  it stands TODAY (existence, format, URLs — **unverified until the
  investigation confirms it against docs.ted.europa.eu / official
  channels; nothing here is asserted from memory**), cadence and
  publication latency vs our daily-window model (is there a daily
  package, and when is it available relative to the publication day?),
  package size and the cost/wall-clock of downloading and filtering to
  our CPV scope inside Worker limits (a whole-OJ-S archive is mostly
  out-of-scope notices for us — where does the filter run, and does the
  archive need R2 staging?), fixed-cost impact of storage/egress against
  the < $100 (target $5–30) constraint, and provenance (bulk packages ARE
  raw XML, so ADR-0005 is naturally satisfied — likely its cleanest fit).
- Either way: the retry-table backlog built during the outage must be
  harvestable by whichever channel wins. Retry rows carry
  `source_notice_id` + `publication_date`, which both channels can key
  on; the `xml_url` column is irrelevant to (a)/(b) but harmless.

Decision criteria recorded now so the eventual choice is honest: coverage
fidelity first (never silently degrade parsed fields), then ADR-0005
provenance, then cost within the existing model, then implementation
surface. Any adoption is a superseding/companion ADR with its own 12-month
D1 projection and cost-model update.

### 6. Coverage-methodology disclosure

A publication day may now land **incrementally**: a `partial` window
advances the checkpoint while up to all of its notices arrive over
subsequent drain days (or never, if abandoned — alerting, never silent).
The ADR-0003 coverage-disclosure duty (docs/product-scope.md: "coverage is
scoped and documented — never imply exhaustive coverage") therefore
extends beyond ADR-0008's "late arrival + abandonment" wording to state
that same-day completeness of a publication day is not guaranteed and that
notices can arrive over the following days. As with the ADR-0008
amendment, execution of the wording change **transfers to the
documentation agent at phase close**. While the §3 outage persists, the
honest bound is open-ended ("until TED's render pipeline recovers or an
alternative channel (§5) is adopted") — the wording must not promise an
"N days" figure the current evidence cannot support; a §5 channel decision
revisits the bound in the same pass.

### 7. Out of scope / unchanged

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
  This ceiling-volume gap existed under A3 too (its own note); with §3
  ruling out a client-side pacing fix, the escape hatch if it materializes
  mid-outage is the §5 contingency (a channel that does not render), not
  patience arithmetic.
- A publication day lands incrementally (§6 disclosure duty). While the
  §3 outage persists, drain throughput is moot (nothing renders for
  anyone) and the backlog simply accumulates — bounded in D1 terms (see
  projection below), loud via `RENDER_PENDING_DEGRADED` + the backlog
  alert, and self-healing on TED recovery. After recovery, 25 rows/day
  means a fully-skipped 156-notice day takes ≥7 calendar days to drain;
  if recovery arrives with a large backlog, re-sizing the drain caps is a
  deliberate, evidence-based follow-up decision (superseding ADR), not a
  pre-tuned guess.
- One new `ingestion_runs` column, one new counter, two new constants, one
  new stable error code, one new `RunWindowResult` field + pure
  classifier. **12-month D1 projection** (ground rule): the new integer
  column adds ~8 bytes × ~730 run rows/year ≈ **6 KB/year** — noise.
  `ingestion_fetch_retries` re-projected now that the 1% incidence
  assumption is falsified (2026-08-20: 32/156 ≈ 20.5%; §3 outage worst
  case 100%): terminal rows purge after 90 days, but `pending` rows
  accumulated during a sustained outage do not — absolute worst case, a
  full 12 months of total outage at the 300/day ceiling ≈ 110k rows ×
  ~300 B ≈ **33 MB** — still negligible against the 10 GB cap; ADR-0003's
  ≥40% headroom is unaffected.
- **Slow-motion abandonment risk during a sustained outage**: the drain
  attempts the 25 oldest due rows daily; each failed cycle burns one of 5
  attempts with linear backoff (next due `attempts` days later), so a
  drained row reaches `NOTICE_FETCH_ABANDONED` ≥ ~10 days after its first
  drain attempt — alertable at every step, but terminal: outage-era
  notices that abandon are recoverable only via a §5 channel (retry rows
  keep `source_notice_id` + `publication_date` for exactly that) or a
  superseding decision, since admin backfill cannot run behind the
  advance-only checkpoint. Whether to suspend attempt-burning while
  degradation is confirmed (vs keeping attempts as the recovery probe) is
  deliberately NOT decided here — it goes to the ted-data investigation's
  target list with §5.
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

- **The cause and duration of the render outage** (§3): the probe
  establishes THAT the pipeline completes no renders for any tested
  client/batch size between 2026-08-18 and 2026-08-20 — not WHY, nor
  whether it is an outage (will recover) or a permanent behavior change
  (front-end no longer serves anonymous XML). The parallel ted-data
  investigation owns this; §5's contingency framing exists because the
  answer may never come from TED.
- **Everything in §5**: Search-API field coverage/fidelity, the
  bulk-download surface (existence/format/cadence/size — asserted by no
  one from memory; verify against official channels), and the ADR-0005
  provenance question for channel (a). Deliberately framed, not decided.
- While the outage persists, **the drain recovering anything is not
  expected** — its daily empty-handed cycles double as the recovery
  probe. The first drain that recovers rows is the recovery signal.
- `RENDER_PENDING_DEGRADED_MIN/RATIO` initial values (5 / 0.2) are
  judgment values mirroring §2's constants; alert-only, so mis-tuning
  costs noise, not data.
- Whether burning retry attempts during a confirmed outage is the right
  spend (Consequences, slow-motion abandonment) — flagged to the ted-data
  investigation alongside §5.

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
- **A batch-and-wait / paced trigger strategy** (trigger K, wait, collect
  K — the leading candidate while the serialized-queue hypothesis stood):
  refuted empirically before design — probe 32337551926 showed a 5-notice
  batch starving identically to a 50-notice batch (0 renders across
  +60/+120/+180 s, no error or rate-limit signal, different egress), so
  batch size is not the variable and pacing cannot fix an origin that
  completes no renders. Would also have hard-coded outage-era behavior
  into the architecture. Rejected on evidence; revivable only via a
  superseding ADR if TED recovers into a measurably slow-but-working
  state.
- **Retuning `MAX_RENDER_VISITS`/`RENDER_RETRY_DELAY_MS` now** (up for
  patience, or down to save requests mid-outage): both directions are
  no-ops against a non-rendering origin (§4); down also slows recovery
  detection. The 2026-08-19 amendment already showed the cost of tuning
  these against an unmeasured render model — A3's patience bump was
  reasoned correctly from the data available and did not survive first
  contact. Rejected.
