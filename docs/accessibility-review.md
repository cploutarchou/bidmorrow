# Accessibility Review — Phase 12 (2026-08-16)

Status of BidMorrow's accessibility verification: what was checked, how,
what was found, and — honestly — what was NOT checked.

## What was checked (automated, repeatable)

All checks below run in `pnpm test:e2e` against the real app (built SPA +
`wrangler dev` Worker, seeded demo data) and are green as of this review.

### axe-core scans — `tests/e2e/accessibility.spec.ts`

`@axe-core/playwright` full-page scans asserting **zero `serious` or
`critical` impact violations, with no rule exclusions**, on 9 pages:

| Page                    | State scanned                               |
| ----------------------- | ------------------------------------------- |
| `/` (home)              | unauthenticated                             |
| `/methodology`          | unauthenticated                             |
| `/pricing`              | unauthenticated                             |
| `/login`                | unauthenticated                             |
| `/signup`               | unauthenticated                             |
| `/onboarding` step 1    | fresh account, empty wizard — as first seen |
| `/app` (feed)           | onboarded org with real scored matches      |
| `/app/tenders/:matchId` | full detail: score breakdown, risk flags    |
| `/app/settings`         | all sections loaded                         |

Result: **0 serious/critical violations** on all 9 pages.
(`moderate`/`minor`-impact findings are not gated; re-run the spec and drop
the impact filter in `seriousOrCriticalViolations` to enumerate them.)

### Keyboard traversal — `tests/e2e/keyboard.spec.ts`

Scripted real-Tab-key traversal (never programmatic `.focus()` — the app
styles focus via `:focus-visible`, which only keyboard-driven focus
triggers):

- Login form: tabbing reaches email → password → submit in order; each
  shows a visible focus style (computed outline, or a box-shadow that
  appears on focus — a constant decorative shadow does not count).
- Feed card and tender detail: the Save action is keyboard-reachable,
  shows visible focus, and toggles via Enter (verified through
  `aria-pressed` in both directions).

### Structural affordances verified elsewhere in the E2E suite

- Skip link ("Skip to main content") present on every page (appears in
  every scanned page snapshot; `styles.css` `.skip-link:focus`).
- Feed tabs are real `role=tab` in a `tablist`; save/ignore are buttons
  with `aria-pressed` state; error/status messages render in
  `role=alert`/`role=status` regions (asserted implicitly by the
  critical-path spec's `getByRole` queries, which fail if roles regress).

## What was NOT checked (honest scope statement)

- **No screen-reader testing** (NVDA/JAWS/VoiceOver). Automated scans catch
  roughly 30–40% of WCAG issues; reading order, announcement quality, and
  live-region behavior under a real screen reader are unverified.
- **No manual zoom/reflow testing** (WCAG 1.4.4/1.4.10 — 200% zoom,
  320px-wide reflow).
- **No color-contrast verification beyond axe's automated checks** (axe
  checks computed contrast where it can; gradients/images are not covered).
- **Onboarding steps 2–10, admin pages, and email templates** were not
  axe-scanned (only step 1 of the wizard is covered; the digest email HTML
  has its own escaping tests but no accessibility scan).
- **No cognitive/plain-language review.**
- Scans reflect the **chromium desktop viewport only** — no mobile
  viewport or touch-target-size checks.

## Recommendation

Automated gates are in place and green; before marketing an accessibility
conformance claim (e.g. WCAG 2.1 AA), commission a manual audit covering
the gaps above. Until then, do not claim conformance — the marketing pages
currently make no such claim (verified: no conformance statement in
`apps/web/src/pages/marketing`).
