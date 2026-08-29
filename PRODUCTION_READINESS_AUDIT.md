# Production readiness audit — Phase 14

**Run**: 2026-08-29 · **Commit**: `99c4e61` (PR #110) · **Auditor**: the assistant
Code session, procedure of record `docs/procedures/production-readiness-audit.md`
· **Scope**: the full Definition of Done in `docs/production-checklist.md`.

## Verdict: **FAIL**

3 HIGH, 4 MEDIUM, 4 LOW, 1 INFO. Readiness may not be declared while a HIGH
is open.

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
(`tax_mode: external` stated as MUST); `docs/conventions/billing.md`. Against
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

### F-02 · HIGH · Deployment · OPEN

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

### F-03 · HIGH · Billing · OPEN (owner)

**No live Paddle account; production billing secrets absent.**

_Evidence_: `HUMAN_DECISION_BLOCKERS.md` item 4c, unstarted; its own text
says "approval takes DAYS". Item 1 lists the four `PADDLE_*` production
secrets plus `PADDLE_CLIENT_TOKEN`/`PADDLE_ENVIRONMENT` as outstanding, and
`ADMIN_EMAILS` is still only set on `staging`.

_Impact_: the binding constraint on the 2026-08-31 launch. Seller
verification and website approval are asynchronous and outside anyone's
control here; every other production step queues behind them.

_Remediation_: owner starts live signup, seller verification and
`bidmorrow.com` website approval immediately.

### F-04 · MEDIUM · Billing · OPEN (owner)

**Sandbox Paddle prices are still `tax_mode: external` while staging says
"incl. VAT".** Blockers 4b. The overlay adds VAT on top of €29/€49, so the
staging checkout currently contradicts its own page. Not customer-facing
(sandbox), but it means the inclusive-pricing path has never actually been
exercised end to end. Remediation: switch both prices to tax mode
"Inclusive" in the sandbox dashboard, then re-run a sandbox checkout.

### F-05 · MEDIUM · Observability · OPEN

**The DB-size alert at 60% of 10 GB does not exist.** `getDbSizeEstimate`
(`packages/db/src/repositories/admin.ts:432`) returns a PRAGMA-based byte
estimate, and the admin Dashboard renders it (correctly showing
"Unmeasured" rather than 0 when the pragma fails). But a repo-wide grep for
the threshold (`10 GB`, `0.6`, `60%`, `SIZE_LIMIT`, …) finds **no constant,
no comparison, no alert and no test**. The checklist item reads "wired and
tested"; it is neither. Impact: D1's 10 GB ceiling is the documented
storage risk (`docs/cost-model.md`, `match_components` growth) and nothing
warns before it is hit. Remediation: threshold constant + surfacing on
health-details + a test.

### F-06 · MEDIUM · Performance · OPEN

**"API p95 < 500 ms" has never been measured.** It appears as a target in
`docs/architecture.md:66` and as a checklist box; no measurement exists in
any doc, test, or ledger entry. The box cannot be checked on intent.
Remediation: measure against staging (which has real ingested data) and
record the numbers, or renegotiate the DoD item.

### F-07 · MEDIUM · Admin/ops · OPEN — needs an owner decision

**Queue/DLQ depth is not on the admin health page.** `apps/worker/src/
routes/admin.ts:774-794` returns `dlq: { note }` with an honest explanation
that a DLQ's contents are not readable from the Worker runtime. The honesty
is right; the checklist item ("Admin health page shows: … queue/DLQ depth")
is still unmet. Remediation: either read depth via the Cloudflare Queues
API from the admin route, or record an accepted deviation with rationale so
the box can be struck rather than left silently unchecked.

### F-08 · MEDIUM · Digest/compliance · OPEN

**There is no unsubscribe that works without login.** The digest's only
opt-out affordance is a "Manage digest preferences" link to
`/app/settings` (`packages/notifications/src/digest-renderer.ts:152,188`),
which requires a session; there is no unsubscribe token route and no
`List-Unsubscribe` header anywhere in the repo. The checklist requires
"unsubscribe works without login". _Calibration_: this is not an imminent
deliverability failure — Gmail/Yahoo's one-click requirement binds bulk
senders (~5,000 msg/day) and BidMorrow is far below that — so the cost
today is the unmet DoD item and the recipient experience, not blocked mail.
Remediation: a signed unsubscribe-token route plus the `List-Unsubscribe`
and `List-Unsubscribe-Post` headers.

### F-09 · LOW · Digest/auth · OPEN (defence in depth)

**Digest recipients are not filtered on `emailVerified`.**
`listOrganizationMemberEmails` selects every member email with no
verification predicate. This is safe _today_ only transitively: Better Auth
runs with `requireEmailVerification: true`
(`packages/auth/src/index.ts:131`) and there is **no invite flow**, so a
membership row can only be created by a verified, signed-in user for
themselves. Adding team invites — a natural next feature — would silently
begin mailing unverified addresses. Remediation: filter on `emailVerified`
in the recipient query, so the guarantee is local to the query that needs
it.

### F-10 · LOW · Process/security · OPEN

**PRs #107–#110 carry no recorded `security` sign-off**, though #109 added
`GET /api/account/me` returning `isAdmin`. The last recorded security
review is PR #105 (2026-08-25, no Critical/High). Reading the endpoint
(`apps/worker/src/routes/account.ts:72-83`), it is session-scoped and
self-referential — it tells you whether _you_ are an admin, and the admin
routes keep their 404 cloak — so I found no vulnerability. The finding is
that docs/project-guide.md's mandated gate for authorization-touching work did not run,
not that it would have failed.

### F-11 · LOW · Testing · OPEN

**The `_headers` verbatim-copy assertion never executes in CI.** It is
guarded "when one exists"; CI checks out clean and runs Test **before**
Build, so `dist/_headers` never exists and the assertion silently no-ops on
every run. It fired locally only because of a stale `dist/` — which is how
this was found. Impact: a build that stopped copying `_headers` (dropping
the CSP on statically-served assets) would ship green. Remediation: run the
check after build in CI, or assert against the build output in a
post-build step.

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
| Digest (3)                | **FAIL**                    | idempotency is genuinely DB-enforced and tested ("a raw duplicate insert fails"); **no no-login unsubscribe** (F-08)                                                                                                                                                                                                                |
| Billing (3)               | **PASS (code)**             | signature verification with no unverified path; `uq_billing_events__provider_event_id`; state re-fetched from Paddle, never trusted from payload; entitlements server-side. Live/sandbox separation cannot be exercised until F-03.                                                                                                 |
| Admin & ops (3)           | **FAIL**                    | health page, audit events and pause/resume verified; **DLQ depth absent** (F-07)                                                                                                                                                                                                                                                    |
| Observability (3)         | **FAIL**                    | correlation IDs and pattern-based redaction verified (`/password\|token\|secret\|authorization\|apikey\|api_key\|cookie/i` — covers `PADDLE_*` by construction); watchdog cron wired at 09:00 UTC with `STALE_INGESTION_HOURS = 36`; **no 60% DB-size alert** (F-05)                                                                |
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
