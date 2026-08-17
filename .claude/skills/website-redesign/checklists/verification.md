# Final verification checklist (Stage 5)

Run by `qa-reviewer` (independent; re-runs everything itself). Every item
gets a real result — command + outcome — never an assertion.

## Build and gates

- [ ] Production build succeeds
- [ ] Lint, format check, typecheck pass
- [ ] Unit, contract, integration tests pass
- [ ] Playwright e2e passes (Chromium preinstalled — never `playwright install`)

## Functionality preservation

- [ ] All pre-existing routes respond and render
- [ ] Auth flows (signup, login, logout, session) work
- [ ] Forms validate and submit; error and empty states render
- [ ] API contracts unchanged (or changes documented and approved)

## Responsive and visual

- [ ] 390px / 768px / 1440px layouts checked on key pages
- [ ] Light and dark themes both correct (incl. status colors)
- [ ] Before/after screenshots captured for changed pages

## Accessibility

- [ ] axe: zero serious/critical on all covered pages
- [ ] Keyboard-only walkthrough of primary journeys; focus visible
- [ ] Screen-reader labels/landmarks on new components
- [ ] Reduced-motion, contrast, reduced-transparency preferences honored
- [ ] WCAG 2.2 AA spot-checks (contrast, target size, headings)

## SEO artifacts

- [ ] Unique title + meta description on every public page
- [ ] Canonical URLs correct; no accidental indexing of private routes
- [ ] robots.txt and XML sitemap valid and consistent
- [ ] Open Graph/social metadata + share images present
- [ ] JSON-LD parses, validates, and is actually permitted by CSP
- [ ] Redirect map applied for any changed URL; no broken internal links

## Performance

- [ ] Lighthouse (or equivalent) run on key pages — record LCP/INP/CLS
- [ ] Bundle sizes within documented budget; marketing/app split intact
- [ ] Fonts self-hosted, subset, within budget; no layout-shift regressions
- [ ] Images optimized, responsive variants, lazy-loaded below the fold

## Security and i18n

- [ ] CSP headers byte-exact test passes; no new inline script/style
- [ ] No secrets, credentials, or sensitive data in code or logs
- [ ] No hardcoded user-facing strings in changed components
- [ ] i18n catalog complete for `en`; activation process documented

## Console and integrity

- [ ] No console errors/warnings in exercised flows
- [ ] No missing assets or broken links (crawl the built site)

Final report: completed work, changed pages, new dependencies with
reasons, screenshots, test results, SEO/performance measurements, known
limitations, recommended next steps.
