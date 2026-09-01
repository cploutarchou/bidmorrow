# BidMorrow Design Upgrade

Date: 2026-09-01. Scope: the public website (marketing, legal and auth
entry pages) of bidmorrow.com. Business functionality was out of bounds
and untouched: URLs, page titles and descriptions, canonical and Open
Graph tags, the sitemap, forms, auth flows, the Paddle checkout entry,
analytics and consent behaviour, API calls, pricing copy, disclaimers
and attribution are byte-for-byte what they were (`lib/seo.test.ts` and
the marketing e2e specs still pass against the same strings).

Companion documents: `docs/design-audit.md` (findings and their
resolution), `docs/design-redesign-plan.md` (the eight phases),
`docs/design-dependencies.md` (nothing added), and
`docs/staging-design-validation.md` (staging evidence). Before/after
captures live under `artifacts/design-review/` (git-ignored; regenerated
by `scripts/design-screenshots.mjs`, and by the `design-review` workflow
against staging or production).

## Executive Summary

The site's typography, tokens and layout were already strong; what let it
down was the imagery and the motion. The hero was an abstract funnel that
said nothing about the product, the four "how it works" illustrations
were generic line art that contradicted the real numbers beside them, the
figures looped forever and failed the contrast audit mid-fade, and two
layout-shift bugs (a collapsing lazy-route fallback and a font swap that
reflowed every headline) put Pricing and How-it-works at a CLS of 0.706.

The upgrade replaces the hero with a miniature of BidMorrow doing its
job: a TED notice arrives, eight qualification components check in with
the points they earned, the score draws to n / 100, and the tender
settles into its published band, three tenders per 13.5 s loop. The same
primitives, standing still, replace the step illustrations, and the
share image is a still of the same scene. Motion is CSS only and
reduced-motion safe. Layout shift is gone (Home mobile 0.158 → 0.001,
Pricing 0.706 → 0), accessibility stays at 100, the JavaScript entry got
smaller, and no dependency was added.

## Pages Audited

Home, How it works, Methodology, Sample verdicts, Cybersecurity tenders,
Pricing, Pilot, Contact, Privacy, Terms, Refunds, Login, Signup, Forgot
password, Reset password, 404. Captured at 390 / 768 / 1440 in light and
dark before the work, and at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 /
1920 after it (the capture script also checks for horizontal overflow and
console errors on every page: none).

## Major Problems Found

Twenty-three findings, severity P0 to P3, in `docs/design-audit.md`. The
ones that mattered most:

1. Every lazily loaded page collapsed to a few pixels and then jumped
   (CLS 0.706 on Pricing and How-it-works). P0.
2. The hero art did not show the product. P1.
3. The font swap reflowed every headline (Home CLS 0.158). P1.
4. The consent banner covered the lower third of a phone screen. P1.
5. The scoring illustration showed invented weights next to the real
   breakdown, whose hand-typed points summed to 86.5 while the verdict
   step said 84. P1.
6. Vocabulary drift ("Strong fit" versus the product's "Strong match").
   P1.
7. Infinite figure loops failing the contrast audit mid-fade. P1.

## Visuals Replaced

| Was                                           | Now                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `FunnelHero.tsx` (abstract funnel, static)    | `DecisionEngine` (animated product miniature, three tenders, four bands)         |
| `StepSource.tsx` (document stack, line art)   | `SourceFrame` (real-shaped notice card on a stack, source line)                  |
| `StepProfile.tsx` (avatar tile + rules)       | `ProfileFrame` (profile rows: CPV, geography, value band, keyword, deadline)     |
| `StepScoring.tsx` (fake weights, "65")        | `ScoringFrame` (the engine panel: eight real components, 84 / 100, Strong match) |
| `StepVerdict.tsx` ("Strong fit" pill + bars)  | Verdict head naming its tender, `ScoreRing`, band chip, real flag                |
| `og-default.png` (funnel motif, "Strong fit") | Static frame of the decision engine, both brand faces, 77 kB                     |
| Two hand-drawn score-ring markups             | One `ScoreRing` component (static, engine and draw-once modes)                   |

Kept: the brand mark, favicons, the app's empty-state illustrations (out
of public scope), the CSS-only hero grid (now masked so it sits quietly
behind the copy), the pricing hold bars and the how-it-works figures
(now playing once).

## SVGs Created

- `ScoreRing`: track and value arcs with `pathLength="100"`, so the dash
  array is written in score points.
- Signal marks (matched, partial, missed, unknown) as inline 16×16 paths
  in `components/hero/primitives.tsx`.
- `og-default.svg` redrawn as the decision engine (source of the PNG).

No raster images were added; no external image URLs exist.

## Animations Added

- Hero decision-engine cycle (13.5 s, three scenes of 4.5 s): notice
  enters and nods, connector dot travels, engine panel lifts, eight rows
  check in 0.2 s apart, ring and counter draw together, band chip and
  bucket light, next tender. Pauses when scrolled out of view; static
  finished frame under reduced motion.
- Score rings draw once when their section reveals (demo cards, verdict
  step, scoring frame).
- How-it-works and pricing figures play once on reveal and rest.
- Micro-interactions, 120 to 250 ms: button lift and press, card and
  chip border transitions, step-button selection, footer link underline,
  FAQ chevron. Hover devices only for anything that moves; all off under
  `prefers-reduced-motion: reduce`.

