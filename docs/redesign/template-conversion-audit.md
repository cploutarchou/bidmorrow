# Template-conversion audit — what is done, what is pending (2026-08-22)

Two independent audits run 2026-08-22 against `main` (`08f81aa`), after the
owner supplied the design project export ("Bidmorrow repository
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

1. Admin theme-v2 page bodies, all ten sections — styling only, cheapest
   major, internal audience.
2. Client Area detail slide-over sheet (replace full-page navigation;
   frontend-only for the existing Analysis content).
3. Onboarding redesign: 5-step flow restructure → 12-sector CPV picker
   (new sector reference data) → scope-estimate panel (new 30-day
   estimate API).
4. Feed left rail (needs saved-searches API) · global search/⌘K palette.
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
11. M3 final slice: sample-verdict demo, category pages, comparison
    module (all policy-locked IN scope).

### Minors (grouped)

- Theme foundation: `--t-*` type-scale tokens, `prefers-contrast` line
  tokens, three-rank buttons, `--accent-hover/press`, `--field-inner-lit`,
  `--bg-overlay`.
- Shared components: low-fit/excluded card states, deadline urgency inks,
  visible status flash, arm→confirm strip with consequence copy.
- Auth polish: pre-submit validation, silent-failure fix, confirmation
  states. Marketing nav `aria-current`. Cookie-banner bottom padding.
- Feed/Settings: sort control + KPI row, "why this score" expander,
  settings validation layer, timezone control, NUTS add, Appearance pane,
  unified save bar; danger zone deletes account not organisation
  (product decision).
- Admin: ops pills, state-aware pause/resume, rail counts, ingestion
  sub-views, flag JSON hint.
- Testing/a11y: feed-tab keyboard model + keyboard spec, 402/success e2e
  assertions, mobile Playwright project, `toHaveScreenshot` baselines,
  zoom/reflow pass, route-change focus management.
- Docs hygiene: font-budget reconciliation (181 KB shipped vs 90 KB
  written; per-visit latin ~57 KB is compliant via unicode-range — record
  the raised budget), stale Lucide note in dependency-versions.md, stale
  pre-v2 comments.

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
