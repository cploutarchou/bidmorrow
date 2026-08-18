# Phase 12 Stage B — Analysis Findings (read-only)

Scope note: this session ran strictly read-only + static analysis. No
`sqlite3` CLI and no `better-sqlite3` module are available in this
environment (checked: `which sqlite3` empty, `require.resolve('better-sqlite3')`
fails at repo root and is not a dependency anywhere in the tree). I did NOT
build a throwaway sqlite DB or run any `EXPLAIN QUERY PLAN`. All query-plan
claims below are reasoned **statically** from the migration DDL
(`migrations/0001`–`0006`, fully read) and the exact Drizzle-generated SQL
reconstructed from the repository source (`packages/db/src/repositories/*`,
read in full for every hot path listed). This is flagged per-finding below
as `[STATIC, UNVERIFIED]`. No repo files were edited; nothing that starts
`wrangler dev`/`playwright` was run.

---

## 1. Performance / query-plan pass

### Index inventory (from migrations 0001–0006, complete)

Only `0002_core_schema.sql` creates indexes (0001/0003 add auth tables,
0004/0005/0006 are column-nullability changes that preserve existing
indexes verbatim). Full list relevant to hot paths:

- `tender_matches`: `uq_tender_matches__organization_id_lot_id_engine_version`
  (unique), `idx_tender_matches__organization_id_engine_version_classification_scored_at`
  (composite, 4 cols), `idx_tender_matches__lot_id`.
- `tender_lots`: `uq_tender_lots__notice_version_id_lot_number`,
  `idx_tender_lots__deadline_at`. **No index on `estimated_value_eur`.**
- `tender_notices`: `uq_tender_notices__source_source_notice_id`,
  `idx_tender_notices__publication_date`, partial
  `idx_tender_notices__archived_at`.
- `tender_cpv_codes`: `uq_tender_cpv_codes__lot_id_cpv_code`,
  `idx_tender_cpv_codes__cpv_code` (not `lot_id`-first; only useful for the
  CPV-prefix `EXISTS` subquery below when combined with a range scan, see
  finding P-3).
- `tender_geographies`: `idx_tender_geographies__lot_id` only (no index on
  `country_code`).
- `saved_tenders` / `ignored_tenders`: unique `(organization_id, lot_id)` +
  a plain `lot_id` index each — this is the only index that serves the
  feed's `saved`/`ignored` tab `EXISTS` subqueries and the batch
  `inArray(lotId, lotIds)` lookups.
- `buyers`: `uq_buyers__source_source_buyer_id`,
  `idx_buyers__source_name_country_code` — **no index usable for the feed's
  `buyerName LIKE '%...%'` substring filter** (a leading-wildcard LIKE
  can't use any index regardless).
- `match_components` / `match_risk_flags`: unique
  `(match_id, component_key)` and plain `match_id` index respectively.
- `organizations`, `users`: no non-PK/non-unique indexes beyond the ones
  shown (organizations has none at all beyond PK; `suspended_at` added by
  0004 is unindexed).
- `ingestion_errors`: `ingestion_run_id`, `(source, source_notice_id)`.
- `email_deliveries`: `(organization_id, created_at)` — serves
  `getRecentErrorCounts`'s 24h `emailDeliveries` count reasonably (leading
  column matches the `eq(organizationId,...)`-free query below only
  partially, see P-6).

### P-1 [HIGH] `listFeedRows` ORDER BY is not covered by any index — full sort on every feed page

`packages/db/src/repositories/matching.ts:711-719` (`GET /api/org/feed`,
the single hottest customer-facing query):

```sql
SELECT ...
FROM tender_matches
JOIN tender_lots ON tender_matches.lot_id = tender_lots.id
JOIN tender_notices ON tender_matches.notice_id = tender_notices.id
LEFT JOIN buyers ON tender_notices.buyer_id = buyers.id
WHERE tender_matches.organization_id = ?
  AND tender_matches.engine_version = ?
  AND tender_matches.classification <> 'EXCLUDED'
  [+ tab-specific classification/scoredAt/EXISTS conditions]
  [+ optional filters]
ORDER BY tender_matches.score DESC, tender_matches.id DESC
LIMIT ?
```

