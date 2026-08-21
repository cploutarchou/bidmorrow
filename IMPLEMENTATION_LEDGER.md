# IMPLEMENTATION LEDGER

Source of truth for cross-session state. Update before every session end /
context compaction. Read first in every session.

## Current phase

**Phase 13 — Deployment/Launch: IN PROGRESS, nearly complete.** Phase 12
is COMPLETE (sign-offs recorded below, merged via PR #12). As of
2026-08-16 night: staging AND production live on custom domains, all
owner-side launch items CLOSED (HUMAN_DECISION_BLOCKERS snapshot: "owner
checklist is now EMPTY"), fixture refresh from real TED notices DONE
(PR #33), security sign-off RECORDED (see "Phase 13 sign-offs" below),
production-reviewer reviewed with conditional findings — all doc/test
fixes applied same night.

**PIPELINE ON HOLD (owner instruction, 2026-08-16 night)**: the
remaining launch pipeline — first-ingestion verification →
production-reviewer re-verify → `phase-13-complete` tag → Phase 14
audit → go-live — is PAUSED until the owner's pre-go-live task is done.
That task (requested same night): **website/UI overhaul** — plan-first
(competitor/UX research, IA, design system, milestones), owner approval
REQUIRED before any implementation. The 05:40 UTC self check-in remains
armed but downgraded to a SILENT read-only health check of the first
real staging ingestion (record results here; do NOT advance the phase
pipeline). Production ingestion stays PAUSED until the owner's explicit
go-live.

**First staging-ingestion health check (2026-08-17 05:40 UTC, silent,
read-only — via Cloudflare D1 API)**: the 05:00 UTC staging cron ran and
completed HEALTHY-EMPTY. `ingestion_runs`: one row, source `ted`, status
`succeeded`, window 2026-08-16→2026-08-16, 5s duration
(05:00:41–05:00:46), notices_seen/upserted/errors all 0.
`ingestion_errors` 0, `source_snapshots` 0, `tender_notices/lots/matches`
0 — internally consistent. Zero notices is EXPECTED: 2026-08-16 was a
Sunday and TED publishes no OJ S edition on weekends; the search call
itself succeeded (a header/identification failure would have surfaced as
errors or a failed run). Checkpoint correctly advanced to 2026-08-16.
The decisive NON-EMPTY end-to-end verification (real XML fetch with the
new TedClient headers → parse → upsert → R2 snapshot) is the 2026-08-18
05:00 UTC run covering Monday's notices — a follow-up silent check is
armed for 2026-08-18 ~05:40 UTC. Phase pipeline NOT advanced, per the
hold.

**Second staging-ingestion health check (2026-08-18 ~05:43 UTC, silent,
read-only — via Cloudflare D1 API): FAILED — real finding, launch-blocking
ingestion bug.** The 2026-08-18 05:00 UTC cron (window 2026-08-17→2026-08-17,
started 05:00:47Z) is the first NON-EMPTY end-to-end run. `ingestion_runs`
latest row: status **`failed`**, notices_seen **1**, notices_upserted 0,
versions_created 0, lots_created 0, errors_count **0**, duration ~2.4s.
`ingestion_errors` **0 rows**; `tender_notices/versions/lots/matches`,
`buyers`, `source_snapshots`, `tender_cpv_codes/geographies` all **0**.
Checkpoint correctly held at **2026-08-16** (NOT advanced past a failed
window — checkpoint safety worked; the next daily cron re-attempts the same
window).

Diagnosis (from run row + tables + code, since worker logs / `wrangler tail`
are not available in-session):

- `notices_seen=1` ⟹ the TED **search** succeeded (endpoint, expert-query
  syntax, and scope all work against live TED; returned exactly 1 notice for
  the 72*/48*/79417000 competition scope on Monday).
- `source_snapshots=0` AND `buyers=0` are decisive: in
  `packages/procurement/src/run-window.ts`, both the snapshot insert
  (`insertSnapshotIfNewHash`, L218) and buyer upsert (L264) run only AFTER
  `client.fetchNoticeXml` (L193). Empty snapshot + buyer tables with 1 notice
  seen ⟹ the run aborted **inside `fetchNoticeXml`**, before any persistence.
- `errors_count=0` / no `ingestion_errors` row ⟹ it did NOT hit a per-notice
  recorded path (MALFORMED_SEARCH_ROW / XML_TOO_LARGE / TedParseError). In
  `fetchNoticeXml`, every failure except `TedXmlTooLargeError` re-throws and
  bubbles to the window-level catch → `status=failed` (run-window.ts
  L195–197, L140–155).
- ~2.4s duration is too short for the client's 4-retry backoff cycle
  (~1+2+4+8=15s), so the notice-XML GET **fail-fast on a non-retryable
  error** — most consistent with an **HTTP 200 empty body** (the documented
  `ted.europa.eu` response to a client it won't serve — see client.ts
  L51–60, L192–201) or a non-retryable 4xx on the `ted.europa.eu` notice-XML
  origin.
- **Why now:** every earlier staging window saw 0 notices, so the
  notice-XML download path (host `ted.europa.eu`, distinct from the working
  search host `api.ted.europa.eu`) had NEVER run from the deployed Worker
  before today — only in the fixture-fetch CI job. Likely **deterministic**
  → recurs daily and will not self-heal, though the held checkpoint means
  each day re-attempts the identical window.

Could NOT live-reproduce from the sandbox: the session network policy denies
`api.ted.europa.eu` (403 CONNECT, `connect_rejected` in agent-proxy status) —
an org policy denial, reported not worked around; the deployed Worker's
egress is the relevant path and it reached the search host fine.

Secondary (defensibility) finding: a window-level failure persists **no
durable diagnostic** — `errors_count=0`, no `ingestion_errors` row; the only
forensic trace is the `ingestion.window.failed` worker log (not retained /
not accessible here). Recommend the window-level catch in `runIngestionWindow`
ALSO write an `ingestion_errors` row (stage `fetch`, error code + message +
failing notice id/URL) so the next occurrence self-documents without live
logs — aligns with the "surface, don't swallow malformed records" hard rule.

Owner next steps (reported to owner as a real finding; NOT auto-fixed —
pipeline is on hold): (a) read the 05:00 run's Worker logs (Cloudflare
dashboard → Workers → the ingest worker → Logs; filter `ingestion.window.failed`
and `ted.request` / `ted.notice_xml.ok`) — that line carries the exact error
message and confirms empty-body vs HTTP status; (b) confirm the DEPLOYED bundle
sends `User-Agent`+`Accept` on the notice-XML GET (present in source — rule out
a stale deploy) and that the Worker egress isn't served the blocked-client
empty body; (c) greenlight the durable-diagnostic `ingestion_errors`-on-failure
change (offered). Phase pipeline NOT advanced, per the hold.

**Ingestion durable-diagnostic fix (owner instruction "fix the ingestion bug",
2026-08-18): SHIPPED (PR #46).** Addresses the secondary/defensibility finding
above. `runIngestionWindow` (`packages/procurement/src/run-window.ts`) now tracks
the notice in flight and, on a window-level failure, writes exactly one durable
`ingestion_errors` row (stage + stable machine code + message + failing notice
id/URL + HTTP status/attempts) and bumps `errors_count` to match — guarded so a
diagnostic-write failure can never mask the original error; checkpoint-hold-on-
failure unchanged. Machine codes: `REQUEST_BUDGET_EXCEEDED`,
`NOTICE_FETCH_HTTP_<status>`, `NOTICE_FETCH_NETWORK_ERROR`,
`UNEXPECTED_WINDOW_ERROR`. Tests extended in `apps/worker/src/ingestion.d1.test.ts`
(budget case now asserts the diagnostic row; new HTTP-404 notice-fetch-failure
test mirrors the 2026-08-17 incident shape). Gates green (format/lint/typecheck/
build; root vitest 445 pass/3 skip, worker 158, db 52). Independent
production-reviewer + security review run before merge.

What this fix does and does NOT do: it makes the failure **self-documenting in
D1**, so the NEXT staging ingest run (daily 05:00 UTC, or an admin backfill)
captures the EXACT notice-XML fetch cause (empty-body vs a specific HTTP status)
in `ingestion_errors` — turning the targeted fetch fix from a guess into a
certainty. It does NOT by itself unblock the Monday window (1 notice, 100% fetch
failure → still correctly window-fatal, checkpoint held). Deliberately NOT
changed: the fail-the-window-on-fetch-error semantics (documented design) and
the "poison-pill" resilience question (one bad notice among many blocking a
whole day) — the latter is ADR-level and noted as a separate follow-up. Root
cause of the fetch failure remains OPEN pending the next run's captured
diagnostic or the Worker log. Phase pipeline still on hold.

**Poison-pill resilience SPEC written (owner instruction "spec the
poison-pill fix as a follow-up", 2026-08-18): ADR-0008
(`docs/architecture-decisions/0008-poison-pill-notice-fetch-resilience.md`),
status Proposed — spec only, implementation NOT scheduled.** Key decisions
specced: per-notice `TedRequestError` from `fetchNoticeXml` becomes
record-and-continue (window `partial`), guarded by a systemic-failure
threshold (fail the window when fetch failures ≥5 absolute AND >20% of
notices seen, code `FETCH_FAILURE_THRESHOLD_EXCEEDED`); skipped notices get
a bounded re-attempt via a new `ingestion_fetch_retries` table (≤25/day
drained inside the daily run, 5 attempts, then `NOTICE_FETCH_ABANDONED`);
search fetches and `REQUEST_BUDGET_EXCEEDED` stay window-fatal; checkpoint
rules, idempotency, TED politeness, and the PR #46 diagnostics unchanged.
Notable nuance found while speccing: the admin backfill CANNOT re-run
windows at-or-behind the checkpoint (advance-only guard throws), so
"manual backfill as the retry path" was not merely weak but unavailable —
this drove the retry-table choice.

**INGESTION FETCH ROOT CAUSE FOUND + FIXED (2026-08-18 ~11:00–12:00 UTC,
owner instruction "finalize the caveats").** Live CI diagnosis (new
dispatchable `ted-diagnose` workflow, runs 32131289081/32131832286/
32132169652 — the sandbox cannot reach TED, CI can): TED **changed the
anonymous notice-XML front-end to ASYNCHRONOUS rendering** around
2026-08-17 — `ted.europa.eu/<lang>/notice/<id>/xml` answers HTTP 202 +
empty body to EVERY client (identified/bare/browser-like; `?download=true`
changes nothing); the request queues a render and a later request may get
the cached XML (observed 200 + 12,953-byte ContractNotice minutes after
trigger; cache short-lived — same URL back to 202 within ~4 min). NOT a
worker/header bug. The failed 2026-08-17 window actually holds **156
in-scope notices** (staging died on #1). Fix shipped: (1)
`TedRenderPendingError` — client surfaces 202/empty-2xx as render-pending;
(2) `runIngestionWindow` requeue-cycling — collect all rows first, requeue
pending notices to the tail (MAX_RENDER_VISITS=4, ≥RENDER_RETRY_DELAY_MS=20s
between visits to the same notice), so pass 1 triggers every render and
later passes collect; exhaustion stays WINDOW-FATAL (checkpoint held, code
`NOTICE_RENDER_PENDING` — never skip-and-advance; ADR-0008 owns any future
record-and-continue); (3) **authenticated API route**: `TedClient.apiKey` →
`GET {base}/v3/notices/{id}/xml` with `Authorization: Bearer` (endpoint
verified to exist: 400 Missing Authorization header without a key; header
SHAPE unverified until the `ted-key-verify` workflow runs against the
owner's key — HUMAN_DECISION_BLOCKERS item 9, owner registering at
developer.ted.europa.eu); `TED_API_KEY` wired through env + both deploy
workflows' secret push. Docs updated (ted-data-source.md supersedes the
2026-08-16 empty-body note; dependency-versions.md verification ledger).
Tests: client 46 (202→pending, empty-2xx→pending, API route URL+auth,
anonymous fallback), ingestion.d1 160 (cycling success = exactly 2 hits/
notice; exhaustion = 4 hits, failed, durable diagnostic, checkpoint held).
Expected behavior on staging after deploy: next daily 05:00 UTC run cycles
the 156-notice backlog — renders triggered pass 1, collected within the
run or (worst case) by the following day's retry from TED's cache.

**PR #51 MERGED + TED key verified (2026-08-18 ~12:10 UTC).** Squash-merged
as `1bf26af` after production-reviewer PASS + security SIGN-OFF (both LOW
follow-ups BM-51-1/BM-51-2 fixed pre-merge); deploy-staging run 32135278377
green (migrations, worker deploy, secret push incl. the owner-set
`TED_API_KEY`, smoke tests). `ted-key-verify` run 32135295775 against the
owner's real key: **`Bearer` header shape CONFIRMED** (it reached account
authorization; the raw shape isn't parsed as credentials at all — no client
change needed), but the API answers **`403 No eNotices2 account found.`** —
the key's EU Login account was never paired with eNotices2. Owner must log
in ONCE at enotices2.ted.europa.eu with the same EU Login account (TED docs:
key pairing requirement; keys are also environment-specific). ⚠️ Until
then, staging ingestion 403s on every notice (configured key ⇒
authenticated route, no anonymous fallback) — daily cron AND admin backfill
will fail with `NOTICE_FETCH_HTTP_403`. Blockers item 9 updated with the
pairing step; dependency-versions.md verification ledger updated
(Bearer = VERIFIED shape, activation pending). Admin-UI access explained to
owner (allowlist login, no separate creds; /admin/ingestion backfill
2026-08-17..2026-08-18 once the key answers 200). Known residual risk noted
for a future hardening decision: a revoked/expired key silently converts
ingestion to 100% window failure — candidate ADR-0008-adjacent follow-up
(auth-error fallback to anonymous cycling, loudly logged).

**TED API-route REMOVED — no such endpoint exists (2026-08-18 ~15:40 UTC).**
After the owner's eNotices2 pairing made the key authenticate, the
authenticated route answered `404 No static resource` for a notice the
anonymous search confirms exists; fetching the API's own OpenAPI spec
(`api.ted.europa.eu/api-v3.yaml`, ted-api-probe runs 32152093521/
32155040026, workflow merged in PRs #53/#54) shows the COMPLETE v3
surface: eSender submit/validate/render(-async)/convert,
`/v3/notices/{businessId}/…`, "search your submitted notices", key renewal,
sdk-versions, and anonymous `/v3/notices/search` — **no published-notice
content endpoint**. The `400 Missing Authorization header` that spawned
the whole key hypothesis was a gateway auth filter answering before
routing. Fix: `TedClient` apiKey option + API-route branch deleted
(`fetchNoticeXml(url)` — front-end URL + render-cycling is THE path);
`TED_API_KEY` removed from worker env, both TedClient constructions, and
both deploy workflows' secret push; `ted-key-verify` workflow deleted
(premise dead), `ted-api-probe` kept as the re-check diagnostic. Blockers
item 9 CLOSED (key not needed; stored secrets harmless, owner may delete).
This also un-breaks staging: with the key deployed, every notice fetch was
404ing via the dead route — after this deploy the keyless cycling path is
active and the owner's admin backfill (2026-08-17..08-18, 156-notice
backlog) can land data. The eNotices2 pairing note stays archived in
dependency-versions.md; residual-risk note above is MOOT (no key in play).

**DESIGN DIRECTION SWITCHED (owner, 2026-08-18 ~09:55 UTC): Control Room
(Direction B) replaces Strata — FULL re-skin, single-theme dark only.**
Owner saw the round-2 "BidMorrow Control Room" mockup artifact and prefers
it; confirmed via structured question: full switch (public site AND app
interface), dark-only as designed (theme toggle removed, daylight twin
retired). Visual re-skin ONLY — structure/copy/IA/pricing unchanged. Full
decision record + token palette + carried-over caveats:
`.claude/skills/website-redesign/requirements.md` Decisions log 2026-08-18;
mockup source committed at
`docs/redesign/mockups/direction-b-control-room.html`. Implementation (M4
re-skin) starting next; the pending final slice (sample-verdict demo +
category pages) will be built Control-Room-styled after the re-skin lands.

**INGESTION CRISIS + ADR-0009 (2026-08-19 → 2026-08-20). TED's public
notice-XML render pipeline stopped completing renders entirely; the
poison-pill fix shipped the day before turned out to convert that into a
permanent daily loop.** Sequence, with the real numbers:

1. **2026-08-19 05:00 cron** (first run after the PR #51 render-cycling
   fix): window 2026-08-17, 156 notices seen, 0 upserted — one notice
   exhausted its 4 visits → `TedRenderPendingError` → window-fatal,
   checkpoint held. Diagnosed as a poison pill; owner green-lit ADR-0008.
2. **2026-08-19 ADR-0008 implemented and deployed** (PRs #59, merged
   dcae4e3): record-and-continue + systemic threshold (≥5 AND >20%) +
   `ingestion_fetch_retries` drain (≤25/day, full render cycle,
   abandonment at 5) + watchdog + admin surface + retention. Amendment
   A1–A4 folded render-pending into the same counter as genuine fetch
   failures and bumped `MAX_RENDER_VISITS` 4→6. Security SIGN-OFF,
   production-reviewer PASS.
3. **2026-08-20 05:00 cron** (first run with ADR-0008 live): **156 seen,
   0 upserted, 32 render-pending skips, threshold tripped at 32/156 =
   20.51%, run `failed`, checkpoint held — and because a failed window
   skips the drain, all 32 retry rows stranded `pending` at attempts=0.**
   ZERO notices rendered across 6 visits over ~8–10 minutes; no HTTP and
   no parse errors. Two design errors were now visible: (i) A1's decision
   to count render-pending toward the systemic threshold — whose ADR-0008
   §2 rationale ("must not advance past a day of unfetched notices") was
   written when a skip meant LOSING the notice, which §3's retry table had
   already changed; (ii) the drain-skip-on-failed-window rule, which turns
   any permanently-failing window into a permanent retry stall.
4. **Batch-size hypothesis REFUTED by evidence, not argument.** CI probe
   `ted-render-batch-probe` (run 32337551926, Azure egress vs the worker's
   Cloudflare egress): a 5-notice batch AND a 50-notice batch each
   rendered **0** at trigger/+60s/+120s/+180s — 100 responses, `other=0`,
   no 4xx/5xx/rate-limit. Since the 2026-08-18 single-notice probe DID
   collect a render (200 + 12,953 bytes), TED's anonymous render pipeline
   stopped completing renders somewhere between 08-18 and 08-20. Not load,
   not egress identity, not our client. (First probe run died in 9 s on a
   missing `actions/checkout` — coordinator error, fixed and re-run.)
5. **ADR-0009 written (Accepted), superseding parts of ADR-0008**: §1
   failure taxonomy splits on ORIGIN BEHAVIOR — HTTP/network failures
   ("origin refusing us") keep the unchanged 5/20% threshold;
   render-pending exhaustion ("origin cooperating but slow") gets its own
   `notices_render_pending` counter with NO fail ceiling plus a distinct
   `RENDER_PENDING_DEGRADED` signal + watchdog condition; §2 drain
   independence via `failureCode` + pure `isSystemicWindowFailure` (skip
   only for budget/threshold/search/fetch codes; unknown codes default to
   RUN the drain — stranding-by-default was exactly the bug); §3 records
   the refutation and decides **no client-side trigger strategy** (tuning
   against an outage would encode the outage into the architecture); §4
   re-justifies `MAX_RENDER_VISITS=6` as transient-state insurance and a
   zero-deploy recovery detector; §5 frames the source-acquisition
   contingency without deciding it.
6. **Implemented + reviewed**: migration 0009 (`notices_render_pending`,
   additive, drizzle zero-diff), taxonomy split, degraded signal, drain
   gate, admin column. Gates: root vitest **530 pass / 3 skip**, worker
   d1 **203**, db **63**, typecheck/lint/format/build green.
   **production-reviewer PASS (2026-08-20)** — 0 Critical/High, every gate
   re-run independently, the 2026-08-20 incident shape verified fixed end
   to end (100%-render-pending day → `partial`, checkpoint ADVANCES, N
   retry rows, exactly one degraded row, zero threshold rows) with the
   ADR-0008 systemic protection intact; MEDIUM RV-0009-01 was this ledger
   entry; LOWs RV-0009-02/03 (same-run drain pickup composition;
   `terminatedByBudget` coverage) closed by follow-up tests. Reviewer
   recorded that no security pass is required for this diff (no authz,
   tenancy, or content-rendering surface; `ingestion_runs` is a
   docs/security.md C6-exempt global ops table) — recorded here rather
   than self-certified.
7. **Content-channel investigation** (`docs/ted-content-channel-options.md`,
   ted-data agent): Option B — TED's **official daily bulk XML packages** —
   recommended as end-state, the only option leaving `parseEformsNotice`,
   the lot-centric model, contract fixtures, content-hash versioning and
   ADR-0005's raw-XML provenance UNCHANGED, and it replaces an
   undocumented website behavior (which changed three times in one week)
   with the documented reuser channel; risk is in-house engineering
   (streaming tar.gz under Workers' limits → R2 staging + queue-driven
   extraction). Option A — Search API `fields` as content — budget is
   comfortable (~30 × 250 = 7,500 ≤ 10,000 cap; FEWER TED requests than
   today) but degraded: lot-array alignment unverified (the index appears
   notice-based; our model is lot-centric), no raw XML so ADR-0005 needs
   supersession, SDK version + buyer org-id have no equivalent. Option C
   (wait) is a canary, not a plan. Two dispatch-only probes authored to
   convert inferred rows to verified ones. **ADR-0010 pending probe
   evidence — do not decide before it.**
8. **Source-facts probe result (run 32347877913, 2026-08-20 08:15 UTC) —
   the bulk address question is now half-answered.** (i) The inferred
   `/packages/notice/daily/{id}` address is DEAD, proven by A/B: the real
   issue id `202600157`, `definitely-not-an-issue` and `00000000` all
   answered `202 / 0 bytes / content-type: text/html` identically, so it
   is the website's catch-all async shell and every poll against it
   measured nothing. (ii) The REAL addresses are published by TED itself
   at `ted.europa.eu/en/simap/xml-bulk-download` (HTTP 200, 191,772
   bytes) and carry NO `/notice/` segment:
   `https://ted.europa.eu/packages/daily/{ojIssueId}` (listed for
   `202600147`–`202600160`) and
   `https://ted.europa.eu/packages/monthly/{year}-{n}`. `OJ` `157/2026`
   → `202600157`, which appears in the published list, so the id encoding
   is source-confirmed, not guessed. Note the same `/packages/daily/…`
   prefix answered 400 in run 32343243004 — the earlier probe read the
   real family's rejection of a malformed id as evidence against the
   family. (iii) **ADR-0010 gate A-G1 is NOT measured**: the populate-rate
   request returned `400 — "Parameter 'fields' contains unsupported
value"`, so at least one requested field name is invalid, the whole
   request was rejected, and the earlier "accepted-but-empty" reading is
   unsupported. Follow-up `ted-package-probe` (PR #65) HEADs/GETs the
   published address with the same garbage-id A/B plus content-type,
   content-disposition, `file(1)`, magic bytes and an archive listing, and
   closes A-G1 by mining the API's own supported-value enumeration then
   measuring each field SEPARATELY. `ted-bulk-poll-probe.yml` is obsolete
   (dead address); the 11:00 UTC re-poll trigger was rewritten to dispatch
   `ted-package-probe` instead. **Gate still OPEN** — the question changed
   from "does an unknown address exist" to "does the published address
   deliver bytes". Standing rule reaffirmed: an address is proven by
   delivering content a garbage id does not, never by response-code
   routing alone.
9. **ADR-0010 GATE CLOSED — Branch B ACTIVATED** (`ted-package-probe`
   run 32352483245, 2026-08-20 09:10 UTC). The address TED publishes
   DELIVERS: `GET https://ted.europa.eu/packages/daily/202600157` → HTTP
   200, `application/gzip`, **19,980,923 bytes**,
   `content-disposition: attachment; filename=20260817_2026157.tar.gz`,
   magic `1f 8b 08 00`, ~207 MB uncompressed, and `tar tzf` listed real
   members (`20260817_157/00566631_2026.xml`, …). The A/B holds: garbage
   ids (`definitely-not-an-issue`, `00000000`) return **400 text/plain**,
   so the real issue and garbage do NOT behave alike — that is what
   proves the address, not the 200 alone. Monthly behaves the same
   (`monthly/2026-1` → 200, gzip, 344,184,486 bytes). Delivery was
   IMMEDIATE — no async generation step — so Branch B's tolerance for
   multi-hour package generation is unused headroom. **The render outage
   stops being existential**; the render front-end demotes to a telemetry
   canary. Verified engineering facts: member naming
   `{YYYYMMDD}_{issueNumber}/{documentNumber}_{year}.xml`, with ONE issue
   appearing in THREE encodings in a single response (`202600157` in the
   URL, `157` in the member dir, `20260817_2026157` in the filename) —
   none derivable from another by assumption; and a daily package carries
   ALL notices of its issue (~207 MB) against a ~156-notice in-scope
   window, so selective extraction is mandatory, not an optimization.
   OPEN: the `publication-number` ↔ member-filename mapping is NOT yet
   verified against a real pair.
10. **ADR-0010 gate A-G1 MEASURED** (same run, window 2026-08-17, 156
    in-scope notices). Field names were mined from the API's own
    supported-value enumeration (47,988 bytes in the 400 body for a
    deliberately invalid field) instead of guessed. Results:
    `BT-137-Lot` 156/156 (**100%**, `LOT-0001` — re-confirms lot
    alignment); `deadline-receipt-tender-date-lot` 130/156 (**83.3%**,
    `2026-09-14+02:00`); `estimated-value-lot` 57/156 (**36.5%**,
    `200000.00`); `estimated-value-cur-lot` 57/156 (**36.5%**, `EUR`);
    `BT-27-Lot` 57/156 (**36.5%** — identical to `estimated-value-lot`,
    i.e. the alias and the BT id are the same datum); `BT-131-Lot`
    **REJECTED 400** — it is not a valid `fields` value, the enumeration
    splits it as `BT-131(d)-Lot` / `BT-131(t)-Lot`, which is what
    docs/ted-data-source.md's field map already recorded (the probe used
    the wrong name, not the API). Contract value at 36.5% is a material
    weakness for Branch A′ — value is a top matching input and a channel
    carrying it for ~1 in 3 notices would force a large "value unknown"
    population or a reweighting. Not blocking, since Branch B supplies
    full XML; recorded because A′ is the contingency. UNRESOLVED: whether
    36.5% reflects the XML's own populate rate or a search index that
    under-populates relative to source — Branch B makes this answerable
    by comparing BT-27 presence in parsed XML against the index for the
    same window. Until then the figure characterises THE SEARCH INDEX,
    not TED's data.

**RISK DOWNGRADED 2026-08-20 09:10 — the abandonment clock is no longer
existential.** With ADR-0010 Branch B activated (item 9), a notice that
reaches terminal `NOTICE_FETCH_ABANDONED` is recoverable from the daily
bulk package, which is addressable by publication date via `OJ` and
independent of both the render pipeline and the advance-only checkpoint.
The clock below still governs how much work the drain burns in the
meantime, and the ~10-day figure stands until Branch B ships — but it no
longer sets a hard decision deadline. Original entry, kept for the record:

**OPEN RISK WITH A CLOCK — slow-motion abandonment**: during a sustained
outage a drained retry row reaches terminal `NOTICE_FETCH_ABANDONED` ≈10
days after its first drain attempt (5 attempts, linear daily backoff), and
abandoned notices are recoverable ONLY via a §5 channel — admin backfill
cannot run behind the advance-only checkpoint. That ~10-day window is the
decision deadline for the channel switch. Whether to suspend
attempt-burning during a known outage is FLAGGED, NOT DECIDED (belongs
with ADR-0010). Corrected projection: the retry table's 12-month
total-outage worst case is ~33 MB, not 8 MB — pending rows never purge,
only terminal ones do.

**M6 Client-area follow-up SHIPPED (2026-08-18 evening, owner directive:
auth/session polish, client billing + subscriptions, autocomplete, client
logo, skills/agents).** Four workstreams, coordinated per the new
single-writer partition rules:
(1) AUTH: `use-redirect-if-authenticated` (authenticated visitors never
see /login|/signup — invariant verified in Better Auth source: with
requireEmailVerification no session exists pre-verification, so
/verify-email is unaffected); api.ts 401s → single coalesced
auth-context refresh (in-flight guard, no loops, get-session never
routes through api.ts); Login's duplicate resolve+navigate race removed;
returnTo open-redirect guard confirmed (`isSafeReturnTo`).
(2) BILLING: server — GET /api/billing/invoices (server-stored
stripeCustomerId only, https-only URL passthrough), POST /cancel
(typed-confirm body, cancel_at_period_end, idempotent), POST /reactivate
(409 requiresCheckout when fully canceled), enriched /status
(price/paymentState; currentPeriodStartAt correctly omitted — no column,
no migration); all owner-gated with tested denial paths; webhook stays
authoritative (syncSubscriptionState re-fetch converges optimistic rows);
SDK semantics cited from installed stripe@22.5.0 types, recorded in
dependency-versions.md §Stripe. Client — Settings billing panel: plan
card (price/status/renewal vs "Cancels on … — access continues"),
overdue notice → portal, ConfirmAction-gated cancel, reactivate,
invoice history (Stripe-hosted View/PDF; loading/empty/forbidden/
not-configured/provider-error states; invoices fetch isolated so the
owner-only 403 doubles as the non-owner UI signal without breaking
Settings), @media print layout + Print button. NOT live-verified against
real Stripe (unit/fake-client + d1 tests only — honest boundary; staging
test-mode exercise pending owner use).
(3) AUTOCOMPLETE: reusable ARIA combobox (activedescendant, full
keyboard matrix, pointer/touch, live-region counts, sequence-guard) over
pure ranked filtering (13 tests); applied to Settings CPV/keyword/country
and onboarding CPV add; free-typed valid codes still accepted; datasets
static/public — CPV_SUGGESTIONS (141 entries, every label extracted from
the official CPV 2008 genericode file — zero recalled), presets-derived
keywords, existing country list.
(4) LOGO: root cause — Logo.tsx was rendered only by MarketingLayout;
mark added to AppShell/AuthLayout/onboarding header (decorative inline
SVG, CSS-sized), screenshot-verified in the built app 1440/390.
SKILLS/AGENTS: new `billing-audit` skill (8-point checklist);
coordination rules codified in website-redesign §Standing rules;
frontend-engineer gained combobox + (earlier) animation/wizard craft;
visual-asset-designer agent (earlier this window).
REVIEWS: security SIGN-OFF (all billing-audit points re-verified; LOW
BILL-R1-01 docs + INFO BILL-R1-03 https-guard fixed in 518b80f; INFO
-02/-04 accepted); **production-reviewer PASS (2026-08-18, post-eb1d87c):
0 Critical/High, gates re-measured independently — root 509/3 skip
(billing 75, combobox 13, cpv 6, format 32), worker 181, db 52, new E2E
17 pass/3 skip in 59s, build green; critical-path flake reproduced once
with the documented baseline signature (PR-M6-04, known). LOW PR-M6-01
(invoice Amount cell showed amountPaid for unpaid invoices — fixed:
non-paid statuses render amountDue) and LOW PR-M6-02 (this record) fixed
in the phase-close commit; INFO PR-M6-03 (reactivate returns pre-call row
fields — correct today, noted against blind copying) accepted.**
TESTS: root vitest 509 pass/3 skip (billing 75, combobox-filter 13, cpv
6); worker d1 181; db 52; E2E grew 28→48 (auth-session 5, billing 5 —
3 documented skips for states unreachable without live Stripe, nothing
faked; combobox 10); all 20 new pass 3× runs. KNOWN: pre-existing E2E
flake critical-path.spec.ts:218 (51-keyword loop, browser-process death
in this sandbox) reproduced identically at baseline — not a regression,
left intact. Also pre-existing: SPA ships as one JS chunk (no route
code-splitting anywhere yet) — flagged against CLAUDE.md guidance as
follow-up, not introduced here.**

**M5 App-interface + interaction milestone SHIPPED (2026-08-18 ~17:30 UTC,
owner instruction "UI still needs work / more interactive / modern
responsive / wizard").** Full chain: ui-visual-designer spec
(`docs/redesign/app-interface-spec.md`, ~1700 lines, 13 sections — root
causes: bare `header` element rule made the app bar a floating island;
`.tab--shelf` class-drop broke dividers; marketing `h1` leaked into the
app; unclassed fieldset) → frontend-engineer implementation (all 12
checklist items: full-bleed app bar + two-row ≤40rem mobile bar, 3 new
tokens `--field-bg`/`--app-header-h`/`--danger-edge`, recessed form
system + `.btn-add`/`.field-group`/`.form-actions`/chip animations,
58rem feed column + designed radar empty state + `data-group` tabs,
panelized Settings, onboarding stepper rail + native `<progress>` meter +
CPV search + `btn-quiet` + `aria-invalid` wiring, TenderDetail facts
panel, interaction layer: press/hover vocabulary, rise-in/chip-in/toast +
auto-clear, cursor blink, readout glow-in, scan sweep — all
reduced-motion-dead; marketing polish + IntersectionObserver scroll
reveals) → qa-reviewer FULL verification (32 screenshots, FAIL:
3 BLOCKING — toast dual-node broke E2E strict selectors; `--text-3` on
raised surfaces 4.34:1; `#main-content` ID rule caused measured 64px
header/content misalignment + 1024px onboarding column — plus 2 MINOR)
→ fixes (PR #56: selectors → `getByRole('status')`;
`--status-low-text`/chip codes → `--text-2` = 5.17:1/4.80:1;
`#main-content.app-main|assistant-main|auth-main` specificity escapes =
flush 144px/144px, 72rem/40rem/30rem columns; `align-content:start`
stepper; a11y-spec reducedMotion re-assert for mid-animation axe flakes;
console-403 noise investigated = dev-only StrictMode double-mount,
deliberately not "fixed") → qa-reviewer targeted RE-VERIFICATION PASS
(E2E 28/28 twice, axe 0 serious/critical everywhere, alignment measured
flush, `final-*` screenshots). Merged: PRs #55 (carried the
implementation WIP) + #56 (QA fixes) → staging. New agents this window
(owner request): `visual-asset-designer` created;
`frontend-engineer` extended with animation + wizard craft. Owner sent 8
final screenshots. Non-blocking residue: dev-console 403 noise (by
design). NOTE: `AppShell.tsx` untouched per spec (CSS-only); marketing
copy untouched (copy locks intact, 448-test root suite green
throughout).**

**M4 Control Room re-skin IMPLEMENTED (2026-08-18, frontend-engineer +
qa-reviewer).** Token-value swap on the existing custom-property system
(names kept, values repointed — 100+ call sites untouched): single dark
palette, grid texture, teal accent, terminal wordmark, restyled buttons;
theme toggle + light theme deleted (`ThemeToggle.tsx`, `lib/theme.ts`(+test),
all `prefers-color-scheme`/`[data-theme]` CSS); @fontsource packages removed
(~81KB fonts → 0, system stacks); Logo/favicon re-colored teal, PNGs
regenerated. Deliberate deviations recorded by the implementer: `--accent-grad`
kept as flat alias; risk-flag amber kept for medium-confidence flags.
Independent qa-reviewer: initial verdict FIX with one blocking finding
F1 (`--text-3` #6b7280 failed AA at 4.14:1/3.78:1 on footer + /month chips)
— fixed to #7d8799 (≥5.05:1 everywhere), axe re-run 0 serious/critical on
/, /pricing, /how-it-works, /contact; F2 stale favicon sizes attr fixed;
F3 (pre-existing CSS/JS budget overage, improved not worsened: CSS
36.69→31.89kB) and F4 (env-only 502) informational. Gates green (444
tests). Shipped as commit 70e1c69 → PR/merge per flow below.

**Website redesign RESTART (owner instruction, 2026-08-17)**: the owner
REJECTED all three initial design directions (Ledger / Control Room /
Mac Modern rev.1 — registry in
`.claude/skills/website-redesign/requirements.md`) and expanded scope
(content strategy, i18n readiness, imagery/motion workstream, full SEO,
13-item approval package). A reusable multi-agent system was
bootstrapped per owner instruction: 9 new specialist agents in
`.claude/agents/` (competitor-researcher, ux-strategist,
ui-visual-designer, content-seo-strategist, frontend-engineer,
backend-security-engineer, accessibility-performance-engineer,
internationalization-engineer, qa-reviewer) + the `/website-redesign`
skill (SKILL.md, requirements.md, templates, checklists,
validate-config.mjs + review-mockup.mjs — all validated). Earlier
in-flight SEO/dependency subagents were stopped by the owner mid-run;
their scopes were re-covered by the new workflow.

**Stages 1–2 COMPLETE, Stage 3 checkpoint PRESENTED (2026-08-17,
~01:45 UTC)**: Stage-1 research done via an 11-agent workflow (7
rendered-page competitor profiles from CI Playwright captures + UX/SEO/
i18n/dependency strategies — all in `docs/redesign/`, merged via PR
#36). Stage-2 round-2 directions built by three ui-visual-designer
agents, harness-verified, published as artifacts: E "Verdict"
(claude.ai/code/artifact/4b25b255-84ff-46ce-8495-35a599ec106d), F
"Daylight" (…/cb5f516a-5edf-41cb-a82d-d510439b8dce), G "Strata"
(…/d841bf21-aafa-4634-bbb8-0ca92f280ff5). 13-item approval package
presented. **RESOLVED 2026-08-17 ~06:05 UTC: owner APPROVED Direction G
"Strata"** — recorded in requirements.md §Decisions log. **Stage 4
implementation STARTED**: M0 foundations running as sequential chunks
(M0.1 Strata tokens + self-hosted fonts + icons + favicon; M0.2
SEO artifacts + prerendering; M0.3 packages/i18n + copy.ts facade), each
chunk gated → PR → merge on green, qa-reviewer verification per
milestone. Pause conditions per requirements.md apply. **2026-08-17
(~11:00 UTC) NEW GATE (owner)**: owner-supplied competitive intel
(GetTenderAI €235/mo unlimited scores; Tenderium €9 PAYG scans +
€99/mo; Stotles free limited bid/no-bid reporting — ALL to be verified)
triggered a competitive-risk + sales-strategy investigation via two new
permanent agents (`competitive-intelligence`, `sales-strategist`).
M0.1 (positioning-neutral foundations, in flight) may land; M0.2+ and
all positioning-sensitive work GATED until the investigation is
integrated. Outputs: docs/redesign/competitive-risk-assessment.md +
docs/redesign/sales-strategy.md. **RESOLVED 2026-08-17 ~11:45 UTC**:
investigation complete + verified (Tendly €29 real via CI capture; R1
High stands; Tenderium pre-transactional, lowered); owner locked product
policy (docs/product-scope.md §Product policy lock + requirements.md
Decisions log): sample-verdict demo IN, programmatic per-tender SEO OUT,
manually-authored category pages IN, pricing €29/€49 EUR retained, free
tier OUT, no automated trial, deterministic explainable scoring REQUIRED
(no LLM in scoring path). **GATE LIFTED** — positioning-sensitive work
unblocked. M0.1 (Strata tokens/fonts/icons) COMPLETE + MERGED (PR #38).
Repo commit author set to owner (Christos <cploutarchou@gmail.com>);
Claude trailers dropped. **M1 (onboarding overhaul) COMPLETE + MERGED
(PR #39, 2026-08-17 ~13:21 UTC)**: 4-phase Strata setup assistant on the
unchanged onboarding API; fixed preset-prefill loss (Review
reconciliation), CPV zero-overlap warning, post-login /onboarding
routing; score copy uses real engine weights. Independently gate-
verified (format/lint/typecheck, 649 unit, build) + onboarding e2e
11/11 in clean runs; screenshots shared. Also fixed a pre-existing
M0.1-era e2e flake (smooth-scroll + slow keyword-cap test → reducedMotion

- test.slow; reproduced on main, not an M1 bug; only surfaced in nightly
  e2e since PR CI has no e2e step). **M2 (feed / tender detail / settings
  restyle in Strata) COMPLETE + MERGED (PR #40, 2026-08-17)** — incl. the
  402 subscription-required state and Settings navigation; score UI re-based
  on the REAL engine components (not the mockup's illustrative labels),
  native `<progress>` bars (CSP intact), Feed stale-response race fixed.
  **GTM + EUR pricing COMPLETE + MERGED (PR #41, 2026-08-17)**: marketing +
  sales acquisition strategy (`docs/redesign/marketing-strategy.md`,
  `sales-strategy.md` §8), canonical EUR pricing spec
  (`docs/redesign/pricing.md`), and **founding cap DECIDED = 50** reconciled
  across all copy/default/tests/docs.
  **NOW: M3 (public marketing site → Strata) — slices 1–3 BUILT, qa-reviewer
  verdict SHIP, merging to staging.** Marketing shell + ThemeToggle + all 8
  marketing pages (Home, Pricing, HowItWorks, Methodology, Pilot, Contact,
  Privacy, Terms) migrated to Strata in vanilla-CSS tokens (`.mkt-*`
  namespace + upgraded shared `.site-header`/`.hero`/`.cta`); CSP intact,
  0 axe violations both themes, guard e2e 26/26, prices frozen €29/€49,
  cap 50, TED attribution + disclaimer preserved. DEFERRED to next slice:
  sample-verdict demo + `/cybersecurity-tenders` `/cloud-tenders` category
  pages. Phase 12's state record kept below:

* **Stage A (E2E + accessibility) COMPLETE, 25/25 green** (`pnpm test:e2e`):
  critical-path journey (signup → mailbox-hook verification → login →
  10-step onboarding → score-now hook → feed → detail → save/ignore/
  feedback → settings incl. real 422 keyword-cap → sole-owner-deletion 409
  → logout/login), 9-page axe scans (0 serious/critical, no exclusions),
  keyboard traversal (real-Tab focus-visible checks), marketing specs.
  Double-gated test hooks (`isE2ETestHooksEnabled`): mailbox capture +
  score-now, both with ungated-404 tests. docs/accessibility-review.md
  written with honest not-checked scope.
* **The E2E suite caught and we fixed 3 REAL product bugs** (commit
  8ff1ce9): (1) org list GETs returned raw DB rows → every Settings list
  save 400'd against `.strict()` schemas — responses now DTO-mapped (also
  response minimization); (2) logout was broken — Better Auth sign-out
  415s without a JSON body; (3) auth-context crashed on Better Auth's
  bare-`null` get-session response. Plus infra fixes: E2E-gated auth rate
  limits (customRules `'**'` — `'*'` matches nothing multi-segment),
  local-dev wrangler ratelimit 5000/60 (shared 'unknown' key), vitest
  vars pinned against `.dev.vars` leakage, dev-vars writer omits empty
  keys (empty string ≠ undefined flipped provider checks), digest
  schedule job clock now injectable (test failed for real 00:00–06:00
  UTC), keyboard spec drives focus via real Tab (`:focus-visible`).
* **Stage B (analysis + fixes)**: docs/phase12-quality-findings.md
  (query-plan pass, testing-gap sweep, E2E-in-CI decision). Applied:
  migration 0007 feed covering index (P-1, zero-drift proven); queue-
  dispatcher + rate-limit middleware tests (both HIGH gaps closed; 429
  now carries request_id); admin audit non-atomicity doc comment;
  `.github/workflows/e2e-nightly.yml` (nightly, per §3 decision).
  Deliberately deferred: classification-variant index + tender_geographies
  composite (speculative, per P-1/P-3's own advice); P-5 ingestion
  sequential round trips (informational, cost model accepts); P-6 admin
  COUNT(*) (LOW). P-2 note: `listTenderMatchesForFeed` appears dead for
  the customer feed (only a test calls it) — flag for cleanup review.

### Phase 13 sign-offs (2026-08-16 night)

**SECURITY: SIGN-OFF** (independent read-only review, main @ e95fc8e; no
critical/high findings). Re-ran worker (157/157), billing+ted (100/100),
db D1 (52/52) suites itself; live-resolved all 26 action SHA pins against
their tags; swept fixtures for personal data (clean) and XXE surface
(none). Verified: webhook/admin/account limiter ordering proven by tests;
SEC-P9-03 reconciliation has NO cross-org abuse path (metadata is
server-set, victim row untouched, repo layer throws TenantMismatchError
— tenant-isolation tests green); typed-confirm gate is in-job and not
API-bypassable, no input ever interpolated into scripts, no secret
echoed; TedClient keeps https-only + host allowlist + size caps, UA
carries no secrets. Findings, all fixed same night: F-1 MEDIUM
threat-model T20 overstated the reviewers gate (corrected + new §5
accepted-residual row: no second-human deploy gate, compensating
controls listed); F-2 LOW stale §5 row contradicting T21 SHA-pinning
(closed); F-6 INFO test comment nit (fixed). F-3/F-4/F-5 INFO accepted
as documented (per-route-group is logging-only by design; size-cap
buffering property; deploy temp-file cleanup nicety).

**PRODUCTION-REVIEWER: conditional — shipped work verifies clean, phase
completion gated.** Re-ran ALL gates itself (install/format/lint/
typecheck/test 634 passing/build — matching claims exactly); verified
all 8 fixtures + meta completeness programmatically, contract tests
behavioral, no personal data; confirm-gate/FK-verify/26-of-26 SHA pins
confirmed; no secrets. Completion blockers: P13-R-01 security sign-off
(now recorded above), P13-R-02 first-ingestion verification (time-gated,
2026-08-17 morning). Doc/test gaps all fixed same night: P13-R-03
backup-restore.md now carries the full 2026-08-16 drill execution record
(RPO demonstrated at minute granularity, RTO ~11 min vs 1 h target);
P13-R-04 required-reviewers contradiction reconciled across blockers
item 8.2 / deployment.md step 3 / deploy-production.yml header +
accepted deviation noted on the checklist item; P13-R-05 checklist
header corrected (boxes = Phase 14 audit-verified, not "nothing done");
P13-R-06 this top-status refresh; P13-R-07 search-path User-Agent
assertion added to client.test.ts. Phase tag waits for the 05:40 UTC
ingestion verification + production-reviewer re-verify.

### Phase 13 progress (2026-08-16)

**FIXTURE REFRESH FROM REAL TED NOTICES + CRITICAL CLIENT FIX (night)**:
the last Phase 13 data-quality gate, executed via CI because the sandbox
cannot reach ted.europa.eu. Sequence: fixture-fetch run #1 (31976779119)
"succeeded" but saved **40 zero-byte XMLs** — `links.xml.MUL`
(`ted.europa.eu/<lang>/notice/<id>/xml`) returns **HTTP 200 with an
empty body to any client that does not identify itself**. PR #32
hardened the fetch script (Accept + User-Agent, empty/HTML bodies
rejected + full per-notice diagnostics); run #2 (31977377822) then saved
all 40/40 real notices. Consequences shipped in the same cycle:
(a) **`TedClient` fix** — sends `Accept` + `User-Agent`
(`TED_USER_AGENT`) on every request and throws `TedRequestError` on an
empty 200 body instead of treating it as valid XML. Without this,
tomorrow's first real staging ingestion would have fetched 0-byte
notices for every row. Recorded in docs/ted-data-source.md with run IDs.
(b) **8 real-notice fixtures** (ted-data agent, verified independently):
SDK **1.12/1.13/1.14** (wild mix from 40 sampled: 7/17/16; no 1.15 in
production TED yet — SDK-example fixtures keep covering it), Greek
script, English, 7-lot + corrected-4-lot + 143 KB 6-lot cases,
missing value/deadline/ProcedureCode cases, an `xmlns=""` eSender
artifact case. Sanitization = natural-person data only (3 files, all
replacements enumerated in meta.json); institutional mailboxes kept.
New contract tests: `parse-notice.test.ts` "real published notices"
block, 8 tests, expected values derived from XML first. Full gates:
634 tests pass (425+157+52), build clean.
Data-quality findings pinned: in-XML publication id is zero-padded
(`00569058-2026`) vs unpadded Search API form — VERIFIED harmless
(ingestion keys identity exclusively on the Search row,
run-window.ts:278, parser id never enters identity paths — do not
"fix" this into a bug); duplicate main-CPV-in-additional VERIFIED
harmless for scoring (cpv component takes best single relationship,
not a sum); real-world decimal anomaly (566489: procedure value
931,557,860 vs lot 931,557.86 — buyer typo, parser reports verbatim,
value logic already prefers lot values); parser exposes no
`efac:Changes` correction signal by design (versioning rides on the
Search API) — noted as a future field if version-aware ingestion ever
needs in-document change references.

**VAT DECISION REVERSED TO "NO VAT AT LAUNCH" (night, PR #30)**: while
activating Stripe Tax the owner hit "Cyprus — Needs attention"
(registration number required) and confirmed they have **no VAT
registration** → collecting VAT is not legally possible. Final state:
flat €29/€49 prices, plain-price copy restored everywhere ("excl. VAT"
removed from Pricing/Pilot/Settings + E2E), `stripe_tax_enabled` OFF in
all environments (staging's brief ON flipped back via staging-flag run),
Stripe Tax integration dormant behind the flag with a documented revisit
trigger (VAT registration). product-scope + blockers item 7 updated.

**LEGAL/VAT DECISIONS IMPLEMENTED (late evening, PR #28)**: owner decided
(a) email-only contact on terms/privacy (no postal address — pages +
blockers updated; email-forwarding test now REQUIRED) and (b) **Stripe
Tax** for VAT. Implementation: new `stripe_tax_enabled` feature flag
(default OFF, admin-flippable like other boolean flags); when ON,
`createCheckoutSession` adds `automatic_tax: {enabled:true}`,
`tax_id_collection: {enabled:true}`, and — only on the
existing-customer reactivation path — `customer_update: {address:
'auto', name:'auto'}` (param shapes verified from the installed SDK's
Checkout/Sessions.d.ts; the customer_update-required-for-tax runtime
behavior could only be cross-checked via WebSearch because
docs.stripe.com is egress-blocked — flagged in the code comment;
validate on staging test-mode before flipping the flag in production).
Flag OFF = params byte-identical to before (exact-object tests). All
customer-facing prices now say "excl. VAT" (Pricing/Pilot/Settings +
E2E assertion); product-scope records the decision. OWNER ACTIONS
(blockers item 7): activate Stripe Tax in BOTH modes (origin address,
registrations, price tax_behavior=exclusive), then ask to flip the
flag (staging first). Gates green: root 414, worker 157, db 52.

**STAGING CUSTOM DOMAIN (owner request, evening)**: staging moves from
workers.dev to **https://staging.bidmorrow.com** — `workers_dev: false`

- `routes` custom_domain in wrangler.jsonc env.staging (same auto-attach
  mechanism as production's apex; 100117 at deploy = delete a conflicting
  `staging` DNS record), static staging vars (no more per-deploy `--var`
  workers.dev injection; the resolve-URL steps removed from
  deploy-staging.yml and staging-ops.yml), smoke tests target the custom
  domain with the same first-run provisioning retry as production. OWNER
  ACTION recorded (blockers snapshot item 7): edit the test-mode Stripe
  webhook endpoint URL to https://staging.bidmorrow.com/api/webhooks/stripe
  (same signing secret, no rotation). First deploy on merge attaches the
  domain; old workers.dev origin stops serving. Existing staging sessions
  invalidate (origin change) — expected.

**TRACKED HARDENING CLOSED (evening, PR #26)** — every follow-up carried
in "Phase 9 follow-ups" / "Deploy-time hardening follow-ups" below plus
the P-2/P10-R-04 review follow-up items:

- **GitHub Actions SHA-pinned** (all 6 actions × 7 workflows; SHAs
  resolved live via `git ls-remote` from each action repo's v4/v2 tag,
  tag kept as trailing comment). threat-model T21 updated to match.
- **SEC-P9-02 CLOSED in-worker** (no zone WAF console action needed):
  `rate-limit.ts` → `createIpRateLimit(routeGroup)` factory;
  `POST /api/webhooks/stripe` limiter-gated BEFORE signature
  verification; `/api/admin/*` (before auth) and `/api/account/*` now
  covered too (P10-R-04 admin half). Wiring tests assert the ordering
  (429 before 503/401).
- **P10-R-04 deploy half**: both deploy workflows verify
  `PRAGMA foreign_keys` = 1 on the live DB right after migrations
  (PRAGMA empirically confirmed queryable on remote D1 via MCP first).
- **P-2 RESOLVED**: `listTenderMatchesForFeed` confirmed dead (no barrel
  export, no app caller) and deleted (+ its private cursor helper +
  args type); tenant-isolation tests ported to `listFeedRows` — the
  isolation suite now exercises the real customer feed query.
- **SEC-P9-03 CLOSED (catch-and-reconcile)**: confirmed root cause —
  `upsertSubscriptionByStripeCustomerId`'s `ON CONFLICT` targets
  `stripe_customer_id` only, so a duplicate checkout's second webhook
  (new customer id, same org) fell through to a raw
  `uq_subscriptions__organization_id` violation → 500 → Stripe
  forever-retry. Now `syncSubscriptionState` detects a pre-fetch row
  with a DIFFERENT customer id in a `blocksNewCheckout` status, cancels
  the duplicate Stripe subscription (`subscriptions.cancel` verified
  from the installed SDK's Subscriptions.d.ts, cancellation_details
  comment set), logs `billing.webhook.duplicate_checkout_reconciled`
  with both ids, records the event `processed` with new outcome
  `'duplicate_reconciled'`, acks 200; kept row untouched. Checkout side
  re-reads `getSubscription` just before the Stripe call (narrows the
  race; residual closed by the webhook path). 3 new D1 tests (duplicate
  reconciles + same-customer redelivery + reactivation unchanged).
- Gates: format/lint/typecheck/build green; root tests 406 pass, worker
  157 (3 new), db 52. threat-model §4.3 residuals + T21 + changelog
  updated; deployment.md CI/CD step 3 updated; phase12-quality-findings
  P-2 marked resolved.
- **Hardening DEPLOYED to both environments**: staging auto-deploy
  (31968470313) green on merge — first CI execution of the FK-verify
  step and the SHA-pinned actions; production deploy **run #6**
  (31968811076, dispatched from main @ bd2c2f6) green end-to-end incl.
  live `PRAGMA foreign_keys`=1 and full smoke. Webhook/admin/account
  rate limits + SEC-P9-03 reconcile are LIVE on bidmorrow.com.

**PRODUCTION IS LIVE: https://bidmorrow.com (deploy run #5, 31966643429,
19:08 UTC, all steps green incl. smoke)**. The road there took 5 runs,
each failure real and owner-fixable: run #1 — apex DNS conflict (100117,
parking A record; owner deleted apex A + www parking CNAME, also fixed a
duplicate-DMARC record); run #2 — domain attached + all 7 secrets
pushed, smoke failed (cert provisioning window); run #3 — same, beyond
cert timing; run #4 — WITH new smoke diagnostics (PR #24): every request
got 403 `cf-mitigated: challenge` ("Just a moment…" Managed Challenge) —
a zone security toggle was challenging ALL non-browser traffic, which
would also have broken Stripe webhooks and the SPA's API calls; owner
disabled it; run #5 — GREEN end-to-end. Production state: worker live on
bidmorrow.com (custom domain + cert), D1 migrated, all secrets set,
`ingestion_paused='true'` — unpausing is the deliberate go-live step
after Phase 14. Lesson recorded: zone-level challenge features must stay
off the app origin (the worker carries its own rate limits/headers).

**FIRST PRODUCTION DEPLOY (run #1 details, 18:23 UTC)**: production D1 CREATED
(`cd5f6ceb-3262-4ba9-a5f4-4c1ed43e27bb`, WEUR — id now committed in
wrangler.jsonc), all 7 migrations applied, `ingestion_paused='true'`
seeded (rows_written 3), all 6 queues + R2 bucket ensured, Worker
`bidmorrow-production` uploaded with 4 crons + 3 producer/consumer
pairs. FAILED at custom-domain attach: API 100117 — the zone has
pre-existing externally-managed address records on the apex; Cloudflare
refuses to overwrite. Secrets push + smoke never ran (post-deploy
steps). FIX = owner deletes the apex A/AAAA/CNAME record(s) in the
zone's DNS (TXT/MX fine to keep), then re-dispatch Deploy production —
every prior step is idempotent.

**PRODUCTION CREDENTIALS COMPLETE + PRICING CURRENCY = EUR
(2026-08-16 ~14:45 UTC)**: owner set ALL `production` environment
secrets (CLOUDFLARE_*, BETTER_AUTH_SECRET, live STRIPE_SECRET_KEY +
both live price ids + STRIPE_WEBHOOK_SECRET, RESEND_API_KEY) and
ADMIN_EMAILS var; live Stripe webhook "bidmorrow-prod" registered
(https://bidmorrow.com/api/webhooks/stripe, 2026-07-29.dahlia,
6 events); live products created. Live prices are **EUR €29/€49** —
copy said "$" in 5 customer-facing spots (Pricing, Pilot, Settings ×2)

- the marketing E2E assertion; ALL price mentions switched to € (copy,
  tests, product-scope with the currency decision recorded, setup-guide,
  blockers, env.ts comments, agent files). First production deploy
  dispatched right after this merge — attaches bidmorrow.com. Still
  open owner-side: required reviewers on the production environment,
  branch protection, Resend domain DNS (email), legal address/VAT
  inputs. Production comes up with ingestion paused.

**ROLLBACK + TIME TRAVEL DRILLS: PASSED (13:44–13:55 UTC)**, all via the
staging-ops workflow (PR #19, merge bcca9bc). Sequence and evidence:
(1) bookmark captured: `0000001e-00000000-000050c9-09eead…` (run
31950678315); (2) rollback drill (run 31950784770): `wrangler rollback
-y` moved staging from the secret-change version 0abde046 back to deploy
version 65ce2bbf with the drill message in the deployment log, and the
post-rollback live health check (live+ready) passed; (3) roll-forward:
Deploy staging dispatch (run 31950899451) green incl. smoke; (4) restore
drill (run 31951034559): `d1 time-travel restore --timestamp
2026-08-16T13:00:00Z` → restored to bookmark `00000015-…`, and the
marker SELECT returned `ingestion_paused="true"` with the ORIGINAL seed
updated_at (1786843493000) — the 13:23 flip was genuinely undone,
point-in-time recovery proven; (5) re-flip (staging-flag run
31951148876): `ingestion_paused="false"`, updated_at 1786888479000.
End state: staging on latest version, ingestion unpaused, first real TED
window at the next 05:00 UTC cron.

**PRODUCTION DEPLOY PREP LANDED**: `.github/workflows/
deploy-production.yml` — dispatch-only, `production` environment gate
(owner must confirm Required reviewers, blockers item 8.2). First run
bootstraps queues/R2/D1 (D1 created in CI with `--location weur`; the
resolved id is patched into the checkout and printed as
PRODUCTION_D1_ID to be committed afterward — the session's MCP
connector was denied resource creation by the permission classifier
this session, so D1 creation moved into CI beside the existing
queue/R2 pattern), captures a pre-migration Time Travel bookmark,
seeds `ingestion_paused=true`, deploys (attaches bidmorrow.com
automatically), pushes production-environment secrets, smokes
https://bidmorrow.com with a domain/cert provisioning retry. NOT
dispatched — blocked on production secrets (Stripe live keys, second
Resend key) and the required-reviewers confirmation.

**INGESTION UNPAUSED (13:23 UTC)**: "Staging flag" workflow run #1
(31949665848) green; its verification SELECT returned
`ingestion_paused = "false"` (updated_at 1786886616000) on the staging
D1. First real TED window runs at the next 05:00 UTC ingest cron
(bounded first-run window). Owner flagged the zone dashboard showing
"No Workers connected" on bidmorrow.com — **expected**: the apex is
production-only; it attaches automatically at the first production
deploy, now codified as `routes: [{pattern: bidmorrow.com,
custom_domain: true}]` + `workers_dev: false` in wrangler.jsonc
env.production. Never connect the staging worker to the zone (would
serve test-mode Stripe + staging DB on the real domain).
`.github/workflows/staging-ops.yml` added for the remaining drills —
`deployments-list` / `rollback-previous` (+ live health check) /
`d1-time-travel-info` / `d1-time-travel-restore` (+ prints
ingestion_paused as restore marker) — wrangler syntax verified against
the pinned 4.123.0 CLI (`rollback -y` non-interactive; restore takes
`--timestamp` RFC3339 or `--bookmark`). Drill plan: capture bookmark →
rollback → health → roll forward via Deploy staging → restore to
13:00 UTC (pre-flip, flag reads 'true' = proof) → re-flip to 'false'.

**PRE-FIRST-INGESTION GATES: PASSED** (ted-gates workflow run #3, live
TED API from GitHub runners). The gate caught and we fixed TWO real
query-grammar bugs before any ingestion ran (both would have broken the
first window): (1) `SORT BY publication-date ASC` rejected — no direction
token allowed (probe: bare/`SORT BY field`/`DESC` all accepted, only
`ASC` invalid); (2) ISO `YYYY-MM-DD` dates rejected — pattern is
`[0-9]{8}|today(±N)`, now converted at the query boundary (`toTedDate`).
PRs #16/#17. **Volume measured** (2026-08-07..13): 141/0/0/173/149/119/
132 → weekday avg ≈143/day, incl-weekend ≈102/day — inside the
150–300/day assumption, no tightening (ADR-0003 trigger >600); recorded
in docs/cost-model.md. Weekend days are 0 (TED publishes weekdays only).
Unpause: MCP connector d1_database_query 403s (account not authorized
for data-plane queries), so `.github/workflows/staging-flag.yml`
(dispatchable, key/value choice inputs, staging environment creds) flips
`ingestion_paused` from CI. Ingest cron: daily 05:00 UTC; first unpaused
run is a bounded first-run window.

**STAGING IS LIVE: https://bidmorrow-staging.cploutarchou.workers.dev**
(deploy run #3, workflow "Deploy staging", all 14 steps green, ~65s).
Timeline: run #1 created all 6 queues then failed on R2-not-enabled
(expected; owner enabled R2 in the dashboard); run #2 exposed a
queue-exists idempotency wording bug (wrangler says "already taken", the
grep expected "already been taken") — fixed via PR #14; run #3 green
end-to-end: R2 bucket created, migrations 0001–0007 applied to remote D1
(cd51fe7b…, WEUR), `ingestion_paused=true` seeded, SPA built, Worker
deployed with `--var` workers.dev URLs, runtime secrets pushed
(BETTER_AUTH_SECRET, RESEND_API_KEY, STRIPE_SECRET_KEY, both price IDs,
ADMIN_EMAILS; STRIPE_WEBHOOK_SECRET/EMAIL_FROM intentionally absent →
documented fallbacks), CI smoke tests passed (health live+ready, CSP
header on SPA, /api/test/* 404 = double gate sealed, JSON 404 envelope).
Session-container egress cannot reach workers.dev (proxy 403), so live
verification is CI-executed, not session-local — honest flag.
Remaining in phase: owner's Stripe webhook (staging URL now known) →
re-run deploy to push STRIPE_WEBHOOK_SECRET; pre-first-ingestion gates
(live checkQuerySyntax, bounded volume window, fixture refresh) after
unpausing; rollback drill + Time Travel restore test; production prep.

- **P-4 scoring N+1 refactor LANDED** (25300b6): bulk existence check
  (chunked `lot_id IN` per engine version, 90/chunk), one `db.batch` per
  flush with shrinking race-retry (genuine integrity errors rethrown),
  per-org 150-match flush buffers + final flush on the truncation path;
  counters/continuation/replace semantics preserved; 155-match and
  150-lot scale tests in both layers. Follow-on fix (c8d4c9d): the
  scoring-bundle READ path (`loadLotScoringBundlesByIds`/`ForNotices`/
  `attachCpvAndGeography`) had unchunked IN-lists that failed at exactly
  the MATCH_QUEUE's 100-id batch size — chunked at 90.

### Phase 12 sign-offs (2026-08-16)

- **security: SIGN-OFF** (independent re-run of lint/root/worker/db/
  tenant-isolation suites — all green). Verified: test-hook double gate
  airtight in every deployed config with real negative tests; E2E
  rate-limit relaxations unreachable outside `isE2ETestHooksEnabled`
  (grep-verified single caller); staging/production keep 100/60 and
  Better Auth defaults; tenant scoping intact through the batch refactor
  (org-scoped existence/insert/delete + structural & behavioral tests);
  no secrets, `.dev.vars` gitignored, mailbox never logs URLs/tokens.
  Findings: SEC-P12-01 LOW (dev server LAN exposure — FIXED same day:
  `wrangler dev --ip 127.0.0.1` in scripts/e2e-webserver.sh);
  SEC-P12-02..05 INFO accepted/recorded (score-now cross-tenant-but-
  production-identical; actions tag-pinned not SHA-pinned; `--env`
  deploy reliance mitigated by placeholder database_id; own-org profile
  response not yet DTO-minimized).
- **production-reviewer: PASS** (every gate re-run with real outputs:
  format/lint/typecheck clean, root 405, worker 152, db 52, build clean,
  **E2E 25/25 by its own execution**, drizzle zero-drift re-proven
  empirically, migrations 0001–0007 from empty verified twice). DoD
  spot-checks all confirmed against code: axe 9 pages no exclusions,
  queue-dispatch/rate-limit tests behavioral not tautological, P-4
  semantics preserved, deferred items recorded, no forbidden patterns.
  Findings: P12-R-01 LOW (ledger staleness — resolved by this entry);
  P12-R-02/03 INFO accepted.

**Phase 12 — Quality: COMPLETE (signed off, merged to main via PR #12,
merge commit d37a514, CI green).** Tag: phase-12-complete (local; tag
pushes are 403 for this session's credentials — see Notes).

**Phase 13 — Deployment: IN PROGRESS (started 2026-08-16).** Plan of
record = docs/deployment.md. Stage A (staging): (1) provision — D1
`bidmorrow-staging` CREATED via MCP connector (id
cd51fe7b-6b12-48b4-ae94-84205c3de99a, WEUR); R2 blocked on one-time
account enablement (owner console action, recorded in blockers item 1);
queues + bucket are created idempotently by the workflow itself. (2)
`.github/workflows/deploy-staging.yml` — auto-deploy on merge to main +
workflow_dispatch, GitHub `staging` environment, steps: ensure
queues/bucket → remote migrations → seed `ingestion_paused=true`
(pre-first-ingestion gates) → build SPA → resolve workers.dev URL from
account subdomain (injected via `--var APP_BASE_URL/BETTER_AUTH_URL`,
overriding the custom-domain placeholders) → deploy → `secret bulk`
(non-empty values only, so absent optionals keep documented fallbacks) →
smoke tests (health live/ready, CSP header, test-hooks 404, JSON 404
envelope). (3) After first green deploy: hand owner the staging URL +
Stripe webhook wizard values (`/api/webhooks/stripe`, API version
2026-07-29.dahlia, 6 events). (4) Then pre-first-ingestion gates on
staging: live `checkQuerySyntax`, one bounded volume-measurement window,
fixture refresh; then rollback drill + D1 Time Travel restore test; then
production prep. docs/deployment.md webhook path corrected
(`/api/billing/webhook` → the real `/api/webhooks/stripe`).

Owner-provided since Phase 11 (see HUMAN_DECISION_BLOCKERS.md): Workers
Paid plan, CI Cloudflare token + account id, BETTER_AUTH_SECRET (distinct
per env), Stripe test keys + prices, Resend API key, ADMIN_EMAILS — all in
GitHub `staging`/`production` environment secrets. Staging deploy is fully
unblocked; STRIPE_WEBHOOK_SECRET waits for the staging URL by design.

**ADR-0008 IMPLEMENTED — poison-pill notice-fetch resilience, consumer
side (2026-08-19).** Schema (migration 0008, `ingestion_fetch_retries` +
`ingestion_runs.notices_fetch_failed`) had already landed; this closes the
consumer side per the ADR + its dated Amendment. `run-window.ts`: a
per-notice `TedRequestError` from `fetchNoticeXml` is now record-and-
continue (durable `ingestion_errors` row reusing the PR #46
`NOTICE_FETCH_*` codes, `noticesFetchFailed`++, idempotent
`upsertFetchRetry`, window finishes `partial`); `TedBudgetExceededError`
still propagates unchanged (§4). Render-pending exhaustion at the phase-2
requeue site gets the identical record-and-continue treatment
(`NOTICE_RENDER_PENDING`, Amendment §A1) — this SUPERSEDES the 2026-08-18
fix's "exhaustion stays window-fatal" behavior; two pre-existing tests
that asserted the old window-fatal shape were rewritten to assert
`partial` + retry-row-created instead. Systemic threshold
(`FETCH_FAILURE_FAIL_MIN=5`, `FETCH_FAILURE_FAIL_RATIO=0.2`, internal
`FetchFailureThresholdError` → durable `FETCH_FAILURE_THRESHOLD_EXCEEDED`)
implemented as an exported pure function (`isFetchFailureThresholdExceeded`)
for unit testing without D1. `MAX_RENDER_VISITS` bumped 4→6 (§A3). New
`packages/procurement/src/fetch-retry-drain.ts` (`drainFetchRetries`):
reuses `processOneNotice` (now exported, with a `swallowFetchErrors` flag
so the drain's own attempts/abandon bookkeeping — not §1's window
skip-and-upsert — decides drain-cycle outcomes) as a shared requeue-
cycling mini-queue over due retry rows, one `attempts+=1` per CYCLE not
per visit (§A2); wired into `runIngestionCatchUp` to run after catch-up,
skipped when catch-up ended `failed` or ingestion is paused. Watchdog
(`checkFetchResilienceAlerts`, wired into the existing `CRON_WATCHDOG`
handler) adds the three §5 alert conditions. Admin: `GET
/api/admin/ingestion/runs` already surfaces `notices_fetch_failed` (whole
row returned); new `GET /api/admin/ingestion/fetch-retries` (status
counts + bounded paginated list). Retention: `purgeOldFetchRetries`
(terminal rows only, 90 days off `updated_at`, pending rows never purged)
wired into `runLedgerPurge` alongside the existing three ledger purges.
Tests: new pure-function suite
`packages/procurement/src/run-window.threshold.test.ts` (7 tests); 9 new
D1 integration tests in `apps/worker/src/ingestion.d1.test.ts` (record-
and-continue partial, budget passthrough still fails the window,
render-pending record-and-continue, threshold breach via
`TedRequestError`s, threshold breach via pure exhaustions (§A4),
idempotent re-run of a partial day, drain recovery end-to-end, drain
backoff+abandonment at 5, drain skipped after a failed catch-up); 1 new
retention-purge D1 test in `org-lifecycle.d1.test.ts`. Gates green:
format/lint/typecheck (all 14 workspace packages) clean, root vitest 516
pass/3 skip, worker 191, db 61, build clean (web + worker dry-run
deploy). Deviation from the ADR's literal §3 "identical processOneNotice
path" wording, recorded honestly: since §1 changed `processOneNotice` to
SWALLOW `TedRequestError` internally, a literal drain-reuse would never
let a drain-cycle failure propagate for the attempts/abandon bookkeeping
§3 requires — resolved via the `swallowFetchErrors:false` flag so the
drain gets the same fetch/snapshot/parse/persist code path with failure
semantics the drain's own contract needs. A permanently-malformed notice
recovered via the drain (fetches fine, then fails to PARSE) is marked
`recovered` in the retry table (the retry table's job is fetch failures
specifically; the parse failure is independently tracked in its own
`ingestion_errors` row) — an interpretation call, not explicit in the
ADR, flagged for review. Not independently re-verified by
production-reviewer/security in this session (implementer-only pass);
recommend running both before the next phase-close tag.

**ADR-0008 REVIEW FINDINGS CLOSED (2026-08-19, same session, security
SIGN-OFF + production-reviewer PASS with findings-before-merge).** F-1
(MEDIUM, the real bug): `checkFetchResilienceAlerts` condition (iii)'s
newest-first streak scan (`packages/procurement/src/health.ts`) broke on
every drain run interleaved between partial windows — the drain writes
its own `ingestion_runs` row (needed as the FK anchor for its own
diagnostics) that always finishes `notices_seen = 0`/`notices_fetch_failed
= 0`, which read as "not fetch-failed" and reset the streak on exactly the
degraded days the condition targets. Fixed by excluding `notices_seen ===
0` rows from the scan (no migration; a cheap existing-shape discriminator,
documented in-code) — this also correctly no-ops on a genuinely empty
window (e.g. a TED-quiet weekend), which carries no fetch-health signal
either way. F-2/F-3/F-4/BM-ADR8-1 (LOW) closed with new tests: pure-drain
render-cycling (`attempts` incremented ONCE per cycle, not per 202 visit —
both the recovers-after-N-202s and exhausts-all-6-visits shapes), the
drain-recovers/parse-fails-independently interpretation call (F-4, now
pinned by a test), watchdog conditions (i)/(ii) direct coverage, and the
new admin endpoint's 404-cloak/200-shape/limit-cap. 15 new D1 tests total
(9 in `ingestion.d1.test.ts`'s new `checkFetchResilienceAlerts` describe
block + 3 in its `ADR-0008 fetch resilience` block + 3 in
`admin.d1.test.ts`). Gates re-run clean: format/lint/typecheck (all 14
packages), root vitest 516 pass/3 skip, worker 200 (was 191), db 61,
build clean (web + worker dry-run deploy).

## Completed

### Phase 11 stage A — Privacy implementation (2026-08-15)

Closed every remaining gap between docs/privacy.md's six implementation
commitments and reality (account deletion + log redaction already shipped
Phase 3/4/2; this session built organization deletion, the deleted-org purge
job, data export, and fixed two FK edges account deletion had never been
exercised against). Full reconciliation with `(implemented Phase N)`
markers is in docs/privacy.md itself — this entry is the session summary.

- **Migrations 0005/0006 (additive, table-rebuild — SQLite has no `ALTER
COLUMN`)**: relax three FKs from `NOT NULL` to nullable —
  `saved_tenders.saved_by_user_id`, `ignored_tenders.ignored_by_user_id`,
  `customer_feedback.user_id` (0005), and `organizations.created_by_user_id`
  (0006). **Why, and how it was found**: these are ORG-owned rows with a
  `users` FK for attribution only; `organizations` rows are NEVER
  hard-deleted (see the purge decision below). A D1 test deleting the
  account of a MEMBER who had saved a tender in an org they remained a
  member of hit a live FK violation on Better Auth's `deleteUser` — the
  active-only `getOrganizationsForUser` account.ts previously used to
  enumerate memberships also silently skipped a leftover membership row in
  an ALREADY-deleted org, and even after fixing that, the sole creator of
  a (tombstoned, never-hard-deleted) org could never delete their account
  either, via `organizations.created_by_user_id`. All three findings fixed
  the same way: nullable column + a targeted repository function
  (`nullifyUserAuthorship` in engagement.ts, `nullifyOrganizationCreator` in
  identity.ts) that SET NULLs the departing user's attribution — same
  "anonymize the author, keep the row" pattern `audit_events.actor_id`
  already used — called from `routes/account.ts` before
  `removeOrganizationMember`/`deleteUser`. `account.ts` now enumerates
  memberships via a new `getAllOrganizationsForUser` (ANY org status, not
  just active) instead of the active-only `getOrganizationsForUser`, and the
  sole-owner 409 guard only fires for an ACTIVE org (a deleted org has
  nothing left to orphan).
- **`DELETE /api/org`** (`routes/org.ts`, OWNER only, exact-match
  `{confirm: <real org name>}` verified server-side): soft-deletes
  (`organizations.status = 'deleted'`) immediately, best-effort Stripe
  `cancel_at_period_end` cancellation (`packages/billing`'s new
  `cancelSubscriptionForOrgDeletion` — never blocks the deletion; every
  outcome incl. "not configured"/API error goes into the audit row's
  `afterSummary` for manual follow-up), writes an `organization.deleted`
  audit row. `middleware/organization.ts`'s `requireOrganization` now
  resolves membership via a new `getFirstOrganizationForUserAnyStatus`
  (any status, not just active) so a deleted org's members get a distinct
  `organization_deleted` 403 instead of the onboarding-shaped
  `no_organization`. **Bug fixed alongside**: `company.ts`'s
  `listOrgsEligibleForScoring` was missing the `organizations.status =
'active'` filter `listOrgsWithDigestEnabled` already had — a deleted org
  with its company profile/CPV rows still intact (pre-purge) stayed
  scoring-eligible; now both exclude deleted orgs identically.
- **`packages/db/src/repositories/org-purge.ts`** (new, GLOBAL,
  cross-tenant by design like `retention.ts`/`admin.ts`) +
  **`packages/procurement/src/org-purge.ts`** (`runOrgPurge`, composes
  `identity.ts`'s `listOrganizationsPendingPurge`/`tombstoneOrganization`
  with the cascade): hard-deletes every owned row for organizations
  `status = 'deleted'` for ≥30 days (config `graceDays`, bounded `limit`
  per run), in FK-safe order — `customer_feedback`/`digest_items` first
  (both reference `tender_matches` and would otherwise block deleting it),
  then `match_components`/`match_risk_flags`/`tender_matches`,
  `saved_tenders`/`ignored_tenders`, `digest_runs`, `email_deliveries`,
  every `company_*`/`matching_preferences`/`digest_preferences` row,
  `support_notes`, `product_events`, leftover `organization_members`.
  **Retention decisions, documented in-file**: `subscriptions` (billing/
  legal record) and `audit_events`/`billing_events` (append-only ledgers)
  are NEVER purged — their `organization_id` FK is why the `organizations`
  row itself is never hard-deleted either; instead it's tombstoned
  (`name` → `deleted-<id>`, PII minimization) so those two ledgers' FKs
  never dangle. A second run is idempotent (the tombstone name prefix
  excludes it from the next scan — no dedicated `purged_at` column needed).
  Wired into the existing daily retention cron (`runRetentionPurgeJob` in
  `apps/worker/src/ingestion.ts` now runs both the tender-corpus sweep and
  `runOrgPurge` back to back; `RunPurgeResult`'s return shape is unchanged
  for the existing `queue.purge.completed` log field).
- **`GET /api/org/export`** (`routes/org.ts`, OWNER only, rate-limited by
  the existing `API_RATE_LIMITER` binding, audit-evented):
  `packages/db/src/repositories/export.ts`'s `getOrgExportBundle` returns
  profile/preferences/saved+ignored+feedback (with tender titles
  denormalized on, capped at 500 rows/collection, `truncated: true`
  signals a follow-up export) as one bounded JSON bundle — deliberately
  excludes the global tender corpus (public TED content, not a portability
  concern).
- **Tests**: `apps/worker/src/org-lifecycle.d1.test.ts` (new, 7 tests, real
  workerd+D1) — org deletion (MEMBER blocked, wrong-confirm 400, correct
  confirm soft-deletes + blocks every member's context + excludes from
  digest/scoring eligibility), `runOrgPurge` (pre-grace org fully intact;
  full purge asserts EVERY owned table empty by direct COUNT query per
  table, `subscriptions`/`audit_events` survive, the org row is a
  tombstone, the global `tender_lots`/`tender_notices` rows for a
  saved-and-purged tender survive untouched, a second run is a no-op), the
  two account-deletion FK edges (member's saved/ignored/feedback rows
  survive with NULL attribution; a sole owner of an already-deleted org can
  now delete their account), and the export endpoint (shape, OWNER-only,
  cross-org isolation via a second org's bundle + a direct repository call).
  `packages/db/src/migrations.d1.test.ts` gained 3 tests (6-migration chain
  applies; the three migration-0005 columns and the migration-0006 column
  are nullable via `PRAGMA table_info`).
  `tests/security/tenant-isolation-contract.test.ts` gained `export.ts` to
  TENANT_FILES (conforms — `getOrgExportBundle(db, organizationId)`) and
  `org-purge.ts` to GLOBAL_FILES with a written cross-tenant-schema
  exemption, plus five new TENANT_EXEMPT entries for the
  userId-first/cross-tenant-by-design new functions in `identity.ts` and
  `engagement.ts`.
- **Gates, real counts**: `pnpm format:check` clean · `pnpm lint` clean ·
  `pnpm typecheck` clean across all 14 workspace packages · `pnpm test`
  (root vitest + worker + db, chained) — root vitest 55 test files / 396
  tests green (incl. the updated tenant-isolation contract), worker
  `pnpm --filter @bidmorrow/worker test` 12 files / 128 tests green
  (includes the new `org-lifecycle.d1.test.ts`'s 7 tests), db
  `pnpm --filter @bidmorrow/db test` 9 files / 49 tests green (includes the
  3 new migration tests) · `pnpm build` (web + worker `wrangler deploy
--dry-run`) green.
- **Open items / not done this session**: `production-reviewer` and
  `security` subagent review (per CLAUDE.md's "after every phase" rule) —
  not run in this session, recorded here as the explicit next step before
  tagging `phase-11-stage-a-complete`. No new HUMAN_DECISION_BLOCKERS items.

### Phase 11 fix batch — review findings closed (2026-08-15)

Closed the review-finding backlog from the Phase 11 stage A pass, one item
per finding id.

- **SEC-P11-01 (MEDIUM, org resolution must prefer ACTIVE membership)**:
  `identity.ts`'s `getFirstOrganizationForUserAnyStatus` ordered by
  `id ASC` only — a user who deletes org A and is later added to (or
  creates) org B stayed shadowed into deleted org A for the full 30-day
  purge grace window, wrongly 403ing every organization-scoped route with
  `organization_deleted`. Fixed: order by `CASE WHEN status = 'active' THEN
0 ELSE 1 END, id ASC` — active membership resolves first; deleted/
  suspended only as a fallback when no active membership exists (so
  `middleware/organization.ts` can still distinguish "was in a deleted org"
  from "never had one"). D1 test in `org-lifecycle.d1.test.ts`: delete org
  A, create org B, `GET /api/org/profile` resolves org B (asserted via a
  distinct company-profile displayName, since `/profile` doesn't leak the
  org id itself).
- **SEC-P11-02 (MEDIUM, auth transactional email must use Resend when
  configured)**: `apps/worker/src/auth-instance.ts` always used
  `createLoggingEmailProvider`, even with `RESEND_API_KEY`/`EMAIL_FROM`
  configured. **Mechanism chosen**: new `packages/notifications/src/
auth-mail.ts` — `buildAuthEmailBody(kind, url)` composes the subject/text/
  html body per kind (verification/password_reset), and
  `createResendAuthEmailProvider` wraps the already-tested
  `createResendEmailProvider` (digest path) to send it.
  `resolveAuthEmailProvider` in `auth-instance.ts` picks Resend when both
  env vars are set, else the logging stub (same "configured vs. logged
  fallback" shape as `digest.ts`'s `resolveDigestProvider`). **SEC-P4-08
  (droppable fire-and-forget) fixed via `ExecutionContext.waitUntil`, NOT by
  awaiting inline**: Better Auth's own docs warn against awaiting
  `sendResetPassword` (timing side channel reveals account existence via
  response latency), so `packages/auth`'s `void deps.sendEmail(...)` call
  shape had to stay fire-and-forget. `createRequestAuth` now takes a third
  `ctx: WaitUntilCtx` param (`c.executionCtx` — verified available at every
  call site since `apps/worker/src/index.ts`'s `export default { fetch: (r,
e, ctx) => app.fetch(r, e, ctx) }` threads it through Hono); the
  `sendEmail` wrapper registers the actual provider-send promise with
  `ctx.waitUntil(sendPromise)` SYNCHRONOUSLY (before any `await`), so even a
  `void`-called async function extends the isolate's lifetime until the send
  settles, without reintroducing the timing side channel. Failures are
  logged (kind/to only, never url/token — C10). Four call sites updated
  (`index.ts`'s `/api/auth/*` mount, `middleware/session.ts`,
  `middleware/admin.ts`, `routes/account.ts`). Tests: existing
  `auth.test.ts` capture-provider suite green unchanged (logging-fallback
  path in test env produces the same log shape); new
  `packages/notifications/src/auth-mail.test.ts` (4 tests) — body composed
  per kind with the url in text/html, Resend send posts the composed
  body, API key never appears in a thrown error.
- **P11-R-01 (MEDIUM, purge tombstone filter)**: `identity.ts`'s
  `listOrganizationsPendingPurge` replaced `name NOT LIKE 'deleted-%'` with
  an exact per-row comparison `name != ('deleted-' || id)` (drizzle `sql`
  template) — the `LIKE` prefix scan could permanently exclude a genuine
  org from ever being purged if its real name happened to start with
  `deleted-` (e.g. "Deleted-Data GmbH"); the exact comparison can only ever
  match a row's own would-be tombstone. Two D1 tests added: a
  `Deleted-Data GmbH` org still gets purged; an already-tombstoned org stays
  excluded on a second scan (idempotency unchanged).
- **P11-R-02 (LOW, `nullifyOrganizationCreator` must not bump `updated_at`
  for deleted orgs)**: `updated_at` on a `status = 'deleted'` org is the
  purge grace clock; the SET NULL now conditionally preserves it via `CASE
WHEN status = 'active' THEN <now> ELSE updated_at END` — bumping it for an
  already-deleted org would silently restart the clock every time a member
  with attribution on it deletes their account, indefinitely deferring
  purge. D1 test: `updated_at` unchanged after `nullifyOrganizationCreator`
  runs against a deleted org.
- **P11-R-03 (MEDIUM, `packages/billing/src/cancellation.test.ts`)**: new
  file, 5 unit tests against a stubbed Stripe client + mocked `@bidmorrow/db`
  repository functions (`vi.mock('@bidmorrow/db')`, no D1 — pure
  orchestration): `no_subscription` (missing row / null
  `stripeSubscriptionId`, Stripe never called), `already_canceled`
  short-circuit (Stripe never called), successful `cancel_at_period_end`
  update + local-row mirror write (asserts the exact upsert args), and the
  Stripe-error path — confirmed the function's actual contract (its own doc
  comment: "best-effort" is the CALLER's `routes/org.ts` responsibility via
  try/catch; the function itself propagates the error rather than
  swallowing it) by asserting `rejects.toThrow` and that the failed attempt
  is never mirrored into the local row.
- **P11-R-04 (LOW, null `email_deliveries.user_id` before Better Auth
  delete)**: new `packages/db/src/repositories/engagement.ts`
  `nullifyUserEmailDeliveries(db, userId)` — global (documented exemption in
  the tenant-isolation contract test, `engagement.ts` TENANT_EXEMPT list),
  since `email_deliveries` is explicitly not tenant-owned for auth mail
  (`organization_id` null, `user_id` set). Wired into `routes/account.ts`
  alongside `nullifyUserAuthorship`/`nullifyOrganizationCreator`, before
  membership removal. No current writer sets `email_deliveries.user_id`
  (`createEmailDelivery` always nulls it — digest sends only), so this is
  currently a no-op in practice but closes the FK edge for a future
  auth-mail delivery-tracking writer; documented CHECK-constraint safety
  note in-file. `docs/privacy.md` commitment 5 wording updated to match
  reality. D1 test: a directly-inserted `email_deliveries` row with
  `user_id` set survives account deletion with `user_id` nulled.
- **SEC-P11-03 + P11-R-05 (docs/privacy.md + docs/threat-model.md)**:
  documented that `audit_events` retains pre-deletion org names/actor ids
  for up to 24 months as deliberate security-forensics retention (the
  tombstone minimizes the LIVE `organizations` row; the ledger is
  append-only by design) — and, per SEC-P11-04 below, that retention window
  is now enforced, not open-ended.
- **SEC-P11-04 (time-based ledger purges)**: new
  `packages/db/src/repositories/retention.ts` functions
  `purgeOldAuditEvents`/`purgeOldEmailDeliveries`/`purgeOldProductEvents`
  (bounded `limit` per table per run; `email_deliveries` detaches
  `digest_runs.email_delivery_id` first — FK-safe, same "detach before
  delete" pattern as `digest_items.match_id`) + new
  `packages/procurement/src/ledger-purge.ts` `runLedgerPurge` orchestrator
  (24-month window for `audit_events`, 12-month for `email_deliveries`/
  `product_events`, per docs/privacy.md's data inventory), wired into the
  existing daily `runRetentionPurgeJob` (`apps/worker/src/ingestion.ts`)
  after the tender-corpus and org purges. D1 tests (2): old rows purged
  across all three tables while recent rows survive; an old-but-referenced
  `email_deliveries` row is detached from its `digest_runs` row before
  deletion rather than violating the FK.
- **Threat-model refresh** (`docs/threat-model.md`, Last-reviewed bumped to
  2026-08-15): all seven items from the security audit applied — new asset
  A12 + threat T22 (organization deletion/purge lifecycle); rate-limit
  fail-open residual risk + revisit trigger #11 added; T13's XML size-cap
  mitigation concretized (`MAX_XML_BYTES` = 15,000,000, Content-Length
  pre-check + actual-byte re-check, with the "not a true streaming cutoff"
  residual stated honestly); T12's billing surface pattern concretized
  (identity trusted from the signature-verified payload, mutable state
  always re-fetched live from Stripe) + SEC-P9-02/03 residuals recorded
  inline; T19 admin surface updated (Phase 10's generic per-request audit
  row) and C5's `SameSite=Strict` admin-cookie claim corrected to reality
  (one shared session cookie, Better Auth's default `Lax`, verified from
  `packages/auth/src/index.ts`'s config — no `sameSite`/`cookies` override
  anywhere); T21's GitHub Actions claim corrected from SHA-pinned to
  tag-pinned (verified against `.github/workflows/*.yml`) + a residual-risk
  row and deploy-hardening follow-up recorded; SEC-P4-09 deltas closed out
  inline at T2 (cf-connecting-ip-only IP keying), T16 (global 128 KB body
  limit covering the webhook route too), and T10 (account-deletion
  membership-compensation-on-failure behavior).
- **Gates, real counts**: `pnpm format:check` clean · `pnpm lint` clean ·
  `pnpm typecheck` clean across all 14 workspace packages · `pnpm test`
  (root vitest + worker + db, chained) — root vitest 57 test files / 405
  tests green (incl. the updated tenant-isolation contract with the new
  `nullifyUserEmailDeliveries` exemption), worker `pnpm --filter
@bidmorrow/worker test` 12 files / 135 tests green (org-lifecycle.d1.test.ts
  grew from 7 to 14 tests), db `pnpm --filter @bidmorrow/db test` 9 files /
  49 tests green — 589 tests total across the three suites · `pnpm build`
  (web + worker `wrangler deploy --dry-run`) green.
- **Open items / not done this session**: `production-reviewer` and
  `security` subagent re-review not run in this session — recorded here as
  the explicit next step before tagging a `phase-11-fix-batch-complete` (or
  equivalent) checkpoint. No new HUMAN_DECISION_BLOCKERS items.

### Phase 10 stage A — Internal admin API (2026-08-15)

- **Migration 0004 (additive, zero drizzle drift)**:
  `organizations.suspended_at INTEGER` nullable
  (`migrations/0004_admin_suspension.sql`, drizzle-kit-generated from
  `packages/db/src/schema/identity.ts`, `drizzle-kit generate` afterward
  produces "No schema changes, nothing to migrate"). **Decision, documented
  in-file on the column**: suspension is NOT a third `organizations.status`
  CHECK value — SQLite cannot ALTER a CHECK constraint in place (only a full
  create-new/copy/swap rebuild, migration-safety skill), and suspension is
  orthogonal to the active/deleted lifecycle (a suspended org stays
  `active`; retention/deletion is untouched). `identity.ts` gains
  `suspendOrganization`/`unsuspendOrganization` (contract-compliant, take a
  single `organizationId`, idempotent). `apps/worker/src/middleware/
organization.ts`'s `requireOrganization` 403s `{error:
'organization_suspended'}` when set — blocks every `/api/org/*`/feed/tender
  route at the source; `company.ts`'s `listOrgsWithDigestEnabled` gained an
  `isNull(organizations.suspendedAt)` filter so the digest scheduler
  excludes suspended orgs too. Both proven by a D1 test (suspend → `GET
/api/org/feed` 403 + digest-selection exclusion → unsuspend → both
  restored).
- **`packages/db/src/repositories/admin.ts` (new file, documented cross-
  tenant exception)**: `searchOrganizationsAdmin`, `getOrgAdminDetail`,
  `searchUsersAdmin`, `listSubscriptionsAdmin`, `listDigestRunsAdmin`,
  `listEmailFailuresAdmin`, `listAuditEventsAdmin`, `getUsageCounts`,
  `getRecentErrorCounts`, `getDbSizeEstimate` — every function is read-only,
  reachable ONLY from `/api/admin/*` (never imported by a customer route),
  and documented in-file as the deliberate exception to the "every tenant
  function requires organizationId" contract. `tests/security/
tenant-isolation-contract.test.ts` classifies `admin.ts` as a GLOBAL file
  with an explicit exemption paragraph (it imports company/engagement/
  billing schema modules specifically BECAUSE it does cross-tenant reads —
  the opposite of every other GLOBAL file's guarantee); the suite passes.
  Small additions to the existing global files for the same admin surface:
  `ingestion.ts` `listErrorsForRun`, `tender-corpus.ts`
  `getNoticeDebugBundle` (notice + versions + per-version lots + R2 snapshot
  pointers, by `source_notice_id`), `matching.ts` `getTenderMatchByLot`
  (contract-compliant — takes `organizationId`, so it stays in the tenant
  file, not `admin.ts`).
- **`GET/PUT` digest preview, read-only**: `packages/notifications`
  `previewDigest` renders EXACTLY what `generateDigest`'s normal
  (non-resumed) send path would render — same candidate query, same
  fresh-path render-item mapping — but creates NO `digest_runs` row, writes
  NO `digest_items`, sends NO email. Proven by a D1 test asserting
  `digest_runs`/`email_deliveries` row counts are byte-identical before and
  after a preview call.
- **Backfill reuses the real ingestion pipeline, not a parallel one**:
  `IngestQueueMessage` gained `{kind:'backfill_window', windowFrom,
windowTo}`; `apps/worker/src/ingestion.ts`'s new `runBackfillWindowJob`
  calls `runIngestionWindow` — the SAME per-window function the daily
  catch-up cron uses — for one admin-supplied day, then enqueues new lots to
  `MATCH_QUEUE` exactly like the cron path. `POST /api/admin/ingestion/
backfill` enumerates `[fromDate, toDate]` into single-day windows, rejects
  a range over 90 days (400 `range_too_large`) BEFORE enqueueing anything,
  and enqueues one `INGEST_QUEUE` message per day. Deliberately does not
  bypass the ingestion checkpoint's advance-only invariant — backfilling
  behind the checkpoint still throws inside `runIngestionWindow`, which is
  correct (backfill fills a gap ahead of catch-up, never rewrites history).
- **Match-trace recompute reuses the exact Phase 7 on-demand-recompute
  pattern** (`GET /api/admin/match-trace?organizationId&lotId`,
  `routes/admin.ts`): `loadOrgProfile` + `mapLotToEngineInput` +
  `scoreLotForOrg`, live, alongside the stored match/components/risk-flags
  row (via the new `getTenderMatchByLot`). D1 test seeds a match with a
  known component sum, asserts the STORED component points sum to the
  stored score, and that a live recompute is returned. `POST /api/admin/
matching/recompute` accepts `noticeIds` (≤100, → `{kind:'recompute'}`
  batches) XOR `lotIds` (≤500, → `{kind:'recompute_continuation'}`
  batches — reuses the existing SEC-P6-01 continuation consumer, which is
  functionally identical to a lot-id-keyed hard-replace recompute, so no
  new queue consumer was needed).
- **Audit design (SEC-P4-07)**: `apps/worker/src/middleware/admin.ts`'s
  `requireInternalAdmin` now writes ONE generic `audit_events` row
  (`action: 'admin.request'`, actor + method+path + query-summary + response
  status) for EVERY request that clears the allowlist — reads included, not
  just mutations — written AFTER `next()` so the row carries the real
  response status. Every mutation route ADDITIONALLY writes its own
  specific row (`org.suspended`, `feature_flag.updated`,
  `ingestion.scope_updated`, `ingestion.backfill_enqueued`,
  `matching.recompute_enqueued`, `support_note.created`, etc.) via a shared
  `writeAdminAction` helper in `routes/admin.ts`. D1-tested: a plain GET
  writes exactly 1 row; a mutating PUT writes exactly 2 (generic + specific)
  and both actions are present.
- **Confirmation pattern**: every mutation route requires an exact-literal
  `confirm` string in its JSON body (`PAUSE_INGESTION`, `RESUME_INGESTION`,
  `UPDATE_INGESTION_SCOPE`, `RUN_BACKFILL`, `RECOMPUTE_MATCHES`,
  `PAUSE_DIGEST`, `RESUME_DIGEST`, `SUSPEND_ORGANIZATION`,
  `UNSUSPEND_ORGANIZATION`, `UPDATE_FLAG`), enforced by zod
  `z.literal(...)` — missing/mismatched `confirm` 400s automatically via
  `@hono/zod-validator`, before the handler body runs. Documented as a
  mistake-friction gate, not a security boundary (`requireInternalAdmin`
  alone is that).
- **Routes** (`apps/worker/src/routes/admin.ts`, full rewrite of the
  Phase 4 placeholder, all behind `requireInternalAdmin`, zod-strict,
  pagination capped at 50 everywhere via a shared `paginationQuerySchema`):
  `GET orgs` (name search + status/subscription summary + member count),
  `GET orgs/:id` (full profile/subscription/digest-prefs/counts bundle),
  `POST orgs/:id/suspend|unsuspend`, `GET users` (email search),
  `GET subscriptions` (status filter), `GET ingestion/runs`,
  `GET ingestion/errors?runId`, `GET notices/:sourceNoticeId`,
  `POST ingestion/pause|resume`, `POST ingestion/scope` (≤20 CPV families,
  re-validated through the pipeline's own `parseIngestionScope` before
  persisting), `POST ingestion/backfill`, `GET match-trace`,
  `POST matching/recompute`, `GET digest/runs`, `GET digest/preview`,
  `GET email/failures`, `POST digest/pause|resume`, `GET/POST
support-notes`, `GET audit-events` (actor/action/since filters),
  `GET health-details` (ingestion staleness + pause state + 24h error
  counts + DB size estimate + recent digest runs + flag states + an
  HONEST note that DLQ contents are not directly readable from the Worker
  runtime), `GET usage` (major-table row counts), `GET flags`,
  `PUT flags/:key` (param validated against `FEATURE_FLAG_KEYS` via
  `z.enum` — an unknown key 400s at the param-validation layer, never
  reaches the handler).
- **DB-size approach, honestly flagged**: `getDbSizeEstimate` attempts
  `PRAGMA page_count`/`PRAGMA page_size` via `db.get(sql\`...\`)`, wrapped
in try/catch; on any failure returns `{measured: false, approxBytes:
  null}`rather than fabricating a number. NOT round-tripped against a real
deployed D1 database from this dev environment (Cloudflare docs hosts are
proxy-blocked here, same restriction as every prior phase's external-docs
caveats) — flagged in-file as a TODO-verify-against-real-D1 before this
ships, same honesty pattern as the Phase 7`_headers` caveat.
- **Tests**: `apps/worker/src/admin.d1.test.ts` (new, 17 tests, real
  workerd+D1) — 404/200 gate sample, audit-row-per-request (read = 1 row,
  mutation = 2 rows: generic + specific), confirm-pattern 400s (missing +
  wrong-literal), org suspension blocking `/api/org/feed` (403) AND
  `listOrgsWithDigestEnabled` (exclusion) with unsuspend restoring both,
  ingestion scope validation (>20 families 400, valid persists), backfill
  bounds (>90 days 400, valid enqueues N single-day messages), match-trace
  stored-component-sum-equals-stored-score + live recompute presence,
  digest preview's zero-side-effects (run/delivery counts unchanged),
  flags PUT rejecting an unknown key (400 at param validation) and a known
  key round-tripping through `GET /flags`, pagination limit>50 rejected.
  `packages/db/src/migrations.d1.test.ts` gained 2 tests (4-migration
  chain applies from empty; `organizations.suspended_at` column exists).
  `apps/worker/src/tenancy.test.ts`'s pre-existing admin-gate test updated
  for the new `/health-details` response shape (was asserting the Phase 4
  placeholder's `{ok:true,admin:true}` body). No new `packages/db`-scoped
  test file — the new repo functions are exercised via the worker's D1
  suite, same pattern as every prior phase.
- **Real counts (2026-08-15, all executed)**: `pnpm format` (4 files
  reformatted by the formatter itself: `routes/admin.ts`,
  `repositories/admin.ts`, `repositories/matching.ts`,
  `tests/security/tenant-isolation-contract.test.ts` — prettier only, no
  logic changes) · `format:check` PASS · `lint` PASS · `typecheck` PASS
  (14/14 workspace projects) · `test` PASS — root vitest **51 files/370
  tests** (unchanged — no new root-scoped test file this phase); worker
  pool-workers **11 files/119 tests** (+1 file/+17 tests, the new
  `admin.d1.test.ts`); packages/db pool-workers **9 files/47 tests** (+1
  test, the two new migration-suite assertions net +1 over the prior
  46 — one test replaced/renamed, one added) = **71 files/536 tests
  total** · `build` PASS (`vite build` 59 modules, 307 KB JS/91 KB gzip,
  unchanged — no web changes this phase; `wrangler deploy --dry-run` —
  top-level clean, lists `env.INGEST_QUEUE`/`MATCH_QUEUE`/`DIGEST_QUEUE`
  alongside every pre-existing binding, no new binding required for this
  phase's `backfill_window` message kind since it rides the existing
  `INGEST_QUEUE`).
- **Open items for stage B (admin UI)**: (1) production-reviewer +
  security sign-off not yet run for this stage (same PILOT-adjacent gate
  pattern noted at the end of every recent phase); (2) no admin frontend —
  every route above is API-only, consumed via curl/Postman/a future
  `apps/web` admin section; (3) `getDbSizeEstimate`'s PRAGMA approach is
  unverified against real deployed D1 (see above); (4) DLQ contents remain
  unreadable from the Worker runtime — surfaced as a documented note in
  `GET health-details`, not solved (would need the Cloudflare dashboard API
  or `wrangler queues list-dlq` wired in separately, out of this stage's
  scope); (5) `POST matching/recompute`'s `lotIds` path reuses the
  `recompute_continuation` message kind rather than a purpose-named one —
  functionally correct (documented in-file) but a future session could add
  a dedicated `admin_recompute` kind if the naming reuse ever causes
  confusion in logs/metrics; (6) support-notes has no edit/delete route yet
  (create + list only, matching the spec's "GET/POST support-notes" scope);
  (7) no rate limiting on `/api/admin/*` specifically (relies on
  `requireInternalAdmin`'s allowlist + audit trail; the existing
  `rateLimitOrgApi` middleware is customer-route-specific and was not
  wired here — low risk given the allowlist gate, but worth a follow-up
  if abuse becomes a concern).

### Phase 10 stage B — Internal admin UI (2026-08-15)

- **Access model — client-side cloaking mirrors the server, never decides
  anything**: `apps/web/src/components/admin/AdminGate.tsx` probes
  `GET /api/admin/health-details` once on mount for the entire `/admin/*`
  route subtree (`App.tsx`'s new nested `<Route path="/admin" element=
{<AdminGate/>}>`); success renders `<AdminShell><Outlet/></AdminShell>`,
  any failure (404 from `requireInternalAdmin`, or any other error) renders
  the SAME `NotFound` page used as the app's catch-all route (`pages/
NotFound.tsx`, also newly added — there was no 404 page before this
  stage). The admin surface's existence is never revealed client-side; the
  server's own always-404-for-non-admins gate
  (`apps/worker/src/middleware/admin.ts`) remains the sole authority — every
  page's every fetch is still independently authorized server-side.
- **Shell**: `components/admin/AdminShell.tsx` — deliberately plain/dense,
  distinct from the customer `AppShell` (no marketing chrome), skip-link +
  `aria-label="Admin sections"` nav, footer-style note that every request is
  audited.
- **Pages** (`pages/admin/`, all thin tables/detail-panes over
  `lib/admin-api.ts`'s typed `/api/admin/*` wrappers, `lib/admin-types.ts`
  DTOs kept in sync with `routes/admin.ts`/`repositories/admin.ts`):
  `Dashboard` (ingestion last-success/stale flag rendered as a TEXT
  "STALE"/"OK" label plus a `form-warning` class — never color-only — plus
  paused/error-count/digest-cycle/DB-size-honesty/DLQ-note/flag-state
  sections), `Organizations` (search table) + `OrganizationDetail`
  (profile/subscription/digest-prefs/counts bundle, suspend/unsuspend),
  `Users` (email search), `Subscriptions` (status filter), `Ingestion`
  (runs table, errors-by-run table with expandable detail-JSON disclosure,
  notice lookup by `sourceNoticeId` rendering versions/lots/snapshot keys,
  pause/resume, CPV-scope editor, backfill form), `Matching` (match-trace
  form rendering a stored-vs-live component diff table with text mismatch
  markers, recompute form), `Digest` (runs table, preview form, email-
  failures table, pause/resume), `Support` (notes list + add form per org,
  pre-fillable from `?organizationId=` — linked from `OrganizationDetail`),
  `Audit` (actor/action/since filters), `Flags` (table + JSON-value PUT
  editor). Every list uses the shared `components/admin/Pager.tsx`
  "load more" control over the existing `lib/cursor.ts` `CursorState`
  pattern (reused from `Feed.tsx`, not reinvented) — pagination on every
  unbounded list, as required.
- **Confirm pattern UX**: `components/admin/ConfirmAction.tsx` — renders
  the exact confirm literal the API contract requires (e.g.
  `SUSPEND_ORGANIZATION`), disables its button until the typed input
  exactly matches (`lib/admin-confirm.ts`'s pure `confirmationMatches`, no
  trim/case-fold), same "type the string to confirm" shape already
  established by `Settings.tsx`'s pre-existing account-delete control —
  extended into a single reusable component so every admin mutation
  (suspend/unsuspend, ingestion pause/resume/scope/backfill, matching
  recompute, digest pause/resume, flag update) shares it. Documented as UX
  friction only, per the API's own doc comment — the server independently
  requires and validates the same literal.
- **Digest preview rendering — explicitly NOT `dangerouslySetInnerHTML`**:
  `Digest.tsx` renders the admin preview's `subject` as plain JSX text, and
  both `text` and the raw `html` source as `<pre>` TEXT blocks (React's
  default escaping) rather than injecting the HTML as markup — even though
  the preview HTML is the app's own already-escaped renderer output, the
  eslint `no-restricted-syntax` ban on the `dangerouslySetInnerHTML` JSX
  attribute is repo-wide (docs/security.md C2) and was not worked around.
- **Match-trace diff — pure, unit-tested, text-marker mismatches**:
  `lib/admin-trace.ts`'s `diffComponents` keys stored vs. live components
  by `componentKey`/`key`, classifies each row `match` / `points_differ` /
  `status_differ` / `stored_only` / `live_only`, and `mismatchMarker`
  renders a distinct non-color string per kind (`"MISMATCH — ..."` prefix)
  — `Matching.tsx` renders this as a 4th "Result" table column, never
  color-only.
- **Client-side validators mirror server bounds (UX only, never authority)**:
  `lib/admin-date-range.ts` `validateBackfillRange` (≤90 days, mirrors
  `routes/admin.ts`'s `enumerateDays`/`MAX_BACKFILL_DAYS`) and
  `lib/admin-scope.ts` `validateCpvScope` (≤20 CPV families, 2-8 char
  families, 2-letter countries, mirrors `ingestionScopeSchema`) — both
  documented in-file as immediate feedback only; the server independently
  re-validates (`parseIngestionScope` for scope, the same day-enumeration
  for backfill) before persisting/enqueueing anything.
- **`lib/format.ts` gained `formatIsoUtc`** (epoch ms → ISO-8601 UTC
  string, `null` → `'not recorded'` rather than blank) — used by every
  admin table per the "all timestamps rendered ISO UTC" instruction;
  covered by 2 new cases in the existing `format.test.ts`.
- **Tests — pure utils only, no DOM harness** (per this stage's explicit
  instruction and the existing `vitest` root project's `environment:
'node'` config, which cannot render JSX anyway): `admin-confirm.test.ts`
  (5 cases: exact/case-mismatch/prefix/whitespace/empty), `admin-date-
range.test.ts` (5 cases: single-day, exactly-at-max, over-max, inverted
  range, malformed date), `admin-scope.test.ts` (5 cases: valid, empty,
  over-cap, short family, bad country code), `admin-trace.test.ts` (8
  cases: clean match, points/status mismatch, stored-only/live-only,
  stable sort, `hasAnyMismatch`, marker uniqueness) — 23 new test cases
  total, plus the 2 `formatIsoUtc` cases above = **25 new tests**.
- **Real counts (2026-08-15, all executed)**: `pnpm format` (13 files
  reformatted by the formatter itself — new admin files only, no logic
  changes) · `format:check` PASS · `lint` PASS (one fix needed: `//
eslint-disable-next-line react-hooks/exhaustive-deps` comments in
  `Audit.tsx`/`Subscriptions.tsx`/`Support.tsx` referenced a rule from a
  plugin not installed in this repo — removed, since the repo's existing
  `Feed.tsx` pattern already excludes deps from `useEffect` without a
  disable comment, i.e. no lint rule to suppress here) · `typecheck` PASS
  (14/14 workspace projects) · `test` PASS — root vitest **55 files/396
  tests** (+4 files/+25 tests: the 4 new `admin-*.test.ts` files plus the 2
  new `formatIsoUtc` cases in the existing `format.test.ts`); worker pool-
  workers **11 files/119 tests** (unchanged — no worker changes this
  stage); packages/db pool-workers **9 files/47 tests** (unchanged) = **75
  files/562 tests total** · `build` PASS (`vite build` 80 modules, 356.65
  kB JS / 99.57 kB gzip, up from 307 KB/91 KB pre-admin-UI; `wrangler
deploy --dry-run` — top-level clean, all pre-existing bindings present,
  no new binding required for a static-assets-only frontend addition).
- **Open items**: (1) production-reviewer + security sign-off not yet run
  for this stage; (2) no DOM/E2E coverage of the admin pages yet —
  deliberately deferred to Phase 12 E2E per this stage's explicit scope
  (Playwright, not Vitest+jsdom, matching the rest of the app's testing
  split); (3) `OrganizationDetail`'s subscription/digest-preferences/
  company-profile sections render their nested objects via
  `JSON.stringify` in a `<pre>` rather than field-by-field tables — safe
  (React-escaped text, no HTML injection) but less polished than a bespoke
  layout; a future session could break these into proper `<dl>` fact
  blocks if admin usage shows it's worth it; (4) `Flags.tsx`'s value editor
  requires typing raw JSON (e.g. `"true"`, `42`, `"a string"`) rather than
  a type-aware widget — matches the API's `z.unknown()` value contract
  exactly but is unforgiving of a bare `true`/`42` without quotes for
  strings; (5) `Support.tsx`'s organization-id field has no autocomplete/
  link-from-search — an admin currently has to already know or copy an org
  ID (the `OrganizationDetail` → Support deep link covers the common path).

### Phase 9 — Billing (2026-08-15)

- **Stripe facts verified this session, source = installed
  `stripe@22.5.0` SDK type declarations** (docs.stripe.com WebFetch was
  egress-blocked, same restriction as earlier phases' external-docs hosts;
  a WebSearch cross-check independently confirmed the recommended webhook
  event set): `Stripe.API_VERSION`/`LatestApiVersion` =
  `"2026-07-29.dahlia"` (matches the pre-existing docs/dependency-
  versions.md pin exactly); `Stripe.createFetchHttpClient()` +
  `Stripe.createSubtleCryptoProvider()` static methods (Workers/edge-safe,
  no Node `http`/`crypto`); `stripe.webhooks.constructEventAsync(payload,
header, secret, tolerance?, cryptoProvider?, receivedAt?)` and
  `generateTestHeaderStringAsync` confirmed on the `WebhookObject`
  interface; a `workerd`/`worker` package-export condition exists
  (`stripe.esm.worker.js`) but the client is still built with an EXPLICIT
  `httpClient`/`cryptoProvider` everywhere so behavior is identical
  regardless of which build a bundler resolves. **Non-obvious, easy-to-get-
  wrong fact caught only by reading the installed types**: in this API
  version, `Stripe.Subscription` has NO top-level `current_period_end` —
  it moved to each `SubscriptionItem` (`items.data[0].current_period_end`);
  and `Invoice.subscription` moved to
  `invoice.parent.subscription_details.subscription`, whose sibling
  `.metadata` field is documented as "an immutable snapshot of the
  subscription metadata at the time of invoice finalization" — this is
  what makes org-identity resolution work for `invoice.*` events with zero
  extra API calls (see below).
- **Customer/org linking design** (`packages/billing/src/checkout.ts`):
  Checkout sessions are created with `client_reference_id`,
  `metadata.organizationId`, AND `subscription_data.metadata.organizationId`
  all set to the org id — the third copy propagates onto the Stripe
  Subscription object itself at creation, so `customer.subscription.*`
  events carry it directly and `invoice.*` events carry the immutable
  snapshot described above. Every handled event type can therefore resolve
  its organization straight from the (signature-verified) payload with
  ZERO Stripe API calls, regardless of delivery order — org identity is a
  label we wrote ourselves and Stripe echoes back unchanged, which is a
  different trust category from mutable payment STATE (see below).
  Reactivation after cancellation reuses the existing `stripe_customer_id`
  as Checkout's `customer` param (the `subscriptions.organization_id`
  unique index is strict 1:1, so a brand-new customer would collide) —
  this widens the literal "block only trialing/active" guard text into
  blocking every non-canceled status, documented in-file as a deliberate,
  correctness-driven deviation from the literal spec wording.
- **State authority / out-of-order safety** (`webhook.ts`): identity comes
  from the payload (above); STATE (status, plan, period end,
  cancel_at_period_end) NEVER does — every handled event triggers a live
  `subscriptions.retrieve` re-fetch and only the re-fetch result is
  written, so whichever event a batch happens to process last, the stored
  state is always Stripe's current truth, never a stale payload's claim
  (proven by the "out-of-order" D1 test: a `canceled`-claiming payload
  processed AFTER an `active` one still leaves the DB `active`, because the
  re-fetch — not the payload — said so both times).
- **Idempotency + retry, corrected mid-session**: the original design
  (pure `insertBillingEventIfNew` unique-insert dedup) would have
  permanently wedged a `failed` row, because Stripe redelivers the SAME
  `event.id` on a non-2xx response — a naive "insert failed → duplicate"
  check would ack that redelivery without ever retrying. Fixed by adding
  `getBillingEventByStripeId` (`packages/db/src/repositories/billing.ts`):
  on an insert conflict, only `processed`/`ignored` rows are treated as a
  true duplicate; `failed` (or a crash-stuck `received`) rows fall through
  and are reprocessed — proven by the `failure-then-retry` test (first
  call throws + row `failed`; second call with a now-working fake client
  succeeds, single row, `processed`).
- **Founding cap/flag**: `FLAG_FOUNDING_CAP` (`founding_cap`, default 20 —
  `packages/billing` `DEFAULT_FOUNDING_CAP`) added to
  `@bidmorrow/config`'s `FEATURE_FLAG_KEYS` (the DB schema's doc comment
  already anticipated this key; the constant was simply missing).
  `countNonCanceledSubscriptionsByPlan` (`packages/db/billing.ts`, new
  documented cross-tenant exemption, same "enumerate all tenants"
  rationale as `listOrgsEligibleForScoring`) counts every non-canceled
  founding subscription; `createCheckoutSession` blocks founding checkout
  when the flag is closed OR the count ≥ cap, both checked BEFORE any
  Stripe API call.
- **Entitlement service** (`entitlement.ts`): `active = status IN
(trialing, active)` OR `status = past_due` within a 7-day grace window
  (`PAST_DUE_GRACE_DAYS`, product/ops trade-off, not Stripe-documented —
  flagged as revisit-with-real-dunning-data) measured from
  `current_period_end_at`; a `past_due` row with no stored period end
  fails closed (no grace basis). Pure grace/status math (`reasonFor`) is
  split out and unit-tested directly, no DB.
- **`FLAG_ENTITLEMENT_ENFORCED`** (`entitlement_enforced`, default `false`
  — V1-pilot mode preserved): gates `GET /api/org/feed` (402
  `subscription_required` when enforced + inactive) and digest generation
  (`apps/worker/src/digest.ts`'s `runDigestJob`, gated BEFORE
  `generateDigest` is ever called — `@bidmorrow/notifications` does not
  and should not depend on `@bidmorrow/billing`; apps/worker, the sole
  composition root, wires both). Both branches D1-tested with the flag on
  and off.
- **Routes** (`apps/worker/src/routes/billing.ts`,
  `routes/webhooks.ts`, composition in `src/billing.ts`): `POST
/api/billing/checkout` (OWNER, 409 on existing-subscription/founding-
  unavailable, audit `billing.checkout_started` + product
  `checkout_started` on success), `POST /api/billing/portal` (OWNER, 404
  `no_billing_customer` before any Stripe call, audit
  `billing.portal_opened`), `GET /api/billing/status` (any member —
  entitlement + subscription summary + `foundingAvailable` so the UI knows
  whether to show the founding button without inferring it client-side).
  `POST /api/webhooks/stripe`: no session middleware (the one
  deliberately-unauthenticated-by-cookie route), raw body read via
  `c.req.text()` once before any JSON parsing (never conflicts with the
  global `/api/*` `bodyLimit` — it only caps size while streaming through),
  `constructEventAsync` signature verification, 400 with NO detail on
  failure, 200 on success/duplicate/ignored, 500 on a genuine post-record
  failure (Stripe retries — safe, re-fetch-based reprocessing).
  `subscription_started`/`subscription_canceled` product events fire from
  `syncSubscriptionState`'s before/after status comparison (webhook.ts),
  not from a route — it is the one place the transition is actually known.
- **Frontend** (`apps/web/src/pages/app/Settings.tsx`): a Billing section
  — status line (plan/status/cancel-at-period-end/inactive-reason),
  Subscribe buttons (Standard always, Founding only when
  `foundingAvailable`), Manage billing (redirects to the Portal URL); no
  client-side role gating (matches every other Settings section — the
  server 403s, `describeBillingError` renders it). Founding-price-for-life
  line repeated here (already in Terms per the Phase 7 review fix).
- **No real Stripe credentials anywhere** (HUMAN_DECISION_BLOCKERS.md item
  4, still OPEN): every test-mode value is an obvious sentinel
  (`sk_test_fake_for_worker_tests_only`, `whsec_fake_for_worker_tests_only`,
  `price_fake_*`) — grep-checked, no `sk_live`/realistic-looking key
  anywhere in the new code. `.env.example`/`apps/worker/.dev.vars.example`
  carry the four Stripe names only.
- **Tests, deliberately two-tiered given the no-real-keys constraint**:
  `packages/billing` (Node, no D1, no network) — 5 files/43 tests:
  `plans.test.ts` (status mapping incl. the `incomplete`/`paused` fail-safe
  branches, price↔plan round-trip), `checkout.test.ts` (pure guard
  predicates: `blocksNewCheckout`, `isFoundingPlanOpenFlag`,
  `resolveFoundingCap` incl. malformed/negative fallback), `entitlement.
test.ts` (`reasonFor` grace-window math incl. the inclusive boundary and
  the no-period-end fail-closed case), `webhook.test.ts` (pure payload-only
  org/subscription-id resolution for all six handled event types incl. the
  invoice-metadata-snapshot path, `isHandledEvent`), `index.test.ts`
  (unchanged skeleton). `apps/worker` — 1 new D1 file
  (`billing.d1.test.ts`, real workerd+D1, Stripe test-mode sentinel
  bindings added to `vitest.config.ts`) — 24 tests, two tiers per its own
  file-header split: HTTP-level (everything reachable without a real
  Stripe network call — 409/404 guards, role/auth gates, webhook signature
  verification incl. `generateTestHeaderStringAsync`, idempotent replay,
  entitlement-flag feed gating, cross-org status isolation, founding
  flag/cap toggling) and direct `processStripeEvent` calls with a
  hand-written fake `WebhookStripeClient` (real D1, zero network) —
  idempotent duplicate (single `retrieve` call), out-of-order
  (state-from-re-fetch proof), unknown-type ack, failure-then-retry,
  cross-org `TenantMismatchError` tenant guard. `packages/db` — 0 new
  files (new repo functions exercised via the worker's D1 suite, same
  pattern as prior phases); `tests/security/tenant-isolation-contract.
test.ts` gained 2 documented exemptions
  (`countNonCanceledSubscriptionsByPlan`, `getBillingEventByStripeId`,
  alongside the pre-existing `markBillingEventStatus`/
  `insertBillingEventIfNew`).
- **Real counts (2026-08-15, all executed)**: `pnpm format` (5 files
  reformatted this batch — prettier only, no logic changes) ·
  `format:check` PASS · `lint` PASS · `typecheck` PASS (14/14 workspace
  projects incl. the now-dependency-added `packages/billing`) · `test`
  PASS — root vitest **51 files/370 tests** (+7 files/+43 tests over the
  prior Phase 8 entry, the five new `packages/billing` files plus the
  `tenant-isolation-contract`/`env.test.ts` additions already counted in
  the file totals); worker pool-workers **10 files/102 tests** (+1
  file/+24 tests, the new `billing.d1.test.ts`); packages/db pool-workers
  **9 files/46 tests** (unchanged) = **70 files/518 tests total** · `build`
  PASS (`vite build` 59 modules, 307 KB JS/91 KB gzip incl. the new Billing
  section; `wrangler deploy --dry-run` — top-level AND `--env staging` AND
  `--env production` all clean, no Stripe secret ever appears as a
  committed `vars` binding, matching the `RESEND_API_KEY` precedent).
- **Open items for the next session**: (1) production-reviewer + security
  sign-off not yet run for Phase 9 (this session's own gate list stops at
  the automated checks — same PILOT-adjacent gate pattern as Phase 8); (2)
  HUMAN_DECISION_BLOCKERS.md item 4 (Stripe account/prices/webhook
  endpoint/Customer Portal enablement) is still fully OPEN — nothing in
  this phase required or invented real credentials, but real end-to-end
  verification against live Stripe test mode (a real `checkout.sessions.
create` round trip, a real webhook delivery from Stripe's dashboard) has
  NOT happened and cannot happen until that blocker is resolved; (3) the
  HTTP-level `/api/billing/checkout` and `/api/billing/portal` SUCCESS
  paths (the calls that would actually reach Stripe's network) are
  deliberately untested at the D1/HTTP layer — only their guard paths
  (which run before any network call) are — flagged as an accepted,
  documented scope boundary given the no-real-keys constraint, not a gap
  to silently carry forward; (4) `ENTITLEMENT_ENFORCED` defaults `false`
  and nothing in this phase flips it — V1-pilot manual provisioning
  continues exactly as before; turning it on is a future-phase/operational
  decision; (5) no admin UI to view/edit `founding_cap`/`founding_plan_open`/
  `entitlement_enforced` flags yet (Phase 10 admin-surface scope, flags are
  DB-editable via `setFeatureFlag` today, same as every other flag).

### Phase 8 — Daily digest (2026-08-15)

- **Provider choice**: plain `fetch` against `api.resend.com/emails`
  (`packages/notifications/src/resend.ts`), not the `resend` npm package —
  justified in-file: docs/dependency-versions.md already records Resend 6.x
  as fetch-based/Workers-compatible, so for a single-recipient send the SDK
  adds a dependency with zero functional gain over one `POST` call; revisit
  if a later phase needs batch sending or webhook signature verification.
  `RetryableEmailError` (5xx/429/network) vs `PermanentEmailError` (other
  4xx) typed errors; sequential sends on one provider instance are spaced
  ≥600ms apart (Resend's documented 2 req/s default) via an internal
  `lastSendAt` timer — correct because a fresh instance is created per queue
  invocation and every digest send is `await`ed inside a queue consumer
  (never fire-and-forget — SEC-P4-08's Phase 8 note, now resolved: contrast
  with `packages/auth`'s intentionally-unawaited transactional-email hooks,
  which stay fire-and-forget and are unaffected by this phase). API key
  never logged; error messages carry HTTP status only, never the response
  body or recipient.
- **TZ / send-hour model**: the Worker cron fires **hourly**
  (`'15 * * * *'`, `apps/worker/wrangler.jsonc` + `src/index.ts`
  `CRON_DIGEST_SCHEDULE`) rather than once daily, because org-local send
  times roll over at different UTC hours. `selectDigestOrgs`
  (`packages/notifications/src/digest-orchestration.ts`) computes each
  org's local date/hour via `Intl.DateTimeFormat({timeZone})` (verified
  working in the workerd pool-workers test runtime —
  `digest-tz.test.ts`) and considers an org due once its local hour ≥
  `DEFAULT_SEND_HOUR_LOCAL` (06:00) AND no `digest_runs` row exists yet for
  that local date — re-evaluated every hour, so a missed/failed cron
  invocation self-heals on the next hourly check instead of silently
  skipping a day (the DB-enforced `(organization_id, digest_date)`
  uniqueness is what makes re-checking safe).
- **Resume path** (`generateDigest`, same file): `createDigestRun` DB-claims
  the run first. A queue retry after a `RetryableEmailError` throw hits
  `DuplicateDigestError` on the next attempt; the function then reads the
  existing row — a terminal status (`sent`/`skipped_empty`/`skipped_paused`)
  is a true duplicate (no-op, no second email); `pending`/`failed` means
  THIS invocation's own prior attempt was interrupted, and it resumes by
  loading the ALREADY-WRITTEN `digest_items` rows (never re-collecting
  candidates) and re-rendering/re-sending from them — proven by the KEY
  test (`apps/worker/src/digest.d1.test.ts`: retryable failure → run
  `failed` → same-day retry → `sent`, `digest_items` row count unchanged
  across both attempts). **Corrected in the P8-R-01 review fix (see "Phase 8
  review fixes" below)**: the ORIGINAL wording here claimed the NORMAL
  (non-resumed) send also lost reasons/risk/buyer/deadline detail — that was
  never actually true of the normal path and was a review-flagged masking
  gap; only the RESUMED path is degraded (`digest_items` has no columns for
  those fields, so a resume genuinely cannot reconstruct them), and it now
  says so explicitly in the rendered email via a
  `(details unavailable — resent digest)` note rather than silently
  omitting the fields.
- **Candidate collection is bounded, not just the rendered top-10**:
  `listDigestCandidateMatches` (`packages/db/src/repositories/matching.ts`)
  collects up to `MAX_DIGEST_ITEMS = 200` matches (org + engine version,
  classification ≥ `minClassification`, scored within the digest window,
  not ignored, deadline not expired) and ALL of them become `digest_items`
  rows (so classification counts and `matchesCount` reflect the true set,
  bounded at 200 — same bounded-background-job pattern as
  `MAX_PAIRS_PER_INVOCATION` elsewhere); `renderDigest`
  (`digest-renderer.ts`) then slices to the top 10 by score for the actual
  email body (`DIGEST_MAX_ITEMS`).
- **Rendering** (`digest-renderer.ts`, pure, no DB/network): subject +
  semantic HTML + plain-text alternative; every source-derived string
  (title, buyer name, component reasons) goes through a new `escapeHtml`
  util (`escape-html.ts`) before touching the template — proven by an XSS
  fixture test (`<script>`/`<img onerror>` in title/buyer/reasons never
  appears unescaped). Counts by classification, top 10 items sorted score
  DESC (title, score+classification, top 2 reasons, top risk flag with the
  existing POSSIBLE "verify in source documents" wording, buyer, deadline,
  CTA `{appBaseUrl}/app/tenders/{matchId}` link), footer with TED
  attribution + decision-support disclaimer + manage-preferences link +
  opt-out note. Honest empty state when `sendEmpty` fires with zero
  candidates.
- **Repo layer additions** (all through `packages/db/src/repositories/`,
  every tenant function still `(db, organizationId, ...)`-first per
  docs/security.md C6): `matching.ts` `listDigestCandidateMatches`;
  `engagement.ts` `getDigestRunByDate`, `insertDigestItems`/
  `listDigestItems` (SEC-P3-03 pattern — both re-verify the parent
  `digest_runs` row belongs to the org before touching `digest_items`),
  `createEmailDelivery`/`updateEmailDeliveryStatus`; `identity.ts`
  `getOrganization`, `listOrganizationMemberEmails` (digest recipients =
  every org member, V1 has no invite/role-based-notification UI);
  `company.ts` `listOrgsWithDigestEnabled` (new documented
  tenant-isolation-contract exemption in
  `tests/security/tenant-isolation-contract.test.ts`, same "enumerate every
  tenant" rationale as the existing `listOrgsEligibleForScoring`
  exemption — the digest scheduler must scan all orgs, never reachable
  from a per-request handler).
- **`digest_paused` global flag** (already existed as
  `FLAG_DIGEST_PAUSED` in `@bidmorrow/config` from Phase 3): checked in
  `generateDigest` BEFORE any DB write — a paused digest leaves NO
  `digest_runs` row at all (not even `skipped_paused`), proven by a test
  asserting `getDigestRunByDate` returns null. Per-org `enabled=false`
  short-circuits the same way (`skipped_paused` status reused for both —
  no separate "disabled" status exists in the schema's CHECK enum).
- **Worker wiring**: `DIGEST_QUEUE` + `bidmorrow-digest-dlq-*` producer/
  consumer in `wrangler.jsonc` (top-level + staging + production, verified
  via three separate `wrangler deploy --dry-run` runs each showing
  `env.DIGEST_QUEUE` alongside the existing bindings); `env.ts`
  `DigestQueueMessage` (`{kind:'digest', organizationId, localDate}`),
  `RESEND_API_KEY?`/`EMAIL_FROM?` (already present in `@bidmorrow/config`'s
  `DEPLOYED_REQUIRED_NAMES` since Phase 4/8 scaffolding — now actually
  consumed); `apps/worker/src/digest.ts` (new composition module, mirrors
  `ingestion.ts`'s pattern) — `runDigestScheduleJob` (hourly cron entry
  point, enqueues only, batched ≤100/message via `sendBatch`, never
  generates inline) and `runDigestJob` (queue consumer entry point);
  `resolveDigestProvider` picks the real Resend provider when both
  `RESEND_API_KEY`/`EMAIL_FROM` are set, else
  `createLoggingDigestEmailProvider` (type-safe, logged fallback — never a
  silent misconfiguration). `index.ts`'s `queue()` dispatches
  `{kind:'digest'}` through the existing catch→retry→DLQ path (retryable
  throws propagate exactly like every other handler failure).
  `.dev.vars.example` gained `RESEND_API_KEY`/`EMAIL_FROM` (both blank,
  names-only).
- **Tests** (all real, all executed): `packages/notifications` — 20 unit
  tests across 4 files (`digest-renderer.test.ts` incl. the XSS fixture and
  empty-digest/counts/POSSIBLE-wording cases, `resend.test.ts` incl.
  retryable-vs-permanent classification, the 600ms spacing check with fake
  timers, and an assertion the API key never appears in a thrown message,
  `digest-tz.test.ts` incl. the Europe/Nicosia-vs-America/New_York
  same-UTC-instant-different-local-date case, `index.test.ts` unchanged).
  `apps/worker` — 2 new D1 integration files, real workerd+D1:
  `digest.d1.test.ts` (9 tests) — full happy path (run+items+delivery+sent,
  content assertions on the rendered HTML), DB-enforced dedupe (second full
  invocation same org+date → no second email), empty+`!sendEmpty` →
  `skipped_empty`/no send, empty+`sendEmpty` → sends, `minClassification`
  filter excludes a below-threshold match, ignored matches excluded, the
  KEY retryable-failure-then-resume test (no duplicate `digest_items`),
  permanent failure → `failed` without throwing (no queue retry), global
  pause → no `digest_runs` row at all; `digest-schedule.d1.test.ts` (5
  tests) — `runDigestScheduleJob` enqueues one message per due org via a
  fake `DIGEST_QUEUE` binding (mirrors `ingestion.continuation.test.ts`'s
  fake-queue pattern) and skips disabled orgs, `resolveDigestProvider`'s
  three branches.
- **Real counts (2026-08-15, all executed)**: `pnpm format` (10 files
  reformatted by the formatter itself — no manual/logic changes, all
  Phase-8-session files) · `format:check` PASS · `lint` PASS ·
  `typecheck` PASS (14/14 workspace `typecheck`-scripted projects) ·
  `test` PASS — root vitest **47 files/328 tests** (+3 files/+28 tests over
  the last recorded root figure, the four new `packages/notifications`
  test files); worker pool-workers **9 files/77 tests** (+2 files/+14
  tests, the two new digest D1 suites); packages/db pool-workers **9
  files/46 tests** (unchanged — no new packages/db-scoped test file this
  phase; new repo functions are exercised via the worker's D1 suites) =
  **65 files/451 tests total** · `build` PASS (`vite build` 59 modules,
  305 KB JS/90 KB gzip; `wrangler deploy --dry-run` — top-level AND
  `--env staging` AND `--env production` all list `env.DIGEST_QUEUE`
  alongside every pre-existing binding).
- **Open items for the next session**: (1) production-reviewer + security
  sign-off not yet run for Phase 8 (this session's own gate list stops at
  the automated checks — human/agent review is the PILOT CHECKPOINT
  gate); (2) the founding-price digest-copy mention flagged as a Phase 7
  follow-up (P7 review batch) was NOT added to the digest templates this
  session — `digest-renderer.ts`'s footer covers TED attribution/
  decision-support/manage-preferences/opt-out only, not pricing — flagged,
  not fixed, revisit if the reviewer calls it required before pilot; (3)
  digest recipients = every org member with no per-member opt-out/role
  filter (V1 has no invite/notification-preference UI at the member level,
  matches the existing single-org-membership model); (4) admin-surfaced
  digest staleness/debugging (docs/product-scope.md item 9) is explicitly
  Phase 10 scope, not touched here — `digest_runs`/`email_deliveries` rows
  are already queryable for it.

### Phase 8 review fixes (2026-08-15)

Targeted fixes from the production review of Phase 8 — no refactors, each
read-before-edit.

- P8-R-01 (fixed, HIGH — the masking gap): `digest_items`
  (`packages/db/src/schema/engagement.ts`) only ever persisted
  `title_snapshot`/`score_snapshot`/`classification_snapshot`, no
  reasons/risk/buyer/deadline columns — no migration was possible within
  this fix's scope, so the fix is entirely in
  `packages/notifications/src/digest-orchestration.ts`: the NORMAL
  (non-resumed) send path now renders straight from the just-collected
  `DigestCandidateMatch[]` returned by `listDigestCandidateMatches`
  (`toRenderItemsFromCandidates` — same in-memory data used to build the
  `digest_items` insert, no extra DB round-trip), which already carries
  `buyerName`/`deadlineAt`/`topReasons`/`topRiskFlag`. This is the route
  the reviewer's item description called out as available given the
  schema; it required no migration. The RESUME path
  (`toRenderItemsFromSnapshot`) genuinely cannot reconstruct those fields
  (the columns don't exist) and stays degraded, but is now HONEST about
  it: each resumed item's rendered reasons include an explicit
  `(details unavailable — resent digest)` note instead of silently
  rendering thinner. `digest-renderer.ts`'s `DigestRenderItem.matchId` is
  now `string | null` (feeds P8-R-03 below). Strengthened the happy-path D1
  test (`apps/worker/src/digest.d1.test.ts`) to assert the sent email
  HTML/text contains the seeded buyer name (`Buyer: City Council`), a
  `Deadline: YYYY-MM-DD` line, and a component-explanation reason
  (`CPV match`) — the exact masking gap the review found; also asserts the
  resumed-send test's email contains the degraded-note text. The Phase 8
  "Resume path" bullet above is corrected in place rather than rewritten
  wholesale, so the history of what was originally claimed stays visible.
- P8-R-02 (fixed, MEDIUM): `generateDigest` now loops over EVERY org member
  email from `listOrganizationMemberEmails` (previously only
  `recipients[0]`), sequentially `await`ed on the same provider instance so
  the existing ≥600ms Resend spacing (`resend.ts`) still applies across
  every recipient. Chosen representation: **one `email_deliveries` row per
  recipient**, not one row with a recipient count — `email_deliveries.to_email`
  is a single TEXT column and the table's `(provider, provider_message_id)`
  unique index assumes one row = one provider send = one recipient; a
  count-only representation would be unable to record each recipient's own
  provider message id or per-recipient send failure, and would collide with
  that uniqueness the moment two rows shared a message id. A retryable
  failure on any recipient aborts the remaining sends and rethrows (queue
  retry resends to every recipient again — the accepted at-least-once
  window, SEC-P8-02, now explicitly multiplied by recipient count and
  documented as such); a permanent failure on one recipient does not abort
  the rest. `digest_runs.email_delivery_id` (a single nullable FK, unchanged
  schema) stores the first successful delivery's id, or the first attempted
  delivery's id if none succeeded — a representative pointer, not a list.
  `queue.digest.completed`/`digest.sent` logs now carry true
  `recipient_count`/`sent_count`/`permanent_failure_count`. New D1 test:
  N members (owner + 2 added via `addOrganizationMember`) → 3
  `provider.sent` calls and 3 `email_deliveries` rows, all `status='sent'`.
- SEC-P8-01 (fixed, LOW): `apps/worker/src/index.ts`'s `queue()` now
  constructs ONE `DigestEmailProvider` per invocation (via the exported
  `resolveDigestProvider` from `digest.ts`) and threads it into every
  `runDigestJob` call in the batch, instead of `runDigestJob` resolving a
  fresh provider (and thus a fresh `lastSendAt=0` spacing timer) per
  message. `runDigestJob` gained an optional `provider` parameter
  (defaults to its own `resolveDigestProvider` call when omitted, so
  standalone/test call sites are unaffected) — the Resend 2 req/s spacing
  now genuinely spans every digest send across the whole batch, not just
  within one org's own recipient loop.
- P8-R-03 (fixed, LOW): `digest-renderer.ts` only wraps the item title in a
  `<a href=...>` CTA link when `item.matchId !== null`; a `null` matchId
  (purged match, or a resumed/degraded render) now renders a plain escaped
  title with no link, in both the HTML and plain-text bodies. New unit test
  in `digest-renderer.test.ts` asserts no `/app/tenders/` URL appears when
  `matchId` is `null`.
- SEC-P8-04 (fixed, INFO): the poison-message error in `index.ts`'s
  `queue()` said `unrecognized MATCH_QUEUE/INGEST_QUEUE message kind` even
  though the same handler has served `DIGEST_QUEUE` since Phase 8 — now
  `unrecognized queue message kind`, queue-name-agnostic, matching the
  doc comment above it that already correctly described all three queues.
- SEC-P8-02 (accepted, not fixed): the at-least-once queue-retry window
  where a send can succeed but the status-write/ack fails, causing a resume
  to re-send — already an accepted trade-off before this batch; unchanged
  in kind by P8-R-02, just now applies per-recipient instead of to a single
  recipient (documented above).
- SEC-P8-03 (superseded by the P8-R-02 fix): the original finding was
  scoped to the single-recipient send; P8-R-02's redesign (loop + one
  delivery row per recipient) replaces that code path entirely, so there is
  no longer a distinct single-recipient finding to track separately.
- Real counts (2026-08-15, all executed): `pnpm format` (1 file
  reformatted: `apps/worker/src/digest.d1.test.ts` — prettier import/prose
  wrap from this batch's additions, no logic changes) · `format:check` PASS
  · `lint` PASS · `typecheck` PASS (14/14 workspace projects) · `test` PASS
  — root vitest **47 files/329 tests** (+1 test over the prior Phase 8
  entry's 328, the new `digest-renderer.test.ts` null-matchId case); worker
  pool-workers **9 files/78 tests** (+1 test over the prior 77, the new
  P8-R-02 multi-recipient D1 test — the happy-path and KEY-retry D1 tests
  gained assertions in place rather than new `it()` blocks) = **65
  files/453 tests total** (root 329 + worker 78 + packages/db 46, db suite
  unchanged this batch) · `build` PASS (`vite build` 59 modules, 305 KB
  JS/90 KB gzip; `wrangler deploy --dry-run` lists `env.DIGEST_QUEUE`
  alongside every other binding).

### Phase 7 review fixes (2026-08-15)

Targeted fixes from the security + production reviews of Phase 7 stages A/B —
no refactors, each read-before-edit.

- SEC-P7-01 (fixed): `apps/web/public/_headers` — Cloudflare Workers Static
  Assets shares Pages' `_headers` mechanism (a file at the root of the
  static-assets output dir, parsed at deploy time, applied independently of
  the Worker's own `secureHeaders()` middleware which only ever runs for
  `run_worker_first: ['/api/*']`). Applies to `/*`: an SPA-compatible mirror
  of the Worker's CSP (`default-src 'self'; script-src 'self'; style-src
'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none';
base-uri 'self'; form-action 'self'`), HSTS, X-Content-Type-Options,
  Referrer-Policy, a minimal Permissions-Policy, X-Frame-Options DENY.
  Verified against a real `pnpm --filter @bidmorrow/web build` output
  (`dist/index.html`): no inline `<script>`/`<style>`, so no CSP relaxation
  needed. **Verification caveat, honestly flagged**: the live-docs fetch this
  fix's syntax/limits claim should have gone through (`verify-current-docs`
  skill / a Cloudflare-docs MCP tool) was not available/reachable this
  session — `developers.cloudflare.com` is proxy-blocked from this dev
  environment (same restriction as ted.europa.eu/ecb.europa.eu in earlier
  phases), and no Cloudflare-docs MCP tool was present in this session's
  toolset despite the review item's instruction to use one. The `_headers`
  content and its in-file comment are based on this project's existing
  recorded platform understanding (docs/dependency-versions.md) and
  long-published Cloudflare behavior, NOT a fresh live-docs confirmation —
  a live re-check is a TODO before this ships to production. New test:
  `tests/security/static-asset-headers.test.ts` (4 tests) — asserts every
  required directive is present in the source file AND that `dist/_headers`
  is byte-identical to it once a build has run (confirmed manually this
  session: `dist/_headers` exists, `wrangler deploy --dry-run` lists it
  among "5 files from the assets directory").
- SEC-P7-02 (fixed): `eslint.config.js` — `no-restricted-syntax` bans the
  JSX attribute `dangerouslySetInnerHTML` outright (message points at
  docs/security.md C2), verified to actually fire against a throwaway test
  file, then confirmed `pnpm lint` stays green with zero real usages in the
  codebase.
- SEC-P7-03 (fixed) + P7-R-03: `apps/worker/src/routes/feed.ts` now catches
  `listFeedRows`'s malformed-cursor `Error` and returns 400
  `{error:'invalid_cursor'}` instead of an unhandled 500 (test in
  `product.test.ts`). `packages/db/src/repositories/matching.ts` — the
  `buyerName`/`cpvPrefix` feed filters were building raw `LIKE '%...%'`
  patterns directly from customer input with no escaping, letting a literal
  `%`/`_` in a search term act as an unintended SQL wildcard; both now go
  through a new `escapeLikePattern` helper (`\`→`\\`, `%`→`\%`, `_`→`\_`)
  paired with an explicit `ESCAPE '\'` clause. Two new D1 tests in
  `matching.d1.test.ts` prove a literal `%`/`_` in a filter matches only the
  buyer/CPV code that actually contains that literal substring, not a decoy
  row that would incidentally match if the character were treated as a
  wildcard.
- SEC-P7-05 (fixed): `apps/web/src/pages/app/TenderDetail.tsx` — the TED
  `sourceUrl` anchor now only renders as a clickable `<a>` when the URL
  starts with `https://`; any other scheme renders as inert plain text
  instead (one-line guard + comment), closing off a `javascript:`/`data:`
  scheme vector from untrusted TED-sourced data.
- P7-R-01 (fixed, HIGH): added a Capabilities (free-text tag list) and
  Certifications (`ISO_27001`/`ISO_9001`/`SOC2`/`OTHER` code select + a label
  field that only appears for `OTHER`) editor to BOTH the onboarding wizard
  (new step 6, "Capabilities & certifications", inserted after Keywords —
  `STEPS` and every subsequent `step === N` branch renumbered) and Settings,
  wired to the existing `GET`/`PUT /api/org/capabilities` +
  `/api/org/certifications` routes. `applyPreset` now also applies
  `preset.capabilities`. `apps/web/src/lib/onboarding-types.ts` gained a
  local `CertificationCode` union + `CertificationDto`/`CERTIFICATION_CODES`
  (kept local rather than importing `@bidmorrow/db`'s type, since `apps/web`
  intentionally depends only on `@bidmorrow/domain`). HowItWorks copy left
  as-is (already accurate).
- P7-R-02 (fixed): every previously-silent `void x().then(...)`/no-catch
  save chain now surfaces its failure via the existing `aria-live`/`role=
"alert"` error pattern — onboarding wizard step saves (`saveBasics`/
  `saveCpv`/`saveGeographies`/`saveKeywords`/
  `saveCapabilitiesAndCertifications`/`saveExclusions`/
  `saveMatchingPreferences`/`saveDigestPreferences` all now return a
  `Promise<boolean>`, catch internally, and only advance to the next step on
  success), Settings' per-section saves (new `saveError` state + `role=
"alert"` region), Feed's `loadMore` (was uncaught — now catches and sets the
  existing `error` state), and `AppShell`'s `signOut` (now checks
  `response.ok` and catches network failures into a new `role="alert"`
  region rather than silently no-op-ing on failure). A `cap_exceeded` 422
  (the CPV-preferences/keywords caps) surfaces its `cap` value in the
  message via a shared `describeSaveError` helper in both files. `grep -rn
"void .*\.then("` over `apps/web/src` now shows only the `.then((ok) => {
if (ok) next(); })`-guarded wizard calls — no bare, uncaught chains remain.
- P7-R-04 (fixed): `packages/procurement/src/scoring-input.ts` — the lot
  `contractNature` pass-through in `mapLotToEngineInput` was a blind `as
ContractNature | null` cast off the raw DB column; replaced with a new
  `parseLotContractNature` validator (same pattern as
  `parseExclusionContractNature`/`parseCertificationCode`) that maps an
  invalid stored value to `null` (logged) instead of fabricating a nature.
  `mapLotToEngineInput` gained an optional `Logger` parameter, threaded
  through from both call sites (`score.ts`'s `deps.logger`,
  `routes/tenders.ts`'s `c.get('logger')`). New unit tests for both the
  valid-passthrough and invalid-drops-to-null branches, plus direct
  `parseLotContractNature` unit tests.
- PROD-P7-01 (fixed): docs/product-scope.md's Pricing section gained a line
  stating the founding price is retained for the life of the subscription
  (plans never auto-migrate); `apps/web/src/pages/marketing/Terms.tsx`'s
  billing paragraph mirrors it verbatim in substance.
- P7-R-06 (cheap part, fixed): `apps/web/src/pages/app/Feed.tsx` — added
  `deadlineAfter` and `publishedAfter` date filter inputs to the filter bar
  (the feed API already accepted both; only the UI was missing them).
- Accepted, not fixed this batch: **P7-R-05** (no prerender/SSR for
  marketing pages — SEO/OG tags are still client-rendered-only; accepted for
  V1 per the existing Phase 7 stage-B scope, no ADR change) and the
  **pricing/digest-mention dependency** (the digest email itself, which
  would be the natural place to reiterate "your price is locked," ships
  Phase 8 — before launch, so the founding-price commitment is documented
  now in product-scope.md/Terms.tsx and will get its digest-copy mention
  when Phase 8 writes the digest templates, not before).
- Real counts (2026-08-15, all executed): `pnpm format` (2 files
  reformatted: `Terms.tsx`, `matching.d1.test.ts` — import merge/prose
  wrap, no logic changes) · `format:check` PASS · `lint` PASS (new
  `no-restricted-syntax` rule verified live-firing against a throwaway
  `dangerouslySetInnerHTML` test file, then removed) · `typecheck` PASS
  (14/14 workspace projects) · `test` PASS — root vitest **44 files/310
  tests** (one new file this batch, `tests/security/static-asset-headers.
test.ts`, 4 tests; `scoring-input.test.ts` gained 5 tests —
  `parseLotContractNature` unit tests + two `mapLotToEngineInput` branch
  tests; the file/test-count delta vs. the stage-B entry's "41 files/301
  tests" is larger than this batch's own additions account for, so that
  prior figure was evidently already stale going into this session —
  reported here as the actual measured `pnpm test` output, not reconciled
  against the older claim); worker pool-workers **7 files/63 tests** (one
  new test this batch, the feed invalid-cursor 400); packages/db
  pool-workers **9 files/46 tests** (two new tests this batch, the
  buyerName/cpvPrefix LIKE-escaping D1 tests) = **60 files/419 tests
  total** · `build` PASS (`vite build` 59 modules, 305 KB JS/90 KB gzip;
  `wrangler deploy --dry-run` reads "5 files from the assets directory" and
  lists all bindings incl. `MATCH_QUEUE`) — **confirmed `apps/web/dist/
_headers` exists post-build and is byte-identical to `apps/web/public/
_headers`** (manual `diff`, and covered going forward by
  `static-asset-headers.test.ts`'s third assertion).

### Phase 7 stage B — Frontend (2026-08-15)

- `apps/web` React Router v7 SPA: marketing (`/`, `/pricing`, `/how-it-works`,
  `/methodology`, `/pilot`, `/privacy`, `/terms`, `/contact` — privacy/terms
  are honest "final legal text pending" summaries, not real legal text) and
  app routes (`/signup`, `/login`, `/verify-email`, `/forgot-password`,
  `/reset-password`, `/onboarding`, `/app`, `/app/tenders/:matchId`,
  `/app/settings`) calling Better Auth REST endpoints directly (verified
  paths from installed `better-auth` dist: `sign-up/email`, `sign-in/email`,
  `sign-out`, `get-session`, `request-password-reset`, `reset-password`,
  `send-verification-email`) and `/api/org/*`, `/api/account`.
- Methodology page carries all required disclosures: score-component table,
  UNKNOWN neutral-policy statement, 5 hard-exclusion rules, risk-flag
  confidence wording, the CPV pre-filter trade-off disclosure (resolves
  `[disclosed: methodology page, Phase 7]` from docs/matching-engine.md), and
  the scoped-coverage statement (72\*/48\*/79417000, "not exhaustive"). New
  copy constants in `apps/web/src/copy.ts`, unit-tested in `app.test.ts`.
- Onboarding wizard: org creation → 8 skippable steps (basics, CPV picker
  w/ preset pre-fill capped at 30, geographies, keywords, exclusions,
  value/deadline, digest) → `POST onboarding/complete`; renders a prominent
  (non-color-only) `scopeOverlapWarning` banner linking to `/methodology`.
- Feed: 6 tabs, filter bar, cursor "load more" (`lib/cursor.ts`, unit
  tested), optimistic save/ignore with rollback + `aria-live` status region,
  honest empty state. Tender detail: full facts, plain-text
  (`white-space: pre-wrap`, React-escaped) description, score-breakdown
  table, risk flags with confidence wording, Useful/Not-useful feedback form
  (reason checklist + ≤500-char comment), "Open original TED notice" link
  (`rel="noopener noreferrer"`), TED attribution.
- a11y: skip link, semantic landmarks/tables, labelled inputs, visible focus
  retained from stage-A styles, status never color-only (`ScoreBadge`
  always renders the text label), `aria-live` regions for optimistic
  actions, mobile breakpoint in `styles.css`.
- Pure logic under unit test (no DOM-testing lib, per Phase-7 scope):
  `lib/format.ts` (relative deadline, score-badge/label mappers,
  component-status/risk-confidence labels) and `lib/cursor.ts`
  (pagination merge) — `format.test.ts`/`cursor.test.ts`.
- New dependency: `react-router@^7.18.2` (verified current major on npm);
  `@bidmorrow/domain` added as an `apps/web` dependency (pure types/presets
  only, no DB/auth coupling) for `COMPANY_PRESETS`/`CONTRACT_NATURES`.
- Gates: `pnpm format`/`format:check`/`lint`/`typecheck`/`test`/`build` all
  green — 301 web+shared tests (vitest root) + 62 worker + 44 db = 407 total;
  `vite build` succeeds (297 KB JS / 89 KB gzip) and `wrangler deploy
--dry-run` packages the built assets without error.
- Open items for next session: production-reviewer + security sign-off not
  yet run for stage B; no DOM-level a11y/E2E verification yet (Phase 12);
  Settings page save flows are per-section (no combined "unsaved changes"
  guard); onboarding wizard state is not persisted across reload (in-memory
  only — a refresh mid-wizard loses unsaved steps, though every already-
  saved step re-loads correctly from `GET /api/org/profile`).

### Phase 7 stage A — Customer product API (2026-08-15)

- Ledger carry-over item 0 (residual LOW from Phase 6): `packages/procurement/
src/scoring-input.ts` — `parseExclusionContractNature`/
  `parseCertificationCode` route the `company_exclusions` contract-nature
  value and `company_certifications.certification_code` through validated
  union parsing (same pattern as `parseSupportedContractNatures`); invalid
  values are dropped and logged, never blindly cast.
- Presets (`packages/domain/src/presets.ts`): 4 static, fully client-editable
  `CompanyPreset`s (`cyber_consultancy`, `cloud_devops`, `software_house`,
  `it_generalist`) — CPV codes chosen within/near the default ingestion scope
  (72\*/48\*/79417000), capabilities, and keywords+synonym groups. `GET
/api/org/presets` (session-only, no org needed) returns them; applying one
  is a client-side pre-fill via the PUT endpoints below.
- Profile-bundle PUT endpoints added (`apps/worker/src/routes/org.ts`,
  mirroring the keywords pattern: owner-only, closed zod schemas, audit
  events on replace): `cpv-preferences` (422 `cap_exceeded` at 30, matches
  the existing repo cap), `geographies`, `capabilities`, `certifications`,
  `exclusions`, `matching-preferences`, `digest-preferences` — each with a
  paired GET. `POST /api/org/onboarding/complete` (owner-only) sets
  `company_profiles.onboarding_completed_at` and returns
  `scopeOverlapWarning: true` when the org's CPV-preference divisions have
  zero overlap with `loadIngestionScope()` (MATCH-P6-01 Phase 7 follow-up
  item 3) — resolves the "Next (Phase 7)" item 3 onboarding warning.
  `onboarding_started`/`onboarding_completed` product events fire on first
  profile write / completion respectively.
- Feed (`GET /api/org/feed`, `apps/worker/src/routes/feed.ts` +
  `packages/db/src/repositories/matching.ts` `listFeedRows`): tabs
  (`today|strong|worth_reviewing|possible|saved|ignored`), filters
  (minScore, country, cpvPrefix, buyerName substring, min/maxValueEur,
  deadlineBefore/After, publishedAfter), cursor pagination (≤50, default 25,
  keyset on score DESC/id DESC). `EXCLUDED` matches never appear. Expired-
  deadline lots are excluded from every tab EXCEPT `saved`/`ignored`
  (deliberate: a customer who saved/ignored something can still find it
  after its deadline). Rows carry top-2 components by points, one "top" risk
  flag (HIGH before POSSIBLE), saved/ignored flags — never the lot
  description.
- Detail (`GET /api/org/tenders/:matchId`, `apps/worker/src/routes/
tenders.ts` + `packages/db` `getTenderMatchWithComponents`/
  `getTenderDetailBundle` (new, tender-corpus.ts)): full lot/notice/buyer
  bundle, score+components+risk flags, saved/ignored/feedback state.
  **On-demand LOW_FIT recompute** (resolves "Next (Phase 7)" item 1): when a
  match has no stored component rows, the route recomputes live via
  `loadOrgProfile` + `mapLotToEngineInput` (called with the match's ORIGINAL
  `scored_at`, not "now" — required for deadline-runway reproducibility) +
  `scoreLotForOrg`, at the CURRENT org profile — never persisted. Determinism
  guarantee documented in-file: reproduces exactly when the org profile is
  unchanged and `match.engine_version === ENGINE_VERSION`; an engine-version
  mismatch skips recompute entirely and returns a score-only note instead of
  a fabricated breakdown (never silently wrong). Test proves recomputed
  component sum === stored score.
- Actions (`apps/worker/src/routes/tenders.ts`): `save`/`unsave`/`ignore`/
  `unignore` (idempotent booleans; `lotId`/`noticeId` resolved server-side
  from the org-checked match row via new `getTenderMatchLotNotice`, never
  from client input) and `feedback` (`upsertCustomerFeedback`, reasons enum,
  comment ≤500 chars). Product events: `match_saved`, `match_ignored`,
  `feedback_useful`, `feedback_not_useful` (existing `insertProductEvent`,
  no repo change needed).
- Repo extensions: `packages/db/src/repositories/matching.ts`
  (`getTenderMatchLotNotice`, `listFeedRows` + `FeedRow`/`FeedFilters`
  types); `engagement.ts` (`isTenderSaved`, `isTenderIgnored`,
  `getCustomerFeedback`); `tender-corpus.ts` (`getTenderDetailBundle`,
  global — org check happens one layer up via the match row, same pattern as
  `loadLotScoringBundlesByIds`).
- Methodology-page CPV pre-filter disclosure ("Next (Phase 7)" item 2) is
  NOT done — no marketing/methodology page exists yet; still open, tracked
  below.
- Tests: `packages/db/src/repositories/matching.d1.test.ts` (new, 6 tests,
  real D1) — tab filtering, `today` 24h window incl. LOW_FIT, minScore,
  cursor pagination stability across a page boundary, expired-deadline
  exclusion (scored tabs vs. saved), saved/ignored tabs + cross-org
  invisibility. `apps/worker/src/product.test.ts` (new, 18 tests, real
  workerd+D1) — presets shape + 401; profile-bundle PUT owner-only/cap/
  cross-org isolation + full bundle round-trip; onboarding complete sets
  timestamp + scope-overlap warning (disjoint-CPV org) + no-warning
  (in-scope org) + 409 without a profile; feed cross-org marker + 401;
  detail full STRONG bundle, LOW_FIT recompute (score computed via the REAL
  engine in test setup so the sum-equals-stored assertion is meaningful,
  not asserting against an arbitrary seeded number), engine-version-
  mismatch note path, cross-org 404; save/unsave/ignore/unignore idempotency
  - product-event counts, cross-org 404 on save, feedback upsert (verdict
    change replaces the row, not duplicates) + distinct product events,
    comment >500 chars rejected at the boundary.
- Real counts (2026-08-15, all executed): `pnpm format` (2 test files
  reformatted, no source diffs) · `format:check` PASS · `lint` PASS ·
  `typecheck` PASS (14/14 projects) · `test` PASS — root vitest 41 files/280
  tests (unchanged); worker pool-workers 7 files/62 tests (+18 over the
  prior 44, new `product.test.ts`); packages/db pool-workers 9 files/44
  tests (+6, new `matching.d1.test.ts`) = 57 files/386 tests total · `build`
  PASS (web 17 modules; worker `wrangler deploy --dry-run` lists all
  bindings incl. `MATCH_QUEUE`).
- Open items for stage B (frontend): (1) methodology-page CPV pre-filter
  disclosure copy (Phase 7 item 2) still not written — no marketing page
  exists to host it yet; (2) onboarding UI to apply a preset client-side and
  surface `scopeOverlapWarning`; (3) feed UI (tabs, filters, infinite
  scroll/cursor), tender detail UI (explanation rendering per docs/matching-
  engine.md's example format, save/ignore/feedback controls); (4) no
  dedicated `/api/org/tenders` list-all endpoint — the feed IS the list
  surface, by design; (5) feed's `country`/`cpvPrefix`/`buyerName` filters
  are unit-tested at the repo level (matching.d1.test.ts's tab/score/cursor
  coverage) but not independently HTTP-tested per filter — the query-schema
  wiring is straightforward and low-risk, flagged rather than exhaustively
  tested given the phase's scope.

### Phase 6 review fix batch (2026-08-15)

- SEC-P6-01 (scoring continuation, real fix): `ScoreLotsResult` gains
  `remainingLotIds` (packages/procurement/src/score.ts) — populated when
  `MAX_PAIRS_PER_INVOCATION` truncates a run; includes the in-progress lot
  plus every unprocessed lot (re-scoring the in-progress lot again is
  idempotent-safe either way). `apps/worker/src/ingestion.ts` adds
  `enqueueScoreContinuation` (chunked ≤100-id re-enqueue to `MATCH_QUEUE`),
  wired into `runScoreJob`/`runRecomputeJob`. Recompute continuations use a
  new `{kind:'recompute_continuation', lotIds}` message (env.ts) rather than
  a fresh `recompute`/`score`, because the notice→current-lot resolution
  already happened and re-resolving by lot id must still hard-replace, not
  idempotent-skip — new `runRecomputeContinuationJob` handles it, dispatched
  in `index.ts`'s `queue()`. Test: `apps/worker/src/ingestion.continuation.
test.ts` (3 tests, fake `MATCH_QUEUE`, no D1 needed) proves batching,
  kind selection, and the empty-remaining no-op.
- SEC-P6-02 (poison-message DLQ routing): `index.ts` `queue()` gains a
  `default` case for an unrecognized message `kind` — throws (never silently
  acks) so it flows through the existing catch → `message.retry()` →
  wrangler `max_retries` → DLQ path, same as any other handler failure.
- MATCH-P6-01 (CPV pre-filter disclosure, documentation disposition):
  docs/matching-engine.md new "CPV pre-filter (scoring eligibility)"
  subsection — states the relevance+cost rationale, the false-negative
  consequence (a pair with zero CPV division overlap is never scored even
  if non-CPV components could reach 45–65), and the two required Phase 7
  follow-ups (methodology disclosure, onboarding scope-overlap warning).
  docs/cost-model.md's pre-filter mention now points at it.
- MATCH-P6-02 (matchable languages beyond English, real fix): `OrgProfile`
  gains `matchableLanguages: readonly string[]` (packages/matching/src/
  types.ts); `capability.ts`/`exclusions.ts` derive the actual matchable set
  as `{'eng'} ∪ org.matchableLanguages` via new `resolveMatchableLanguages`
  (never trusts a caller to have already unioned `eng` in). packages/
  procurement/src/scoring-input.ts maps `company_keywords.language` (BCP-47)
  to ISO 639-2 (the code TED/eForms actually emits) via a small static
  24-EU-language map (`BCP47_TO_ISO_639_2`); unrecognized subtags pass
  through as-is. `listCompanyKeywords` already returned the `language`
  column — no schema/repo change needed. Tests: capability.test.ts +
  exclusions.test.ts (German-keyword org matches German lot text;
  English-only org stays UNKNOWN against German-only text; excluded German
  phrase fires only for the org with German in `matchableLanguages`);
  scoring-input.test.ts (`toIso6392`/`parseSupportedContractNatures` pure
  unit tests). `loadOrgProfile` — full DB-coupled path — stays covered at
  the existing D1 integration level (apps/worker/src/scoring.d1.test.ts).
- MATCH-P6-03: `pnpm format` run (IMPLEMENTATION_LEDGER.md/docs formatting
  only; no code changes from the formatter).
- MATCH-P6-05 (documentation, matches existing implementation):
  docs/matching-engine.md's Procedure/contract nature section now states
  explicitly that nature and procedure type are independent sub-signals —
  the known half scores normally when only one is known, the unknown half
  contributes 0 (not a further neutral half), and UNKNOWN (2.5) applies
  only when both are absent.
- MATCH-P6-06: `capability.ts`/`procedure.ts` UNKNOWN branches now import
  and multiply by `UNKNOWN_NEUTRAL` (packages/matching/src/index.ts)
  instead of a hardcoded `0.5` literal.
- SEC-P6-04 (contract-nature cast, cheap fix): `scoring-input.ts`'s
  `supportedContractNaturesJson` parse now goes through
  `parseSupportedContractNatures` — validates each entry against
  `CONTRACT_NATURES` (packages/domain), drops and logs anything invalid,
  never a blind `as ContractNature[]` cast.
- Real counts (2026-08-15, all executed): format PASS (2 files reformatted:
  IMPLEMENTATION_LEDGER.md, docs/matching-engine.md — no source code diffs)
  · format:check PASS · lint PASS · typecheck PASS (14/14 projects) · test
  PASS (root vitest 41 files/280 tests incl. new ingestion.continuation.
  test.ts 3, capability.test.ts +2, exclusions.test.ts +2,
  scoring-input.test.ts +7; worker pool-workers 6 files/44 tests; packages/db
  8 files/38 tests, unchanged) = 55 files/362 tests total · build PASS (web
  - worker `wrangler deploy --dry-run`).
- Open items carried forward: (1) lot title/description language-tagging
  gap (Phase 6 stage B, still open — per-language map not reconstructible
  from the current flattened-string storage); (2) stale pre-correction
  match rows never purged/detached from the feed; (3) admin-triggered
  bounded recompute (Phase 10) reuses `scoreLotsForOrgs` directly, no new
  wrapper.

### Phase 6 stage B — Matching pipeline wiring (2026-08-15)

- ECB rates (packages/procurement/src/ecb.ts): `fetchEcbRates`/
  `parseEcbDailyXml`/`refreshEcbRates`, fast-xml-parser added directly to
  `procurement` (justified — `ted`'s xml.ts is an internal, non-exported
  module; not reused across package boundaries). ecb.europa.eu confirmed
  proxy-blocked from dev (`CONNECT tunnel failed, response 403`, same as
  TED) — fixture built from the documented real feed shape
  (tests/fixtures/ecb/eurofxref-daily.xml), 8 tests green. Wired into
  `runIngestCatchUpJob` (apps/worker/src/ingestion.ts), before scoring,
  non-fatal on failure (value scoring degrades to UNKNOWN — ADR-0004).
- Engine input mapping (packages/procurement/src/scoring-input.ts):
  `loadOrgProfile` (company repo bundle -> OrgProfile) and
  `mapLotToEngineInput` (LotScoringBundle -> LotInput; EUR direct, non-EUR
  via `getRate` ≤7d, rateDate returned alongside for the persisted
  explanation, no rate -> null/UNKNOWN). Known carried-over gap: lot
  title/description are flattened single strings from Phase 5 ingestion
  (not per-language maps), keyed here under the notice's first declared
  language — honest best-effort, not guaranteed-correct language tagging;
  flagged, not fixed (would need a tender_lots schema change). 8 unit
  tests (pure branches only — non-EUR/getRate branch proven at D1
  integration level, faking a drizzle chain would test the fake).
- Scoring orchestration (packages/procurement/src/score.ts):
  `scoreLotsForOrgs({lotIds|noticeIds, engineVersion, recompute,
ingestionRunId})` — CPV DIVISION pre-filter (skip = no row of any kind,
  including EXCLUDED); component-persistence rule (EXCLUDED: rule+evidence
  only; LOW_FIT: score+classification only; ≥POSSIBLE_MATCH: full
  components+risk flags); bounded `MAX_PAIRS_PER_INVOCATION = 5000`
  (`truncated: true` when hit, caller must re-enqueue remainder — no
  continuation-enqueue wired yet, open item). Missing-main-CPV lots ->
  `ingestion_errors` (stage `score`) when an `ingestionRunId` is available,
  else logged only (recompute path has no run to attach to — documented).
- DB repo additions: `company.ts` `listOrgsEligibleForScoring` (profile +
  ≥1 CPV pref; added to the tenant-isolation-contract test's documented
  exemptions — global-scan-across-tenants, ids only); `matching.ts`
  `replaceTenderMatches` (hard delete+reinsert, FK-safe, one batch — the
  correction/recompute path); `tender-corpus.ts`
  `loadLotScoringBundlesByIds`/`loadLotScoringBundlesForNotices` (bounded
  join+batch queries feeding the mapper).
- Recompute path: `run-window.ts`/`catch-up.ts` now return `newLotIds`
  (every freshly-inserted lot id, new notices AND corrected-notice new
  versions) instead of a fixed empty scoring count.
  `ingestion_runs.matches_scored` accounting decision: stays honestly 0 —
  scoring is fully decoupled/async (MATCH_QUEUE), so no ingestion run ever
  scores anything itself; the scored-pair count is observable on scoring's
  own `scoring.run.completed` structured log line instead (documented in
  run-window.ts). `recomputeMatches`-for-admin (Phase 10) is
  `scoreLotsForOrgs({noticeIds, recompute:true})` — already generically
  usable, no separate wrapper needed.
- Worker wiring: `MATCH_QUEUE` + `bidmorrow-match-dlq-*` producer/consumer
  in wrangler.jsonc (top-level + staging + production, verified via
  `wrangler deploy --dry-run` showing the binding in all three); `env.ts`
  `MatchQueueMessage` (`score`/`recompute`); `index.ts` `queue()` extended
  to dispatch by message `kind` (one handler serves both queues);
  `ingestion.ts` `runIngestCatchUpJob` now refreshes ECB rates, then
  enqueues new lot ids to MATCH_QUEUE in ≤100-id batches after catch-up;
  `runScoreJob`/`runRecomputeJob` added as the queue-consumer entry points.
- Tests (apps/worker/src/scoring.d1.test.ts, real D1 via pool-workers, fake
  TedClient + real `tests/fixtures/ted` fixtures): 8 tests green —
  STRONG_MATCH full component breakdown sums to score; LOW_FIT has zero
  component/risk-flag rows; CPV-disjoint org gets no row; excluded-phrase
  org gets rule+evidence only; non-EUR value UNKNOWN-then-converted via a
  seeded exchange_rates row (explanation contains the rate date); scoring
  idempotent (insert path, no dupes); recompute idempotent (replace path,
  no dupes across repeated runs); a REAL correction (second ingested
  version) recomputes against the new current-version lot. NOTE: these
  tests share one D1 per file (existing project pattern) — assertions are
  scoped to each test's own org id, never to a call's aggregate counters,
  since other tests' orgs remain eligible and get harmlessly scored too.
- Real counts (2026-08-15, all executed): format:check PASS · lint PASS ·
  typecheck PASS (14/14 projects) · test PASS (root vitest 41 files/269
  tests incl. new ecb.test.ts 8 + scoring-input.test.ts 8 + tenant-
  isolation-contract exemption addition; worker pool-workers 5 files/41
  tests incl. new scoring.d1.test.ts 8; packages/db 8 files/38 tests,
  unchanged) · build PASS (web + worker `wrangler deploy --dry-run`, both
  top-level and `--env staging` show `env.MATCH_QUEUE`).
- Open items: (1) `truncated: true` pair-cap has no continuation-enqueue
  wired yet (worker just logs it — Phase 10-ish follow-up); (2) lot title/
  description language-tagging gap (above) not fixed, only carried
  forward honestly; (3) stale pre-correction match rows (old lot id) are
  never purged/detached from the feed — feed correctness across
  corrections is a future-phase concern, out of scope here; (4) admin-
  triggered bounded recompute (Phase 10) can reuse `scoreLotsForOrgs`
  directly, no new wrapper built.

### Phase 0 — Research (2026-08-14)

- Repository inspected: was empty (single README).
- Official docs verified via research subagents (full details in
  docs/dependency-versions.md and docs/ted-data-source.md):
  - TED Search API v3: `POST https://api.ted.europa.eu/v3/notices/search`,
    anonymous, expert query language, ITERATION pagination, no documented
    rate limit (self-imposed throttling required).
  - eForms: SDK 1.15.1 latest; active CVS range ~1.12–1.14; version detected
    from `cbc:CustomizationID`; competition vs result form types; field
    ID/XPath map recorded.
  - CPV 2008 current; NUTS 2024 current.
  - TED reuse: free incl. commercial, source acknowledgement required
    (Decision 2011/833/EU).
  - Cloudflare: D1 10 GB/db (paid), $5/mo plan allowances, Time Travel 30d,
    Queues at-least-once, Static Assets = recommended SPA path, native
    rate-limit binding GA, Workflows bills per-step (not used).
  - Stack: Better Auth 1.6.29 (+ official Drizzle adapter, org plugin),
    Hono 4.13, Drizzle 0.45.2, Stripe SDK 22 (constructEventAsync on
    Workers), Resend 6, Vite 8, Vitest 4.1 + pool-workers 0.21, wrangler 4.
  - Claude Code: agents support model/effort/skills/tools frontmatter
    (model: fable valid); skills = SKILL.md dirs; hooks/permissions schema
    confirmed.
- Created: `.claude/agents/` (13 agents per routing table),
  `.claude/skills/` (9 skills), `.claude/settings.json` (env-file deny
  rules, destructive-wrangler deny rules, PostToolUse typecheck hook +
  `.claude/hooks/typecheck-changed.sh`).

### Phase 1 — Product/Architecture (2026-08-14)

- docs/product-scope.md (V1 in/out, exclusions table, pricing).
- docs/architecture.md + ADRs 0001–0006 (platform/monorepo; Better Auth
  Drizzle-over-D1 route; ingestion scope + retention; currency via ECB
  reference rates; R2 snapshots; Queues+Cron over Workflows).
- docs/matching-engine.md (full deterministic spec: weights, CPV gradient,
  UNKNOWN=50% neutral policy, hard exclusions, risk flags, versioning).
- docs/ted-data-source.md, docs/ted-ingestion-scope.md (scope = 72* + 48* +
  79417000 default; retention deadline+90d; volume assumption 150–300/day
  to be MEASURED in Phase 5).
- docs/data-model.md (all required tables, constraints, indexes, growth
  profile) — drafted via subagent, to be reconciled with Better Auth
  generated schema in Phase 3/4.
- docs/threat-model.md (STRIDE-per-asset, all 21 contractual threats,
  controls C1–C11) — security-agent-owned going forward.
- docs/security.md (control baseline C1–C11, forbidden patterns).
- docs/cost-model.md ($6/mo @0–10 customers, ~$26 @100, ~$30–105 @1,000;
  D1 12-month projection ≤3–5 GB vs 10 GB limit).
- docs/dependency-versions.md (version register + platform facts + flags).
- docs/privacy.md, deployment.md, backup-restore.md, runbook.md,
  incident-response.md, customer-support.md, production-checklist.md
  (operational set; procedures marked [validate: Phase N] where they
  depend on unbuilt systems).
- CLAUDE.md, HUMAN_DECISION_BLOCKERS.md, README.md, .env.example.

### Phase 2 — Foundation (2026-08-14)

- pnpm workspace (pnpm 10.33.0, Node 22): root scripts format/lint/typecheck/
  test/build/db:migrate:local; strict tsconfig base (TS ~5.9.2, Bundler
  resolution, noEmit, source-level package exports — no per-package builds);
  ESLint flat config (no-any, no-empty-catch, no-console except warn/error);
  Prettier 3.6.
- 12 package skeletons. Real foundational code: `domain` (branded IDs,
  core unions, Unknown<T> helper, ProcurementSource interface), `config`
  (zod 4.4.3 env schema — errors list NAMES only, secrets required in
  staging/production), `observability` (JSON logger, recursive key-based
  redaction, never-throws — hardened per SEC-P2-01, child loggers for
  correlation IDs), `matching` (ENGINE_VERSION, COMPONENT_MAX sums 100,
  UNKNOWN_NEUTRAL, classify() with tested 80/65/45 boundaries), `db`
  (TenantScoped contract marker). Others are honest type-stub skeletons.
- apps/worker: Hono 4.13, secure headers + strict CSP, server-generated
  request-id, /api/health/live + /api/health/ready (no detail leakage),
  onError/notFound JSON; wrangler.jsonc (nodejs_compat, Static Assets SPA
  with run_worker_first /api/*, per-env D1 with distinct names + placeholder
  IDs → blockers item 1). migrations/0001_init.sql bootstrap applies from
  empty DB. Pool-workers 0.21 tests (7) run in real workerd with local D1;
  note: cloudflareTest()/readD1Migrations import from package ROOT in 0.21
  (docs prose partly stale), tests use `import { env, exports } from
'cloudflare:workers'`.
- apps/web: React 19.2 + Vite 8.2 shell (headline/subheadline/CTA from
  product-scope, TED attribution + decision-support disclaimer in footer,
  semantic HTML); copy exported from src/copy.ts and tested.
- CI: .github/workflows/ci.yml — frozen install, format:check, lint,
  typecheck, test, build + separate gitleaks job (fetch-depth 0). No deploy
  steps. Playwright scaffold only (config + README; suites in Phase 12).
- Deferred deliberately (P2-002/P2-003): Queues/R2/cron bindings arrive with
  their owning phases per ADR-0006; tests/{fixtures,unit,...} dirs and
  scripts/ created when their first artifacts land (unit tests are colocated
  in src/).
- PostToolUse typecheck hook verified live (P2-005): fired on every scaffold
  edit (pre-install failures surfaced TS2307 exactly as designed; silent
  green after install, including the SEC-P2-01 fix edits).
- Known INFO gap (P2-004): readiness-failure path has no automated test yet
  (code-review-verified only); add a broken-DB-binding test in a later phase.

### Phase 3 — Database (2026-08-14)

- Drizzle schema: 38 non-auth tables across 8 area files
  (identity/company/tender/ingestion/matching/engagement/billing/ops), all
  docs/data-model.md constraints encoded in-schema: named CHECK enums
  (ck__), uniques (uq__), indexes (idx_*), partial indexes, lazy circular
  FK (tender_notices.current_version_id ↔ versions). Doc reconciliations:
  exchange_rates added per ADR-0004; Better Auth note gained the Phase 3
  users-placeholder line (auth_accounts/auth_sessions deferred to Phase 4
  generation).
- migrations/0002_core_schema.sql generated by drizzle-kit 0.31 (flattened,
  headered; starts by dropping the 0001 _bootstrap placeholder). 0001
  byte-identical. drizzle-kit generate now produces a ZERO diff (schema ↔
  SQL agreement proven); packages/db/drizzle/ snapshot journal kept in-repo
  for future 0003+ diffs. Chain applies to a completely empty D1 (99
  commands, verified twice independently).
- Repository layer (11 modules): organizationId-FIRST contract on every
  tenant function; UPDATE/DELETE double-scoped (id AND organization_id);
  typed errors (CapExceededError, DuplicateDigestError,
  TenantMismatchError); caps enforced (keywords 50, CPV 30); checkpoint
  advance-only; notice versioning never overwrites history; match insert
  idempotent via (org,lot,engine_version) with verified-race handling;
  billing upsert guards stripe-customer cross-tenant hijack. An executable
  structural contract test (tests/security/tenant-isolation-contract.test.ts)
  enforces the signature rule by parsing repo sources.
- Seed: scripts/seed-demo.sql — Acme Cyber Consulting + 2 fake TED-DEMO
  notices, demo_-prefixed ids, .example hosts, manual-local-only, loudly
  marked; applies cleanly after 0001+0002.
- Tests: 111 total green — root 17 files/66 (+5 structural security),
  worker 7, packages/db 8 files/38 in real workerd D1 (migrations-from-
  empty sentinel, corpus idempotency/correction flow, run lifecycle,
  checkpoint no-backwards, cap errors, DB-enforced digest dedupe, stripe
  event idempotency, stale-rate rejection, full tenant-isolation negative
  suite incl. SEC-P3-01 regression + FK sentinel SEC-P3-02).
- Root `pnpm test` chains root+worker+db suites (P3-R-003 foot-gun noted:
  future pool-workers suites must be appended to the chain).

### Phase 4 stage A — Auth core (2026-08-14)

- Verified against live Better Auth 1.6.29 docs (github.com/better-auth/
  better-auth main branch, fetched — better-auth.com is proxy-blocked) AND
  the installed package source (`@better-auth/core`, `@better-auth/
drizzle-adapter`, `better-auth` dist), not memory: `drizzleAdapter` import
  is `@better-auth/drizzle-adapter` (separate package, matches ADR-0002 +
  dependency-versions.md pin — NOT the `better-auth/adapters/drizzle`
  subpath some doc pages show for a different release line); model
  resolution (`getModelName`) proven from `@better-auth/core` source to key
  the `schema` object passed to `drizzleAdapter` by the **mapped**
  `modelName`, so `packages/auth` sets `user.modelName`/`session.modelName`/
  `account.modelName`/`verification.modelName` to our real snake_case table
  names and keys the `schema` object with those same strings; email/reset
  hook signatures, `requireEmailVerification` (proven via sign-in/sign-up
  route source: 403 `EMAIL_NOT_VERIFIED`, sign-up returns `{token:null,
user}` while still firing `sendVerificationEmail`), `rateLimit: {enabled,
storage:'database', modelName}`, and CSRF origin-header enforcement (a
  cookie-bearing state-changing request needs a matching `Origin` header —
  discovered via a failing smoke test, not assumed) were all confirmed this
  way, not assumed from ADR prose.
- ADR-0007 followed: NO organization plugin; `packages/auth` is
  authentication-only (`createAuth` in packages/auth/src/index.ts).
- Schema reconciliation (packages/db/src/schema/identity.ts): `users`
  gained `image`; four new Better-Auth-core tables (`auth_accounts`,
  `auth_sessions`, `auth_verifications`, `auth_rate_limits`) hand-mapped
  (CLI generation can't know our table-name mapping, so it isn't
  authoritative here — documented in-file). DEVIATION recorded in-file and
  in docs/data-model.md §1: these five tables use Drizzle
  `integer(...,{mode:'timestamp_ms'})`/`{mode:'boolean'}` column modes
  (Better Auth writes native `Date`/`boolean` for those fields) — on-disk
  storage is still plain INTEGER; every other table keeps the repo's plain-
  number convention untouched. Existing Phase-3 test helpers
  (`test/helpers.ts`, `tenant-isolation.d1.test.ts`) updated to the new JS
  types (`Date`, `boolean`) for their placeholder `users` inserts.
- Migration 0003_auth_tables.sql: additive only (4x CREATE TABLE + indexes,
  1x ALTER TABLE users ADD COLUMN image). Procedure: rebuilt
  packages/db/drizzle/ as a two-step baseline→diff (old schema snapshot,
  then new schema diff) since the in-repo drizzle/ journal only tracks a
  single collapsed snapshot (mirroring the Phase 3 0000_core_schema.sql
  pattern) — flattened the diff into the migration, then regenerated a
  fresh single `packages/db/drizzle/0000_core_schema.sql` baseline and
  proved `drizzle-kit generate` afterward gives **zero diff**. Full chain
  (0001+0002+0003) verified twice: once against a brand-new scratch D1
  (`--persist-to` under the session scratchpad; 0001✅/0002✅/0003✅, 11
  commands on 0003) and once via `pnpm db:migrate:local`. 0001/0002
  untouched (only 0003 is new).
- packages/notifications: added `EmailProvider`/`EmailMessage` +
  `createLoggingEmailProvider(logger)` — logs `kind`+`to` only, never
  `subject`/`text` (which may carry a verification/reset URL) — Resend
  implementation still Phase 8 (blocker 3).
- apps/worker: `/api/auth/*` mounted per the documented Hono pattern
  (`app.on(['GET','POST'], ...)`); `Env` gained `APP_ENV`/`APP_BASE_URL`/
  `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`; wrangler.jsonc got non-secret
  `vars` per env + comments pointing secrets at `wrangler secret put`/
  `.dev.vars`; `.dev.vars.example` added (gitignore needed a
  `!.dev.vars.example` exception — `.dev.vars.*` was blanket-ignoring it).
- Smoke tests (apps/worker/src/auth.test.ts, real workerd+D1, pool-workers):
  10 tests — sign-up creates `users` row with `email_verified=0` and fires
  the logging email stub with `kind=verification`+the email (asserted via a
  `console.warn`/`console.error` capture, with a regression assertion that
  NO captured log line contains the verification URL/token); unverified
  sign-in → 403 `EMAIL_NOT_VERIFIED`, no session cookie; after setting
  `email_verified=1` directly in D1, sign-in succeeds, sets an HttpOnly
  session cookie, `get-session` returns the user, `sign-out` clears the
  session (subsequent `get-session` → null). Existing
  packages/db/src/migrations.d1.test.ts sentinel updated for the 4 new
  tables + 0003 in `d1_migrations`.
- Gates (all executed 2026-08-14, real output, no claims without runs):
  `pnpm format:check` PASS · `pnpm lint` PASS · `pnpm typecheck` PASS
  (14/14 workspace projects) · `pnpm test` PASS — root 17 files/66 tests,
  worker 2 files/10 tests (workerd+D1), db 8 files/38 tests (workerd+D1) =
  114 tests total, zero skipped/deleted · `pnpm build` PASS (vite + wrangler
  deploy --dry-run, bindings listed including the new `vars`).

### Phase 4 stage B — Tenancy (2026-08-14)

- Verified against installed `better-auth@1.6.29` source (not memory):
  `auth.api.getSession({ headers })` returns `{ session, user } | null`
  (`requireHeaders: true`, `dist/api/routes/session.mjs`);
  `auth.api.deleteUser({ headers, body })` is disabled by default and
  throws 404 unless `user.deleteUser.enabled` is set
  (`dist/api/routes/update-user.mjs`) — enabled in `packages/auth`
  (password/verification-email confirmation left off for V1; the
  composition root's own domain-level gate — sole-OWNER orgs cannot
  self-delete — is the safety check instead); `internalAdapter.deleteUser`
  cascades `auth_accounts`/`auth_sessions` but NOT `organization_members`
  (no FK cascade — that table is domain-owned), so the account-deletion
  handler removes membership rows itself first. Better Auth's own
  database-storage rate limiter applies a strict 3-req/10s rule to
  sign-up/sign-in keyed by `x-forwarded-for` (`@better-auth/core/dist/
utils/ip.mjs`) — the new SEC-P3-04 test suite gives each test-created user
  a distinct synthetic IP so its own volume doesn't self-throttle; also
  caught (and fixed) that Better Auth lowercases emails on sign-up, so the
  test helper's raw-SQL force-verify update needed lowercase addresses to
  match.
- apps/worker/src/env.ts: `Env`/`Variables`/`AppBindings` extracted from
  index.ts (avoids a circular import with the new
  src/auth-instance.ts factory, which both `/api/auth/*` and the session
  middleware now share). `Env` gained `ADMIN_EMAILS?` (secret-like — never
  a wrangler.jsonc `vars` entry, only `.dev.vars`/`wrangler secret put`)
  and `API_RATE_LIMITER?: RateLimit`.
- Middleware (src/middleware/): `requireSession` (401 JSON on no session);
  `requireOrganization` (org/role from `organization_members` via
  `getOrganizationsForUser` ONLY — V1 single-org rule, 403 `no_organization`
  when none) + `requireRole(role)` guard; `requireInternalAdmin`
  (ADMIN_EMAILS allowlist, case-insensitive/trimmed; 404 — not 401/403 —
  for every non-admin caller so the admin surface's existence is never
  revealed, docs/security.md C11); `rateLimitOrgApi` (native
  `API_RATE_LIMITER` binding on `/api/org/*`, IP-keyed, tolerant of a
  missing binding — logs once and skips rather than failing closed/open).
- Routes (src/routes/, zod-validated via `@hono/zod-validator` 0.9.0, new
  dep): `POST /api/org` (create org + OWNER membership, 409 if the user
  already has one — V1 single-org rule); `GET/PUT /api/org/profile` (PUT
  OWNER-only, closed zod schema — unknown fields incl. a client-supplied
  `organizationId` are rejected 400, never honored); `GET/PUT
/api/org/keywords` (PUT OWNER-only, `CapExceededError` → 422
  `{error:'cap_exceeded',cap}`); `DELETE /api/account` (409
  `transfer_or_delete_organization_first` for a sole OWNER — checked via
  new `countOrganizationOwners`, not just "has an OWNER row", so it stays
  correct if multi-owner orgs ever ship; otherwise removes memberships then
  calls Better Auth's deleteUser); `/api/admin/health-details` placeholder
  (real admin tooling is Phase 10). All handlers read `organizationId`
  from `c.var` only; every write goes through a repository function.
- packages/db/src/repositories/identity.ts: three additions, all
  `(db, organizationId, ...)`-shaped (no structural-contract-test
  exemption needed) — `addOrganizationMember` (no invite UI in V1; exists
  for org bootstrap + MEMBER-role test seeding), `removeOrganizationMember`
  (double-scoped delete), `countOrganizationOwners`.
- wrangler.jsonc: `[[ratelimits]]` binding `API_RATE_LIMITER`
  (namespace_id 1001, simple 100 req/60s) — confirmed working in BOTH the
  pool-workers 0.21 test runtime (miniflare's ratelimit plugin picked it up
  from `wrangler.jsonc` via `configPath`, no test-only override needed) and
  `wrangler deploy --dry-run` bindings output; middleware still guards the
  missing-binding case per the plan for any environment where it isn't
  true.
- Tests: `apps/worker/src/tenancy.test.ts`, 8 tests, real workerd + local
  D1, covering every SEC-P3-04 bullet — unauthenticated 401 on every
  `/api/org/*` route and 404 on `/api/admin/*`; B never reads/writes A's
  profile row (asserted both via HTTP response AND a direct repository
  read of A's row before/after); query-string `organizationId` ignored on
  GET, JSON-body `organizationId` rejected 400 on PUT (both leave A
  untouched); MEMBER role → 403 on PUT profile (member row seeded via the
  new `addOrganizationMember`); admin gate 404 for a normal user / 200 for
  the ADMIN_EMAILS test user; keywords cap 51 → 422 with zero rows
  persisted; account deletion 409 for a sole OWNER, 204 + D1 row gone +
  subsequent session check 401 for a memberless user.
- Deliberate scope note: account deletion only removes
  `organization_members` rows before calling Better Auth's deleteUser
  (matches what V1 actually populates for a self-deleting user); a broader
  user-reference sweep (`support_notes.author_user_id`,
  `feature_flags.updated_by_user_id`, admin-only tables) is out of scope
  here and would only matter for an INTERNAL_ADMIN account, which Phase 10
  owns.
- Gates (all executed 2026-08-14, real output): `pnpm format` (1 file
  reformatted, the new test file) · `pnpm format:check` PASS ·
  `pnpm lint` PASS · `pnpm typecheck` PASS (14/14 workspace projects) ·
  `pnpm test` PASS — root 17 files/66, worker 3 files/18 (workerd+D1, incl.
  the new tenancy.test.ts), db 8 files/38 (workerd+D1) = 122 tests, zero
  skipped/deleted · `pnpm build` PASS (vite 17 modules; `wrangler deploy
--dry-run` lists `env.API_RATE_LIMITER (100 requests/60s)` alongside the
  existing bindings).

### Phase 4 review fixes (2026-08-14)

Targeted fixes from the security + production reviews of Phase 4 stage A/B —
no refactors, each read-before-edit.

- SEC-P4-01 (fixed): `apps/worker/wrangler.jsonc` — wrangler named
  environments do NOT inherit top-level bindings; `ratelimits` is now
  redeclared identically inside both `env.staging` and `env.production`.
  Verified with `wrangler deploy --dry-run --env staging`: bindings output
  now lists `env.API_RATE_LIMITER (100 requests/60s)` (it did not before).
- SEC-P4-02 (fixed): `apps/worker/src/index.ts` — `hono/body-limit`
  middleware bounds every `/api/*` request body to 128 KB before any route
  handler runs, returning a JSON 413 `{error:'payload_too_large'}`. New test
  in `tenancy.test.ts` (`SEC-P4-02`): `PUT /api/org/profile` with a >128 KB
  body → 413.
- SEC-P4-03 (fixed): `apps/worker/src/routes/org.ts` — `website` schema
  switched from `z.url()` to zod v4's built-in `z.httpUrl()` (verified from
  installed `zod/v4/classic/schemas` — restricts to the `http`/`https`
  protocol regex), so `javascript:`/other schemes can never be stored. New
  test (`SEC-P4-03`): `website: 'javascript:alert(1)'` → 400.
- SEC-P4-04 + P4-R-03 (fixed): `apps/worker/src/routes/account.ts` —
  membership removal still runs before `auth.api.deleteUser` (FK ordering
  unchanged), but the `account.deleted` audit event now writes only AFTER
  `deleteUser` succeeds, and `deleteUser` is wrapped in try/catch: on
  failure the removed membership rows are re-inserted (compensation) via the
  captured rows, the error is logged (no secrets) with the correlation id,
  and the handler returns 500 `{error:'account_deletion_failed'}`. The
  10-row membership fetch cap was removed — `getOrganizationsForUser` is now
  paginated to exhaustion so an OWNER row past a fixed page size can't
  silently escape the sole-OWNER guard.
- P4-R-02 (applied): `packages/auth/src/index.ts` sets
  `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` (option path
  verified from installed `@better-auth/core/src/utils/ip.ts` — `getIp`
  walks `ipAddressHeaders` in order with NO fallback to
  `x-forwarded-for` once set, so the client-spoofable header is no longer
  consulted at all). `apps/worker/src/tenancy.test.ts` and
  `apps/worker/src/auth.test.ts` updated to key their per-test IP isolation
  off `cf-connecting-ip` instead of `x-forwarded-for`.
- SEC-P4-05 (documented, accepted for V1): TOCTOU race between the
  organization-existence check and the insert in `POST /api/org` — comment
  added at the check site; a partial unique index is scheduled with the
  next schema migration. Failure mode is an orphaned extra org, not a
  security issue, since `requireOrganization` deterministically picks the
  first org by id order.
- SEC-P4-08 (documented, accepted for V1): comments added at both
  `void deps.sendEmail(...)` call sites in `packages/auth/src/index.ts` —
  fire-and-forget is fine for the current logging-only dev/test provider,
  but the Phase 8 Resend provider MUST NOT rely on fire-and-forget on
  Workers (isolate teardown can drop the email); it needs
  `ExecutionContext.waitUntil` or a durable queue instead.
- SEC-P4-06 (tests added) in `apps/worker/src/tenancy.test.ts`: MEMBER role
  → 403 on `PUT /api/org/keywords`; a second `POST /api/org` by the same
  user → 409 `organization_exists`; `PUT /api/org/keywords` with an unknown
  top-level field → 400 (closed zod schema); `ADMIN_EMAILS`
  case-insensitivity exercised by reconfiguring the test binding to mixed
  case (`Admin@Example.test`) while the admin-gate test signs in with the
  lowercase form — 200.
- P4-R-01 (partial): smoke test added in `apps/worker/src/auth.test.ts` for
  `POST /api/auth/request-password-reset` (path verified from installed
  `better-auth` source, `dist/api/routes/password.mjs`) — 200 for an
  existing verified user, confirms the logging email provider was invoked
  for that recipient, and confirms the token/reset-url never appear in
  worker logs (C10). Full token-roundtrip reset (actually consuming the
  token via `/reset-password`) stays deferred to Phase 12 E2E — no test
  harness currently exposes the generated token outside the (intentionally
  unlogged) email body.
- Gates (all executed 2026-08-14, real output): `pnpm format` (reformatted
  1 file, the new auth.test.ts additions) · `pnpm format:check` PASS ·
  `pnpm lint` PASS (0 errors) · `pnpm typecheck` PASS (14/14 workspace
  projects) · `pnpm test` PASS — root 17 files/66 tests, worker 3 files/24
  tests (workerd+D1, +6 over the prior 18), db 8 files/38 tests = 128 tests,
  zero skipped/deleted · `pnpm build` PASS (vite 17 modules; `wrangler
deploy --dry-run` for the top-level env AND `--env staging` both list
  `env.API_RATE_LIMITER`).

### Phase 5 — TED Ingestion (2026-08-14)

- **Stage A (packages/ted)**: TedClient (anonymous Search API v3,
  sequential, 500 ms spacing, exp backoff + jitter honoring Retry-After,
  max 4 retries, hard request budget → TedBudgetExceededError, ITERATION
  iterator with stalled-token guard, fetchNoticeXml host-allowlisted to
  https *.ted.europa.eu + 15 MB size cap SEC-P5-01). eForms parser
  (fast-xml-parser 5.10; DTD rejected + strict validator — XXE/billion-
  laughs closed; namespace-prefix-agnostic navigation; OPT-300 buyer
  resolution; lot→procedure CPV/NUTS fallback; multilingual {lang→text}
  maps preserved; UTC deadlines; CPV check-digit stripping; version-
  tolerant 1.13–1.15 with warnings outside; TedParseError carries
  ParseIssue[] with 1 KB message truncation SEC-P5-04; 100k text caps;
  never fabricates — explicit nulls).
- **Fixtures**: 12 sanitized official OP-TED SDK examples under
  tests/fixtures/ted/{1.15,1.13}/ with meta.json (provenance, sdk tag,
  sanitization): normal, multi-lot, missing-value, missing-deadline,
  non-english, multilingual (24 langs), unexpected-optional-fields,
  published-publication-id, malformed-truncated (derived, documented),
  normal-corrected (derived), second-schema-version (1.13.2). Live
  published-TED fixtures pending network access (TED-P5-02).
- **Stage B (packages/procurement + worker)**: feature-flag-driven
  IngestionScope (default 72/48/79417000) + pause flag (fail-open on
  malformed JSON, warn-logged P5-R-03); buildScopeQuery (syntax pending
  live checkQuerySyntax — see gates below); bounded day-window catch-up
  (≤3 windows/run, stops at first failure); runIngestionWindow: search →
  fetch XML → sha-256 + gzip → R2 snapshot (ADR-0005 deterministic keys;
  publication-number validated two-tier SEC-P5-02) → parse → Search-row
  overrides → alpha-3→alpha-2 country map → upsert notice/version/lots/
  cpv/geo; TedParseError/XML_TOO_LARGE → ingestion_errors (detail_json
  capped 50 KB) + partial status, window proceeds; checkpoint advances
  only on full success (SQL-guarded advance-only). Retention purge:
  deadline+90d / no-deadline publication+180d, saved/feedback-pinned
  exempt, notice-granular, batch-bounded 500, FK-safe order, snapshots
  retained (R2 lifecycle owns objects); repositories/retention.ts global
  exemption documented + insert-ban asserted (SEC-P5-03). Worker: queues
  (INGEST_QUEUE + DLQ) / R2 (SNAPSHOTS) / crons (ingest 05:00, retention
  06:30, stale watchdog 09:00 UTC) in top-level AND both env blocks;
  scheduled()/queue() dispatch; /api/health/ready reports
  lastSuccessfulIngestionAt + stale (>36 h).
- **Deferred to Phase 6** (TED-P5-03): match recompute on new notice
  versions — listLotsForScoring already keys on current version; Phase 6
  scores post-ingestion.
- **OPEN honesty flags** (also in docs/deployment.md pre-first-ingestion
  gates): (1) composed expert-query syntax NOT validated against live
  checkQuerySyntax (TED API proxy-blocked from dev env) — must pass on
  staging before the production cron is enabled (TED-P5-01); (2) scoped
  daily volume UNMEASURED — planning number 150–300/day stands unverified;
  measure on first staging window, record in cost model, tighten-before-
  widen if >2× (ADR-0003); (3) purge eligibility scan is in-memory —
  fine ≤~50k lots, keyset pagination past that (P5-R-04).

## In progress

- **Branch B prerequisite CLOSED — member addressing CONFIRMED
  (2026-08-21, run 32522822931)**. The last open item in ADR-0010 is
  answered by content, not inference. Window 2026-08-17: Search returned
  156 notices with a SINGLE distinct `OJ` value (`157/2026`);
  `/packages/daily/202600157` delivered 19,980,923 B gzip →
  207,127,552 B; 3,190 members, ALL matching `20260817_157/NNNNNNNN_2026.xml`;
  Q4a matched 20/20; Q4b negative control 0 false positives; Q5 extracted
  `00566194_2026.xml` (50,965 B) and read
  `<efbc:NoticePublicationID schemeName="ojs-notice-id">00566194-2026`.

  **Three facts Branch B implementation depends on:**
  1. **ZERO-PAD TO 8 DIGITS.** Search returns `566194-2026` (6 digits);
     member filename AND canonical in-XML id are `00566194-2026`. A direct
     string match between the two FAILS. `num.padStart(8, '0')`. This is
     the detail most likely to be got wrong.
  2. Member paths are **constructible without listing the archive**:
     `{YYYYMMDD}_{OJ-seq}/{padded}_{year}.xml`, both components already in
     the search row.
  3. **Selectivity 4.9%** — 156 of 3,190 members, ~7.6 MB of interest
     inside 207 MB (20.4x reduction). Quantifies ADR-0010 §3's selective
     extraction over whole-archive parsing.

  **Probe weakness found and fixed in the same pass**: Q5 asserted with a
  bare `grep -q "$num"` substring search, which would also pass on an
  unrelated occurrence — the automated verdict was weaker than the
  evidence it printed. The CONFIRMED result itself is sound (the canonical
  element was printed and read directly). Q5 now asserts on
  `<efbc:NoticePublicationID ...>{padded}-{year}<` and has a third WEAK
  outcome. Pattern verified offline against the real observed line.

  **Branch B is now unblocked.** Next session: plan mode, per CLAUDE.md.

- **Render channel: NOT an outage — a short-TTL cache (2026-08-21,
  evidence)**. The §5.4 canary's first run looked like recovery (200,
  244,469 bytes, ~1s). It was not. The batch probe (run 32520323517,
  window 2026-08-17 — deliberately the window that previously returned
  0/156) measured, relative to trigger completion: batch A (5 notices)
  available +7..+67s, gone by +132s; batch B (50) absent at +60..+112s,
  available +232..+310s (47/50), gone by +490s. `other=0` every pass — no
  4xx/5xx — so re-queueing, not blocking. Latency scales with batch size.

  **This resolves the contradiction that shaped ADR-0008/0009.** The
  2026-08-18 diagnostic saw a render complete (polled inside the window);
  the 2026-08-20 run saw 0/156 (a 156-notice cycle outlasts the content).
  A treadmill, not an outage. Nothing was ever down — which also means the
  "slow-motion abandonment" risk was never an outage clock either.

  **ADR-0010 §1 is vindicated on mechanism rather than symptom.** The
  original argument reasoned from instability ("changed three times in one
  week"); the stronger form is that a full window through this channel
  means winning a ~1-3 minute race per batch. Branch B remains correct and
  is now the only structurally sound option, not merely the safer one.

  Canary REFRAMED accordingly (its old verdict language said "expected
  while the outage persists" and its ::notice said "recovered" — both the
  wrong model): it now samples densely and early (0/+45/+90/+150 rather
  than 0/+60/+180, which would routinely land after expiry and report a
  false absence), reports render LATENCY, and states explicitly that a
  single absence is not an outage signal. Recorded in
  `docs/ted-data-source.md` and ADR-0010.

  Exact TTL deliberately NOT measured — bounded above (~2 min A, ~3 min B)
  by the poll spacing; no decision depends on the precise number.

- **ADR-0010 §5 branch-independent decisions — SHIPPED (session
  2026-08-21, owner-directed "do what you believe is best")**. All four
  §5 items, chosen ahead of Branch B deliberately: they touch the exact
  ingestion surface Branch B builds on, so landing them first means the
  big change is not built on config about to move underneath it.

  - **§5.1 `onlyLatestVersions` pinned `false`.** Added to
    `TedSearchRequest` (`packages/ted/src/index.ts`) and set explicitly on
    the window search (`run-window.ts`). Previously implicit — the
    observed default already behaved this way (156 rows), but an upstream
    flip would have silently cost 11/156 (~7%) superseded versions and
    their history.
  - **§5.2 `fetch_retry_attempts_suspended` operator flag.** New constant
    (`packages/config`), fail-open reader `isFetchRetryAttemptsSuspended`
    (`scope.ts`, same shape as `isIngestionPaused`), drain wiring
    (`fetch-retry-drain.ts`), admin PUT validator case. While set: the
    drain pulls `FETCH_RETRY_SUSPENDED_CANARY_ROWS` (3) due rows instead
    of 25, and a render-pending cycle exhaustion leaves BOTH `attempts`
    and `next_attempt_at` untouched — the row stays due and is re-probed
    rather than pushed a day out by a failure that was never its own.
    `TedRequestError` still burns (per-notice evidence, outage or not).
    Bound 3 × `MAX_RENDER_VISITS` (6) = 18 requests/day, matching the
    ADR's estimate. `DrainFetchRetriesResult.attemptsSuspended` surfaces
    the posture. **This is what actually stops the abandonment clock** —
    the risk carried since ADR-0009 is now operator-actionable.
  - **§5.3 `OJ` added to `SEARCH_FIELDS`.** Cap re-checked: 4 × 250 =
    1,000 ≤ 10,000. `extractSearchRow` reads by key so the extra field is
    non-breaking. Branch B needs it to map a notice to its daily package.
  - **§5.4 render canary.** New `.github/workflows/ted-render-canary.yml`
    — 1 notice, daily 11:00 UTC (clear of the worker crons 05:00/06:30/
    09:00/:15 and the 03:00 nightly E2E), trigger + re-poll at +60s/+180s,
    telemetry-only: exits 0 always, writes a verdict to the job summary,
    raises `::notice` only on RECOVERY. A red run every day during a known
    outage is alarm fatigue, not signal.

  **§5.4 is deliberately partial and that is recorded in the ADR**: the
  canary shipped, the code-side demotion did NOT. `processOneNotice` still
  fetches notice XML through the render front-end because that is still
  the only implemented content path — removing it before Branch B exists
  would leave ingestion with no content channel at all. The switch belongs
  to Branch B.

  **Tests**: 4 new D1 tests (S-1..S-4 in `ingestion.d1.test.ts`) covering
  no-burn on render-pending, burn on `TedRequestError`, the canary-subset
  cap, and the flag-off default. Two failed on the first run and both were
  my test's fault, not the implementation's: (i) the D1 file is shared
  across the suite, so other suites' due retry rows competed for the
  3 canary slots — fixed by back-dating the tests' own rows 30 days so
  `next_attempt_at ASC` puts them first deterministically; (ii) HTTP 500 is
  a RETRYABLE status (`client.ts isRetryableStatus`), so the client spent
  the 30s test budget on real backoff sleeps — switched to 404, which
  raises `TedRequestError` immediately. `packages/config/src/env.test.ts`'s
  flag-registry guard also failed, correctly, and was updated — that test
  is doing its job.

  **Gates green**: format, lint, typecheck, tests (530 + 217 + 63, 3
  pre-existing skips), build. Docs updated: ADR-0010 §5 implementation
  record, `docs/ted-data-source.md` (the request shape ingestion actually
  sends), `docs/runbook.md` (operator procedure for the new flag +
  daily-review checklist), `docs/data-model.md` (its flag list was already
  stale by four keys — now points at `FEATURE_FLAG_KEYS` as the source of
  truth rather than drifting again).

  **Unverified**: the canary workflow has never executed — `workflow_dispatch`
  needs the workflow on the default branch first. To be dispatched once
  merged.

- **Pre-launch mode + countdown + containerized dev (session 2026-08-21
  evening, owner-directed)**: `prelaunch`/`launch_date` feature flags
  (packages/config; admin Flags UI picks them up automatically; validator
  cases in routes/admin.ts), environment-aware default (absent = closed on
  production only), server gates on sign-up (index.ts middleware before the
  Better Auth mount) and checkout (routes/billing.ts) both 403,
  GET /api/public-config (secret-free, 60s cache), prelaunch.ts +
  prelaunch.test.ts (8 tests). Web: lib/public-config.ts,
  components/LaunchCountdown.tsx (minute granularity, textual date, no
  negative counts), site-wide launch banner in MarketingLayout, signup
  closed-state card, Settings billing "Subscriptions open at launch" note.
  Containerized dev: Dockerfile.dev + docker-compose.yml (vite :5173 +
  wrangler :8787, local simulators, auto-generated fake .dev.vars) +
  .devcontainer/. Ops: .claude/skills/launch-mode + /launch-mode command
  (go-live = one admin flag flip, no deploy — HUMAN_DECISION_BLOCKERS item
  11). Gates green (68+17+9 files; worker 213 incl. new prelaunch tests);
  full Playwright E2E **45 passed / 3 skipped (pre-existing)**. Merged to
  main as **4448e09 (PR #69)** after CI green. Staging auto-deploy
  verified: /api/public-config `prelaunch:false` — registrations stay
  OPEN there (owner-directed). Production deploy dispatched on explicit
  owner instruction (run 32506382104, success) and verified live:
  /api/health/live 200, /api/public-config
  `{"prelaunch":true,"launchDate":"2026-08-31T21:00:00Z"}`, sign-up POST
  403 `signups_closed`, SPA shell 200 — production is CLOSED until the
  go-live flag flip (blocker item 11). Containerized dev verified
  end-to-end on the host: `docker compose build && up` → worker :8787
  health 200 + public-config `prelaunch:false` (local env open, correct)
  - vite :5173 200; stack shut down after. One post-merge fix needed:
    docker-dev.sh's install sentinel `[ ! -d node_modules ]` never fired
    (the empty compose named volume makes the dir exist), so wrangler was
    missing on first boot — replaced with a wrangler-resolvability probe
    from apps/worker.

- **FULL 2026-08-21 design-handoff implementation (UNCOMMITTED,
  session 2026-08-21, owner-directed)**: the owner exported "Bidmorrow
  repository connection-handoff.zip" and directed implementation of ALL of
  it. Owner decisions taken this session (supersede 2026-08-18 directives):
  (1) **dark + light theme** with a toggle, dark default, OS preference
  honoured when no stored choice — reverses "dark only"; (2) **self-hosted
  Archivo (400–700 var) + Source Code Pro (400–500 var)** from
  apps/web/public/fonts — reverses "system fonts only" (CSP font-src
  'self' already allowed it; the screens' Archivo won over the Theme
  Spec's older Newsreader/Plex trio, owner-confirmed).

  Landed, all surfaces:
  - **Theme layer v2** (styles.css head): Theme Spec §09 tokens
    (bg-_/line-_/ink-_/accent-_/sig-_/fit-_), full pre-v2 alias block per
    the §10 migration table (no selector broke), [data-theme='light'] +
    prefers-color-scheme mirror, glass/backdrop-filter removed (opaque
    stepped surfaces), glow shadows removed, @font-face for 10 self-hosted
    woff2 subsets. lib/theme.ts + components/ThemeToggle.tsx (localStorage
    `bm-theme`, storage/matchMedia sync); initTheme() in main.tsx;
    index.html dual theme-color metas.
  - **Marketing pages** (earlier same session): HowItWorks/Methodology/
    Pricing rebuilt to `BidMorrow Marketing.dc.html`.
  - **Homepage** rebuilt to `BidMorrow Homepage.dc.html`: hero grid bg,
    demo feed panel with timezone/locale geo picker (no network), facts,
    auto-advancing 4-step stepper + stage figures, truths, component
    split, tiers, coverage, pricing, FAQ, closing CTA. All bars are native
    <progress> (CSP); delays via nth-child.
  - **Cookie consent (GDPR)** per the homepage prototype: lib/consent.ts +
    components/CookieConsent.tsx (banner + preferences dialog + footer
    controls in MarketingLayout; keys bm_consent_categories/
    bm_analytics_consent; no pre-ticks; closing ≠ consent; withdraw
    supported). GA4 loading STUBBED — needs measurement ID + CSP
    allowlist, recorded as HUMAN_DECISION_BLOCKERS item 10.
  - **Auth** rebuilt to `BidMorrow Auth.dc.html`: AuthLayout split
    (routing-rules aside + form card, aside hidden <980px), all five
    pages restyled with subtitles, live pw-length hints, "Sent to" panel,
    neutral-reset note, missing-token CTA; logic/endpoints byte-identical.
    Prototype-only affordances (screen tabs, account simulator) not
    ported.
  - **Onboarding**: chrome restyled to `BidMorrow Onboarding.dc.html`
    (panel header + ThemeToggle, kicker-style progress line, pill rail,
    Archivo titles); 12-screen structure/API flow untouched (prototype's
    5-step condensation NOT adopted — would break the tested flow).
  - **Client area**: AppShell header (pill nav, ThemeToggle, avatar
    initials), TenderCard with score ring (SVG attrs, CSP-safe) + 3px fit
    gutter, ScoreBadge moved to the Theme Spec §04 fit ramp
    (solid/tint/outline/label-only; risk colors reserved for signals),
    glow text-shadow removed. Prototype-only features with no backend
    (pipeline kanban, saved searches, shelves, alerts bell, ⌘K palette,
    Bid/Maybe/Pass, CSV export) deliberately NOT built — product-truth.
  - **Admin**: AdminShell rebuilt to `BidMorrow Admin.dc.html` layout —
    header strip + sticky 216px left rail with left-mark active state
    (top-nav removed), ThemeToggle; all 10 section pages untouched.
  - Handoff bundle unzipped at repo root is gitignored + lint/prettier-
    ignored (`bidmorrow-repository-connection/`).

  Gates at session end, ALL GREEN: format, lint, typecheck, unit+contract
  tests (12 files / 110 web + full workspace suites), and the FULL
  Playwright E2E suite — **45 passed, 0 failed, 3 skipped
  (pre-existing)**. E2E findings fixed along the way: (a) light-mode axe
  color-contrast — light `--ink-3` #6b7480→#5f6875 (was 4.09:1 on the
  sunken footer; also cured a latent 4.45:1 on canvas that hit the
  onboarding axe gate) and light `--sig-caution` #a16207→#935906 (was
  4.31:1 on its tint at 11px); (b) two marketing.spec locators updated for
  strict mode (the redesigned pages legitimately repeat "Join the founding
  pilot" and "CPV fit"); (c) **pre-existing broken test repaired, NOT
  redesign fallout**: critical-path "keyword cap (51 -> 422)" used
  `#new-keyword` + `following-sibling::button[1]`, which resolves to zero
  elements ever since PR #58 (2026-08-19) wrapped the input in the
  Combobox's `.combobox__field` — E2E isn't in CI yet so nothing caught
  it; locator now targets the add-row's real "Add" button and the test
  passes in seconds. Visual QA (WebKit): auth dark+light, homepage
  dark+light, marketing pages — match the prototypes; zero horizontal
  overflow. Reviews COMPLETE (see
  "Reviewer sign-offs per phase"): security PASS; production-reviewer
  APPROVE after one remediation round (PR-001..PR-005 fixed same
  session). Merged to main as
  **a2a2f24 (PR #67)** after CI green (checks + secret-scan); staging
  auto-deploy succeeded and verified serving the new frontend (dual
  theme-color metas, /fonts 200); production deploy dispatched with the
  typed confirmation on explicit owner instruction and verified live on
  bidmorrow.com (new metas, fonts 200, /api/health/live ok, strict CSP
  header unchanged). Production ingestion remains PAUSED — go-live is
  still a separate deliberate owner step.

## Next (Phase 6 — Matching)

1. Deterministic engine in packages/matching per docs/matching-engine.md:
   hierarchical CPV gradient, capability/keyword matching (diacritic-fold,
   synonym groups), geography, value bands (ECB rates via exchange_rates),
   buyer/procedure/deadline/eligibility components; UNKNOWN=50% policy;
   hard exclusions (known values only); risk flags with evidence +
   confidence; ENGINE_VERSION stamped.
2. Scoring pipeline: post-ingestion enqueue → score (org × new/changed
   current-version lots, CPV-scope pre-filter), persist via
   insertTenderMatches (components only ≥ POSSIBLE_MATCH per spec).
3. Recompute path for corrected notices (TED-P5-03).
4. Unit tests per master spec list incl. worked example 84.5 as fixture;
   determinism property test; matching-audit skill + reviews.
5. Phase 5 residual LOWs (re-verification): direct D1 test for the
   XML_TOO_LARGE → ingestion_errors window-proceeds branch; unit test for
   the 50 KB boundIssuesForErrorDetail cap.

## Next (Phase 7)

0. Residual LOW from Phase 6 re-verify: route contract_nature/certification
   exclusion-value casts in scoring-input.ts through union validation
   (same pattern as parseSupportedContractNatures).

1. On-demand LOW_FIT explanation recompute in tender detail (docs/
   matching-engine.md §Component persistence promise): LOW_FIT matches only
   persist score+classification, not the component breakdown, so opening a
   LOW_FIT lot must recompute its explanation on demand (deterministic +
   versioned, per the engine contract) rather than reading stored rows that
   don't exist.
2. Methodology page: disclose the CPV pre-filter (docs/matching-engine.md
   "CPV pre-filter (scoring eligibility)") — the `[disclosed: methodology
page, Phase 7]` marker left in that doc section must be resolved by
   actual customer-facing copy before ship.
3. Onboarding: warn when an org's CPV preferences have zero overlap with the
   ingestion scope (docs/ted-ingestion-scope.md `DEFAULT_INGESTION_SCOPE`) —
   such an org would never see any matches (MATCH-P6-01 disposition).

## Architecture decisions

ADR-0001 Workers modular monolith / D1 / plain pnpm (no Turborepo).
ADR-0002 Better Auth 1.6.x + @better-auth/drizzle-adapter over D1;
org plugin for tenancy; nodejs_compat; rate-limit storage=database.
ADR-0003 Scoped ingestion (72*, 48*, 79417000 default) + deadline+90d
retention; widening = admin bounded backfill.
ADR-0004 Currency: EUR direct; ECB reference rates (≤7d old) for scoring
only; else UNKNOWN. Original values always displayed.
ADR-0005 Raw XML snapshots gzipped in private R2, 3-year lifecycle.
ADR-0006 Queues + Cron; Workflows rejected (per-step billing, no need).

## Dependencies added

Phase 2 (all per docs/dependency-versions.md pins): typescript ~5.9.2,
eslint 9 + typescript-eslint 8, prettier 3.6, vitest ^4.1, hono ^4.13,
wrangler ^4, @cloudflare/vitest-pool-workers ^0.21,
@cloudflare/workers-types ^5, react/react-dom ^19.2, vite ^8.2,
@vitejs/plugin-react ^6, zod ^4.4.3, drizzle-orm ~0.45.2 (declared, unused
until Phase 3), @playwright/test ^1.62. pnpm.onlyBuiltDependencies
[esbuild, workerd].

Phase 4 stage A: better-auth 1.6.29, @better-auth/drizzle-adapter 1.6.29
(packages/auth); @cloudflare/workers-types added as a devDependency to
packages/auth/notifications (needed for the `console`/`crypto` ambient
types once they compile packages/db/observability source directly).

Phase 4 stage B: @hono/zod-validator ^0.9.0, zod ^4.4.3 (apps/worker —
peer-compatible with hono ^4.13 and zod 4 per the installed package's
declared peerDependencies).

## Tests executed

Phase 2 final run (2026-08-14, all executed, all green): format:check PASS ·
lint PASS · typecheck PASS (14 projects) · test PASS (root vitest 15 files /
57 tests incl. new SEC-P2-01 hostile-getter test; worker pool-workers 1
file / 7 tests in workerd with real local D1) · build PASS (vite 17 modules;
wrangler deploy --dry-run) · db:migrate:local PASS (also verified from a
completely empty DB via fresh --persist-to dir by production-reviewer).

Phase 4 stage A final run (2026-08-14, all executed, all green):
format:check PASS · lint PASS · typecheck PASS (14/14 workspace projects) ·
test PASS (root vitest 17 files/66 tests; worker pool-workers 2 files/10
tests in workerd with real local D1, incl. new auth.test.ts; packages/db
pool-workers 8 files/38 tests in workerd with real local D1, incl. updated
migrations.d1.test.ts) — 114 tests total · build PASS (vite 17 modules;
wrangler deploy --dry-run, new APP_ENV/APP_BASE_URL/BETTER_AUTH_URL vars
listed in bindings output) · full migration chain (0001+0002+0003) verified
against a fresh scratch D1 and via `pnpm db:migrate:local`; drizzle-kit
generate afterward gives zero diff.

Phase 4 review fixes final run (2026-08-14, all executed, all green):
format:check PASS · lint PASS · typecheck PASS (14/14 workspace projects) ·
test PASS — root 17 files/66, worker 3 files/24 (workerd+D1), db 8 files/38
(workerd+D1) = 128 tests, zero skipped/deleted · build PASS (vite 17
modules; `wrangler deploy --dry-run` for both the top-level env and
`--env staging` list `env.API_RATE_LIMITER`, confirming SEC-P4-01).

## Known risks

- TED rate limits undocumented → self-imposed throttling; measure real
  behavior in Phase 5.
- Scoped-volume assumption (150–300/day) unmeasured → Phase 5 must measure
  before cost model is confirmed.
- match_components row growth is the D1 size driver → JSON-column fallback
  decision pre-recorded in data-model doc; revisit at 50 orgs.
- Imminent majors (Drizzle 1.0, Better Auth 1.7, Vitest 5, TS 7) — pinned
  to stables; watchlist in dependency-versions.md.
- Resend pricing figures unverified against resend.com (proxy-blocked);
  re-verify before Phase 8.
- eForms buyer resolution (OPT-300 indirection) is the trickiest parse path
  — needs real fixtures early in Phase 5.
- SEC-P4-05 (accepted): `POST /api/org`'s existence-check-then-insert is not
  atomic — two concurrent requests from the same user can both create an
  organization. Accepted for V1 (orphaned extra org, not a security issue);
  a partial unique index closing this race is scheduled with the next
  schema migration.
- SEC-P4-08 (accepted, must fix before Phase 8 ships): `packages/auth`'s
  `sendResetPassword`/`sendVerificationEmail` hooks call `sendEmail`
  fire-and-forget (`void`, not awaited) to avoid timing attacks. This is
  safe today because the only provider is the logging-only dev/test stub,
  but the Phase 8 Resend provider MUST route delivery through
  `ExecutionContext.waitUntil` (or a durable queue) — fire-and-forget on
  Workers can be torn down mid-flight and silently drop verification/reset
  emails.

## Human actions required

See HUMAN_DECISION_BLOCKERS.md (8 open items: Cloudflare account/token,
DNS + email auth records, Resend, Stripe, auth secret, admin allowlist,
business/legal info, GitHub branch protection). None block Phases 2–7.

## Security findings

None open. Threat model created (docs/threat-model.md) before architecture
finalization, per requirement.

## Cost changes

Baseline model established: ~$6/mo (0–10 customers), ~$26/mo (100),
~$30–105/mo (1,000) — see docs/cost-model.md. Within constraint.

## Deployment state

Nothing deployed. No Cloudflare resources exist yet.

## Reviewer sign-offs per phase

- 2026-08-21 handoff redesign (pre-go-live website/UI overhaul, full
  design bundle): **security PASS** — security agent, 2026-08-21.
  No Critical/High/Medium findings; web-only change surface confirmed
  (worker/packages/migrations/tests-security untouched); fonts verified
  genuine woff2, all same-origin, no CSP change needed; consent/theme
  storage defensively parsed, no HTML injection surface, GA4 genuinely
  stubbed; auth flows unchanged (neutral reset confirmation, unverified
  refusal, token handling intact); re-ran tests/security (11 passed),
  worker (205 passed), root suite (530 passed). Findings: LOW (client
  8-char password hint duplicates server policy constant — cosmetic),
  INFO (.gitignore newline — fixed same session).
- 2026-08-21 handoff redesign: **APPROVE** — production-reviewer,
  2026-08-21, after one remediation round. Initial verdict REJECT on
  PR-001 HIGH (homepage demo panel labeled "Live notices · scored this
  morning" over invented tenders naming real public bodies, with a
  fabricated citation — product-truth violation) + PR-002 MEDIUM
  (consent dialog claimed an unimplemented 6-month retention) + PR-003/
  004/005 LOW/INFO (present-tense GA4 copy; missing OFL license texts;
  .gitignore newline). All five remediated and re-verified in source:
  demo panel now explicitly illustrative with a visible disclaimer and
  anonymized buyers, citation removed; consent copy accurate; analytics
  note conditional; OFL texts shipped with the fonts. Post-remediation
  gates re-run by the reviewer: format/lint/typecheck/test/build all
  exit 0; full Playwright E2E **45 passed, 0 failed, 3 pre-existing
  skips**. Open findings: none.

- Phase 0: **PASS** — production-reviewer, 2026-08-14. Docs-only phase;
  gates honestly N/A (no code); completeness/consistency/truthfulness
  verified independently.
- Phase 1: **PASS** — production-reviewer, 2026-08-14. Findings:
  P1-001 MEDIUM (matching example not table-derivable) → FIXED (example
  recomputed table-exact, 84.5 with derivations; will become a test
  fixture in Phase 6). P1-002 LOW (blocker count) → FIXED. P1-003 LOW
  (.env.example caught by deny glob) → FIXED (globs narrowed to real
  secret variants). P1-004 INFO → no change needed (security agent body
  already restricts Bash to test/lint, security.md agent line 14).
  P1-005 INFO (scope+retention share ADR-0003) → accepted, no action.
- Phase 2: **PASS** — production-reviewer, 2026-08-14 (re-ran every gate
  independently; findings P2-001 MEDIUM resolved by security review below,
  P2-002/003 deferrals recorded, P2-004/005 handled — see Phase 2 notes).
  **Security agent SIGN-OFF**, 2026-08-14: CSP/headers, logger redaction,
  env schema, wrangler config, repo-wide greps all pass; SEC-P2-01 LOW
  (logger throw path) FIXED same day with regression test; SEC-P2-02/03
  INFO tracked as conventions for Phases 4/6 and deploy time.
- Phase 3: **PASS** — production-reviewer, 2026-08-14 (re-ran all gates:
  111 tests, fresh-empty-DB migration proof, drizzle zero-drift proof,
  0001 untouched verified via git history; P3-R-001 resolved by security
  sign-off below; P3-R-002 resolved by this ledger update; P3-R-003 INFO
  noted in Phase 3 section; P3-R-004 verified-correct idempotency
  handling, no action). **Security agent SIGN-OFF (tenant-isolation
  audit)**, 2026-08-14: grep audit + migration constraint audit + test
  audit all PASS. SEC-P3-01 MEDIUM (feedback matchId cross-tenant
  reference) FIXED same day (org-check + TenantMismatchError + regression
  test); SEC-P3-02 LOW FIXED (FK-enforcement sentinel test); SEC-P3-03
  INFO (future digest_items repo must scope through parent) and
  SEC-P3-04 INFO (endpoint-level isolation tests are a Phase 4 hard
  requirement) carried into Phase 4 plan.
- Phase 4: **PASS** — production-reviewer, 2026-08-14 (all gates re-run
  independently: 122 tests pre-fixes, fresh-empty-DB chain 0001–0003,
  drizzle zero-drift; findings P4-R-01 password-reset coverage → partial
  smoke test added, token roundtrip deferred to Phase 12 E2E; P4-R-02
  cf-connecting-ip keying → applied; P4-R-03 audit ordering → fixed).
  **Security agent SIGN-OFF**, 2026-08-14 (0 CRITICAL/HIGH): grep audit
  clean, org context strictly membership-derived, admin gate cloaked, no
  token logging. SEC-P4-01 (env rate-limit bindings), SEC-P4-02 (body
  limit), SEC-P4-03 (URL scheme) MEDIUMs FIXED same day; SEC-P4-04
  deletion ordering FIXED (audit-after-success + compensation); SEC-P4-05
  TOCTOU documented-accepted; SEC-P4-06 test gaps closed (4 tests);
  SEC-P4-07 admin auditing scheduled with Phase 10 tooling; SEC-P4-08
  email waitUntil requirement recorded for Phase 8; SEC-P4-09 threat-model
  deltas noted for next touch. Final post-fix gates: 128 tests green.
- Phase 5: **ted-data agent SIGN-OFF** (ingestion-audit skill, all 8 items
  PASS with evidence; TED-P5-01 live query validation → deployment gate;
  TED-P5-02 live fixtures pending network; TED-P5-03 recompute → Phase 6;
  TED-P5-04 watchdog is log-line + uptime monitor note). **Security agent
  SIGN-OFF** (0 CRITICAL/HIGH; XXE/SSRF/ReDoS/resource-exhaustion posture
  verified; SEC-P5-01/02 MEDIUMs + 03/04 LOWs FIXED same day).
  **production-reviewer**: initial FAIL on P5-R-01 HIGH (ledger unflushed)
  - P5-R-02 MEDIUM (paused-flag untested) → fixes applied →
    **re-verification PASS** (2026-08-14, commit 8c76c07, all fixes verified
    with evidence, 205 tests green). Residual LOWs (XML_TOO_LARGE branch D1
    test, 50 KB cap unit test) carried into Phase 6 next-list.

- Phase 6: **Matching audit** (matching-audit skill, all 8 items PASS with
  evidence; worked example hand-recomputed to 84.5; initial BLOCKED on
  format gate + MATCH-P6-01/02 dispositions). **Security agent SIGN-OFF**
  (0 CRITICAL/HIGH; ReDoS/tenant-isolation/ECB/bounds verified; SEC-P6-01
  MEDIUM continuation + 02/04 fixed). **production-reviewer re-verification
  PASS** (2026-08-15, commit d4c0518: all 9 fixes confirmed with evidence,
  362 tests green). Dispositions: CPV pre-filter accepted + documented with
  Phase 7 disclosure/warning follow-ups; multilingual keywords FIXED
  (matchable-language expansion); residual LOW (contract-nature/cert
  exclusion-value casts) carried to Phase 7.

- Phase 7: **Product agent: IN SCOPE / TRUTHFUL** (11 checks; PROD-P7-01
  founding-price commitment → documented in product-scope + terms).
  **Security agent: BLOCKED → SIGN-OFF after re-verification** (SEC-P7-01
  HIGH static-asset CSP/_headers FIXED + build-shape tests; 02 lint ban,
  03 cursor 400, 04 LIKE escaping, 05 https link guard all verified; no
  open findings; deploy-time CSP smoke test recorded as pre-production
  TODO). **production-reviewer: FAIL → PASS after re-verification**
  (P7-R-01 capability/cert editors + preset application FIXED; P7-R-02
  error surfacing FIXED; 03/04/06 fixed; P7-R-05 prerender accepted;
  digest pricing mention depends on Phase 8 shipping before launch).
  Final gates: 419 tests green (2026-08-15, commit 3231b4c + close-out).

- Phase 8: **Security agent SIGN-OFF** (email escaping/C2, secrets/C10,
  delivery integrity, tenant isolation, abuse bounds all PASS; SEC-P8-01
  LOW + 04 INFO fixed in batch; SEC-P8-02 at-least-once window accepted +
  documented). **production-reviewer: FAIL → PASS after re-verification**
  (P8-R-01 HIGH rich-content fix verified with strengthened tests;
  P8-R-02 all-member delivery verified; 03 CTA guard; residuals accepted).
  Final gates: 453 tests green (2026-08-15, commit dbf7857).

- Phase 9: **Security agent SIGN-OFF** (C9 webhook integrity, tenant
  guard, secrets, server-side entitlements, authz all PASS; SEC-P9-01/04
  comment/wording fixes applied same day; SEC-P9-02 webhook rate limit →
  WAF rule at deploy time and SEC-P9-03 concurrent-checkout double-customer
  edge → follow-ups recorded below). **production-reviewer PASS** (all
  gates re-run, 518 tests; P9-R-01 MEDIUM unknown-price-id silent-ack →
  FIXED same day (now throws → failed row + Stripe retry, routed through
  the tested failure path); P9-R-02 crypto-provider claim → FIXED
  (explicit SubtleCrypto default at verification call site)). Post-fix
  gates all green.

- Phase 10: **Security agent SIGN-OFF** (gate integrity, audit
  completeness, confirmations, suspension end-to-end, cross-tenant admin
  surface all PASS; SEC-P10-01 MEDIUM flag-PUT shape validation FIXED same
  day + tests; SEC-P10-02 LOW audit-on-error FIXED (try/finally);
  SEC-P10-03/04/05 tracked LOW/INFO). **production-reviewer FAIL → fixes
  applied** (P10-R-01 format gate fixed; P10-R-02 MEDIUM backfill now
  honors the ingestion pause at BOTH enqueue (409) and consumer (skip)
  layers + tests; P10-R-04 LOW tracked: admin rate limit + live PRAGMA
  verification at deploy). Post-fix gates all green: 566 tests
  (2026-08-15). P10-R-03 satisfied by the security SIGN-OFF above.

- Phase 11: **Comprehensive security audit SIGN-OFF** (all C1–C11
  verified against the full codebase with evidence; 0 CRITICAL/HIGH;
  SEC-P11-01/02 MEDIUMs FIXED same day; 03/04/05 fixed or documented;
  tracked deploy-time gaps reconfirmed). **production-reviewer PASS**
  (privacy commitments 1–6 all implemented+tested; purge table
  enumeration complete vs schema; P11-R-01/03 MEDIUMs FIXED; 02/04 fixed).
  **Re-verification PASS** (2026-08-15: all 11 fix items verified with
  evidence, 589 tests green, threat model T22 + 7 deltas consistent).
  Residual LOW/INFO items documented in code + ledger follow-ups.

## Pilot checkpoint

**REACHED (2026-08-15, post-Phase 8).** The product is functionally usable
for founding-pilot participants behind manual provisioning: signup/verify/
login, onboarding with presets, scoped TED ingestion, deterministic scored
feed + detail + save/ignore/feedback, and daily digests (pending the
Resend key — blocker 3 — and email DNS — blocker 2). Billing is not yet
live (Phase 9 next). The human may start pilot recruitment while Phases
9–13 proceed. Provisioning: create the account via normal signup; digest
requires RESEND_API_KEY + verified domain.

## Phase 9 follow-ups — ALL CLOSED 2026-08-16 (Phase 13 hardening, PR #26)

- ~~SEC-P9-02~~ CLOSED: in-worker IP rate limit on POST
  /api/webhooks/stripe, applied before signature verification (no zone
  WAF rule needed; see "Phase 13 progress").
- ~~SEC-P9-03~~ CLOSED: webhook catch-and-reconcile — duplicate
  subscription canceled via Stripe API, event acked 200, kept row
  untouched (see "Phase 13 progress").

## Deploy-time hardening follow-ups — ALL CLOSED 2026-08-16 (PR #26)

- ~~Pin GitHub Actions to commit SHAs~~ DONE: every `uses:` in
  `.github/workflows/*.yml` now carries a full commit SHA (tag as
  trailing comment); threat-model T21 updated.
- ~~SEC-P9-02 / SEC-P9-03~~ closed as above.

## Notes

- Tags `phase-0-complete` / `phase-1-complete` created locally; pushing tags
  returns HTTP 403 (session credentials are scoped to the working branch
  only). Phase completion is authoritatively recorded here and in commit
  history; re-push tags from an environment with tag permissions, or tag on
  merge to the default branch.
