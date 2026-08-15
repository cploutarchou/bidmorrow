# IMPLEMENTATION LEDGER

Source of truth for cross-session state. Update before every session end /
context compaction. Read first in every session.

## Current phase

**Phase 8 — Digest: implemented, review fixes applied.** Next: run
`production-reviewer` + `security` sign-off on the fixed state, then the
PILOT CHECKPOINT.

## Completed

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

- Nothing mid-flight. Working tree committed at each checkpoint.

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

## Pilot checkpoint

Not reached (after Phase 8).

## Notes

- Tags `phase-0-complete` / `phase-1-complete` created locally; pushing tags
  returns HTTP 403 (session credentials are scoped to the working branch
  only). Phase completion is authoritatively recorded here and in commit
  history; re-push tags from an environment with tag permissions, or tag on
  merge to the default branch.
