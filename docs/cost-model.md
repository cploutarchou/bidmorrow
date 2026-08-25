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

- Ingestion: 1 daily cron, ~150–300 scoped notices/day. TED's async
  notice-XML rendering (docs/ted-data-source.md, 2026-08-18) makes the
  happy path ≥2 fetches/notice, and the ADR-0008 fetch-retry drain (amended
  2026-08-19) adds ≤150 requests/day worst case (25 rows × 6 render
  visits) → ~350–800 outbound TED calls/day, inside the self-imposed
  2,000/run budget; these are outbound subrequests, not billed Worker
  requests. ADR-0009 (2026-08-20) removes the early abort for
  render-pending-only days: the degraded-day worst case (every render
  pending, full 6 visits each) is ~936 fetches at 156 notices/day and
  ~1,800 at the 300/day ceiling — still inside the 2,000/run budget; $0
  billing impact (outbound subrequests). Queue-batched normalization → well under 100k Worker
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

**MEASURED 2026-08-16** (live TED API, ted-gates workflow run #3, one
`totalNoticeCount` query per day for 2026-08-07..13): 141 / 0 / 0 / 173 /
149 / 119 / 132 — weekday avg ≈ **143/day**, incl-weekend avg ≈ 102/day
(TED publishes nothing on weekends). The 150–300/day assumption holds
with margin; no scope tightening needed (ADR-0003 trigger is >600/day).

- Worst case unpruned: 300/day × 20 KB × 365 ≈ **2.2 GB/year** + match rows.
- Match rows dominate at scale: matches ≈ orgs × active lots. With 90-day
  retention (deadline-passed + 90d purge) the active window is ~9–18k lots;
  at 100 orgs ≈ 1.4M match rows + ~11M component rows ≈ 1.5–3 GB steady
  state. Component rows are the biggest table → store component details as
  one compact JSON column per match if row growth outpaces projection
  (decision recorded in data-model doc; revisit at 50 orgs).
- `ingestion_fetch_retries` (ADR-0008, amended 2026-08-19): rows exist only
  for per-notice fetch/render failures — pessimistic 1%/day at the 300/day
  ceiling ≈ **0.33 MB/year** worst case before the 90-day terminal-row
  purge (steady state a few KB). Measured render-pending incidence
  2026-08-19: 1/156 ≈ 0.6%. **The 1% assumption is falsified for burst
  days** (2026-08-20: 32/156 ≈ 20.5% skipped render-pending; ADR-0009 —
  the TED render pipeline is currently completing no renders at all):
  terminal rows purge after 90 days, but `pending` rows accumulated
  during a sustained render outage do not — absolute worst case, 12
  months of total outage at the 300/day ceiling ≈ 110k rows × ~300 B ≈
  **33 MB** — still negligible vs the 10 GB cap; no headroom impact.
  ADR-0009's `notices_render_pending` run-column adds ~6 KB/year (noise).
- **Steady state projection ≤ ~3–5 GB total at 100 customers** vs 10 GB
  limit → ≥50% headroom. Retention/archival (normalized rows pruned after
  deadline+90d; snapshots retained in R2) is what keeps this bounded and is
  therefore a mandatory, tested job.
- Monitoring: DB size vs limit is a first-class admin health metric with an
  alert at 60% of the 10 GB limit.

## Variable / revenue-linked costs (separate)

- Paddle (Merchant of Record, ADR-0011): **5% + 50¢ per transaction**
  (Paddle's published rate — developer.paddle.com "How does Paddle
  compare?" table, verified 2026-08-25; the API's `fee_rate` example is
  `0.05`). Paddle collects and remits VAT itself, so no tax-compliance
  cost sits on this line. Scales with revenue, not infrastructure. Prices
  are VAT-inclusive (owner decision 2026-08-26), so the net depends on the
  customer's VAT share: reverse-charge B2B ≈ €27.05 (Founding €29) /
  €46.05 (Standard €49); a 19% VAT consumer ≈ €22.42 / €38.23.
- No LLM inference costs: V1 has no production LLM usage by design.
- No paid analytics, no paid monitoring, no paid procurement data.

## Guardrails enforced in code/config

Bounded backfills (admin-only, windowed) · per-run TED request budget ·
queue batch caps · max retries with DLQ · max keywords (50) / CPV
preferences (30) per org · bounded recompute windows · digest batching ·
emergency pause flags (ingestion_paused, digest_paused) · CPV/country
ingestion scope config · retention purge job · DB-size alert at 60% ·
fetch-retry drain caps (≤25 rows × ≤6 render visits/run, 5 attempts, then
alerting abandonment — ADR-0008) · systemic fetch-failure threshold on
genuine fetch failures (ADR-0008 §2 as narrowed by ADR-0009 §1; render-
pending days alert via RENDER_PENDING_DEGRADED instead of failing) ·
cause-classified drain skip on systemic/budget window failures
(ADR-0009 §2).

## Deliberately avoided

Turborepo (unneeded at this repo size), Workflows (per-step billing since
2026-08; Queues + cron suffice for our 2 pipelines — see ADR), paid
observability SaaS, paid translation, multi-region databases, Durable
Objects (rate limiting uses the native binding).
