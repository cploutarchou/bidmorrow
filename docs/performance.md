# API latency

Measured, not asserted. `docs/production-checklist.md` carries the target
"API p95 < 500 ms excluding upstream calls"; before 2026-08-29 that target
existed only as prose in `docs/architecture.md` and nothing had ever measured
it (PRODUCTION_READINESS_AUDIT.md F-06).

## Harness

`scripts/measure-api-latency.mjs` — drives a running worker over real HTTP,
N iterations per route, reporting p50/p95/p99 by nearest rank (no
interpolation: at N in the tens, an interpolated p95 would imply precision the
sample does not have). One warm-up request per route is discarded so p99 does
not become a measurement of isolate start-up. Bodies are drained before the
clock stops.

Two rules keep the numbers honest:

- **"Excluding upstream calls" is satisfied by route choice, not by
  instrumentation.** Every measured route is served from D1 alone — nothing on
  these paths calls TED, Paddle or Resend.
- **A route that answers 4xx/5xx aborts the run.** An error path
  short-circuits before the work the budget is about, so publishing its
  latency would be a fabricated number. The first run of this harness did
  exactly that — a wrong query parameter made the feed answer 400, and it
  cheerfully reported 23.9 ms for a route that had done no work. The guard
  exists because of that.

```bash
bash scripts/e2e-webserver.sh        # 127.0.0.1:8787 — builds, migrates, seeds
node scripts/measure-api-latency.mjs # add --json for machine-readable output
```

Exits non-zero if any route's p95 exceeds `--budget-ms` (default 500).

## Result — local stack, 2026-08-29

Commit `813188e` plus the F-06 working tree. `wrangler dev` on
127.0.0.1:8787, local D1 seeded with `scripts/seed-demo.sql`, 40 iterations
per route, every response 200.

| Route                         |    p50 |    p95 |    p99 |
| ----------------------------- | -----: | -----: | -----: |
| `GET /api/health/ready`       |  7.0ms |  9.9ms | 14.1ms |
| `GET /api/public-config`      |  6.9ms | 10.2ms | 25.8ms |
| `GET /api/account/me`         | 10.6ms | 14.5ms | 38.2ms |
| `GET /api/org/profile`        | 16.8ms | 21.3ms | 52.0ms |
| `GET /api/org/feed?tab=today` | 24.7ms | 29.7ms | 32.1ms |
| `GET /api/org/feed?tab=saved` | 23.8ms | 28.4ms | 28.9ms |
| `GET /api/org/feed/stats`     | 21.6ms | 29.3ms | 32.0ms |
| `GET /api/org/saved-searches` | 13.0ms | 16.3ms | 29.1ms |

Worst p95 is the feed at **29.7 ms**, roughly 17× inside the 500 ms budget.

## What this does NOT establish

Read it as a floor, not as production p95. Three gaps, none of them small:

1. **No network, no edge.** Local `wrangler dev` measures handler + local-D1
   time. Production adds TLS, the Cloudflare edge, and remote-D1 round trips.
2. **A seed-sized dataset.** `seed-demo.sql` is a handful of rows. Staging
   holds ~460 notices / ~750 lots today and production will exceed that; the
   feed's keyset pagination and the stats endpoint's seven `COUNT(*)`s are the
   queries whose cost grows with the corpus, and they are exactly the two
   slowest rows above.
3. ~~**The harness cannot run against staging as written.**~~ Closed
   2026-08-30: `--email` + `PERF_PASSWORD` sign a seeded staging account in
   directly (no test mailbox), and `staging-perf.yml` runs it weekly.

So the production-checklist box stays **unchecked**. What changed is that the
target is no longer unmeasured: there is a repeatable harness, a recorded
baseline, and a named list of what would turn it into a production claim.

## Results — staging from a GitHub-hosted runner

Same script, `--email` seeded account, 40 iterations per route, 700–900 ms
pacing, gate 800 ms on the client-side figure. All p95, ms.

| Route                 | 08-30 (run 1) | 09-01 (run 33548220706) | 09-04 (run 33895830914, ATL) total / app / net |
| --------------------- | ------------: | ----------------------: | ---------------------------------------------: |
| health (2 D1 reads)   |           166 |                     671 |                                 318 / 240 / 78 |
| public config         |            98 |                     387 |                                 199 / 125 / 74 |
| account me            |           177 |                     648 |                                 316 / 244 / 79 |
| org profile bundle    |           411 |                   1,190 |                                 605 / 519 / 94 |
| feed, first page      |           608 |                   1,965 |                                 926 / 837 / 96 |
| feed, saved shelf     |           640 |                   1,968 |                                 953 / 867 / 96 |
| feed stats (7 counts) |           596 |                   1,964 |                                 967 / 877 / 93 |
| saved searches        |           293 |                   1,165 |                                 604 / 487 / 82 |

Nothing on those code paths changed between the two runs, and the one-read
routes moved by the same factor as the feed. That is the signature of the
path, not of a query: the runner is outside Europe, D1 is in `WEUR`, and a
request from there pays the ocean once on the client leg and once per D1
round trip. Which of those legs moved on 09-01 the measurement could not
say, which is why it now can (next section).

## The split (ADR-0012)

Outside production the Worker answers every request with
`Server-Timing: app;dur=<ms>, colo;desc="<IATA>"`: the wall time the request
spent inside the Worker, D1 round trips included, and the colo it ran in.
The script reports each route as:

- **total** — client wall clock including body read (the figure the gate
  used so far);
- **app** — Worker-side wall clock from the header;
- **net** — `total − app`, the path between the machine running the script
  and the Worker's colo; plus the colo(s) observed.

`--gate total|app` picks which figure the budget applies to. `--gate app`
refuses to run where the header is absent (production never sends it), so
it cannot pass vacuously.

The 09-04 run answered the question the earlier two could not: `net` is
flat at ~80 ms, and `app` grows by ~115 ms per D1 round trip because the
Worker ran in Atlanta against a database in `WEUR`. The feed routes make
roughly seven such trips. From a European colo each trip costs about a
tenth of that, which puts the customers' feed near 100–200 ms; that is a
derivation, and the measured customer figure is the Workers Logs number.

**The vantage rule (ADR-0012 A1).** `staging-perf.yml` now runs
`--gate app --budget-ms 500 --vantage EU`: the checklist budget is asserted
on the Worker-side figure and only when the Worker ran in Europe (the
header also carries the continent). From anywhere else the run prints the
table, emits a workflow warning naming the colo, and exits 0 as NOT GATED.
GitHub-hosted runners have landed in `SJC` and `ATL` so far, so expect the
warning weekly until a European runner exists; the values remain a trend
line from one vantage.

The customer-geography number is not this script at all: every request also
writes a `request completed` log line (route pattern, status, `duration_ms`,
`colo`, `country`) to Workers Logs. Filter by European colos in the
dashboard for the p95 real customers see.

## Re-measure when

- Before ticking the production-checklist p95 item: use the Workers Logs
  `duration_ms` p95 for European colos, not a runner figure.
- After any change to the feed query, the stats query, or their indexes.
- When the corpus grows by roughly an order of magnitude.
