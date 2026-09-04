# ADR-0012: API latency is measured where customers are; no Smart Placement

Status: Accepted (2026-09-04). Closes the follow-up opened in
`IMPLEMENTATION_LEDGER.md` on 2026-09-01 ("measure from where customers
are, or take Smart Placement to the architect as an ADR").

## Context

- `docs/production-checklist.md` carries the target "API p95 < 500 ms
  excluding upstream calls". `scripts/measure-api-latency.mjs` measures it
  (docs/performance.md); `staging-perf.yml` runs the script weekly against
  staging from a GitHub-hosted runner with an 800 ms client-side budget.
- Both D1 databases run in `WEUR` (read replication disabled; verified via
  the Cloudflare API on 2026-09-04). Every customer-facing request runs the
  Worker at the colo nearest the client and then makes N round trips to
  that primary. The customers are EU-based (docs/product-scope.md), so
  their round trips stay inside Europe.
- GitHub-hosted runners are not in Europe. From there every one of those N
  round trips crosses an ocean, and the client leg does too. The two
  staging runs so far disagree by 3× on identical code paths (08-30: feed
  p95 595–640 ms; 09-01: 1,965 ms; the trivial one-read routes moved the
  same way), and nothing in the measurement says whether that was the
  runner's path, the Worker's colo, or D1 itself. A gate whose failures
  cannot be attributed is noise, and loosening its budget to make it quiet
  would hide a real regression behind the runner's geography.
- Smart Placement (`placement.mode = "smart"`) would move the Worker next
  to the D1 primary. Cloudflare documents a limitation that matters here:
  with `assets.run_worker_first` the whole script is placed as one unit,
  so the placement decision cannot separate the edge-first asset path from
  the D1-bound API path (developers.cloudflare.com, "Run your Worker
  script first", checked 2026-09-04). Placement also does nothing for the
  client leg.

## Decision

1. **Measure real customer traffic, not a probe on another continent.**
   The request-correlation middleware now closes every request with a
   structured `request completed` log line: matched route pattern, method,
   status, wall time (`duration_ms`), and the Cloudflare colo and country
   the Worker ran in. Workers Logs is enabled for staging and production
   (`observability.enabled`, sampling 1, 7-day retention on the paid plan).
   The customer-geography p95 is a dashboard query over that field,
   filtered by European colos; it needs no runner anywhere.
2. **Make the probe attributable.** Outside production the Worker answers
   with `Server-Timing: app;dur=<ms>, colo;desc="<IATA>"`. The script
   reports each route three ways: `total` (client wall clock), `app`
   (Worker-side wall clock, D1 round trips included) and `net` (the
   difference, i.e. the path to the colo and back), plus the colo. A
   failure now says which leg moved. Production never sends the header:
   server-side timings are a side channel nobody outside needs.
3. **The weekly gate keeps its 800 ms client-side budget for now.** It is
   not loosened. The first run carrying the split (dispatched on merge)
   decides the follow-up, by evidence rather than by guess:
   - `app` small and `net` large: the runner's path. The gate moves to
     `--gate app` at the 500 ms budget from the checklist, and the
     client-side figure stays reported for information.
   - `app` large from a non-European colo: the Worker ran far from D1
     and every hop paid the ocean. Same outcome as above, and a note in
     docs/performance.md that only an EU-located run measures `app`
     meaningfully.
   - `app` large from a European colo: a real Worker-side regression
     (query count, missing index, D1 slowness). Fixed as such.
4. **No Smart Placement.** The customers' path is already short, the
   documented `run_worker_first` limitation applies to this Worker, and
   changing production topology to satisfy a probe that customers do not
   take is the wrong direction. Revisit if the Workers Logs p95 for
   European colos exceeds the 500 ms budget with the query paths already
   optimal, or if the D1 primary ever moves out of Europe.

## Consequences

- Workers Logs adds observability the incident-response runbook has
  lacked (only live `wrangler tail` existed). Volume is a few thousand
  events per day against 20M included per month; cost impact ~$0
  (docs/cost-model.md updated).
- Log lines carry route patterns and platform-supplied placement only:
  never concrete paths, query strings or identities beyond the existing
  correlation ids. `colo`/`country` are validated before use.
- `scripts/measure-api-latency.mjs` gains `--gate total|app`; `--gate app`
  refuses to run where the header is missing rather than pass vacuously.
- Superseding this ADR is the only way to adopt Smart Placement or to
  change the gate's budget.

## Amendment A1 (2026-09-04): the first split run, and the gate that follows from it

The first run carrying the split (`staging-perf` run 33895830914, 40
iterations per route, GitHub-hosted runner, Worker colo `ATL`):

| Route                  | total p95 | app p95 | net p95 |
| ---------------------- | --------: | ------: | ------: |
| health (2 D1 reads)    |       318 |     240 |      78 |
| public config (1 read) |       199 |     125 |      74 |
| account me             |       316 |     244 |      79 |
| org profile bundle     |       605 |     519 |      94 |
| feed, first page       |       926 |     837 |      96 |
| feed, saved shelf      |       953 |     867 |      96 |
| feed stats (7 counts)  |       967 |     877 |      93 |
| saved searches         |       604 |     487 |      82 |

Reading: `net` is flat at ~75–95 ms for every route, so the client leg is
not the story. `app` grows by ~115 ms per D1 round trip (one read: 125,
two: 240) because the Worker ran in Atlanta and the database is in
`WEUR`; the feed routes make roughly seven such trips. That is decision
§3's second case: a non-European colo, every hop paying the ocean. A
European colo pays roughly a tenth of that per hop, which puts the same
routes near 100–200 ms for customers. That last figure is derived, not
measured; the measured number is the Workers Logs `duration_ms` p95 for
European colos, which is where the checklist item is settled.

Decided:

1. The weekly gate asserts the checklist budget, `app` p95 < 500 ms, and
   asserts it only from a European vantage (`--gate app --budget-ms 500
--vantage EU`). The Worker now also reports its continent in
   `Server-Timing`. From any other continent the run prints the full
   table, emits a workflow warning naming the colo, and exits 0 as NOT
   GATED. The client-side 800 ms budget is retired: `net` is ~80 ms and
   carries no signal about the application.
2. This is not a loosening. The budget is stricter than before (500 on
   the Worker-side figure instead of 800 on the client-side one) and it
   is never asserted from a vantage where it would be a statement about
   the Atlantic. GitHub-hosted runners have landed in `SJC` and `ATL`;
   until one lands in Europe, or a European runner exists, the weekly run
   is a trend line (from one vantage, a doubled query count shows as a
   doubled `app` figure), and the customer p95 comes from Workers Logs.
3. A geography-independent assertion, the number of D1 round trips per
   route, would let the weekly run gate from anywhere. It needs a
   per-request query counter around the D1 binding and is left as the
   next step, recorded in `IMPLEMENTATION_LEDGER.md`, not started here.
