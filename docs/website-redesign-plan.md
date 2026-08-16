# Website & Interface Overhaul — Implementation Plan

Status: **AWAITING OWNER APPROVAL** (2026-08-17). No implementation begins
until the owner approves this plan. Produced by three research workstreams
(frontend inventory, live competitor/UX research, product-truth guardrails)
plus design/security/accessibility/QA synthesis. Launch pipeline (Phase 13
tag → Phase 14 audit → go-live) is ON HOLD behind this task per owner
instruction (see IMPLEMENTATION_LEDGER.md).

Goal: an interface that feels premium, simple, fast, secure, and more
compelling than competitors — without unnecessary complexity, and without
violating a single product-truth rule.

---

## 1. Competitor & UX analysis (summary)

Method caveat: the sandbox proxy blocks direct access to external sites, so
competitor observations come from search-index snippets, cached titles, and
third-party teardowns — labeled as such in the full research report. A
30-minute owner eyeball of the five main competitor homepages is a cheap
validation step before M1 copy is finalized.

| Competitor             | Position                                        | Pricing                         | Beatable weakness                                                                  |
| ---------------------- | ----------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Stotles (UK benchmark) | "Win public sector contracts", AI-heavy suite   | Free tier → ~£50/user → £475/mo | UK-centric; enterprise sprawl; black-box "AI" scoring                              |
| Mercell (pan-EU)       | "Open the World of Public Business", 800k users | Demo-gated, no public prices    | Zero price transparency; two-sided identity confusion; dated fragmented web estate |
| Tenders Direct         | "Never miss a tender", human-curated            | From £1,359/yr **paid upfront** | Price/commitment gap; recall framing solves the wrong problem for our ICP          |
| OpenOpps               | "860+ sources, 193 countries"                   | ~£55/mo self-serve trial        | Breadth-not-relevance; no vertical focus; low design polish                        |
| Tenderlake             | "Total Tender Visibility", LLM explanations     | £249–546/mo                     | Priced out of SME; probabilistic explanations vs our deterministic ones            |
| TED (free baseline)    | Official journal, 3,000+ notices/day            | Free                            | Not a competitor — the raw-material story: "we read all 3,000 daily so you don't"  |

Market-wide gaps BidMorrow can own, all with zero customers and zero fake
anything:

1. **The inversion headline.** Nobody's headline promises fewer, better
   tenders. Our existing tagline already owns "skip the rest".
2. **Methodology transparency as the testimonial substitute.** No
   competitor discloses scoring methodology. Ours is deterministic,
   versioned, documented — publishing it converts "no logos yet" into
   "we show our work instead".
3. **The explainable score card as hero imagery** (Resend's lesson: the
   artifact is the pitch). A real score breakdown out-credentials a logo
   carousel for a technical ICP.
4. **The SME price hole is real**: nothing credible exists at €29–49/mo
   flat. The pricing page's honesty (no demo gate, no annual upfront, no
   enterprise tier) directly negates documented incumbent sins.
5. **Honest coverage as a feature** — precise, falsifiable CPV scope beats
   both "never miss" overclaiming and "193 countries" breadth noise.
6. **Privacy as a European trust signal** — "no third-party analytics, no
   session replay" is already a product rule; saying it on the site
   resonates with security consultancies specifically.

## 2. Current-state findings driving the plan

From the frontend inventory (full report in session records):

- Stack: React 19 + Vite + react-router 7, TS strict, zero UI deps, one
  hand-written 566-line stylesheet, 6 color tokens, system fonts, no
  icons/logo/favicon, one 640px breakpoint. Semantic HTML and a11y
  patterns are genuinely strong (landmarks, labels, aria-pressed, live
  regions, focus-visible, skip links) — **preserve, don't regress**.
- Hard constraints: CSP `style-src 'self'` (no inline styles → no runtime
  CSS-in-JS), `font-src 'self'` (self-hosted fonts only), `script-src
'self'`, no third-party anything; `dangerouslySetInnerHTML` banned by
  ESLint; copy constants locked by unit tests (rewording = deliberate
  test updates in the same PR).
