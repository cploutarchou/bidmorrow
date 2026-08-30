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
3. **The harness cannot run against staging as written.** It establishes a
   session through the double-gated `/api/test/mailbox` e2e hook, which 404s
   outside a local/test environment — by design. Measuring authenticated
   routes on staging needs a dedicated seeded account whose credentials live
   in CI secrets, which does not exist yet.

So the production-checklist box stays **unchecked**. What changed is that the
target is no longer unmeasured: there is a repeatable harness, a recorded
baseline, and a named list of what would turn it into a production claim.

## Re-measure when

- Before ticking the production-checklist p95 item (needs gap 3 closed).
- After any change to the feed query, the stats query, or their indexes.
- When the corpus grows by roughly an order of magnitude.
