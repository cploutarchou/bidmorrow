# Dependency Evaluation — BidMorrow Website Redesign

Date: 2026-08-17. Evaluator: dependency-vetting helper task.
Constraints protected (requirements.md §Hard technical constraints; the frontend and accessibility conventions, docs/conventions/frontend.md):

- CSP `script-src 'self'; style-src 'self'; font-src 'self'` — **no unsafe-inline, no nonces possible** (headers are static in `apps/web/public/_headers`, byte-exact-tested in `tests/security/static-asset-headers.test.ts`). Runtime `<style>`-element injection with CSS text content is **blocked**. Inline styles set via CSSOM (`element.style.x = …`, React `style` prop) are **allowed** (CSP does not govern CSSOM).
- Self-hosted fonts ≤ ~90KB total; marketing JS bundle ≈ 150KB gz budget; React 19.2 + Vite 8.2 + react-router 7.18 (library mode) + TS strict + pnpm; no SSR-framework rebuild.

Verification method: npm registry metadata + published tarballs downloaded and **grepped for runtime style injection** (empirical CSP check); official docs sites (motion.dev, lucide.dev, radix-ui.com, react-spectrum) are **egress-blocked from this environment** — doc-level claims that could not be confirmed are marked _"needs verify-current-docs before install"_. Font sizes below are **measured from the actual Fontsource woff2 files**, not estimates.

What exists today in `apps/web` (relevant baseline): vanilla-CSS tokens in `src/styles.css`, `system-ui` font stack (no self-hosted fonts yet), **no** icon library, **no** motion library, **no** UI-primitive library, no images pipeline, no prerendering, no i18n lib. Everything below is additive.

---

## 1. Icons — lucide-react vs. inline original SVG

**Verdict: ADOPT lucide-react (runtime UI icons) + original inline SVG (brand/illustrative art).**

|                   | lucide-react                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version / license | 1.31.0 (published 2026-08-09) / **ISC** (permissive, compatible)                                                                                                                          |
| Maintenance       | Very active (weekly releases; huge community; Vercel-sponsored)                                                                                                                           |
| Bundle            | Per-icon ESM modules, **fully tree-shakable**; ~0.3–0.6KB gz per icon; 20–30 icons ≈ 8–15KB gz. Never use the dynamic `icons` map/`DynamicIcon` (pulls the whole set).                    |
| CSP               | Pure SVG React components, no style injection (verified: zero `createElement("style")` in dist). Clean.                                                                                   |
| A11y              | Renders `aria-hidden="true"` by default (verified in dist) — correct for decorative icons; pass `aria-label` + remove aria-hidden for meaningful ones (wrap or use visually-hidden text). |
| React 19          | peer `^19.0.0` ✓                                                                                                                                                                          |

- Consistent 24px-grid, 2px-stroke language fits the macOS-inspired "polished icons" direction; stroke-width themable via CSS `currentColor`.
- **Existing code covers:** nothing — no icons in the codebase today.
- Rule: hero/marketing illustrations, logo, and any signature visuals are **original inline SVG** (also satisfies "never copy Apple assets"). lucide only for functional UI glyphs (nav, chevrons, check, close, etc.).
- Record in `docs/dependency-versions.md` at install; verify current import syntax via `verify-current-docs` (docs site was blocked this session).

## 2. Fonts — @fontsource self-hosted subsets

**Verdict: ADOPT @fontsource-variable/inter + @fontsource/ibm-plex-mono; display face ADOPT-IF the chosen design direction demands one (budget shown below).**

License: all candidates **OFL-1.1** (self-hosting explicitly allowed). Fontsource is actively maintained (Inter 5.3.0, 2026-07-19). **SF Pro is NOT licensable for self-hosting — confirmed off the table; `system-ui` remains the fallback stack (already in styles.css).**

**Measured latin-subset woff2 sizes (downloaded from the published packages):**