- Known defects to fix: layout width bug (64rem content inside 44rem
  header/footer); HTTP 402 paywall renders as a generic error in Feed;
  no post-login routing into onboarding for new users; feed's 9-field
  filter bar dominates the page; Settings = 11 stacked sections with no
  navigation; dark mode auto-only with 5 unthemed status hexes; no
  favicon/OG/robots/sitemap; no `<title>` on `/app` or `/onboarding`;
  single 357 KB bundle shipping the admin surface to marketing visitors;
  responsive behavior never tested at any viewport.

## 3. Positioning & message architecture (from product guardrails)

Message hierarchy (strongest first): 1) scoped-relevance promise ("skip
the rest"), 2) explainable 0–100 score with breakdown, 3) deterministic /
LLM-free (a factual claim — "AI-powered" wording is a truth violation,
not a style choice), 4) daily digest only-when-meaningful, 5) honest
coverage, 6) EUR flat pricing + real founding cap, 7) TED attribution
(mandatory), 8) no lock-in.

Hard guardrails (redesign MUST NOT): fake testimonials/logos/stats; any
exhaustive-coverage implication; eligibility/award guarantees; AI-black-box
framing; hiding disclaimers; fake urgency (counters not wired to the real
cap); third-party fonts/CDNs/analytics/chat widgets; public tender SEO
pages (explicitly OUT of V1); overstating team size (sole trader).

MUST KEEP: TED attribution, decision-support disclaimer, plain EUR flat
prices, founding-cap honesty ("first 20"), scoped-coverage statement
naming CPV 72*/48*/79417000, UNKNOWN-policy and hard-exclusion wording,
"no LLM in the scoring path".

## 4. Visual direction

Three directions were developed; recommendation is **A**, borrowing B's
monospace-data discipline. A rendered mockup of Direction A accompanies
this plan for approval.

- **A — "Ledger" (recommended).** Swiss/editorial precision: the site as
  an audit document. Near-white paper ground, ink text, ONE deep-blue
  accent reserved for scores/CTAs; hairline rules and visible table
  structure; a grotesque sans for headings + **tabular monospace for
  every number, score, CPV code and date**. Reads as regulator-grade
  trustworthiness — "we show our work". Rhymes with (and massively
  upgrades) TED's official-journal seriousness; differentiates from both
  corporate-gloss incumbents and the AI-hype cluster.
- **B — "Control Room".** Linear-adjacent dark technical authority.
  Strong pull for cyber/dev ICP; risk: reads startup-trendy to
  conservative DACH/Benelux buyers, and dark marketing sites are now a
  dev-tool convention.
- **C — "Civic Modern".** GOV.UK-influenced warm institutional clarity.
  Ages well with 40–60-year-old consultancy owners; less distinctive.

The one visual move no competitor can copy without changing their
product: making the deterministic score breakdown the hero image.

## 5. UI design system (M0 deliverable)

Vanilla CSS custom properties — **no Tailwind, no CSS-in-JS** (CSP-safe by
construction, zero new runtime deps, preserves the existing test suite and
the "simple, fast, secure" brief).

- **Tokens**: full semantic scale replacing the current 6 —
  color (bg/surface/raised, text/muted/subtle, border/hairline, accent +
  on-accent, and THEMED status colors: strong/worth-reviewing/possible/
  excluded/danger/warning/success — fixing the 5 unthemed hexes), spacing
  scale (4px base: 1–24), type scale (fluid via `clamp()`, 12→40px),
  radii (2/4/8/999), shadows (2 elevations, subtle), z-index scale,
  measure (65ch reading width).
- **Typography**: self-hosted, subset woff2, OFL-licensed — **Inter
  variable** (UI + headings) and **IBM Plex Mono** (all numerals, scores,
  CPV codes, dates, prices; tabular figures). Budget ≤ ~90 KB combined;
  `font-display: swap`; system-stack fallbacks. (Owner may decline fonts
  → system stack with `font-variant-numeric: tabular-nums` as fallback
  plan; decision point D2.)
- **Dark mode**: keep `prefers-color-scheme` auto as the base; ALL tokens
  themed including status colors (WCAG AA in both themes); optional
  manual toggle deferred to M3 (decision D5).
- **Components** (in `apps/web/src/components/`, `packages/ui` stays
  empty until a second consumer exists): Button (primary/secondary/
  danger/quiet), ScoreBadge v2 (size variants, themed, text always
  present), ScoreBreakdownTable (the hero asset — renders component
  rows + points + status + explanation), Card, SectionHeading, Chip(+
  remove), Disclosure (for feed filters), Stepper (onboarding progress),
  SkeletonRow, EmptyState, Callout (info/warning/danger), StickySectionNav
  (settings), PageIntro. All keyboard-first, all status text+color.
