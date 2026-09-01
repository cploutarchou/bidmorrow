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
smaller, and no dependency was added. It shipped to production on
2026-09-01 at 23:02 UTC (`Deploy production` run 21) after the staging
gate; the live verification and the production Lighthouse numbers are
in the sections below.

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

- Hero decision-engine loop (13.5 s, three scenes of 4.5 s): notice
  enters and nods, connector dot travels, engine panel lifts, eight rows
  check in 0.2 s apart, ring and counter draw together, band chip and
  bucket light, next tender. One scene is in the render tree at a time;
  every element runs a short one-shot animation at a delay into the
  scene, and the scene's own 4.5 s animation ending is what hands over to
  the next (one `animationend` listener, no timers). Pauses when scrolled
  out of view; static finished frame under reduced motion.
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
- Hero entrances never leave text at partial opacity: notice and band
  chip wipe in, the engine panel rises and lights its border, rows slide
  in while only the check-in mark fades, the band lights with a step.
  Staging Lighthouse had caught the 35% rows mid-entrance; timed axe
  passes now show zero contrast violations at any point in the loop.
- The axe e2e spec now covers `/reset-password` in both states.

## Performance Improvements

- Lazy-route fallback reserves the viewport: Pricing / How-it-works CLS
  0.706 → 0.
- Metric-matched fallback faces (`size-adjust` and the override
  descriptors, computed from real glyph advances): Home CLS 0.158 → 0.001.
- Hero panel is `contain: layout paint` with a size-contained counter and
  ring; the loop is CSS, paused off-screen, and contributes no layout
  shift.
- The loop's main-thread cost was measured with CDP `Performance`
  metrics at 4× CPU throttling over 6 s windows: the first version kept
  39 infinite animations ticking (three quarters of them in hidden
  scenes) and cost about 2.1 s of main-thread time per 6 s; the shipped
  version (hidden scenes out of the render tree, short delayed one-shots
  that finish and stop ticking) costs about 0.6 s per 6 s, most of it the
  0.7 s count-up. The ambient grid dots no longer pulse for the same
  reason (four infinite loops that were never noticed).
- JavaScript entry shrank by ~5 kB (SVG components removed).

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
- FAQ accordion removes ~1,400 px of phone scrolling. Home at 390 px
  measures 13,116 px against 13,417 px before: the accordion's saving is
  partly spent on the hero (the engine panel is taller than the funnel
  sketch it replaces) and the product frames in the stepper. The other
  pages are within 60 px of their previous height.
- Validated at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920, light
  and dark: no horizontal overflow on any route.

## Staging Deployment

PR #134 squash-merged to `main` as `adad0c2` on 2026-09-01 at 21:38 UTC
after CI passed; `Deploy staging` run 124 (33562159261) deployed it in one
minute with smoke tests green, and the docs-only #131 merge redeployed the
identical build as run 125 at 22:06 UTC. Evidence and results are in
`docs/staging-design-validation.md`: `site-health` run 7 (health 200 and
not stale, security headers unchanged, staging `noindex`, production
crawlable, new share image served), `design-review` run 3 (84 full-page
captures at 390/768/1440 in both themes, no console errors, no
horizontal overflow) and its Lighthouse table (accessibility 100 on four
of five pairs, CLS 0 or 0.001 everywhere, performance 84 to 100).

## Production Deployment