| Face                                    | File              | KB       |
| --------------------------------------- | ----------------- | -------- |
| Inter variable (wght axis, all weights) | latin-wght-normal | **47.1** |
| Inter variable italic                   | latin-wght-italic | 50.6     |
| IBM Plex Mono 400 (static)              | latin-400-normal  | **14.4** |
| JetBrains Mono variable                 | latin-wght-normal | 39.5     |
| Instrument Sans variable                | latin-wght-normal | 29.4     |
| Bricolage Grotesque variable            | latin-wght-normal | 40.4     |
| Fraunces variable (display serif)       | latin-wght-normal | 35.8     |
| Newsreader variable                     | latin-wght-normal | 56.7     |

**Recommended budget (fits ≤90KB):**

- Baseline: **Inter variable (47.1) + IBM Plex Mono 400 (14.4) = 61.5KB**, leaving ~28KB headroom.
- Inter has **tabular figures built in** (`font-variant-numeric: tabular-nums`) — score readouts/data tables may not need a mono face at all; mono is an aesthetic choice for data blocks.
- With a display face: Inter + Fraunces + Plex Mono = 97.3KB (slightly over); Inter + Instrument Sans + Plex Mono = 90.9KB (at the line). If a display face is chosen, either drop the mono (Inter + Fraunces = 82.9KB) or subset further.
- **Skip italic files** (≈+50KB) unless the design uses italics; latin-ext not needed for English-only launch (re-add per-locale at i18n activation — note this in the i18n activation doc).
- Further trimming when needed: `pyftsubset`/glyphhanger can pin the variable wght axis to e.g. 400–700 and strip unused OpenType features (typically −20–35%). Do this as a build step only if the pairing overruns.
- CSP: `font-src 'self'` — copy woff2 into `public/fonts/` (or import via Vite asset pipeline) and write our own `@font-face` in styles.css with `font-display: swap` (or `optional` for the display face) + `size-adjust` metrics fallback to kill CLS. Do **not** import Fontsource's CSS wholesale — it declares every subset; hand-written @font-face keeps control.
- **Existing code covers:** nothing — system-ui stack only. `_headers` already has `font-src` implicitly via `default-src 'self'` (explicit `font-src 'self'` is in the worker policy; keep both in sync when touching the byte-exact test).

## 3. Motion — motion vs motion/mini vs pure CSS + View Transitions

**Verdict: ADOPT pure CSS transitions/animations as the default mechanism; ADOPT-IF `motion` (LazyMotion/`m` or `motion/mini`) strictly for the few interactions CSS cannot express; REJECT full `motion` import.**

| Option                                             | Est. gz cost                                                       | CSP                                     | Notes                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure CSS transitions/keyframes                     | **0KB**                                                            | Perfect (`style-src 'self'` stylesheet) | Covers ~90% of macOS-quality micro-interactions: hover lifts, focus rings, fades, spring-like easing via `linear()` easing functions, scroll-driven reveals via `animation-timeline: view()` (progressive enhancement), `@starting-style` for entry transitions |
| View Transitions API (same-document)               | 0KB                                                                | Perfect                                 | react-router 7 supports `<Link viewTransition>`; Chrome/Edge, Safari 18+, Firefox 139+ — progressive enhancement, no polyfill. _Needs verify-current-docs for exact RR7 API at install._                                                                        |
| `motion/mini` (`useAnimate` mini / mini `animate`) | **~2.3KB** (official docs figure)                                  | Clean — WAAPI-driven                    | Springs, sequencing, stagger on top of WAAPI                                                                                                                                                                                                                    |
| LazyMotion + `m` component                         | **~4.6KB initial** + async feature packages (official docs figure) | Clean with the caveat below             | Declarative React API when needed                                                                                                                                                                                                                               |
| Full `motion` component                            | **~34KB** (official docs figure)                                   | Caveat below                            | ~23% of the whole marketing budget — not justified                                                                                                                                                                                                              |

