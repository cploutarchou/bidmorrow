# BidMorrow visual upgrade plan (2026-09-01)

Companion to `docs/design-audit.md` (the findings) and, at the end,
`docs/design-upgrade-report.md` (what shipped). Scope: the public website
(marketing + auth entry) served by `apps/web`. Nothing here changes URLs,
copy that carries SEO or product truth, forms, auth, analytics, API calls,
payment flows or metadata; every change has to buy at least one of trust,
clarity, conversion, product understanding, visual quality, usability,
accessibility, responsiveness or performance, and the audit row it closes
names which.

## Ground rules that bound the work

- **Identity stays.** Archivo + Source Code Pro, the teal accent
  (`--accent`), five opaque surface steps, hairline lines, the faint hero
  grid, light and dark themes as equals. No new colours; status colours stay
  muted and reserved for signal (risk/billing/system).
- **Product truth first.** Everything illustrative is labelled
  "Illustrative example, not live data"; buyers stay anonymised (house
  rule from the demo panel); scores are `n / 100` with the published
  bands (Strong match 80–100, Worth reviewing 65–79, Possible match 45–64,
  Low fit 0–44, Excluded); components and weights are the real eight
  (CPV fit 35, Capability & keyword fit 20, Geography 15, Contract value 10,
  Buyer & sector 5, Procedure & contract nature 5, Deadline runway 5,
  Eligibility & certifications 5). BidMorrow recommends where to spend
  investigation effort; it never says "win".
- **Copy rule:** no em dashes on the website (owner, 2026-09-01; guard test
  `apps/web/src/no-em-dash.test.ts`).
- **CSP-safe:** no inline `style=` or `<style>` (house convention), no
  CDN, self-hosted assets only. Motion is CSS keyframes/transitions driven
  by classes and custom properties set in stylesheets; JS only where a
  browser API is the right tool (IntersectionObserver, matchMedia).
- **Motion policy:** 120–250 ms for micro-interactions with `--ease`;
  workflow demonstrations may be longer; nothing loops fast; every
  animation has a `prefers-reduced-motion: reduce` static state that is a
  complete, fully visible composition (never a frozen mid-frame).
- **Dependencies:** none planned. Anything added is documented in
  `docs/design-dependencies.md` with bundle impact, licence, maintenance
  and the native alternative that was rejected.
- **Budgets:** Lighthouse mobile ≥ 90 / 95 / 95 / 95 on the local stack;
  LCP < 2.5 s, CLS < 0.1, INP < 200 ms; marketing CSS and JS stay inside
  the budgets recorded in `docs/performance.md` and the audit.

## Baseline (local stack, Lighthouse 12.8, mobile emulation, 2026-09-01)

| Page         | Perf | A11y | BP  | SEO\* | LCP   | CLS       | Shift culprit                                  |
| ------------ | ---- | ---- | --- | ----- | ----- | --------- | ---------------------------------------------- |
| Home         | 79   | 100  | 100 | 66    | 2.6 s | **0.158** | `.hp-hero__frame` (font swap reflows the copy) |
| Home desktop | 95   | 100  | 100 | 66    | 0.6 s | **0.131** | same                                           |
| Pricing      | 74   | 100  | 100 | 66    | 2.1 s | **0.706** | `<footer>` jumps when the lazy route arrives   |
| How it works | 72   | 96   | 100 | 66    | 2.4 s | **0.706** | same, plus a `.mkt-fig-chip` contrast failure  |

\* SEO 66 is the local stack's `noindex` (`APP_ENV=local`); production is
crawlable and is re-checked by `site-health.yml`.

Every page also pays ~300–500 ms for the render-blocking `index-*.css`
(15 kB over the wire). Bundle: vendor 245 kB, entry 84 kB, marketing CSS
77 kB raw.

## Phases

### Phase 1 — Critical visual and stability fixes (P0/P1, no design risk)