Gate (the brief's list, each with its evidence):

| Gate                      | Evidence                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build passes              | CI checks job on the PR head and on `main` (web build + `verify:build`)                                                                                                                              |
| Tests pass                | vitest across the workspace, D1 and worker suites in CI; Playwright marketing, accessibility, keyboard: 41 passed locally                                                                            |
| No major console errors   | 84 staging captures (run 3) and 28 after the accessibility fix (run 5): none; the only console messages are the CSP-blocked Cloudflare beacon, pre-existing, recorded                                |
| No broken links or images | Every route rendered with no failed resource loads (a failed load logs a console error); marketing e2e follows the nav                                                                               |
| Staging verified          | `docs/staging-design-validation.md`                                                                                                                                                                  |
| Responsive verified       | 390 / 768 / 1440 on staging, 375 to 1920 locally, no overflow anywhere                                                                                                                               |
| Payments unaffected       | Diff touches `apps/web` marketing UI, CSS, docs, scripts, one workflow; `packages/billing` and the checkout entry untouched                                                                          |
| Forms unaffected          | Auth and contact forms untouched; reset-password axe scan added                                                                                                                                      |
| Analytics unaffected      | Consent and analytics code untouched (`components/CookieConsent.tsx`, `lib/analytics`)                                                                                                               |
| Authentication unaffected | Auth pages and API untouched; keyboard and marketing e2e green                                                                                                                                       |
| SEO metadata unaffected   | `lib/seo.test.ts` unchanged and green; site-health shows robots, sitemap, canonical behaviour unchanged                                                                                              |
| Performance acceptable    | CLS 0.158/0.706 → 0.001/0; staging Lighthouse 87 to 100 on the run of record (run 5)                                                                                                                 |
| Accessibility acceptable  | axe green locally on every public route; staging Lighthouse 100 on all five pairs after the hero entrance fix (run 5; the 96 in runs 3 and 4 was axe sampling text mid-fade, see the validation doc) |

Deploy: `deploy-production.yml` dispatched on `main` `7e13eea` with the
typed confirmation, on the owner's instruction once the gate held.
`Deploy production` run 21 (33569044580) ran from 23:01:04 to 23:02:20
UTC on 2026-09-01 with every step green: queues, R2 bucket and D1
ensured (idempotent), D1 Time Travel bookmark captured, migrations
applied (nothing new), foreign-key enforcement verified, web SPA built,
Worker deployed, runtime secrets pushed, smoke tests passed
(`/api/health/live` and `/api/health/ready` 200, CSP header present,
e2e test hooks 404, production `robots.txt` body with the sitemap line
and no blanket disallow, `sitemap.xml` served).

Live verification: `site-health` run 8 (33569323675, 23:04 UTC, from a
GitHub runner) shows `https://bidmorrow.com/` 200 with the security
headers unchanged (CSP with the Paddle allowances, HSTS with preload,
`nosniff`, `X-Frame-Options: DENY`, permissions policy), health live and
ready 200 with `db: ok` and `stale: false` (last successful ingestion
22:43 UTC), `www` 301 to the apex, the production `robots.txt` body
under Cloudflare's managed block, `sitemap.xml` 200, `X-Robots-Tag`
absent on production and `noindex, nofollow` on staging, and the new
77,109-byte share image served from production.

Visual verification on production: `design-review` run 6 (33569309061,
23:04 to 23:13 UTC against `https://bidmorrow.com`): 64 captures (every
public route full-page at 390 and 1440 in light and dark, plus the Home
hero and consent-banner frames), no console errors, no horizontal
overflow; the 112 CSP-blocked Cloudflare beacon messages are the
pre-existing zone injection, reported separately. The hero frames at
both widths and in both themes render the deployed decision engine as
they did on staging (notice card, engine panel with the eight rows
checked in, band row, the "illustrative example, not live data" label).
The captures are on the run's `design-review-production` artifact (30
days) and were also pushed to a scratch branch for review, deleted
afterwards.

Rollback (decided before deploying): the upgrade carries no migration, so
rollback is code only. First choice is the Cloudflare Workers deployment
rollback to the previous version (the 19:55 UTC deploy of `3c08100`,
`Deploy production` run 20) from the dashboard or `wrangler rollback`
with production credentials; the alternative is `git revert` of the
squash commit on `main` and a re-dispatch of `deploy-production.yml`.
`docs/deployment.md` "Rollback strategy" is the procedure of record.

## Lighthouse Results

Local stack (`wrangler dev`), Lighthouse 12.8, mobile emulation with
simulated throttling unless noted. SEO reads 66 on the local stack
because it serves `noindex`; production is crawlable. Local mobile
performance varies by about ±8 points between runs on the sandbox
(five runs of Home ranged 84–94); the staging and production rows come
from the `design-review` workflow and are the record.

| Page                     | Before (perf / a11y / LCP / CLS / TBT) | After (perf / a11y / LCP / CLS / TBT) |
| ------------------------ | -------------------------------------- | ------------------------------------- |
| Home (mobile)            | 79 / 100 / 2.6 s / 0.158 / 360 ms      | 87 / 100 / 2.5 s / 0.001 / 310 ms     |
| Home (desktop)           | 95 / 100 / 0.6 s / 0.131 / 60 ms       | 100 / 100 / 0.5 s / 0.001 / 0 ms      |
| Pricing (mobile)         | 74 / 100 / 2.1 s / 0.706 / 10 ms       | 96 / 100 / 2.1 s / 0 / 120 ms         |
| How it works (mobile)    | 72 / 96 / 2.4 s / 0.706 / 20 ms        | 91 / 100 / 3.0 s / 0 / 130 ms         |
| Sample verdicts (mobile) | not measured                           | 89 / 100 / 2.9 s / 0 / 210 ms         |

