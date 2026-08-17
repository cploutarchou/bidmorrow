---
name: responsive-qa
description: Verify a web page or milestone is genuinely responsive and visually finished across mobile, tablet, and desktop in both themes — collapsing mobile navigation, brand logo + favicon, no horizontal overflow, tap-target sizes, type legibility, and fidelity to the approved design. Use before declaring any marketing/app UI milestone done, and whenever a design "doesn't match on mobile."
---

# Responsive QA

Programmatic checks like "no horizontal scroll" are necessary but NOT
sufficient — they pass on a header whose nav wraps into three stacked rows.
This skill forces an actual look at every breakpoint and both themes, and a
polish checklist, so mobile fidelity is verified by evidence, not asserted.

## When to use

- Before marking any public-site or app-UI milestone complete.
- Whenever the owner says a design "doesn't match", "isn't responsive", or
  "the menu doesn't collapse on mobile".
- After any header/nav/layout change.

## Procedure

1. **Build + serve the real build** (not dev):
   ```
   pnpm --filter @bidmorrow/web build
   (cd apps/web && npx vite preview --port 4173 --strictPort &)
   ```
2. **Capture every route × viewport × theme**:
   ```
   node scripts/shoot-marketing-responsive.mjs http://127.0.0.1:4173 \
     <scratchpad>/responsive-shots
   ```
   Viewports: mobile 390, tablet 768, desktop 1280. Themes: dark + the
   daylight twin. The script also fails on any horizontal overflow.
3. **Actually READ the mobile screenshots** (390px) for every route — do not
   trust the overflow check alone. Then spot-check tablet + desktop.
4. **Run the checklist** below. Any ✗ is a defect to fix before shipping.
5. Kill the preview (`fuser -k 4173/tcp`). Attach the mobile + desktop
   screenshots to the milestone report; send the owner the mobile ones.

## Checklist (every ✗ blocks)

Navigation / header

- [ ] Below the mobile breakpoint the primary nav **collapses into a single
      control** (hamburger/menu button) — it never wraps into stacked rows.
- [ ] The menu button is keyboard- and screen-reader-accessible:
      `aria-expanded`, `aria-controls`, a state-aware `aria-label`; focus
      moves into the panel on open and back on close; **Esc** and
      outside-click/tap close it; it closes on navigation.
- [ ] Menu button and every nav item have a ≥44px touch target.
- [ ] Desktop still exposes the nav links inline (don't hide them behind the
      hamburger at desktop — keeps desktop e2e/assertions valid).

Brand

- [ ] The **logo mark** is present in the header (and footer brand), matching
      the approved design and `public/favicon.svg`, and themes via tokens.
- [ ] The **favicon** is wired in `apps/web/index.html` (svg + png +
      apple-touch-icon + theme-color) and the files build into `dist/`.

Layout / legibility (each route, mobile)

- [ ] No horizontal body scroll at 360/390px (script-enforced).
- [ ] Hero, card grids, pricing tiers, steps, prose all stack cleanly; no
      clipped/overlapping content; comfortable type scale and measure.
- [ ] Both themes render correctly (no color defined only inside a
      media/`[data-theme]` block; `body` has an explicit token background).
- [ ] `prefers-reduced-motion` honored for any menu/entrance transition.

Fidelity

- [ ] The result matches the approved mockup's intent at each breakpoint
      (compare against `docs/redesign/mockups/*`). Note deliberate,
      justified deviations in the milestone report.

## Constraints (inherited)

CSP is load-bearing: the mobile menu toggles via state → CSS classes, never
inline styles; no CDN; fonts self-hosted. Truthful content; pricing frozen;
TED attribution + decision-support disclaimer preserved. WCAG 2.2 AA.