- **Layout**: single `--layout-max` (72rem marketing / 64rem app) applied
  consistently to header/main/footer — fixes the width bug; consistent
  page gutters; breakpoints 40/64/90rem; mobile nav = simple disclosure
  (no JS-heavy drawer).
- **Brand basics**: SVG wordmark + minimal favicon set (SVG + PNG +
  apple-touch), `theme-color`, self-hosted static OG image (1200×630).

## 6. Information architecture & user flows

Public IA unchanged in structure (all existing routes keep their URLs):
`/` · `/pricing` · `/how-it-works` · `/methodology` · `/pilot` ·
`/privacy` · `/terms` · `/contact` + auth. Changes are within pages, plus
cross-linking: Home now funnels to Methodology (trust) and Pilot/Signup
(conversion); every marketing page ends with a CTA block (How-it-works
currently dead-ends).

Flow fixes (app):

1. **Post-login/verification routing**: user with no org → redirect to
   `/onboarding` instead of Feed's 403 message; deep-link preservation
   (`returnTo`) on the login redirect.
2. **402 paywall state**: Feed (and any entitlement-gated surface) renders
   a dedicated "subscription required" state with a Subscribe CTA that
   deep-links to Settings→Billing — never a generic error.
3. **Onboarding**: visual Stepper (progress bar + step labels), same
   10-step structure, presets promoted visually; completion screen keeps
   the honest scope-overlap warning.
4. **Post-checkout return**: dedicated `/app/billing/success` route
   (confirmation + "go to your feed"), replacing the silent return.
5. **Settings**: sticky in-page section nav (11 anchors), sections grouped
   into cards; per-section save preserved (no risky refactor of working
   forms).

## 7. Page-by-page plan (public site, M1)

