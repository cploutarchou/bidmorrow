# Cost Model

Hard constraint: fixed infrastructure **< $100/month** during MVP/early
revenue. Target: **$5–30/month**. Alert threshold: **$60–80** projected run
rate. Payment-processing fees are modeled separately (they scale with
revenue, not fixed cost).

Prices verified against official Cloudflare/Resend docs on **2026-08-14**
(see docs/dependency-versions.md for sources). Re-verify at each phase review
(cost-audit skill).

## Platform allowances (Workers Paid, $5/mo base)

| Resource                | Included at $5/mo                               | Overage                            |
| ----------------------- | ----------------------------------------------- | ---------------------------------- |
| Worker requests         | 10M/mo (static asset requests free & unlimited) | $0.30/M                            |
| Worker CPU              | 30M CPU-ms/mo                                   | $0.02/M CPU-ms                     |
| D1 rows read            | 25B/mo                                          | $0.001/M                           |
| D1 rows written         | 50M/mo                                          | $1.00/M                            |
| D1 storage              | 5 GB                                            | $0.75/GB-mo                        |
| Queues operations       | 1M/mo (~3 ops per delivered message)            | $0.40/M                            |
| KV reads/writes         | 10M / 1M per mo                                 | $0.50/M / $5.00/M                  |
| Cron triggers           | 250/account                                     | —                                  |
| D1 Time Travel          | 30-day retention, free                          | —                                  |
| R2 (separate free tier) | 10 GB storage, 1M Class A, 10M Class B per mo   | $0.015/GB-mo, $4.50/M A, $0.36/M B |

Key limits: **D1 max database size 10 GB (paid)**; 1,000 D1 queries per
invocation; Queues message ≤128 KB, batch ≤100 msgs; native rate-limiting
binding (GA) at no documented extra cost.

## Fixed monthly components

| Component                                         | 0 customers     | 10      | 100             | 1,000        |
| ------------------------------------------------- | --------------- | ------- | --------------- | ------------ |
| Workers Paid base (incl. D1/Queues/KV allowances) | $5.00           | $5.00   | $5.00           | $5.00        |
| Workers request overage                           | 0               | 0       | 0               | ~$0–3        |
| D1 overage (reads/writes/storage)                 | 0               | 0       | 0               | ~$0–5        |
| Queues overage                                    | 0               | 0       | 0               | ~$0–2        |
| R2 (snapshots, ~2–6 GB steady-state)              | $0 (free tier)  | $0      | $0              | ~$0–1        |
| Resend                                            | $0 (free 3k/mo) | $0      | $20 (paid tier) | ~$20–90      |
| Domain (amortized ~$12/yr)                        | $1              | $1      | $1              | $1           |
| **Total fixed**                                   | **~$6**         | **~$6** | **~$26**        | **~$30–105** |

Assumptions behind the request math:

- Ingestion: 1 daily cron, ~150–300 scoped notices/day, ≤ a few hundred TED
  API calls/day, queue-batched normalization → well under 100k Worker
  requests/mo and ~1M D1 row writes/mo including match recomputation.
  Matching writes ≈ orgs × new lots × ~10 component rows/day: at 100 orgs ×
  200 lots × 12 rows ≈ 240k writes/day ≈ 7.2M/mo — inside the 50M allowance.
  At 1,000 orgs this reaches ~72M/mo → ~$22/mo overage worst case; mitigate
  by pre-filtering lots per org (CPV scope intersection) before scoring,
  which cuts ≥80% of pairs. Modeled conservatively in the 1,000 column. This
  pre-filter is also a deliberate relevance decision, not purely a cost one
  — see docs/matching-engine.md "CPV pre-filter (scoring eligibility)" for
  the trade-off and its disclosure requirements.
- Dashboard traffic: 1,000 active customers × ~30 sessions × ~50 API calls
  ≈ 1.5M requests/mo — inside included 10M.
- Email: digests ≈ customers × ~22 send-days/mo (only-when-meaningful
  reduces this). 100 customers ≈ ~2,200/mo → Resend free tier (3k/mo)
  borderline → budget the $20 tier. 1,000 customers ≈ ~22k/mo → $20–90
  depending on Resend tier at the time; re-verify pricing before that scale.

Conclusion: **~$6/mo at 0–10 customers, ~$26/mo at 100 customers** — inside
the $5–30 target. At 1,000 customers the projection can cross the $60–80
alert band only via email volume + matching writes; both have identified
mitigations and by then revenue is ≥$29k/mo.

## D1 storage projection (12 months, scoped ingestion)

Scope per docs/ted-ingestion-scope.md (~IT/cyber CPV superset): assume
**150–300 notices/day**, avg 1.6 lots/notice, normalized footprint
≈ 12–20 KB/notice (notice + versions + lots + CPV/geo rows + FTS-free text
columns; raw XML goes to R2, NOT D1).

- Worst case unpruned: 300/day × 20 KB × 365 ≈ **2.2 GB/year** + match rows.
- Match rows dominate at scale: matches ≈ orgs × active lots. With 90-day
  retention (deadline-passed + 90d purge) the active window is ~9–18k lots;
  at 100 orgs ≈ 1.4M match rows + ~11M component rows ≈ 1.5–3 GB steady
  state. Component rows are the biggest table → store component details as
  one compact JSON column per match if row growth outpaces projection
  (decision recorded in data-model doc; revisit at 50 orgs).
- **Steady state projection ≤ ~3–5 GB total at 100 customers** vs 10 GB
  limit → ≥50% headroom. Retention/archival (normalized rows pruned after
  deadline+90d; snapshots retained in R2) is what keeps this bounded and is
  therefore a mandatory, tested job.
- Monitoring: DB size vs limit is a first-class admin health metric with an
  alert at 60% of the 10 GB limit.

## Variable / revenue-linked costs (separate)

- Stripe: ~2.9% + $0.30 per transaction (EU cards vary) — scales with
  revenue, not infrastructure.
- No LLM inference costs: V1 has no production LLM usage by design.
- No paid analytics, no paid monitoring, no paid procurement data.

## Guardrails enforced in code/config

Bounded backfills (admin-only, windowed) · per-run TED request budget ·
queue batch caps · max retries with DLQ · max keywords (50) / CPV
preferences (30) per org · bounded recompute windows · digest batching ·
emergency pause flags (ingestion_paused, digest_paused) · CPV/country
ingestion scope config · retention purge job · DB-size alert at 60%.

## Deliberately avoided

Turborepo (unneeded at this repo size), Workflows (per-step billing since
2026-08; Queues + cron suffice for our 2 pipelines — see ADR), paid
observability SaaS, paid translation, multi-region databases, Durable
Objects (rate limiting uses the native binding).