## Components Created

`apps/web/src/components/hero/`: `DecisionEngine.tsx`, `primitives.tsx`
(`NoticeCard`, `PipelineConnector`, `SignalRow`, `VerdictBands`),
`ScoreRing.tsx`, `frames.tsx` (`SourceFrame`, `ProfileFrame`,
`ScoringFrame`), `decision-engine-data.ts` (weights, bands, tenders) with
`decision-engine-data.test.ts`. Styles in `styles/hero.css`.

Tooling: `scripts/design-screenshots.mjs`, `scripts/design-element-shot.mjs`,
`scripts/design-lighthouse.mjs`, `.github/workflows/design-review.yml`.

## Components Removed

`assets/FunnelHero.tsx`, `assets/steps/StepSource.tsx`,
`StepProfile.tsx`, `StepScoring.tsx`, `StepVerdict.tsx`; the
`STAGE_SCORE_BARS` and `ringDash` helpers in `Home.tsx`; the dead
`.mkt-hero-panel`, `.mkt-figure--scan`, `.hp-stage__scan/__bars/__chips`,
`.hp-sbar*`, `.hp-ring__track/__fill` and hero-panel scan rules and
keyframes.

## Dependencies Added

None, runtime or development. See `docs/design-dependencies.md` for the
native-API mapping and the bundle effect (JS entry 83.7 → 77.7 kB on
disk; CSS 76.6 → 86.6 kB on disk, +0.8 kB over the wire).

## Accessibility Improvements

- Figures no longer loop, so the axe contrast audit no longer catches
  chips mid-fade (How-it-works accessibility 96 → 100).
- The lazy-route fallback is a `main` landmark with the skip-link target,
  so keyboard users are never stranded during a chunk load.
- The hero is one `role="img"` whose label tells the story in a sentence;
  all inner text is layout. Reduced motion renders a finished frame.
- The FAQ is native `<details>`, keyboard-operable with focus rings intact.
- Micro-interactions are gated on `(hover: hover)` and
  `prefers-reduced-motion: no-preference`; focus styles untouched.
- The axe e2e spec now covers `/reset-password` in both states.

## Performance Improvements

- Lazy-route fallback reserves the viewport: Pricing / How-it-works CLS
  0.706 → 0.
- Metric-matched fallback faces (`size-adjust` and the override
  descriptors, computed from real glyph advances): Home CLS 0.158 → 0.001.
- Hero panel is `contain: layout paint` with a fixed-width counter; the
  loop is CSS, paused off-screen, and contributes no layout shift.
- JavaScript entry shrank by ~6 kB (SVG components removed).

## SEO Impact

None intended, none found: titles, descriptions, canonical, Open Graph
and Twitter tags, sitemap and robots behaviour are unchanged
(`lib/seo.test.ts`, `PageMeta`). The FAQ answers remain in the DOM inside
`<details>`. The Open Graph image keeps its path, dimensions and weight
budget, so existing share previews refresh to the new card without a URL
change. Local Lighthouse SEO reads 66 because the local stack serves
`noindex`; production is crawlable and re-checked by `site-health.yml`.

## Mobile Improvements

- Hero composition at 390 px: the same story in one column, 2×2 band
  grid, tighter type.
- Consent banner: compact two-column actions below 640 px; body reserves
  matching bottom padding; the sticky CTA already yields to it.
- Demo carousel: slides at 88% width so the next card peeks in.
- FAQ accordion removes ~1,400 px of phone scrolling.
- Validated at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920, light
  and dark: no horizontal overflow on any route.

## Staging Deployment

Pending: filled in after the PR merges and `deploy-staging.yml` runs;
evidence goes to `docs/staging-design-validation.md`.

## Production Deployment

Pending: only after every gate in the plan's Phase 8 holds and the owner's
deploy instruction stands (`deploy-production.yml`, typed confirmation).
Rollback: re-dispatch `deploy-production.yml` at the previous production
ref (recorded below once known).

## Lighthouse Results

Local stack, Lighthouse 12.8, mobile emulation unless noted. SEO is 66 on
the local stack (see above).

| Page             | Before (perf / a11y / CLS) | After (perf / a11y / CLS) |
| ---------------- | -------------------------- | ------------------------- |
| Home (mobile)    | 79 / 100 / 0.158           | see rerun below           |
| Home (desktop)   | 95 / 100 / 0.131           | 100 / 100 / 0.001         |
| Pricing (mobile) | 74 / 100 / 0.706           | 95 / 100 / 0              |
| How it works     | 72 / 96 / 0.706            | 90 / 100 / 0              |
| Sample verdicts  | not measured               | 81 / 100 / 0              |

Staging and production numbers are appended once the `design-review`
workflow has run against each.

## Remaining Recommendations

- Sample verdicts (mobile) sits at 81 with 430 ms of blocking time from
  rendering the generated verdict list; splitting or virtualising that
  list is the one page still short of the 90 target and is application
  work, not design.
- Local Lighthouse mobile numbers vary by ±8 points run to run on the
  sandbox; treat the staging workflow's numbers as the record.
- Contact and the auth pages were deliberately left as they are.
- Email templates (`packages/notifications`) were not touched, per the
  owner's instruction that the copy sweep applied to the website only.