Best practices is 100 on every page before and after on the local stack.

Staging, `design-review` run 5 (33568475343, 2026-09-01 22:53 to 23:00
UTC, after the accessibility fix, real network from a GitHub runner):

| Page                     | Perf | A11y | BP  | SEO | LCP   | CLS   | TBT    |
| ------------------------ | ---- | ---- | --- | --- | ----- | ----- | ------ |
| Home (mobile)            | 87   | 100  | 93  | 58  | 2.6 s | 0.001 | 300 ms |
| Home (desktop)           | 100  | 100  | 93  | 58  | 0.6 s | 0.001 | 0 ms   |
| Pricing (mobile)         | 97   | 100  | 93  | 58  | 2.2 s | 0     | 30 ms  |
| How it works (mobile)    | 92   | 100  | 93  | 58  | 3.1 s | 0     | 30 ms  |
| Sample verdicts (mobile) | 91   | 100  | 93  | 58  | 3.0 s | 0     | 120 ms |

SEO 58 on staging is its own `noindex` (by design); best practices 93
everywhere is the console-error audit catching the CSP-blocked
Cloudflare Web Analytics beacon (pre-existing, owner decision recorded
in `HUMAN_DECISION_BLOCKERS.md`).

Production, `design-review` run 6 (33569309061, 2026-09-01 23:11 to
23:13 UTC, real network from a GitHub runner, the same build as staging):

| Page                     | Perf | A11y | BP  | SEO | LCP   | CLS   | TBT    |
| ------------------------ | ---- | ---- | --- | --- | ----- | ----- | ------ |
| Home (mobile)            | 80   | 100  | 93  | 92  | 2.5 s | 0.001 | 570 ms |
| Home (desktop)           | 100  | 100  | 93  | 92  | 0.6 s | 0.001 | 0 ms   |
| Pricing (mobile)         | 97   | 100  | 93  | 92  | 2.2 s | 0     | 30 ms  |
| How it works (mobile)    | 92   | 100  | 93  | 92  | 3.0 s | 0     | 20 ms  |
| Sample verdicts (mobile) | 92   | 100  | 93  | 92  | 2.9 s | 0     | 110 ms |

Accessibility 100 on every pair, CLS 0.001 or 0 everywhere. SEO 92
rather than 100 is Lighthouse's robots.txt audit reporting
`Content-Signal: search=yes,ai-train=no,use=reference` as an unknown
directive; that line is Cloudflare's zone-level managed robots.txt
(Content Signals Policy), not the Worker's body, crawlers ignore
directives they do not know, and the owner decision is recorded in
`HUMAN_DECISION_BLOCKERS.md`. Home (mobile) 80 against 87 on staging is
a single throttled run on the identical bundle (same chunk hashes, 12
requests, 190 kB transferred, script bootup about 1.0 s on both): the
difference is 570 ms against 300 ms of blocking time from the same SPA
JavaScript, inside the run-to-run spread already noted, and the other
four pairs match staging within a point.

## Remaining Recommendations

- Home (mobile) sits at 84–94 locally (87 on staging, 80 on production,
  single runs) with 300 to 570 ms of blocking time that
  is the SPA's own script execution on a throttled CPU, not the visuals
  (the hero's loop measures ~0.1 s of main-thread time per second at 4×
  throttle); the next step there is application work (less JavaScript on
  the marketing entry), not design.
- Local Lighthouse mobile numbers vary by ±8 points run to run on the
  sandbox; treat the staging workflow's numbers as the record.
- Cloudflare's zone-level managed robots.txt prepends a `Content-Signal`
  line that Lighthouse's robots audit calls an unknown directive (SEO 92
  on production); keeping it or switching it off in the zone is an
  owner decision recorded in `HUMAN_DECISION_BLOCKERS.md` (recommended:
  keep it, the site's own rules are unaffected).
- Contact and the auth pages were deliberately left as they are.
- Email templates (`packages/notifications`) were not touched, per the
  owner's instruction that the copy sweep applied to the website only.
