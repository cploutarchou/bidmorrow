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