1. **Lazy-route CLS (0.706 → ≈0).** The Suspense fallback for lazy pages is
   a few lines tall, so the footer paints in the viewport and then jumps
   when the chunk renders. Reserve the viewport: the route fallback gets
   `min-height: 100dvh` (only shifts outside the viewport are free), and
   marketing chunks get `<link rel="modulepreload">` hints from the entry
   on link hover/visibility (`lib/prefetch-route.ts`) so navigation never
   waits on a chunk. Direct loads keep their one chunk fetch; the fallback
   just stops moving things.
2. **Font-swap CLS (0.158 → ≈0).** Add metric-matched fallback faces for
   Archivo and Source Code Pro (`size-adjust`, `ascent-override`,
   `descent-override`, `line-gap-override` over Arial/Courier New) so the
   swap keeps line boxes the same height. Measured, not guessed: the
   overrides are computed from the fonts' own metrics.
3. **Contrast failure** on `.mkt-fig-chip` (How it works) fixed with the
   existing `--accent-text` / tint pairing that already clears AA elsewhere.
4. **Consent banner on mobile.** It hides the hero's price note and the
   first CTA on a 390 px screen. Keep the legal behaviour (no pre-ticks,
   closing is not consent) and reduce its footprint on small screens:
   two-line copy, buttons in one row, and the sticky hero CTA yields to it.

### Phase 2 — Hero: the decision engine

Replace `FunnelHero` (abstract chips falling through a lens into three
count cards) with `DecisionEngine`, a miniature of the product working:

```
TED · OJ S            three queued notice chips (never empty)
        ↓
┌ Notice ─────────────────────────────┐   IllustrativeTender 1 of 3
│ National health ministry · CY       │
│ Cloud migration + managed hosting   │
│ €1.84M · closes in 6 days           │
└─────────────────────────────────────┘
        ↓ connector
┌ BidMorrow qualification ────────────┐
│ CPV fit                   ✓  32/35  │   rows check in one by one
│ Capability & keyword fit  ✓  18/20  │
│ Geography                 ✓  14/15  │
│ Contract value            ✓   9/10  │
│ Eligibility & certs.      △   2/5   │   caution keeps its wording
│ ───────────────────────────────────  │
│ Score  ◔ 84 / 100                   │   ring draws, number counts up
└─────────────────────────────────────┘
        ↓
[ Strong match 84 ] [ Worth reviewing ] [ Possible match ] [ Low fit ]
        ▲ the card settles into its band; the next notice queues up
```

- **Three illustrative tenders** (typed data in
  `components/hero/decision-engine-data.ts`, anonymised buyers, real
  component names and weights, points that sum to the score, bands per
  the published table): a Strong match (84), a Worth reviewing (71, with a
  deadline caution), and a Low fit (38, geography and CPV misses). The
  third outcome matters: the product's value is what it tells you to skip.
- **Animation (≈ 13.5 s loop, 4.5 s per tender):** card enters 400 ms →
  five signal rows check in at 250 ms intervals → score ring draws and the
  number counts up 600 ms → verdict chip appears and the card slides into
  its band 500 ms → hold 1.2 s → next tender. One CSS timeline: every
  element animates on the shared 13.5 s cycle with delays composed from
  `--scene-start` (per tender, set by a scene class) and `--row` (per
  signal row, set by `:nth-child`). No JS timers, no `useEffect`, nothing
  to leak; the browser pauses it in background tabs. The count-up uses a
  registered custom property (`@property --de-score`) with a static
  number as the no-support fallback.
- **Reduced motion:** the whole visual renders tender 1's final frame
  (card, five checked rows, 84 / 100, Strong match highlighted) and never
  moves. Off-screen the animation is paused via one IntersectionObserver
  (the existing `use-reveal` pattern), so it costs nothing while scrolled
  past.
- **Markup:** HTML + small inline SVGs (ring, ticks, connectors) rather
  than one big SVG, so text renders as text (crisp at every DPR, theme
  tokens apply directly, no viewBox font scaling). The visual is
  `role="img"` with a full-sentence label; inner text is presentational.
  Captions keep "Illustrative example, not live data".
- **Primitives** (`components/hero/`): `NoticeCard`, `SignalRow`,
  `ScoreRing`, `VerdictBand`, `PipelineConnector`; each takes typed props
  and no inline styles. `ScoreRing` is reused later for the demo panel
  ring (`hp-ring`) so the site has one ring.