- Package: `motion` 13.1.0 (2026-08-10), **MIT**, extremely active; `framer-motion` is now a re-export shell — depend on `motion` only. peer React ^19 ✓.
- **CSP finding (verified against published 13.1.0 dist):** the _only_ `<style>`-element injection in the ESM tree is `AnimatePresence mode="popLayout"` (`PopChild.mjs`) — it appends an empty `<style>` and writes rules via CSSOM `insertRule` (generally not CSP-blocked, and it supports a nonce we can't provide anyway). Everything else animates via `element.style`/WAAPI (CSSOM — allowed). **Policy if adopted: ban `mode="popLayout"`** (ESLint no-restricted-syntax rule + note in the shared plan) and re-run `tests/security/` + a manual console check for CSP violations in the e2e pass.
- Reduced motion: pure CSS → one `@media (prefers-reduced-motion: reduce)` block zeroing durations; motion → `<MotionConfig reducedMotion="user">` / `useReducedMotion`. Both stories are good; CSS is simpler to enforce globally.
- **Recommendation: start with zero motion dependencies.** CSS + View Transitions deliver the macOS feel (ease curves, subtle depth/parallax, staggered reveals) within CSP at 0KB. Add `motion/mini` (~2.3KB) only when a concrete approved interaction needs interruptible springs/orchestration, and record the rationale in `docs/dependency-versions.md`.
- **Existing code covers:** nothing (no transitions in styles.css yet).

## 4. UI primitives — radix-ui / react-aria vs native `<dialog>` + popover

**Verdict: REJECT radix-ui under this CSP; ADOPT native `<dialog>` + `popover` attribute + small internal primitives; react-aria-components ADOPT-IF a genuinely complex app-side widget (combobox/select) appears later.**

- **radix-ui 1.6.7 (MIT, active, React 19 ✓) — hard CSP incompatibility, empirically verified:** `@radix-ui/react-dialog` (and AlertDialog, DropdownMenu, Select, etc. — anything modal) depends on `react-remove-scroll` → `react-style-singleton`, whose published dist does `document.createElement('style')` + `appendChild(document.createTextNode(css))`. That is inline `<style>` text content → **blocked by `style-src 'self'`** without unsafe-inline or a nonce, and our static `_headers` cannot carry nonces. Result: CSP violation reports in console and broken scroll-lock/scrollbar-compensation styling. `modal={false}` sidesteps it but forfeits the main reason to use Radix modals. Do not adopt; do not weaken the policy (docs/security.md C3).
- **react-aria-components 1.20.0 (Apache-2.0, Adobe, very active):** no style injection found in its published dist (verified); CSP-clean. But it is heavyweight (tens of KB gz even tree-shaken per component) and the marketing site does not need it. Keep on the shelf for future complex app widgets only, with a bundle measurement gate at adoption.
- **Native platform (recommended):**
  - `<dialog>` + `showModal()`: top layer, focus containment, Esc, `::backdrop`, inert background — free, CSP-perfect, excellent support. React 19 renders `<dialog>` fine.
  - `popover` attribute (+ `popovertarget`): menus, mobile nav, tooltips — Baseline since 2024, light-dismiss and top-layer for free, **zero JS** for simple cases.
  - CSS anchor positioning for anchored popovers is _not_ yet safely cross-browser — position simple cases with CSS relative to a wrapper; **needs verify-current-docs** before relying on `anchor()`. If complex anchored positioning is truly needed, `@floating-ui/dom` (~6KB gz, MIT, computes via CSSOM inline styles — CSP-clean) is the fallback, adopt-if.
  - Tabs: ~60-line internal roving-tabindex component (WAI-APG pattern); tooltip: internal, popover-based, honoring hover/focus + `Esc`. These are small enough that the requirements' "small internal implementation" clause applies.
- A11y wins Radix would have provided (focus management, typeahead menus) are largely covered by native `<dialog>`/popover semantics now; the Playwright axe gate (`@axe-core/playwright` already installed) verifies the result.
- **Existing code covers:** `ConfirmAction.tsx`, `AdminShell.tsx` etc. exist without any primitive lib — internal patterns are already the house style.

## 5. Prerendering public marketing routes (SEO)

**Verdict: ADOPT-IF vite-prerender-plugin (first choice) or a custom render-to-static script (fallback); REJECT vite-react-ssg; react-router framework-mode prerender noted as strategic alternative. No SSR framework — all options below are build-time only, zero runtime bundle, CSP-neutral.**

| Option                                                           | Version / license         | Maintenance                         | Fit                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **vite-prerender-plugin**                                        | 0.5.13 (2026-03-15) / MIT | Preact-team project, stable cadence | **peer `vite 5.x–8.x` ✓**. Framework-agnostic: you export an async `prerender()` that returns HTML (use `react-dom/server` `renderToString` + `<StaticRouter>`/`createStaticHandler` from react-router). Handles multi-route crawling, `<head>` injection. Small, no runtime footprint.                                                                                                                               |
| Custom post-build script                                         | —                         | ours                                | ~80 lines: import built server-ish entry, `renderToString` each marketing route, write `dist/<route>/index.html`. Zero deps, maximum control (e.g., emitting the JSON-LD hash — see below). More maintenance on us.                                                                                                                                                                                                   |
| vite-react-ssg                                                   | 0.9.2 (2026-07-15) / MIT  | active                              | **REJECT: peer-depends on `react-router-dom ^6.14.1`** — project is on `react-router` v7. Also drags critters/beasties/styled-components peers.                                                                                                                                                                                                                                                                       |
| react-router 7 framework mode, `ssr: false` + `prerender: [...]` | first-party               | very active                         | Same stack (still react-router), first-party static prerender with SPA hydration. Cost: migrating from library mode to `@react-router/dev` framework mode (entry/config churn across the whole app, not just marketing). Legitimate, but the biggest diff of the three — only choose it if the team wants framework mode for other reasons. **Needs verify-current-docs** for current config surface before choosing. |

- Hydration keeps CSP intact (same single same-origin module script; no inline bootstrapping — verify output once in the byte-exact headers test run).
- **JSON-LD mechanism (requirement calls for one):** prerendered pages embed `<script type="application/ld+json">`; inline scripts of _any_ type are subject to `script-src`, so add the block's **SHA-256 hash** to `script-src` in `_headers` and the Hono policy, generated deterministically at build (stable content → stable hash), and update `tests/security/static-asset-headers.test.ts` in the same PR. This is the explicit CSP-compatible mechanism; the custom-script option makes hash emission trivial.
- **Existing code covers:** nothing — pure SPA today; `index.html` is a single shell. Marketing routes already separated under `MarketingLayout`, which makes route selection clean.

## 6. i18n libraries (data only — recommendation owned by another agent)

All three are CSP-clean (pure JS, no style/script injection), TS-strict-compatible, React 19-compatible. Bundle figures are estimates (bundlephobia unreachable this session) — **verify at adoption**.

| Lib                     | Version / license     | Maintenance            | Est. runtime gz       | CSP / notes                                                                                                                                             |
| ----------------------- | --------------------- | ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-i18next + i18next | 17.0.11 / 26.3.6, MIT | very active (Jul 2026) | ~12–16KB combined     | Runtime interpolation/plurals; largest ecosystem; lazy-loadable locale JSON ✓                                                                           |
| @lingui (core+react)    | 6.6.0, MIT            | active (Jul 2026)      | **~3–5KB** (smallest) | Compile-time ICU extraction → tiny runtime; needs macro/SWC-or-Babel build step in Vite (plugin exists); catalogs are plain files ✓                     |
| react-intl (FormatJS)   | 10.1.22, BSD-3-Clause | very active (Aug 2026) | ~15–20KB              | ICU at runtime; heaviest; strong Intl formatting APIs (native `Intl` covers most of this anyway — `lib/format.ts` already uses locale-aware formatting) |

Bundle-budget note for the coordinator: on a 150KB gz marketing budget, the ~10–15KB delta between lingui and the others is material but not decisive; catalog architecture (centralized messages incl. metadata/a11y/emails per requirements) matters more than runtime size.

## 7. Image tooling — build-time optimization + responsive `<picture>`

**Verdict: ADOPT vite-imagetools (devDependency) + hand-authored `<picture>`/`srcset` strategy.**

- **vite-imagetools 12.0.0** (2026-08-08), MIT, active; **peer `vite >= 8.0.0` — exact match** for our Vite 8.2. sharp-based (sharp 0.35.3, Apache-2.0, active). Import-time directives (`?w=400;800;1200&format=avif;webp;png&as=picture`) generate hashed responsive variants at build. **Zero runtime bundle cost; build-time only; CSP-neutral** (outputs are same-origin static assets, `img-src 'self'` already allows them).
- vite-plugin-image-optimizer 2.0.3 (2025-10-30, MIT): compresses in place only — no responsive variant generation; not sufficient alone; skip to avoid overlap.
- Strategy (a11y/perf agent's budget rules): AVIF → WebP → fallback in `<picture>`; explicit `width`/`height` (no CLS); `loading="lazy"` + `decoding="async"` below the fold; hero image `fetchpriority="high"` and preloaded. Product screenshots exported at 1x/2x. SVG preferred wherever art is vector (most of the macOS-inspired surface work should be CSS/SVG, keeping raster images rare).
- **Existing code covers:** nothing — no images or pipeline exist today.
- pnpm note: `sharp` needs a postinstall build — add to root `pnpm.onlyBuiltDependencies` alongside esbuild/workerd.

## 8. Carousel / slider libraries

**Verdict: REJECT by default (matches requirements.md standing decision — carousels only where they genuinely improve comprehension).**

Accessibility bar any future proposal must meet **before** a library is even evaluated (from requirements + the frontend and accessibility conventions, docs/conventions/frontend.md; failing any item = auto-reject):

1. **Keyboard:** all controls tabbable in logical order; arrow-key slide navigation; no focus trap; focus not lost when slides change; visible focus indicators.
2. **Touch/pointer:** swipe with equivalent button controls (WCAG 2.5.1/2.5.7 single-pointer alternatives); targets ≥24×24 (2.5.8).
3. **Screen reader:** `aria-roledescription="carousel"`, per-slide labels ("Slide 2 of 5"), off-screen slides `aria-hidden`/`inert`, slide changes announced politely (and not at all during auto-rotation).
4. **Pause:** if anything auto-advances, a visible pause/stop control (WCAG 2.2.2) and pause on hover/focus.
5. **Reduced motion:** `prefers-reduced-motion` disables auto-advance and animated transitions (instant swap fallback).
6. CSP: no runtime style injection; zero serious/critical axe violations in the Playwright gate; works at 400% zoom/reflow.

Reference data if the owner ever approves one: **embla-carousel-react 8.6.0**, MIT, ~5–7KB gz, headless, no style injection — but ships _no_ a11y semantics itself; every item above would be our code. That cost usually exceeds building the specific pattern directly.

## 9. OG-image generation

**Verdict: ADOPT static designed PNGs; satori pipeline REJECT for V1 (revisit only if per-page OG images become a need).**

- V1 has a **small, fixed set of public marketing routes** (public tender-detail SEO pages are explicitly out of scope), English-only launch → a handful of hand-designed 1200×630 PNGs (one brand default + optionally one per top-level page) is the simplest correct answer. Zero dependencies, zero build steps, pixel-perfect brand control, served as same-origin static assets (CSP-neutral; OG images are fetched by crawlers, not the page).
- Keep each under ~200KB (does not count toward the JS budget but respect crawler limits); note OG PNGs cannot use the self-hosted-font budget reasoning — they're raster, bake the type in.
- Build-time programmatic option, recorded for later: **satori 0.29.0** (MPL-2.0, active Jul 2026, no peers) + **@resvg/resvg-js 2.6.2** (MPL-2.0, **last publish 2024-03 — stale native binding, flag at adoption**). MPL-2.0 is acceptable for internal build tooling (file-level copyleft; nothing distributed). Only worth the pipeline when route count × locales makes manual PNGs unmaintainable (e.g., i18n activation).

---

## Summary table

| #   | Candidate                                              | Verdict                                                         | License        | Est. cost                  |
| --- | ------------------------------------------------------ | --------------------------------------------------------------- | -------------- | -------------------------- |
| 1   | lucide-react                                           | **Adopt** (UI glyphs; original SVG for art)                     | ISC            | ~8–15KB gz for 20–30 icons |
| 2   | @fontsource-variable/inter + @fontsource/ibm-plex-mono | **Adopt** (display face adopt-if)                               | OFL-1.1        | 61.5KB measured (≤90KB ✓)  |
| 3   | Pure CSS + View Transitions                            | **Adopt**                                                       | —              | 0KB                        |
| 3   | motion (mini / LazyMotion)                             | Adopt-if (concrete need; ban popLayout)                         | MIT            | 2.3–4.6KB gz               |
| 3   | motion (full component)                                | Reject                                                          | MIT            | ~34KB gz                   |
| 4   | Native `<dialog>`/popover + internal primitives        | **Adopt**                                                       | —              | ~0–2KB own code            |
| 4   | radix-ui                                               | **Reject** (verified CSP violation via react-style-singleton)   | MIT            | —                          |
| 4   | react-aria-components                                  | Adopt-if (future complex app widget only)                       | Apache-2.0     | tens of KB                 |
| 5   | vite-prerender-plugin (or custom script)               | Adopt-if (pick at implementation)                               | MIT            | 0 runtime                  |
| 5   | vite-react-ssg                                         | Reject (react-router-dom v6 peer)                               | MIT            | —                          |
| 6   | i18n (data only)                                       | lingui smallest (~3–5KB); i18next ~12–16KB; react-intl ~15–20KB | MIT/MIT/BSD-3  | see §6                     |
| 7   | vite-imagetools (+sharp)                               | **Adopt** (devDependency)                                       | MIT/Apache-2.0 | 0 runtime                  |
| 8   | Carousel libs                                          | **Reject by default**; a11y bar recorded                        | —              | —                          |
| 9   | Static OG PNGs                                         | **Adopt**; satori/resvg reject for V1                           | — / MPL-2.0    | 0                          |

Rough marketing-bundle math if all "adopt" items land: react+react-dom+react-router baseline (~60–75KB gz) + icons (~10KB) + i18n (3–16KB) + 0KB motion/UI/images = **~75–100KB gz**, comfortably inside the ~150KB budget with headroom for page code.

## Items needing `verify-current-docs` before install (egress-blocked this session)

1. motion.dev docs: confirm 13.x mini/LazyMotion API names and sizes; confirm no new style-injection sites beyond PopChild.
2. lucide.dev: current import guidance and dynamic-icon warnings.
3. CSS anchor positioning + popover browser-support matrix (MDN/caniuse) before relying on `anchor()`.
4. react-router 7 `viewTransition` prop and framework-mode `prerender` config surface (only if that option is chosen).
5. vite-prerender-plugin README for the exact `prerender()` contract on Vite 8.
6. vite-imagetools v12 directive syntax.
7. Bundlephobia/size-limit measurements for the chosen i18n lib (numbers above are estimates).

Every adopted dependency must be recorded in `docs/dependency-versions.md` with rationale, per requirements.md §Libraries, and a `pnpm build` + bundle-size measurement reported after each addition.