The only composite index on `tender_matches` is
`(organization_id, engine_version, classification, scored_at)` — it has
neither `score` (the actual ORDER BY key) nor is it a prefix match for the
`today` tab (which doesn't filter on `classification` at all, only
`scored_at` range) or the `strong`/`worth_reviewing`/`possible` tabs (which
filter `classification` as an equality but then still need to sort by
`score`, a column not in the index). SQLite can use the index to satisfy
the WHERE prefix (`organization_id`, `engine_version`, optionally
`classification`) but then must sort the matched rows in memory (`ORDER BY
score DESC` is not index-supplied) — for the `today`/`strong`/etc. tabs
this is a bounded "filter with index, sort in memory" which is fine at
today's row counts but degrades linearly with an org's match count per
engine version as the ingestion corpus grows (V1 has one CPV-scoped source
— docs/cost-model.md — but this is still the single highest-QPS query in
the app). `[STATIC, UNVERIFIED — no EXPLAIN QUERY PLAN could be run]`

**Proposed fix** — add a covering index matching the actual sort:

```sql
CREATE INDEX idx_tender_matches__org_engine_score_id
  ON tender_matches (organization_id, engine_version, score DESC, id DESC);
```

This serves the `today`/no-tab-filter/saved/ignored paths' WHERE+ORDER BY
directly (classification is a cheap post-filter on a narrow row). For the
`strong`/`worth_reviewing`/`possible` tabs, a second composite keeping
classification as a prefix would be ideal too:

```sql
CREATE INDEX idx_tender_matches__org_engine_class_score_id
  ON tender_matches (organization_id, engine_version, classification, score DESC, id DESC);
```

