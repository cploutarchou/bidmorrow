# Brand elevation phase — modern, mobile-first, motion + imagery (2026-08-26)

Owner request: "make our website and client area more modern, mobile
friendly, with catchy features, modern animations, images — we need to be
a top brand world-wide."

## 1. Baseline audit (screenshots 2026-08-26, 1366px + 390px)

What is already good: clear type hierarchy (Archivo display), light
gallery ground with a faint grid, honest copy, a working interactive
"how it works" stepper, illustrative verdict cards, responsive layout.

What holds the brand back:

| #   | Gap                                                                                                                                                                                       | Where                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| B1  | **No imagery at all.** Hero is text on a grid; sections are text + bordered boxes. Nothing a visitor remembers.                                                                           | Home, How it works, Pricing   |
| B2  | **No signature visual.** The product's story (thousands of notices → a handful of verdicts) is never shown, only told.                                                                    | Hero                          |
| B3  | Step visuals are grey placeholder bars.                                                                                                                                                   | Home "How it works" panel     |
| B4  | Social share image showed a bare score card (84.5/100 worked example) — a spec, not a brand. Replaced with the funnel motif; `docs/redesign/seo-content-strategy.md` §3 updated to match. | `public/og/`, `lib/seo.ts:37` |
| B5  | Motion is limited to the stepper and a few drifts; no scroll reveal, no card lift, no number count-up, no hero entrance.                                                                  | marketing.css                 |
| B6  | Pricing cards are flat; the founding card does not feel like the offer.                                                                                                                   | Pricing                       |
| B7  | App: KPI strip, tabs and cards appear instantly with no entrance; score rings are static; empty states are a glyph + text.                                                                | Feed                          |
| B8  | App mobile: KPI strip is a 2×2 grid of large boxes taking a full screen before the first tender.                                                                                          | Feed 390px                    |
| B9  | No route transition — pages cut hard.                                                                                                                                                     | App + marketing               |

## 2. Direction (stays inside the approved design language)

Not a re-brand. Same tokens, fonts, accent (`--accent` teal), light-first
with the dark twin, Lucide + original SVG. What changes is **depth,
imagery and motion**:

- **Aurora ground**: a soft two-tone radial wash (accent tint + warm
  neutral) behind the hero and section heads, animated very slowly
  (60s drift), static under `prefers-reduced-motion`.
- **Signature visual — "the funnel"**: an original SVG animation in the
  hero: a stream of notice chips flows down, passes the profile "lens",
  and three land as verdict cards (Strong / Worth reviewing / Possible)
  with count-up numbers. CSS/SMIL-free, CSS keyframes only, ≤ 12 KB,
  static end-frame for reduced motion. No fake statistics: the numbers
  are labelled "illustrative".
- **Step art**: four original SVG illustrations (source → profile →
  scoring → verdict) in the same line-and-fill style, replacing the grey
  bars.
- **Product frame**: the illustrative feed card stack sits in a floating
  "window" with layered soft shadow and a subtle 3D tilt on pointer move
  (desktop only, capped 4°, none for reduced motion / touch).
- **Scroll reveal**: `.reveal` utility (opacity + 12px rise, 500ms,
  staggered via `--i`), driven by one IntersectionObserver hook; all
  content visible without JS and under reduced motion.
- **Pricing**: founding card gets an accent gradient border + glow, hover
  lift; the 12-month hold bars animate in on reveal.
- **OG image**: 1200×630 PNG (+ SVG source) with wordmark, headline and
  the funnel motif; page-specific alt text unchanged.
- **App**: KPI numbers count up on load; cards stagger in (40ms);
  score ring draws its arc; skeleton shimmer; empty states get small
  original illustrations; mobile KPI strip becomes a horizontal
  snap-scroll row of compact chips; `View Transitions` cross-fade on
  route change when supported (progressive, no library).
- **Mobile**: sticky bottom CTA on Home after the hero scrolls out
  (dismissable, respects safe-area); tap targets ≥ 44px; sample-verdict
  cards become a snap carousel at ≤ 40rem.

## 3. Hard constraints

- CSP-safe: every asset self-hosted, inline SVG or `/public` files; no
  CDN, no runtime style injection, no new runtime dependency.
- Marketing entry budget 150 KB gz stays; illustrations as inline SVG
  components or `<img src>` (never base64 in JS).
- WCAG 2.2 AA: contrast, focus, motion under `prefers-reduced-motion`,
  no content behind animation, no autoplay > 5s without a pause control
  (the stepper already has one; the funnel loops ≤ 5s then settles).
- Product truth: no testimonials, logos, customer counts or invented
  metrics. Illustrative numbers are labelled.
- Procurement content is never rendered as HTML.

## 4. Delivery

1. `visual-asset-designer`: funnel SVG, 4 step SVGs, 3 empty-state SVGs,
   OG image (SVG + PNG) → `apps/web/src/assets/` + `public/og/`.
2. `frontend-engineer` (app): Feed/Settings/onboarding polish per §2.
3. `frontend-engineer` (marketing): hero, reveal system, product frame,
   pricing, sticky mobile CTA, route transitions.
4. `accessibility-performance-engineer` + `qa-reviewer`: gates, budget,
   axe, 390/768/1440 screenshots.
