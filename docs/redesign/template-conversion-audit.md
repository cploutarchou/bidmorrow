# Template-conversion audit — what is done, what is pending (2026-08-22)

Two independent audits run 2026-08-22 against `main` (`08f81aa`), after the
owner supplied the Claude Design project export ("Bidmorrow repository
connection", last design-side sync 2026-08-20T11:26Z) on branch
`upload-template` (`4e9341b`, `Bidmorrow repository connection-handoff.zip`):

1. **Plan audit** — every acceptance item of `docs/website-redesign-plan.md`
   (M0–M4 + post-competitive scope lock) verified against code and ledger
   (7 auditors).
2. **Template delta** — every surface of the design export (Homepage,
   Marketing, Auth, Client Area, Onboarding, Admin, Theme Spec) compared
   feature-by-feature against `apps/web` (8 auditors).

Every claim below was verified by reading source, not by trusting doc/ledger
statements. Prototype-only scaffolding (account simulators, `.dc` runtime,
localStorage ops-state) was excluded from the comparison by instruction.

## Per-surface verdicts (template delta)

| Surface                                          | Verdict             | Decisive evidence                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage                                         | **FULLY CONVERTED** | Every prototype section/state/interaction present (hero + animated bg, geo-aware demo feed, stepper, methodology/pricing/FAQ sections, consent state machine). Two deliberate reverse deltas are product-truth compliance (example-verdict labelling, buyer anonymization).              |
| Marketing (how-it-works / methodology / pricing) | **FULLY CONVERTED** | Exact copy, all data-table values, all five animated figures with matching timings, both breakpoint collapses. Sole functional minor: no current-page indicator in the marketing nav.                                                                                                    |
| Auth                                             | **MOSTLY**          | All five screens + post-auth routing rule + refusal/neutral/expired states. Gaps are feedback polish: no reset-done confirmation, no "sent again" state, `noValidate` forms without pre-submit checks, silent ForgotPassword network failure.                                            |
| Theme Spec                                       | **MOSTLY**          | §09 tokens (both themes), §10 aliases, §02 surfaces, §04 fit/signal split, fonts all landed. Missing: §05 type-scale tokens entirely, parts of §06 buttons, §07 low-fit collapse/excluded rule text, §08 `prefers-contrast` line tokens; `--bg-overlay`/`--accent-hover/press` dead.     |
| Client Area                                      | **PARTIAL**         | What exists is faithful (AppShell, 6-tab feed, TenderCard score-ring geometry, settings, billing). **Absent entirely: Pipeline view, Insights view, detail slide-over sheet (5 tabs), feed left rail/saved searches, global search + ⌘K palette** — no routes, components, or endpoints. |
| Onboarding                                       | **PARTIAL**         | The pre-prototype 12-screen assistant remains (M1 work). The prototype's actual redesign is unimplemented: 5-step flow compression, **12-sector CPV picker (onboarding currently only fits IT companies)**, 30-day scope-estimate panel (needs a new API).                               |
| Admin                                            | **PARTIAL**         | Shell fully converted (rail, typed-confirmation literals, bounds). **Every page body is untouched pre-design HTML** — PR #67's admin diff touched only `AdminShell.tsx` + `styles.css`; no card grids/panel vocabulary/mono tables, no visible mutation feedback, no ops pills.          |

## Plan-audit verdicts (redesign plan M0–M4)

- **M1 onboarding overhaul — COMPLETE** (all 8 accept items verified;
  note this predates the design export's later onboarding redesign above).
- **M2 app restyle — MOSTLY**: missing `/app/billing/success` (Stripe
  `success_url` still targets `/app/settings?checkout=success`, which
  nothing reads — paying customers get no confirmation), no keyboard model
  on `role=tab` feed tabs, no 402/success e2e assertions.
- **M3 marketing — MOSTLY**: the policy-locked "final slice" was silently
  dropped across PRs #67–#70 — **sample-verdict demo (D9-extended)**,
  **`/cybersecurity-tenders` + `/cloud-tenders` category pages**, and the
  **unnamed comparison module** are all absent; Methodology lacks the
  rendered 84.5/100 worked example; FAQ is static divs, not
  `<details>/<summary>`; Home lacks the persona line and two trust items.
- **M0.2 SEO — NOT STARTED**: no robots.txt, no sitemap.xml, no OG/Twitter
  meta, no OG image, no noindex on app/admin shells. Launch-relevant.
- **M0.3 i18n/copy facade — NOT STARTED** (no `packages/i18n`; `copy.ts`
  verbatim guardrail statements imported by no component — documented,
  owner-directed drift via PR #67, but the facade intent is half-abandoned).
- **Plan-M4 hardening — NOT DONE** (the ledger renumbered "M4" into the
  Control Room re-skin, which hid this): **no route code splitting — one
  478 kB JS chunk vs the 150 kB budget, admin code ships to marketing
  visitors**; CSS 91 kB vs 25 kB; no Playwright mobile project; no
  visual-regression baselines; no zoom/reflow pass. Delivered elsewhere:
  touch targets, reduced-motion kill-switch, theme toggle (PR #67,
  reversing D5).
- **Owner-gated (HUMAN_DECISION_BLOCKERS)**: #10 GA4 ID + CSP, #11 go-live
  flip (launch_date 2026-08-31T21:00Z), #4 residue (Stripe live-mode
  webhook + Customer Portal never individually confirmed), #12 www DNS.

## Consolidated pending list

### Majors (template surfaces)

1. ~~Admin theme-v2 page bodies, all ten sections~~ — **DONE 2026-08-23.**
   Card grid, fact strips, panel vocabulary, mono ops tables, filter pills
   and a visible mutation flash across all 11 admin pages. Two deliberate
   departures from the export: its `div`-grid tables carry a per-section
   `grid-template-columns` as an inline `style` attribute, which this app's
   `style-src 'self'` CSP forbids, so real `<table>` elements are kept and
   restyled instead; and its arm→confirm strip is `position: sticky` off a
   single page-level `pending` state machine the app does not have, so the
   strip is styled in flow. The remaining admin minors below (ops pills
   wired to state, state-aware pause/resume, rail counts, ingestion
   sub-views, flag JSON hint) are unchanged.
2. ~~Client Area detail slide-over sheet~~ — **DONE 2026-08-23.** Opened
   from the feed, a tender now slides over it instead of navigating away.
   Deliberately NOT the prototype's state-only overlay: it is driven by the
   same `/app/tenders/:matchId` route via react-router's
   `backgroundLocation`, so the tender keeps one real linkable URL, Back
   closes the sheet, and a shared link or refresh still renders the full
   page. Both surfaces render one `TenderDetailContent`, so they cannot
   drift. Only the Summary and Score tabs exist — Requirements, Buyer and
   Activity are item 7 below and were not stubbed.
3. ~~Onboarding redesign~~ — **DONE 2026-08-23.**
   - **DONE — 12-sector CPV picker** (`apps/web/src/lib/cpv-sectors.ts`).
     Any company can now start from its own line of work, not just IT.
     Sector selection pre-fills CPV codes only: presets also carry keywords
     and capabilities written for IT consultancies, which would be worse
     than nothing for a catering company.
   - **DONE — 30-day scope estimate.** New `POST
/api/org/onboarding/scope-estimate` + `estimateScope` repository
     function, counting real lots over a real window using the same CPV
     **division** rule the scoring pre-filter applies. Country is reported
     separately, never folded into the headline, because geography is a
     scored component and not a gate.
   - **DONE 2026-08-23 — the 5-step flow compression.** Company · Starting
     point · Scope · Fit · Digest & review. The screen bodies are grouped,
     not rewritten, so every field's validation, dirty-tracking and resume
     behaviour carries over; what changed is navigation (one Continue per
     step, which saves that step's resources in order and stops at the first
     failure) and the progress model. The welcome splash is gone — the
     design has no such screen and each step now carries its own title and
     blurb. Skip is gone too: with several resources per step it had no
     single meaning, and leaving a field blank and continuing already does
     what it did.
   - Fixed on the way through: the client-side scope indicator reduced
     `79417000` to the division `79`, so it reported the whole of division
     79 as covered. Harmless while onboarding was IT-only; a false promise
     to exactly the business-services companies the sector picker is for.
4. Feed left rail · global search/⌘K palette — **RAIL DONE 2026-08-23.**
   New `saved_searches` table (migration 0010), org-scoped repository and
   `/api/org/saved-searches` CRUD, plus the rail itself: name the current
   filter set, re-apply it, delete it. Workspace-wide by design — a saved
   search is a team's view of the market, not a personal bookmark.
   Two blocks of the design were deliberately NOT built, because both would
   have meant inventing numbers: the per-search and per-shelf hit counts
   (nothing counts those today), and the "78% complete" profile meter (there
   is no completeness model). The rail's profile line states what the
   profile actually holds instead. **The ⌘K palette is still open** — see
   the note below on why most of its designed commands cannot be honest yet.
5. Pipeline (kanban) view — new backend domain.
6. Insights view — new analytics endpoints.
7. Detail tabs Requirements / Buyer intelligence / Activity+notes —
   **presuppose extraction, buyer-history, and team capabilities beyond
   the V1 TED-only backend; owner decision before any work.**

### Majors (plan)

8. M0.2 SEO artifact set (robots/sitemap/OG/noindex/OG image).
9. `/app/billing/success` (or consume `checkout=success`) — post-checkout
   confirmation for paying customers.
10. Route code splitting + budget compliance (admin out of customer
    bundle).
11. M3 final slice — **DONE 2026-08-23**: sample-verdict demo (PR #86),
    **`/cybersecurity-tenders`** (PR #87), and the honest unnamed
    **comparison module** on Home (`#compare`) — six attribute rows
    (price, billing, scoring, methodology, data source, tracking), each
    "typical" cell restating a finding from
    `docs/redesign/competitor-findings.md` (seven services captured
    2026-08-17), each BidMorrow cell linking to the page that keeps the
    claim true, the evidence basis stated to the reader under the table,
    and no competitor named (owner-gated, decision D11). Only
    `/cloud-tenders` is deferred: the cloud-CPV fetch returned hardware
    and licensing rather than hosting, and a category page whose sample
    verdicts are not really about the category is worse than no page.
    - `/cybersecurity-tenders`: hand-written methodology argument (there
      is no cybersecurity CPV — six real codes with their verbatim
      CPV 2008 labels show why code-watching fails both ways) plus two
      real engine-scored security notices, drawn from the shared
      sample-verdict set via a `surfaces` tag so the demo page keeps its
      policy-capped five. Not a directory: no inputs, no app links, one
      CTA — asserted by e2e.
    - `/cloud-tenders` is deliberately NOT built yet: the cloud-CPV
      fetch (run 32650923035) returned hardware and licensing, not
      hosting or managed infrastructure, and a category page whose
      sample verdicts are not really about the category is worse than no
      page. Owner concurred 2026-08-23. Waiting on a genuine anchor
      notice from a later fetch.
    - Building the page surfaced an engine defect, fixed as
      **ENGINE_VERSION 1 → 2** (owner-approved 2026-08-23): the buyer
      component knew 12 of the eForms `buyer-legal-type` codelist's 20
      codes and accepted two that do not exist. Details in
      docs/matching-engine.md §Buyer/sector and the ledger.
    - `/sample-verdicts`: four real TED-published notices scored by the
      production engine against two representative supplier profiles,
      spanning Strong match / Worth reviewing / Low fit / Excluded, each
      with its full component breakdown and a link to the notice on TED.
      Nothing on the page is hand-written except the one-line "why we
      chose this one", which is labelled as ours.
    - The data is generated, not authored
      (`packages/procurement/scripts/generate-sample-verdicts.ts` →
      `apps/web/src/lib/sample-verdicts.generated.ts`), and
      `tests/integration/sample-verdicts-committed.test.ts` fails if the
      committed file stops matching a fresh engine run — the failure mode
      that mattered was a page confidently showing numbers the engine no
      longer produces.
    - Four new fixtures under `tests/fixtures/ted/1.13/` (real German,
      Czech and Slovak notices, fetched via the `ted-fixture-fetch`
      workflow, which gained a CPV-prefix filter for the purpose). The
      sandbox cannot reach ted.europa.eu — the agent proxy denies the
      CONNECT — so the fetch has to run in CI.
    - The notice → `LotInput` mapping the demo needs is now a shared,
      tested module (`packages/procurement/src/notice-lot-input.ts`)
      rather than a lookalike written for the generator. The lookalike
      read the deadline off a property that does not exist and the country
      off a lot field `NormalizedLot` has never had, and the engine
      scored the wrong input without complaining: every sample verdict
      was understated by 15 geography points and reported "no deadline
      published".
    - No `WORTH_REVIEWING`-to-`STRONG_MATCH` tuning was done. The profiles
      were written once and the four scores are whatever came out.

### Minors (grouped)

- Theme foundation: `--t-*` type-scale tokens, `prefers-contrast` line
  tokens, three-rank buttons, `--accent-hover/press`, `--field-inner-lit`,
  `--bg-overlay`.
- Shared components: low-fit/excluded card states, ~~deadline urgency
  inks~~ (**DONE 2026-08-23** — thresholds read off the design's own Home
  demo-feed data, <7 days risk / <14 caution, supplementary to the deadline
  text), ~~visible status flash~~ (done for admin 2026-08-23; the customer
  app surfaces still route status text through `visually-hidden-status`),
  arm→confirm strip with consequence copy.
- ~~Auth polish: pre-submit validation, silent-failure fix, confirmation
  states. Marketing nav `aria-current`. Cookie-banner bottom padding.~~ —
  **DONE 2026-08-23.** ForgotPassword's network failure is now a visible
  "nothing was sent" error instead of an unhandled rejection (a non-2xx
  answer no longer shows the privacy confirmation either), the sent state
  offers "Send it again" with a re-send status, ResetPassword hands Login a
  reset-done confirmation via router state, and Login/Signup/Forgot run the
  checks their `noValidate` attributes imply before fetching. The nav marks
  the current page via `aria-current` (which also carries the styling), and
  an open consent banner gives the document bottom clearance so the
  footer's privacy link and cookie-preferences reopener stay reachable.
  Each fix is pinned by an e2e test.
- Feed/Settings: sort control + KPI row, ~~"why this score" expander~~
  (**DONE 2026-08-23** — a native `<details>` on the card revealing the
  engine's component explanation strings, which the feed payload already
  carried and the card never rendered),
  settings validation layer, timezone control, NUTS add, Appearance pane,
  unified save bar; danger zone deletes account not organisation
  (product decision).
- Admin: ops pills, state-aware pause/resume, rail counts, ingestion
  sub-views, flag JSON hint.
- Testing/a11y: ~~feed-tab keyboard model + keyboard spec~~ and
  ~~route-change focus management~~ — **DONE 2026-08-23.** The feed tablist
  now follows the WAI-ARIA tabs pattern (roving tabindex, Arrow/Home/End
  move and activate — the same model the detail sheet already used), and
  `components/RouteFocus.tsx` moves focus to `<main>` and resets scroll on
  every pathname change, with three deliberate exceptions documented in the
  file (initial load, search-only changes, and the slide-over sheet in both
  directions — `DetailSheet` owns focus there). Both are pinned by keyboard
  e2e tests. Still open: 402/success e2e assertions, mobile Playwright
  project, `toHaveScreenshot` baselines, zoom/reflow pass.
- Docs hygiene: font-budget reconciliation (181 KB shipped vs 90 KB
  written; per-visit latin ~57 KB is compliant via unicode-range — record
  the raised budget), stale Lucide note in dependency-versions.md, stale
  pre-v2 comments.

## Status — first four items implemented 2026-08-22, merged 2026-08-23

Merged to `main` as `068e8d9` (PR #79) with CI green. The merge was held for
~17 hours by an account-level GitHub Actions block: every run failed in 1–3
seconds with zero steps executed and no logs, including a re-dispatch of an
unchanged workflow that had succeeded earlier the same day, which ruled out
the branch and the workflow files. The owner cleared it on the billing side.

| Pending item                                                | Status                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0.2 SEO artifact set                                       | **DONE** — metadata + OG block, noindex, env-aware robots.txt, sitemap, generated share image                                                                                                                                                                                             |
| `/app/billing/success`                                      | **DONE** — polls billing status, three honest states, 7 tests on the retry logic                                                                                                                                                                                                          |
| Route code splitting                                        | **DONE** — marketing entry 478.00 kB → 58.28 kB first-party + 230.57 kB vendor; admin verified absent from the customer bundle                                                                                                                                                            |
| Theme foundation tokens                                     | **DONE (additive)** — `--t-*` scale, ghost button rank, `prefers-contrast` bug fixed                                                                                                                                                                                                      |
| CSS budget (91 kB vs 25 kB)                                 | **Split DONE 2026-08-23** — per-surface stylesheets; entry (base+marketing) 64.65 kB raw / 12.68 kB gzip; app 30.5, admin 6.9, auth 3.2 kB load only with their chunks. 25 kB raw still missed — the remainder is genuinely marketing CSS, and trimming it is content work, not splitting |
| Type-scale call-site migration                              | **Deferred** — only 2 of 215 declarations matched exactly, and the `font` shorthand resets weight                                                                                                                                                                                         |
| `--accent-hover/press`, `--field-inner-lit`, `--bg-overlay` | **Still unwired** — each moves pixels; belongs in a reviewed restyling PR                                                                                                                                                                                                                 |
| Admin page bodies (ten sections + org detail)               | **DONE 2026-08-23** — see the note under "Majors" below                                                                                                                                                                                                                                   |
| Detail slide-over sheet                                     | **DONE 2026-08-23** — route-driven, so the URL survives; Summary + Score tabs only                                                                                                                                                                                                        |
| CSS budget after the admin work                             | superseded by the split row above — the admin vocabulary now ships only in the admin chunk                                                                                                                                                                                                |

Everything else in the pending list below is untouched and still stands.

## Recommended implementation order

1. Theme foundation tokens (blocks all downstream restyling).
2. Shared components (blocks Client Area + Admin).
3. Independent small fixes (parallelizable).
4. Admin page bodies (cheapest major).
5. Detail-sheet overlay + settings layer.
6. Onboarding redesign (flow → sector picker → estimate API).
7. Feed enhancements needing new APIs (sort, saved searches, ⌘K, export).
8. Backend-heavy views: Pipeline, then Insights.
9. Owner-gated: GA4-after-consent; detail Requirements/Buyer/Activity
   tabs (V1-scope decision); M3 final slice priorities.

## Record-keeping contradictions found (fix with the next ledger flush)

- Ledger "M2 COMPLETE + MERGED" vs three verifiably absent M2 accept
  criteria (billing success route, keyboard model, e2e assertions).
- HUMAN_DECISION_BLOCKERS: item 7 declares the owner checklist EMPTY while
  item 4 still reads PARTIALLY PROVIDED (Stripe live-mode webhook +
  Portal unconfirmed).
- Ledger's "M4" ≠ plan's M4 (re-skin vs hardening) — plan-M4 never ran.
- Ledger promise "final slice … after the re-skin lands" (ledger:241-242)
  never closed or descoped; code contains neither.
- M3 merge (#42) and follow-ups (#43, 5dc8dc8) and the re-skin merge
  (09d186b) lack ledger PR records.
- Font budget exceeded without a recorded decision.
- dependency-versions.md Lucide note stale.