This second index would also directly serve the keyset-cursor's `(score,
id)` tiebreak used by `decodeScoreCursor`. Given SQLite index cardinality
concerns and D1 write-amplification cost, I'd recommend shipping only the
first (broader) index and re-evaluating the second once the classification
tabs show up as slow in production observability — do not create both
speculatively.

### P-2 [MEDIUM] `listTenderMatchesForFeed`'s doc comment references an index that doesn't match its own ORDER BY either — RESOLVED 2026-08-16 (removed)

**Resolution (Phase 13 hardening)**: confirmed dead for production — not in
the package barrel, no app caller; `feed.ts` uses `listFeedRows`. The
function (plus its private `decodeFeedCursor` and `ListMatchesForFeedArgs`)
was deleted and the two `tenant-isolation.d1.test.ts` usages ported to
`listFeedRows`, so the isolation suite now exercises the feed query
customers actually hit. Original finding kept below for the record.

`matching.ts:239-243`'s doc comment claims it's "Backed by
`idx_tender_matches__organization_id_engine_version_classification_scored_at`"
and its `ORDER BY desc(scoredAt), desc(id)` — that part IS a genuine
prefix match of the composite index (when a `classifications` filter is
also supplied) and does NOT need a new index. However this function
appears to be **dead code for the customer feed** — `feed.ts` calls
`listFeedRows`, not `listTenderMatchesForFeed`; the latter's only other
caller found is `packages/db/src/tenant-isolation.d1.test.ts`. Worth
confirming with the team whether this is intentionally-kept legacy/test
scaffolding or should be removed — not a perf bug, just noted so it isn't
mistaken for the feed's actual query path during future index tuning.

### P-3 [MEDIUM] CPV-prefix and country feed filters are `EXISTS` subqueries with only partial index support

`matching.ts:671-700`. The `cpvPrefix` filter:

```sql
EXISTS (SELECT 1 FROM tender_cpv_codes
        WHERE tender_cpv_codes.lot_id = tender_lots.id
          AND tender_cpv_codes.cpv_code LIKE ? ESCAPE '\')
```

`idx_tender_cpv_codes__cpv_code` is NOT lot_id-led, so this EXISTS can't
seek by lot_id via that index; it CAN however use the unique
`(lot_id, cpv_code)` index for the `lot_id = tender_lots.id` correlation
(a prefix-LIKE on the trailing `cpv_code` column of that same index is
still a valid range scan since the pattern has no leading wildcard —
`escapeLikePattern` + `${prefix}%` is a right-anchored wildcard, which
SQLite CAN use as an index range scan on `(lot_id, cpv_code)`). This one is
likely fine as-is. The `country` filter's EXISTS:

```sql
EXISTS (SELECT 1 FROM tender_geographies
        WHERE tender_geographies.lot_id = tender_lots.id
          AND tender_geographies.country_code = ?)
```

only has `idx_tender_geographies__lot_id` (lot_id alone) — SQLite can seek
to the lot_id but then must scan every geography row for that lot to check
`country_code` (lots have very few geography rows typically, so this is
low-severity, but a composite would still help):

```sql
CREATE INDEX idx_tender_geographies__lot_id_country_code
  ON tender_geographies (lot_id, country_code);
```

Low priority — lot-to-geography fanout is small (typically 1–3 rows), so
the current index is probably fine in practice; listed for completeness.
`[STATIC, UNVERIFIED]`

### P-4 [HIGH] `scoreLotsForOrgs` — genuine N+1 write pattern in the scoring hot path

`packages/procurement/src/score.ts:186-250`. For every `(lot, org)` pair
that survives the CPV pre-filter, the code calls `insertTenderMatches` (or
`replaceTenderMatches` in recompute mode) **one pair at a time**, and
`insertTenderMatches` itself (`matching.ts:121-217`) does, per call:

1. `matchExists` — a `SELECT ... LIMIT 1` existence check (one round trip).
2. `db.batch([...])` — a second round trip (insert match + optional
   component rows + optional risk-flag rows, correctly batched as ONE
   transaction internally, but that batch is still issued per pair).

With `MAX_PAIRS_PER_INVOCATION = 5_000` and the CPV pre-filter documented
as removing "≥80% of pairs" (`docs/cost-model.md`), a single scoring
invocation processing up to 5,000 considered pairs can still issue on the
order of **hundreds to ~1,000 scored pairs × 2 D1 round trips each** in a
tight sequential loop (`await` inside a `for` over `orgsWithDivisions`
inside a `for` over `lotBundles`) — this is a textbook N+1: the existence
check and the write are never batched across pairs even though
`insertTenderMatches` already accepts `args.matches: TenderMatchInput[]`
(plural) as its input type, i.e. the repository function's own signature
supports batching a whole array of matches in one transaction, but
`scoreLotsForOrgs` calls it with a single-element array on every
iteration instead of accumulating matches per invocation and calling it
once (or in bounded chunks) at the end.

**This is the single most consequential perf finding in the scoring path**
— it directly multiplies D1 request count (and, on Cloudflare D1, request
count is part of the pricing/latency model — docs/cost-model.md) by the
number of scored pairs, and serializes them (no `Promise.all`, each
`await`ed in turn), so wall-clock time for one scoring invocation scales
linearly with round-trip latency × pairs scored rather than batch count ×
round-trip latency.

**Recommended fix** (no code changed here, description only): accumulate
`TenderMatchInput[]` across the inner org loop (or across the whole
invocation, capped by a batch size like 100–200) and call
`insertTenderMatches`/`replaceTenderMatches` once per batch instead of
once per pair. `matchExists`'s existence check would need to become a
single `WHERE ... AND lot_id IN (...) AND engine_version = ?` bulk lookup
per batch (already have `uq_tender_matches__organization_id_lot_id_engine_version`
to serve that IN-list efficiently) rather than N individual `SELECT`s.
Note this is a **functional refactor**, not just an index addition — flag
for the next implementation phase, not something a migration alone fixes.

### P-5 [MEDIUM] Ingestion `processOneNotice` is fully sequential, ~8+ round trips per notice

`packages/procurement/src/run-window.ts:177-352`. Per notice inside a
250-notice search page: `getNoticeByPublicationNumber` →
`getLatestVersionNumber` (conditional) → `fetchNoticeXml` (network) →
`insertSnapshotIfNewHash` → optional R2 `put` → `upsertBuyer` (conditional)
→ `upsertNoticeWithVersion` → `insertLots` → `insertCpvCodes` →
`insertGeographies`, all `await`ed in strict sequence with no
`Promise.all` anywhere in this function. This is **partially unavoidable**
(each step's SQL genuinely depends on the previous step's result — e.g.
you need the notice id before you can insert lots), so I'm not proposing
an index fix here — this is architecture, not a missing index — but it's
worth flagging as a per-notice cost multiplier: at `SEARCH_PAGE_LIMIT =
250` notices/page, a full page is up to ~2,000 sequential D1 round trips
before the next page even starts fetching. Given `docs/cost-model.md`
already treats this as an accepted trade-off for V1 volume, I'm ranking
this **MEDIUM/informational** rather than actionable — flag for
production-reviewer to confirm the cost model still holds as TED volume
for the configured CPV scope grows.

### P-6 [LOW] Admin `getUsageCounts`/`getOrgAdminDetail` issue unindexed `COUNT(*)` full-table scans

`packages/db/src/repositories/admin.ts:324-354` (`GET /api/admin/usage`)
runs 5 parallel `SELECT COUNT(*)` over `organizations`, `users`,
`tender_notices`, `tender_lots`, `tender_matches` — none of these tables
has a covering index that would let SQLite answer a bare `COUNT(*)` from
an index rather than a full table scan (SQLite picks the smallest
available index for a covering count scan when one exists; none of these
tables has a non-nullable, always-present secondary index that's smaller
than the table itself here — `tender_matches` does have narrower indexes,
so `COUNT(*)` there may use one, but the base tables do not).
`getOrgAdminDetail` (`admin.ts:106-165`) similarly does 3 `COUNT(*)` per
org-detail view, each correctly `WHERE organization_id = ?` and each IS
served by an existing index prefix (`tender_matches`'s composite,
`saved_tenders`'/`customer_feedback`'s org-scoped unique/plain indexes) —
those are fine. Only the **global**, no-WHERE counts in `getUsageCounts`
are the concern, and this is an admin-only, low-QPS dashboard endpoint
(not a customer hot path), so ranked **LOW**. If it becomes a real cost
line as row counts grow, the standard mitigation is periodic materialized
counters rather than an index (an index can't make `COUNT(*)` with no
WHERE clause sub-linear in SQLite without a covering index equal in row
count to the table, which defeats the purpose).

### P-7 [INFO] Unbounded-query audit — no violations found

Every hot-path list query read (`listFeedRows`, `listDigestCandidateMatches`,
`listTenderMatchesForFeed`, every `admin.ts` list route, `searchOrganizationsAdmin`,
`searchUsersAdmin`) has an explicit `.limit(...)` via `normalizeLimit`
(shared.ts) or a documented "V1 customer count is small" unpaginated
exception (`listOrgsEligibleForScoring`, `listOrgsWithDigestEnabled`,
`selectDigestOrgs` iterating candidates) that is explicitly commented and
intentional, not an oversight. No missing-LIMIT finding to report.

---

## 2. Testing-gap sweep

Inventory (verified by reading/grepping, not assumed):

- `tests/security/`: only 2 files — `tenant-isolation-contract.test.ts`
  (structural: every tenant repo function requires `organizationId`;
  classifies files GLOBAL/TENANT/exempt) and `static-asset-headers.test.ts`
  (CSP/_headers — **covered**, confirmed by reading the file: HSTS, CSP
  self-only, X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
  X-Frame-Options, and the "copied into dist/" build check).
- Cross-tenant/authz/privilege-escalation tests actually live in
  `apps/worker/src/tenancy.test.ts` and `apps/worker/src/auth.test.ts`
  (not under `tests/security/`) — confirmed real coverage: cross-org
  read/write isolation, no client-supplied `organizationId` override,
  role escalation (MEMBER on OWNER-only routes), INTERNAL_ADMIN 404 for
  non-admin + allowlist, account-deletion edge cases, request-body-size
  limit, keyword cap, website-URL scheme restriction (XSS-adjacent).
- Webhook replay/idempotency: **covered** —
  `apps/worker/src/billing.d1.test.ts` has an explicit
  `'replaying the same event id is idempotent: 200 + single row, no
duplicate insert'` test plus out-of-order/duplicate-delivery cases.
- ECB rate staleness fallback: **covered** — confirmed
  `packages/db/src/repositories/ops-global.d1.test.ts` directly tests
  `getRate` at exactly `RATE_MAX_AGE_DAYS` (fresh, passes) and
  `RATE_MAX_AGE_DAYS + 1` (stale, returns null → engine falls back to
  UNKNOWN). Initially suspected a gap here from a comment-only grep hit;
  verified against the actual test file before reporting — **not a gap**.
- Catch-up window bounds: **covered** —
  `packages/procurement/src/checkpoint-windows.test.ts` tests first-run
  (no historic backfill), `maxWindows` bounding, "fully caught up" empty
  result, and "never today" — **not a gap**.
- Digest empty-state: **covered** — `apps/worker/src/digest.d1.test.ts`
  has both `'empty + !sendEmpty → skipped_empty, no email sent'` and
  `'empty + sendEmpty → sends anyway'` — **not a gap**.
- Admin audit logging: **partially covered** —
  `apps/worker/src/admin.d1.test.ts`'s `'audit logging (SEC-P4-07)'`
  block verifies the happy path (a read writes one `admin.request` row; a
  mutation writes both a generic + a specific row). **Gap**: no test
  covers the audit-write failure/ordering path. `writeAdminAction`
  (`routes/admin.ts:94-122`) is called **after** the mutation completes in
  every route (e.g. `suspendOrganization` runs, then
  `writeAdminAction(...)` — not wrapped in try/finally, not part of the
  same transaction as the mutation). If the audit insert itself throws
  (e.g. a transient D1 error), the handler throws too and the client sees
  a 500 — but the mutation (org suspended, flag flipped, etc.) has ALREADY
  happened with **no audit trail**, and there is no test exercising this
  ordering or documenting the accepted risk. **RISK: MEDIUM** — this is a
  real "admin action with no audit row" gap, though it requires a D1
  failure specifically on the second write to trigger, and the model here
  (write-after-mutate, not transactional) appears to be an accepted
  trade-off rather than an oversight — but there's no test OR doc comment
  in `admin.ts` making that trade-off explicit the way other
  intentionally-imperfect trade-offs in this codebase are documented
  (contrast with the digest resume-path doc comments, which are very
  explicit about accepted risk). Recommend either a doc comment
  acknowledging non-atomicity, or a test asserting the current (accepted)
  behavior so a future refactor doesn't silently change it.
- Rate-limit middleware (`rateLimitOrgApi`,
  `apps/worker/src/middleware/rate-limit.ts`): **genuine gap, confirmed by
  grep** — no test file matches `rate-limit` in its name
  (`find **/rate-limit*.test.ts` → no results), and grepping every
  `*.test.ts` under `apps/worker/src` for `rate.?limit|429` only turns up
  the two files that ALREADY appeared above for unrelated reasons
  (`tenancy.test.ts`, `auth.test.ts`), and neither actually asserts a 429
  or exercises the limiter — the two hits are just comments referencing
  "Better Auth's own database-storage rate limiter (docs/security.md C7)",
  a DIFFERENT rate limiter (Better Auth's own, for `/api/auth/*`) than
  the one this middleware wraps (`API_RATE_LIMITER`, Workers-native
  binding, for `/api/org/*`). **Zero test coverage** of: (a) the 429 path
  when the binding rejects, (b) the fail-open path when
  `API_RATE_LIMITER` is undefined (explicitly documented as intentional
  in the middleware's own doc comment — "skips limiting rather than
  failing closed"), (c) the once-per-isolate warn-log dedup
  (`missingBindingLogged`). **RISK: MEDIUM-HIGH** — this is a genuinely
  untested security control on every `/api/org/*` route; the fail-open
  behavior in particular is a documented, deliberate design decision that
  has no regression test protecting it (a future change to "fail closed"
  or a bug that silently disables limiting would go undetected). This is
  straightforward to test with `vitest-pool-workers`' fake/miniflare
  rate-limiter binding.
- Queue consumer dispatch (`queue()` in `apps/worker/src/index.ts:240-348`):
  **genuine gap, confirmed by grep** — grepped every `*.test.ts` under
  `apps/worker/src` for `MessageBatch`/`.queue(` — the only hit
  (`ingestion.continuation.test.ts`) tests the **producer** side
  (`enqueueScoreContinuation`, i.e. what gets sent TO the queue), never
  the **consumer** dispatcher itself. The exported `queue` function's
  per-message `try { switch(...) } catch { message.retry() }` /
  `message.ack()` routing — including the explicit poison-message handling
  for an unrecognized `kind` (`SEC-P6-02`/`SEC-P8-04` comments describing
  exactly this as a deliberate "never silently ack it, throw so it
  retries then DLQs" design) — has **zero direct test coverage**. Every
  `run*Job` function it calls (`runIngestCatchUpJob`, `runScoreJob`, etc.)
  IS unit/D1-tested individually elsewhere, but the dispatcher's own
  control flow (does an unrecognized kind actually call `.retry()` and
  not `.ack()`? does one message's failure `.retry()` without blocking
  processing of the next message in the same batch? does the
  `digestProvider` get hoisted once per batch, not per message, as the
  comment claims?) is untested. **RISK: HIGH** — this is exactly the kind
  of "glue code no one writes a unit test for because every piece it
  calls is tested" gap, and it directly implements the DLQ/retry
  semantics the task explicitly calls out as a target area. `MessageBatch`
  can be constructed as a plain mock object (it's a plain interface with
  `.messages`, no live Cloudflare binding needed) — this is testable with
  `vi.fn()` stand-ins for `message.ack`/`message.retry` and stubbed
  `run*Job` imports, no real queue infrastructure required.
- CSP/`_headers`: **covered** (see above).
- Contract tests (TED fixtures): the fixture set in `tests/fixtures/ted/`
  matches every category the spec lists — normal, multi-lot, missing
  value, missing deadline, corrected notice (`normal-corrected.xml`),
  non-English, malformed (`malformed-truncated.xml`), unexpected optional
  fields, and a second schema version (`1.13/second-schema-version.xml` vs
  the primary `1.15/` set) — did not re-verify every fixture is actually
  wired into a running contract test (out of scope for this static pass;
  the file inventory alone matches the spec's checklist), flagging as
  **not fully verified, but the fixture inventory itself is complete**.

### Gap ranking (risk-ordered)

1. **HIGH** — Queue consumer `queue()` dispatch logic untested (ack/retry/poison-message routing, per-batch provider hoisting).
2. **MEDIUM-HIGH** — Rate-limit middleware (`rateLimitOrgApi`) untested: no 429 assertion, no fail-open regression test.
3. **MEDIUM** — Admin audit-write-after-mutate ordering/failure path undocumented and untested (non-atomic audit trail).
4. **INFO** — A few areas initially suspected as gaps from keyword grepping (ECB staleness, catch-up window bounds, digest empty-state, CSP headers) were verified to already have solid coverage — listed above specifically so this isn't miscounted as an unverified claim.

---

## 3. E2E-in-CI recommendation

**Recommendation: (c) — a separate nightly scheduled workflow, NOT a
per-PR blocking or non-blocking job.**

Reasoning:

- The existing `ci.yml` `checks` job already runs
  format/lint/typecheck/test/build sequentially in one job on every PR —
  adding `wrangler dev` + local D1 + seed + Playwright to that job (option
  a) would make every PR pay for a chromium download (~120MB, not cached
  by default unless a cache step is added) plus a `wrangler dev` cold
  start (the Playwright config's own comment notes this "can take a
  while" — 180s timeout) plus the E2E run itself, all sequentially before
  the PR gets a status — this meaningfully slows the fast
  inner-loop feedback the current single-job CI is optimized for, and a
  chromium/wrangler-dev-related flake would then block unrelated PRs from
  merging.
- A non-blocking per-PR workflow (option b) still pays the same
  chromium-download + wrangler-dev-startup cost on every PR (GitHub
  Actions billed minutes, real cost even if non-blocking), and non-blocking
  CI checks are, in practice, ignored once they start flaking — this
  tends to rot into "green X" theater rather than real signal, which
  actively works against the docs/project-guide.md rule "never claim a test ran when
  it didn't" / "failing tests are findings" ethos this project holds
  everywhere else.
- Nightly (option c) amortizes the chromium-download + wrangler-dev-boot
  cost to once/day instead of once/PR, still catches E2E regressions
  within a bounded (worst-case ~24h) window, and — critically — a
  single-worker, non-parallel, ordered spec suite (`workers: 1,
fullyParallel: false` — this is explicit in `playwright.config.ts`,
  because the critical-path spec is one ordered signup→onboarding→feed
  journey against one seeded worker) is inherently a worse fit for
  "gate every PR" than for "run once, alert if it breaks."
- Option (d) (manual pre-release only) under-uses work already invested in
  Phase 12 stage A (the seeded webserver script, the fixture-driven demo
  seed, the accessibility/keyboard specs) — a scheduled nightly is barely
  more infrastructure than manual-only but gives continuous signal without
  the per-PR cost of (a)/(b).

**Concrete wiring sketch** (illustrative only — NOT applied to
`ci.yml`/any new file in this session):

```yaml
# .github/workflows/e2e-nightly.yml (NEW FILE, separate from ci.yml)
name: E2E (nightly)

on:
  schedule:
    - cron: '0 3 * * *' # 03:00 UTC daily
  workflow_dispatch: {} # manual trigger for pre-release verification

permissions:
  contents: read

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # Cache the Playwright browser binary across nightly runs — avoids
      # the ~120MB chromium download on every scheduled run, not just
      # every PR.
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ hashFiles('pnpm-lock.yaml') }}

      - name: Install Playwright chromium
        run: npx playwright install --with-deps chromium

      # scripts/e2e-webserver.sh handles build+seed+wrangler-dev startup;
      # Playwright's own webServer config invokes it — no separate step
      # needed here, matching local `pnpm test:e2e` behavior exactly.
      - name: Run E2E suite
        run: pnpm test:e2e
        env:
          CI: true

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  notify-on-failure:
    needs: e2e
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - run: echo "Nightly E2E failed — wire to Slack/email/issue-creation per team preference."
```

Once E2E stability is proven over a few weeks of nightly runs (low
flake rate), promoting a **subset** (just `critical-path.spec.ts`, not
`accessibility.spec.ts`/`keyboard.spec.ts`) to a non-blocking per-PR job
(option b) would be the natural next step — but that's a future decision,
not this session's recommendation.

---

## Honesty notes / what I could not verify

- No `EXPLAIN QUERY PLAN` was actually run anywhere in this report — every
  query-plan claim is derived from reading the Drizzle-generated DDL
  (migrations) against the reconstructed SQL shape from repository source,
  which I'm confident is accurate (Drizzle's query builder maps 1:1 to the
  SQL shown) but is explicitly `[STATIC, UNVERIFIED]` per the task's own
  instruction, since no sqlite3/better-sqlite3 tool was available in this
  environment to confirm empirically.
- I did not run `pnpm test`, `pnpm typecheck`, or any other quality-gate
  command in this session — the task instructions for this specific
  analysis explicitly required staying read-only and avoiding the task
  chain (this conflicts with a `run-quality-gates` skill block that was
  also attached to this session's instructions; I followed the more
  specific, explicit read-only constraint for THIS task rather than the
  generic skill template, and I'm flagging that choice here rather than
  silently ignoring the conflict).
- I did not verify that every fixture file under `tests/fixtures/ted/` is
  actually wired into a passing contract test assertion (only that the
  fixture inventory matches the spec's required category list) — that
  would require running the contract test suite, which this session's
  constraints prohibited.