- **Home** — hero: existing headline + new subhead naming mechanism and
  source ("Deterministic relevance scoring on every TED competition
  notice, matched to your company profile"); persona line ("Built for
  5–50-person IT, cyber and software consultancies without a bid team");
  primary CTA "Join the founding pilot", secondary "See how scoring
  works"; hero artifact = **real rendered ScoreBreakdownTable** of the
  canonical worked example (84.5/100 STRONG_MATCH fixture from
  docs/matching-engine.md — real component, not an image; crisp in both
  themes, zero image weight). Sections: the enemy ("Most tender alerts
  maximize volume. TED publishes 3,000+ notices every working day —
  your job is saying no fast."), 3-step how-it-works teaser with UI
  crops, honest-coverage box (verbatim scoped-coverage statement framed
  as a feature), anti-fine-print trust checklist (monthly billing,
  cancel anytime, no demo calls, price on the page, no third-party
  trackers), pricing teaser, founding-pilot CTA. TED statistics quoted
  are about TED (true, sourced), never fabricated product stats.
- **Pricing** — both prices in large type; founding card marked "First 20
  customers — €29/mo locked for the life of your subscription"; explicit
  "what happens when founding is full"; billing-honesty microcopy under
  CTAs ("Monthly. Cancel anytime in the customer portal. The price shown
  is the total amount charged."); short concrete feature list (same
  product both tiers — say so); "No enterprise tier. No sales calls.";
  pricing FAQ (coverage, score calculation, "Is this AI?" → honest
  deterministic answer, cancellation, no-relevant-tenders case).
- **How it works** — 5 steps kept, each with a visual (UI crop or small
  diagram: TED → parse → score → shortlist → digest); closing CTA block.
- **Methodology** — promote from compliance doc to trust asset: add the
  full worked example with annotations; keep every existing statement
  verbatim; add "same inputs + same engine version = identical score"
  framing; link prominently from Home hero.
- **Pilot** — founder-direct framing ("direct line to the person building
  BidMorrow" — truthful singular), what-you-get/what-we-ask kept.
- **Contact** — keep email-only (decided); add honest response
  expectation only if the owner commits to one.
- **Privacy/Terms** — visual restyle only; content untouched ("final
  legal text pending" flag stays until owner provides final text).
- **Auth pages** — restyled within the design system; no flow changes
  beyond `returnTo`.

## 8. Backend/API needs (deliberately minimal)

- **None required for M0–M1.** The Stripe return URL for the new
  `/app/billing/success` route is config-side (M2).
- Optional, each behind an owner decision: public founding-availability
  endpoint for a live "spots remaining" counter (D6 — must be wired to
  the real flag/cap or not exist); first-party page-view counter (D7 —
  product scope allows "minimal first-party events only"; default:
  defer).
- No schema changes. No new org-scoped endpoints. Worker changes limited
  to static-asset headers if needed (e.g., correct content-type for OG
  image — likely nothing).

## 9. Authentication, privacy & security considerations

- CSP is **load-bearing and unchanged**: no inline styles/scripts, no
  external origins. All fonts/images self-hosted; the design system is
  static CSS; the mockup's patterns comply.
- `ProtectedRoute`/`AdminGate` remain UX-only guards; server-side authz
  untouched. The 402/redirect changes are client rendering of existing
  server decisions — no authorization logic moves client-side.
- TED content remains text-only rendered (React escaping; ESLint ban on
  `dangerouslySetInnerHTML` stays); the ScoreBreakdownTable renders
  fixture/API data as text nodes only.
- No new cookies, no localStorage except the optional theme toggle (D5).
- Static-asset headers test (`tests/security/static-asset-headers.test.ts`)
  must stay green byte-for-byte unless a deliberate, reviewed change.
- `security` agent reviews M0 (headers/brand assets), M1 (new public
  surface), M2 (flow changes) before each is marked complete.

## 10. Accessibility, performance, SEO, analytics, testing

**Accessibility** (WCAG 2.2 AA target; current strengths preserved):

- Keep: semantics, labels, aria-pressed, live regions, skip links,
  text+color status, `:focus-visible`.
- Add: focus moved to `<h1>`/main on route change; `aria-current` on nav;
  feed tabs get arrow-key roving tabindex (or drop tab roles for a
  simpler list — decide in M2 implementation); contrast-verify every new
  token pair in both themes; `prefers-reduced-motion` respected by any
  transition; touch targets ≥ 24px.
- Manual pass in M4: 200%/400% zoom, 320px reflow, mobile viewport —
  the inventory found responsive behavior has never been tested.

**Performance**:

- Route-level code splitting: `React.lazy` boundaries for marketing /
  app / admin (admin must leave the customer bundle). Budget: marketing
  entry ≤ 150 KB uncompressed JS (from 357 KB), fonts ≤ 90 KB, CSS ≤
  25 KB. No new runtime deps. LCP stays text/HTML (hero table, no hero
  image).
- No third-party requests of any kind (CSP enforces).

**SEO** (hygiene only — programmatic SEO stays OUT of scope):

- robots.txt (allow marketing, disallow `/app`, `/admin`), sitemap.xml
  (8 marketing URLs), OG/Twitter meta + static OG image on all marketing
  pages, `<title>` for Feed/Onboarding, favicon set, `theme-color`,
  keep per-page canonicals. `noindex` meta on app/admin shells.

**Analytics**: none added (product rule). Conversion insight limited to
what Stripe/signup funnel already shows unless D7 approved.

**Testing**:

- Every existing suite stays green at every milestone; copy-locked tests
  updated deliberately in the same PR as copy changes.
- New: Playwright mobile-viewport project (390×844) running the
  marketing + critical-path specs; assertions for 402 state, onboarding
  redirect, billing success route; axe scans extended to new/changed
  states (still zero serious/critical, no exclusions); visual-regression
  screenshots (Playwright `toHaveScreenshot`) for the 8 marketing pages
  - feed + detail in both themes as an M4 baseline.
- `production-reviewer` re-runs all gates at each milestone end.

## 11. Milestones, order, acceptance criteria

Each milestone = one or more PRs to main via the normal gates (format,
lint, typecheck, 3 test suites, build, secret-scan) + staging auto-deploy
smoke. Security review on M0/M1/M2; production-reviewer at every
milestone end. Production deploy of the redesigned site happens only via
the owner-gated production workflow (bundled with go-live, or on owner
request in between).

**M0 — Design foundations & platform hygiene** (est. 1 session)
Tokens + type scale + fonts + layout-width fix + themed status colors +
wordmark/favicon/OG assets + robots/sitemap/meta/titles + `noindex` on
app shells. All pages restyled by tokens only (no structural rewrites).
Accept: all suites + axe green; width bug gone (header/main/footer share
one max-width at 360/768/1024/1440px); both themes AA-contrast for every
token pair; fonts self-hosted ≤ 90 KB; CSP tests byte-identical; no new
runtime deps.

**M1 — Marketing site redesign** (est. 1–2 sessions; highest conversion
impact) — Home/Pricing/How-it-works/Methodology/Pilot/Contact per §7,
ScoreBreakdownTable component + worked-example content, copy updates with
their locked tests. Accept: every claim traceable to a doc or guardrail
(product agent sign-off on copy); marketing spec + new assertions green;
axe green on all marketing pages; responsive at 4 widths; OG cards render
(manual check); CTA present on every page end; disclaimers/attribution
present exactly as before.

**M2 — App experience** (est. 1–2 sessions) — Feed (filters →
Disclosure with active-count badge, card hierarchy: score prominent,
title weight up, Strong accent border; skeleton loading; 402 paywall
state; `<title>`), TenderDetail polish (facts grid, breakdown table
restyle), onboarding redirect + `returnTo` + Stepper, `/app/billing/
success`, Settings sticky section nav + card grouping. Accept:
critical-path spec green including new 402 + redirect + success-route
assertions; keyboard spec green; axe green on app states; optimistic
save/ignore behavior unchanged; no server authz logic moved client-side.

**M3 — Performance & polish** (est. 1 session) — code splitting
(marketing/app/admin), bundle budget enforcement, focus-on-route-change,
`aria-current`, feed-tab keyboard model, reduced-motion, optional dark
toggle (D5). Accept: marketing entry ≤ 150 KB and admin absent from it
(verified from build output); no regression in any suite; keyboard spec
extended for tabs.

**M4 — QA hardening & reviews** (est. 1 session) — mobile-viewport
Playwright project, manual zoom/reflow pass, visual-regression baselines,
full gates, `security` + `production-reviewer` + accessibility review,
docs updated (accessibility-review.md, deployment notes), ledger updated.
Accept: all suites incl. new projects green in CI; reviewer sign-offs
recorded; then the paused launch pipeline resumes (first-ingestion
verification evidence → phase tag → Phase 14 audit → owner go-live).

## 12. Workstream/role mapping

UX research (done) · product/UI design (Direction A system + page specs —
lead session with `product` copy sign-off) · frontend (`frontend` agent,
implementation) · backend (`backend` agent, only if D6/D7 approved) ·
security (`security` agent, read-only reviews M0/M1/M2) · accessibility/
performance (dedicated pass in M4 + budgets in M0/M3) · QA (`qa` agent,
spec extensions + visual baselines) · `production-reviewer` at every
milestone end. All specialists operate as senior reviewers of their own
lane; no fabricated credentials or employment claims anywhere.

## 13. Decisions needed from the owner (approval gate)

- **D1 — Visual direction**: A "Ledger" (recommended; mockup provided),
  B dark, or C civic?
- **D2 — Self-hosted webfonts** (Inter + IBM Plex Mono subsets, ≤ 90 KB,
  OFL, CSP-compliant): yes (recommended) / no (system fonts + tabular
  numerals).
- **D3 — Copy changes to locked constants** (subhead, section copy; tests
  updated in the same PRs; headline/tagline itself unchanged): approve?
- **D4 — Vertical landing pages** ("/for/cybersecurity-consultancies"
  etc.): new public pages beyond the fixed V1 marketing list → default
  NO this cycle; revisit post-launch.
- **D5 — Dark-mode manual toggle** (localStorage, M3): default defer to
  auto-only; approve if wanted.
- **D6 — Live founding-spots counter** on pricing (needs a small public
  API wired to the real cap): default NO (static "first 20" wording).
- **D7 — First-party page-view counter** (privacy-preserving, no
  cookies): default NO for this cycle.
- **D8 — Founder note on Pilot page** (named, honest solo framing):
  owner's personal call; default NO until owner opts in.
- **D9 — Interactive scoring demo widget** (static bundled sample data,
  no backend): guardrail review says static worked example delivers most
  of the value; default NO this cycle.

Defaults require no action — approving the plan with "defaults" means:
Direction A, fonts yes, copy yes, D4–D9 no.