- **Composition:** desktop (≥ 60 rem) two-column hero with the art column
  widened from 25 rem to 30 rem, the engine panel as an opaque product
  surface (`--bg-panel`, hairline, `--shadow-panel`) instead of the
  gradient frame; 390 px: the queue collapses to a single line, the engine
  shows four rows, the bands become a two-by-two grid, total height ≈ 420
  px, same timeline.
- **Grid background:** keep; add a radial mask so the grid fades behind
  the copy and is strongest behind the engine; dots stay, one fewer.

### Phase 3 — Site-wide imagery

- The four "How it works" step illustrations become small product frames
  in the same DOM style as the hero (source document with real TED
  fields, profile chips, score breakdown, verdict card) so step art and
  hero share one language. `StepVerdict`'s placeholder bars become the
  real three-line explanation shape.
- OG image regenerated from the new hero composition
  (`scripts/generate-og-image.mjs` already exists; re-run, same size and
  weight budget).
- Empty-state illustrations (app) are out of the public scope and stay.
- Raster inventory: 7 files, all brand or OG assets; nothing to remove.
  `brand-mark-512.png` (82 kB) is only referenced by Paddle/email and stays
  out of the page load.

### Phase 4 — Motion and micro-interactions

- Buttons: `translateY(-1px)` on hover with the existing 160 ms ease,
  press state `translateY(0)`; focus ring unchanged.
- Cards (`hp-card`, pricing plans, truth cards, tier cards): outline/shadow
  transition on hover, 180 ms; no lift on touch.
- Geo chips and step buttons: selection state animates the underline/fill
  (150 ms) instead of snapping.
- Ring draw + number count-up shared with the hero; demo panel rings draw
  once on reveal.
- Route transitions: keep the existing View Transitions cross-fade.
- Everything above is `@media (prefers-reduced-motion: no-preference)`
  only.

### Phase 5 — Mobile refinement

- Hero composition at 390 px (above); sticky CTA and consent banner
  arbitration; the demo panel carousel keeps its dots but gains edge
  fades; section spacing tightened where a 390 px page runs to 13,000 px.
- Validate 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 with
  `scripts/design-screenshots.mjs` (overflow check built in).

### Phase 6 — Performance and accessibility

- Re-run Lighthouse on the local stack for Home, Pricing, How it works,
  Sample verdicts; targets above. Keep `tests/e2e/accessibility.spec.ts`
  (axe) green and extend its route list to `/reset-password`.
- Bundle: marketing entry stays ≤ the current 84 kB; the hero adds
  ≤ 6 kB of JS and ≤ 8 kB of CSS.

### Phase 7 — Staging validation

Merge via PR → `deploy-staging.yml` (auto on `main`). The sandbox cannot
reach `staging.bidmorrow.com`, so validation runs where it can: a
workflow (`design-review.yml`, `workflow_dispatch`) that runs
`scripts/design-screenshots.mjs` and Lighthouse against staging on a
GitHub runner and uploads the PNGs and reports as artifacts, plus
`site-health.yml` for status codes, headers and SEO artifacts. Results go
in `docs/staging-design-validation.md`.

### Phase 8 — Production

Gate (all must hold): build + tests green; no console errors in the
screenshot runs; no broken links or images; staging screenshots reviewed
at 390/768/1440 in both themes; payments, forms, analytics, auth entry
untouched by the diff (they are; the diff is `apps/web` UI + CSS); SEO
metadata unchanged (`lib/seo.test.ts`); performance and accessibility at
or above baseline. Then `deploy-production.yml` with the typed
confirmation, and `site-health.yml` + the design-review workflow against
production. Rollback: the previous production run's commit is recorded
in `docs/design-upgrade-report.md`; a rollback is a re-dispatch of
`deploy-production.yml` at that ref.

## Working method per section

audit → design → implement → test (unit/e2e as fits) → visual verify
(screenshots) → performance verify (Lighthouse where it matters) → commit,
one logical commit per section (`design:`, `perf:`, `a11y:` prefixes).
