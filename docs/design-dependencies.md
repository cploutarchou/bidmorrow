# Design upgrade: dependency record

Companion to `docs/design-audit.md` and `docs/design-redesign-plan.md`
(2026-09-01). The brief's dependency policy: prefer CSS, SVG and native
browser APIs; add a library only when it measurably beats a native
approach; document every addition here with its size, its purpose and
why native was not enough.

## Runtime dependencies added

None.

Everything shipped in the visual upgrade is built from what the browser
already provides:

| Need                                   | Solution                                                                                                                                  | Native API                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Hero decision-engine loop (13.5 s)     | CSS keyframes on one shared cycle, per-scene offsets through an inherited custom property                                                 | CSS Animations, custom properties                                |
| Score count-up and ring draw, in step  | One registered `@property --de-value` (`<integer>`) animated by keyframes; `counter-reset` renders the number, `pathLength="100"` the arc | CSS Properties and Values API, CSS counters, SVG `pathLength`    |
| Pause the loop when scrolled away      | `IntersectionObserver` toggling `animation-play-state`                                                                                    | IntersectionObserver                                             |
| Score rings draw once on reveal        | Same `--de-value` property, `from { --de-value: 0 }` keyframe keyed on the existing `[data-reveal].is-in` state                           | CSS Animations                                                   |
| Scroll reveal                          | Existing `lib/use-reveal.ts` (`IntersectionObserver`), unchanged                                                                          | IntersectionObserver                                             |
| FAQ accordion                          | Native `<details>` / `<summary>` with a CSS chevron                                                                                       | HTML disclosure element                                          |
| Layout-shift-free font swap            | `@font-face` fallback faces with `size-adjust` and the `*-override` descriptors                                                           | CSS Fonts Level 5 descriptors                                    |
| Micro-interactions (120–250 ms)        | CSS transitions, gated on `(hover: hover)` and `prefers-reduced-motion: no-preference`                                                    | CSS Transitions, media queries                                   |
| Product frames (how-it-works step art) | DOM + CSS reusing the hero's primitives; no images                                                                                        | HTML/CSS                                                         |
| Open Graph image                       | Hand-authored SVG rendered to PNG by the existing Playwright-based script                                                                 | SVG; Playwright is already a dev dependency (`@playwright/test`) |

## Development dependencies added

None. Screenshot capture (`scripts/design-screenshots.mjs`,
`scripts/design-element-shot.mjs`) and Lighthouse runs use the
`@playwright/test` package already in the workspace and `npx lighthouse@12`
on demand, which is not added to `package.json`.

## Fonts

No new font families. Archivo and Source Code Pro remain the only web
fonts, self-hosted from `apps/web/public/fonts/`, unchanged in weight
and subset. Three local fallback faces (Arial / Liberation Sans, DejaVu
Sans, Courier New / Liberation Mono) are declared in CSS only; they load
nothing.

## Bundle effect (web entry, `pnpm --filter @bidmorrow/web build`)

Measured from the Lighthouse network audit on the local stack (resource
size is the file on disk, transfer size is what the wire carries after
compression).

| Asset         | Before (2026-09-01 baseline) | After the upgrade      |
| ------------- | ---------------------------- | ---------------------- |
| `index-*.js`  | 83.7 kB (23.9 kB transfer)   | 77.7 kB (22.4 kB gzip) |
| `index-*.css` | 76.6 kB (15.8 kB transfer)   | 86.6 kB (16.6 kB gzip) |

JavaScript shrank: the FunnelHero and the four step SVG components left
the entry, and the hero's only script is one `IntersectionObserver` plus a
CSSOM property write. CSS grew by about 10 kB on disk (0.8 kB over the
wire): `styles/hero.css` carries the decision-engine timeline, the product
frames and the ring draw, and the micro-interaction rules sit in
`marketing.css`, less the dead hero-panel, figure-scan, score-bar and
chip rules that were removed. The plan's per-page budgets (LCP, CLS, INP,
Lighthouse) are checked in `docs/design-upgrade-report.md`, not here.
