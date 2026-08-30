# Production readiness audit — Phase 14

**Run**: 2026-08-29 · **Commit**: `99c4e61` (PR #110) · **Auditor**: Claude
Code session, procedure of record `.claude/skills/production-readiness-audit`
· **Scope**: the full Definition of Done in `docs/production-checklist.md`.

## Verdict: **FAIL**

3 HIGH, 4 MEDIUM, 4 LOW, 1 INFO. Readiness may not be declared while a HIGH
is open.

**Remediation log** (2026-08-29) — fixed: F-01, F-12 (in the audit's own
change), **F-05** (D1 capacity alert), **F-08** (no-login unsubscribe + RFC
8058 headers), **F-09** (verified-recipient filter), **F-11** (the `_headers`
check now actually runs in CI). Closed by review: **F-10**. Still open:
**F-02, F-03** — both owner-gated on the live Paddle account, and the only
remaining HIGHs; **F-04** — owner-reported done 2026-08-29 but unverified
here, with the confirming sandbox checkout still owed; **F-06** (baseline now
measured, staging measurement still owed — needs a seeded staging account in
CI secrets, an owner action); **F-07** — **now FIXED**: the owner chose the
DLQ-consumer option, so the DLQs are consumed and recorded (migration 0012).

**Follow-up security review** (2026-08-29, `security` agent, read-only, gates
re-run by the reviewer) over the F-08/F-09 change and the F-10 backlog: **no
CRITICAL or HIGH in either scope**. Three LOW/INFO items were fixed
immediately — SEC-UNSUB-01 (the recipient address was being written into
`audit_events`, whose 24-month append-only retention SURVIVES org purge and
tombstoning, while `email_deliveries` is purged at 12 months and with the org;
the in-code claim that this "adds no new PII" was wrong and the address is now
omitted), SEC-UNSUB-02 (a CRLF/NUL guard at the Resend `headers` boundary —
not exploitable with today's sole caller, but the seam that owns the risk),
and A-3 (the F-09 filter had no test at all, so deleting it would have shipped
green; now covered, and mutation-checked by removing the predicate and
confirming two tests fail). Accepted and recorded, not fixed: unsubscribe
tokens are unbounded in time and not re-bound to current membership, so a
forwarded digest can disable an org's digest later (bounded, audited,
reversible in Settings — but per-recipient suppression becomes mandatory the
day team invites ship), and `BETTER_AUTH_SECRET` reuse couples session
rotation to breaking outstanding unsubscribe links.

The failure is **not in the shipped application code**. All five quality
gates are green on `99c4e61`, the full migration chain applies from empty,
and every mandatory invariant that has a test has a passing one. What fails
is the launch path around it: production serves 41 PRs of stale code whose
billing package targets a payment provider the project has left, and the
owner-side Paddle work that would let a corrected production deploy happen
has not started, two days before the 2026-08-31 launch date.

One HIGH (F-01) was found and **fixed inside this audit**; it was a docs
defect with a money consequence, not a code defect.

---

## 1. Gates re-run (not taken from the ledger)

`pnpm install --frozen-lockfile` clean, then each gate in CI's own order
(`.github/workflows/ci.yml:34-53`):

| Gate                | Exit | Evidence                                                                                |
| ------------------- | ---- | --------------------------------------------------------------------------------------- |
| `pnpm format:check` | 0    | —                                                                                       |
| `pnpm lint`         | 0    | —                                                                                       |
| `pnpm typecheck`    | 0    | all packages                                                                            |
| `pnpm test`         | 0    | root 692 passed / 3 skipped (80 files) · worker 272 (19) · db 68 (9) = **1032 passing** |
| `pnpm build`        | 0    | web + worker                                                                            |

**One first-run failure, diagnosed and dismissed as an artifact, not
suppressed.** The first `pnpm test` failed one assertion —
`tests/security/static-asset-headers.test.ts` "is copied verbatim into
dist/ … when one exists" — because a `dist/` left over from a _pre-Paddle_
build carried the old CSP. The test compares the source `_headers` to the
built copy; my run order (test before build, matching CI) meant it read a
stale artifact. Re-run after the build: green. Root cause is F-11, not a
code defect.

## 2. Migrations

- Full chain `0001`→`0011` applied to a **fresh** local D1:
  all 11 ✅ (`wrangler d1 migrations apply bidmorrow --local` after clearing
  `.wrangler/state/v3/d1`). The `packages/db` suite independently applies the
  chain from empty in workerd before every one of its 68 tests.
- **No applied migration edited** — `git log --follow` shows exactly one
  commit per migration file, except `0010_saved_searches.sql` (2), which is
  the documented 2026-08-24 fix: block comments broke wrangler's `--remote`
  splitter, and the file was verified unapplied in _both_ live databases
  before it was touched. Staging has since applied the corrected version.

## 3. Findings

### F-01 · HIGH · Billing/docs · **FIXED in this change**

**Owner-facing setup instructions told the owner to create the LIVE Paddle
catalog tax-exclusive, contradicting the shipped pricing.**

_Evidence_: `HUMAN_DECISION_BLOCKERS.md` item 4c ("recreate the two
products/prices exactly (EUR, monthly, tax-exclusive)"), item 4 header,
snapshot item 6, item 7; `docs/setup-guide.md` §4b and §4f step 3;
`docs/redesign/pricing.md` §"Requirement on the underlying Paddle prices"
(`tax_mode: external` stated as MUST); `.claude/agents/billing.md`. Against
this, the code shipped by PR #108 is `PlanPrice.taxInclusive: true`
(`packages/billing/src/plans.ts`) and every customer surface renders "incl.
VAT". ADR-0011 §2 had been amended correctly; the instructions had not.

_Impact_: an owner following the documented steps would build a live catalog
that charges €29/€49 **plus** VAT while the pricing page, checkout page,
Settings and Terms all promise €29/€49 all-in — a price misrepresentation
discovered by the customer at the payment step, on the launch path, in the
one place a mistake costs money and trust.

_Remediation_: all eight passages corrected to `tax_mode: internal` with the
2026-08-26 supersession named. Two dated decision-log entries
(`docs/redesign/pricing.md` row 3, the redesign skill's 2026-08-17 timeline)
were annotated rather than rewritten — history stays history.

_Status_: **FIXED**.

### F-02 · HIGH · Deployment · **CLOSED 2026-08-30** (run 33318306885: D1 at 0012, production Paddle config live; smoke-step robots assertion fixed in #118)

**Production is 41 PRs behind `main` and its billing code targets a
decommissioned provider.**

_Evidence_: last `Deploy production` = run 32506382104, 2026-08-21 17:06 UTC,
commit `4448e09` (PR #69). `main` is `99c4e61` (PR #110). Live D1 read of
`bidmorrow-production` (`cd5f6ceb…`): **9** migrations recorded — missing
`0010_saved_searches` and `0011_paddle_billing` — 0 users, 0 organizations,
0 notices, 0 ingestion runs.

_Impact_: production has none of the redesign, SEO artifacts, code
splitting, navigation, brand work, or Paddle billing. It cannot take a
payment through Paddle at all. Deploying `main` is itself blocked until
F-03 supplies live Paddle secrets, so this cannot simply be run.

_Remediation_: sequence is F-03 → `production` environment secrets/vars
(blockers item 1) → deploy `main` → verify migrations 0010/0011 applied →
smoke → then the item-11 go-live flag flip.

### F-03 · HIGH · Billing · OPEN (owner) — **PARTIALLY CLOSED 2026-08-30**

**No live Paddle account; production billing secrets absent.**

_Update 2026-08-30_: the live account exists and the `paddle-live` MCP
authenticates against it. Live catalog (tax-inclusive, verified by
`transactions.preview`: DE total €29.00 = €24.37 + €4.63 VAT), notification
destination and client token created; `production` now holds the two
price-id secrets, `PADDLE_CLIENT_TOKEN`, `PADDLE_ENVIRONMENT=production` and
`ADMIN_EMAILS`. Remaining and owner-only: seller verification, website
approval for `bidmorrow.com`, default payment link, live `PADDLE_API_KEY`
and `PADDLE_WEBHOOK_SECRET`. Details: `HUMAN_DECISION_BLOCKERS.md` 4c.

_Evidence_: `HUMAN_DECISION_BLOCKERS.md` item 4c, unstarted; its own text
says "approval takes DAYS". Item 1 lists the four `PADDLE_*` production
secrets plus `PADDLE_CLIENT_TOKEN`/`PADDLE_ENVIRONMENT` as outstanding, and
`ADMIN_EMAILS` is still only set on `staging`.

_Impact_: the binding constraint on the 2026-08-31 launch. Seller
verification and website approval are asynchronous and outside anyone's
control here; every other production step queues behind them.

_Remediation_: owner starts live signup, seller verification and
`bidmorrow.com` website approval immediately.

### F-04 · MEDIUM · Billing · **OWNER-REPORTED DONE 2026-08-29, unverified here**

_Update 2026-08-30_: verified by API through the reconnected sandbox MCP —
both sandbox prices are `tax_mode: internal`; live prices likewise, with
`transactions.preview` returning €29.00 / €49.00 totals in 8 countries.
Still owed: one real inclusive checkout on staging (the only completed
sandbox transaction, €58.31, predates the switch).

**Sandbox Paddle prices were `tax_mode: external` while staging said
"incl. VAT".** Blockers 4b. The overlay added VAT on top of €29/€49, so the
staging checkout contradicted its own page.

_Status_: the owner reports both sandbox prices are now tax mode
"Inclusive". This could NOT be verified from the auditing session — no
Paddle MCP is connected and the API key is a GitHub secret that never
enters the repo — so it is recorded on the owner's word, not on an
observation. The code side was already correct
(`PlanPrice.taxInclusive: true`) and the copy already says "incl. VAT".

_Still owed, and it is the half that actually proves it_: a real sandbox
checkout on staging showing the total as €29 with VAT carved out, not €29
plus VAT added. That single observation is what distinguishes `internal`
from `external` at runtime, and the inclusive-pricing path has still never
been exercised end to end.

### F-05 · MEDIUM · Observability · **FIXED 2026-08-29**

**The DB-size alert at 60% of 10 GB does not exist.** `getDbSizeEstimate`
(`packages/db/src/repositories/admin.ts:432`) returns a PRAGMA-based byte
estimate, and the admin Dashboard renders it (correctly showing
"Unmeasured" rather than 0 when the pragma fails). But a repo-wide grep for
the threshold (`10 GB`, `0.6`, `60%`, `SIZE_LIMIT`, …) finds **no constant,
no comparison, no alert and no test**. The checklist item reads "wired and
tested"; it is neither. Impact: D1's 10 GB ceiling is the documented
storage risk (`docs/cost-model.md`, `match_components` growth) and nothing
warns before it is hit.

_Fixed_: `D1_MAX_BYTES` / `D1_SIZE_ALERT_FRACTION` + `evaluateDbSize()` in
`packages/procurement/src/health.ts`; `/api/admin/health-details` now returns
the evaluated alert rather than a bare byte count; the admin Dashboard shows
percent-of-ceiling and takes the existing `--risk` card treatment past the
threshold; and the 09:00 UTC watchdog logs `db.size.threshold_exceeded` so it
reaches the same place every other alert does — a number nobody alerts on is
not an alert. 6 tests, including the boundary (alerts exactly AT 60%, not only
past it) and the rule that an unmeasured estimate never alerts and never
fabricates a fraction.

### F-06 · MEDIUM · Performance · OPEN — **baseline measured 2026-08-29**

**"API p95 < 500 ms" has never been measured.** It appears as a target in
`docs/architecture.md:66` and as a checklist box; no measurement exists in
any doc, test, or ledger entry. The box cannot be checked on intent.

_Progress 2026-08-29_: `scripts/measure-api-latency.mjs` + a recorded
baseline in `docs/performance.md`. Local stack, 40 iterations/route, all 200:
worst p95 is the feed at **29.7 ms**, ~17× inside the budget. The harness
refuses to report a route that answered 4xx/5xx — which caught its own first
run publishing 23.9 ms for a feed request that had 400'd on a bad query
param and done no work.
**Still open, and the box stays unchecked**, because a local run is a floor,
not production: no network or edge, a seed-sized dataset (the two slowest
routes are exactly the two whose cost grows with the corpus), and the harness
cannot reach staging as written — it establishes a session through the
double-gated e2e mailbox hook, which 404s outside local/test by design.
Closing it needs a dedicated seeded staging account with credentials in CI
secrets.

### F-07 · MEDIUM · Admin/ops · **FIXED 2026-08-29** (owner picked option 2)

**Queue/DLQ depth is not on the admin health page.** `apps/worker/src/
routes/admin.ts:774-794` returns `dlq: { note }` with an honest explanation
that a DLQ's contents are not readable from the Worker runtime. The honesty
is right; the checklist item ("Admin health page shows: … queue/DLQ depth")
is still unmet.

Investigated 2026-08-29. The three DLQs (`bidmorrow-{ingest,match,digest}-dlq-*`)
are declared as `dead_letter_queue` targets in `wrangler.jsonc` but **have no
consumer** — nothing drains them and nothing reads them. So today a
dead-lettered message is not merely absent from this page: nobody ever finds
out it happened. That is a bigger hole than the checklist item describes.

Three options, with their real costs:

1. **Cloudflare Queues REST API from the admin route** — needs an account API
   token as a new Worker secret (a new owner action and a new standing
   credential in the Worker) plus an outbound dependency on the request path.
   Closes the checklist item exactly as written.
2. **A DLQ consumer that records dead-lettered messages into D1** — makes
   "depth" a real queryable number with no new secret and no outbound call,
   and additionally makes poison messages _visible_, which nothing does today.
   Costs a migration (0012) and three consumer bindings across three
   environments. Strictly better operationally; a one-way door two days before
   launch, with production already two migrations behind.
3. **Accept the deviation**, record the rationale, and strike the box.

Recommendation was **(2)**, with a note to prefer after launch. The owner
chose to take it now ("merge it till nothing is pending").

_Fixed_: migration `0012_dead_letter_messages.sql` (one new table, additive,
nothing dropped or retyped), DLQ consumers declared for all three queues in
all three environments, and a queue-handler branch that records each
dead-lettered message and only then acks — a failed D1 write retries rather
than destroying the only record of the failure. "Depth" is now
`COUNT(*) WHERE resolved_at IS NULL`, shown on the admin Dashboard with the
`--risk` treatment when non-zero, and the honest-but-empty `dlq.note` is gone.
Recording is idempotent on `provider_message_id` and uses
`onConflictDoNothing`, NOT an upsert, so a Cloudflare redelivery cannot
resurrect a row an operator already resolved — asserted by test. 8 repository
tests; the migration sentinel now expects twelve.

Deployment note that matters: production is already two migrations behind, so
its next deploy applies `0010`, `0011` and now `0012` together.

### F-08 · MEDIUM · Digest/compliance · **FIXED 2026-08-29**

**There is no unsubscribe that works without login.** The digest's only
opt-out affordance is a "Manage digest preferences" link to
`/app/settings` (`packages/notifications/src/digest-renderer.ts:152,188`),
which requires a session; there is no unsubscribe token route and no
`List-Unsubscribe` header anywhere in the repo. The checklist requires
"unsubscribe works without login". _Calibration_: this is not an imminent
deliverability failure — Gmail/Yahoo's one-click requirement binds bulk
senders (~5,000 msg/day) and BidMorrow is far below that — so the cost
today is the unmet DoD item and the recipient experience, not blocked mail.
_Fixed_: `packages/notifications/src/unsubscribe-token.ts` (HMAC-signed,
domain-separated, deliberately no expiry — an unsubscribe link must still
work in a message found months later), `apps/worker/src/routes/digest.ts`
(`GET` renders a confirmation page and mutates nothing, because mail
scanners follow links; `POST` performs it, which is also exactly RFC 8058's
one-click contract), and both headers set per recipient on the digest send.
7 route tests including a cross-org forgery attempt and idempotency.

### F-09 · LOW · Digest/auth · **FIXED 2026-08-29**

**Digest recipients are not filtered on `emailVerified`.**
`listOrganizationMemberEmails` selects every member email with no
verification predicate. This is safe _today_ only transitively: Better Auth
runs with `requireEmailVerification: true`
(`packages/auth/src/index.ts:131`) and there is **no invite flow**, so a
membership row can only be created by a verified, signed-in user for
themselves. Adding team invites — a natural next feature — would silently
begin mailing unverified addresses. _Fixed_: `listOrganizationMemberEmails` now filters on
`users.email_verified`. The function has exactly one caller (the digest),
so the change is contained; the guarantee is now a property of the query
rather than of two distant facts.

### F-10 · LOW · Process/security · **CLOSED 2026-08-29**

**PRs #107–#110 carry no recorded `security` sign-off**, though #109 added
`GET /api/account/me` returning `isAdmin`. The last recorded security
review is PR #105 (2026-08-25, no Critical/High). Reading the endpoint
(`apps/worker/src/routes/account.ts:72-83`), it is session-scoped and
self-referential — it tells you whether _you_ are an admin, and the admin
routes keep their 404 cloak — so I found no vulnerability. The finding is
that CLAUDE.md's mandated gate for authorization-touching work did not run,
not that it would have failed.

_Closed_: the `security` agent ran the retro-review on 2026-08-29 over
`ad3d7e1..99c4e61` and **confirmed** that reading against the code rather than
the PR descriptions — the endpoint sits behind `requireSession` plus the IP
rate limit, returns only the caller's own identity, and a `false` answer
distinguishes an empty allowlist from a non-listed address, so it is not an
enumeration oracle; the 404 cloak and the per-request admin audit row are
intact. #107 (secrets fail closed, never logged), #108 (copy/flags only) and
#110 (no new origins, no inline scripts) also came back clean. No finding
above INFO in any of the four.

### F-11 · LOW · Testing · **FIXED 2026-08-29**

**The `_headers` verbatim-copy assertion never executes in CI.** It is
guarded "when one exists"; CI checks out clean and runs Test **before**
Build, so `dist/_headers` never exists and the assertion silently no-ops on
every run. It fired locally only because of a stale `dist/` — which is how
this was found. Impact: a build that stopped copying `_headers` (dropping
the CSP on statically-served assets) would ship green.

_Fixed_: `scripts/verify-build-artifacts.mjs`, wired as its own "Verify build
artifacts" CI step immediately after Build, where `dist/` actually exists.
Verified by hand that it exits 1 both when `dist/_headers` is missing and when
it differs, and 0 on a good build. The test's own comment — which claimed the
quality-gate build step covered this end-to-end, and did not — is corrected;
its opportunistic assertion is kept because it still catches a stale local
`dist/`, which is how the gap surfaced.

### F-12 · INFO · Docs · **FIXED in this change**

Stale record-keeping corrected: `HUMAN_DECISION_BLOCKERS.md`'s "the
owner-side launch checklist is now EMPTY" (untrue since ADR-0011 reopened
it); the ledger's "Current phase" (still the 2026-08-16 hold, describing
the website overhaul as not-yet-started when it had shipped across #67–#110);
the ledger's "Deployment state" (still "Nothing deployed. No Cloudflare
resources exist yet."); and the ledger's "Human actions required"
(Phase-2-era list ending "None block Phases 2–7").

_Not_ changed, because it was already correct on `main`:
`docs/production-checklist.md`'s Billing section (already Paddle-shaped)
and ADR-0011 §2 (already amended to tax-inclusive).

---

## 4. Checklist walk

Verified by execution or by reading the implementation, never from a ledger
claim.

| Section                   | Verdict                     | Basis                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build & quality gates (5) | **PASS**                    | §1 above                                                                                                                                                                                                                                                                                                                            |
| Migrations (3)            | **PASS**                    | §2 above                                                                                                                                                                                                                                                                                                                            |
| Auth & tenancy (5)        | **PASS**                    | `requireEmailVerification: true`; anti-enumeration + tenant-isolation suites green; `tests/security/tenant-isolation-contract.test.ts` is a structural contract whose exemption allowlist fails when stale, plus a behavioural D1 counterpart; `requireInternalAdmin` 404-cloaks and audits. See F-09.                              |
| TED ingestion (6)         | **PASS**                    | idempotency/checkpoint/error-surfacing tests green; live staging evidence: 2026-08-29 run 133/133, 0 errors, checkpoint advancing; `NOTICE_RENDER_PENDING` handled by the retry queue, never silently dropped                                                                                                                       |
| Matching (6)              | **PASS**                    | named passing tests for determinism, component sum = total, all-UNKNOWN → LOW_FIT without throwing, `COMPONENT_MAX` = 100, evidence capping; `ENGINE_VERSION = '2'` written on every match                                                                                                                                          |
| Customer product (3)      | **FAIL**                    | pagination and the methodology page verified; **p95 never measured** (F-06)                                                                                                                                                                                                                                                         |
| Digest (3)                | **PASS** (2026-08-29)       | idempotency is genuinely DB-enforced and tested ("a raw duplicate insert fails"); no-login unsubscribe + RFC 8058 headers shipped, closing F-08                                                                                                                                                                                     |
| Billing (3)               | **PASS (code)**             | signature verification with no unverified path; `uq_billing_events__provider_event_id`; state re-fetched from Paddle, never trusted from payload; entitlements server-side. Live/sandbox separation cannot be exercised until F-03.                                                                                                 |
| Admin & ops (3)           | **PASS** (2026-08-29)       | health page, audit events and pause/resume verified; DLQ depth is a real number since F-07 — the DLQs are consumed and recorded to `dead_letter_messages`                                                                                                                                                                           |
| Observability (3)         | **PASS** (2026-08-29)       | correlation IDs and pattern-based redaction verified (`/password\|token\|secret\|authorization\|apikey\|api_key\|cookie/i` — covers `PADDLE_*` by construction); watchdog cron wired at 09:00 UTC with `STALE_INGESTION_HOURS = 36`; the 60% DB-size alert shipped 2026-08-29, closing F-05                                         |
| Security (4)              | **PASS with a process gap** | security review of PR #105: no Critical/High, four findings fixed in-tree; gitleaks green in CI; adversarial fixtures present. See F-10.                                                                                                                                                                                            |
| Testing (3)               | **PASS**                    | 1032 tests green; axe specs present; nightly E2E green 08-27, 08-28, 08-29 after being red 08-19→08-26                                                                                                                                                                                                                              |
| Deployment (5)            | **FAIL**                    | staging deployed and smoke-green; **both mandatory drills were in fact executed** on staging 2026-08-16 — rollback run 31950784770, D1 Time Travel restore run 31951034559, recorded in `docs/backup-restore.md:130-135`, so those two boxes can now be checked with evidence; production deploy gate as documented. Fails on F-02. |
| Cost (3)                  | **PASS**                    | `docs/cost-model.md` re-verified 2026-08-25 for Paddle (5% + 50¢, MoR); measured TED volumes recorded; under budget                                                                                                                                                                                                                 |
| Docs (2)                  | **FAIL**                    | consistency restored by F-01/F-12, but `HUMAN_DECISION_BLOCKERS.md` still has OPEN launch blockers, which that item forbids                                                                                                                                                                                                         |

**Correction to an earlier verbal status in this session**: I had reported
the D1 restore and rollback drills as not done, reading the unchecked boxes
as the fact. They were both executed on staging on 2026-08-16 with run IDs
recorded; only the checkbox was never ticked.

## 5. What would turn this into a PASS

In order, because each unblocks the next:

1. **F-03** — owner starts live Paddle verification + website approval today.
2. **F-04** — flip both sandbox prices to tax-inclusive; run one real
   sandbox checkout end to end on staging.
3. **F-02** — production secrets, then deploy `main`, then verify `0010`
   and `0011` applied to production D1.
4. **F-05, F-06, F-07, F-08** — the four MEDIUMs; none are large, and F-07
   may be closed by an accepted deviation instead of code.
5. Re-run this audit. Then the `prelaunch` flag flip (blockers item 11) is
   the last deliberate step.

F-09, F-10 and F-11 do not gate the launch but should not be lost.
