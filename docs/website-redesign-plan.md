# Website & Interface Overhaul — Implementation Plan

Status: **AWAITING OWNER APPROVAL** (2026-08-17, rev. 2 after owner
feedback: macOS-style direction with Tendify as visual benchmark,
onboarding prioritized, pricing untouched). No implementation begins
until the owner approves this plan. Produced by three research
workstreams (frontend inventory, competitor/UX research, product-truth
guardrails) plus design/security/accessibility/QA synthesis. Competitor
browsing: the sandbox egress proxy blocks competitor hosts, so rendered-
page evidence is captured by the `competitor-screenshots` CI workflow
(Playwright on a GitHub runner → scratch branch `competitor-shots`) and
reviewed from those screenshots; §1a records what the rendered pages
show. Launch pipeline (Phase 13 tag → Phase 14 audit → go-live) is ON
HOLD behind this task per owner instruction (see
IMPLEMENTATION_LEDGER.md).

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

| Competitor                                                               | Position                                                                                                                           | Pricing                                                 | Beatable weakness                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stotles (UK benchmark)                                                   | "Win public sector contracts", AI-heavy suite                                                                                      | Free tier → ~£50/user → £475/mo                         | UK-centric; enterprise sprawl; black-box "AI" scoring                                                                                                                                                                                                                            |
| Mercell (pan-EU)                                                         | "Open the World of Public Business", 800k users                                                                                    | Demo-gated, no public prices                            | Zero price transparency; two-sided identity confusion; dated fragmented web estate                                                                                                                                                                                               |
| Tenders Direct                                                           | "Never miss a tender", human-curated                                                                                               | From £1,359/yr **paid upfront**                         | Price/commitment gap; recall framing solves the wrong problem for our ICP                                                                                                                                                                                                        |
| OpenOpps                                                                 | "860+ sources, 193 countries"                                                                                                      | ~£55/mo self-serve trial                                | Breadth-not-relevance; no vertical focus; low design polish                                                                                                                                                                                                                      |
| Tenderlake                                                               | "Total Tender Visibility", LLM explanations                                                                                        | £249–546/mo                                             | Priced out of SME; probabilistic explanations vs our deterministic ones                                                                                                                                                                                                          |
| TED (free baseline)                                                      | Official journal, 3,000+ notices/day                                                                                               | Free                                                    | Not a competitor — the raw-material story: "we read all 3,000 daily so you don't"                                                                                                                                                                                                |
| Tendify (owner-supplied screenshot, 2026-08-17 — direct visual evidence) | "Find, monitor, understand and manage tenders in one workflow"; AI chat ("Riko"); by-feature/role/market mega-menu; free-trial CTA | Free trial motion; prices not visible on the shown page | **The owner's design benchmark**: soft light ground, floating rounded product-UI cards embedded in marketing pages, pill CTAs. Weaknesses we beat: cookie banner/trackers (we run none — CSP-enforced), generic multi-role targeting, AI-chat framing vs our deterministic story |

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

**Owner directive (2026-08-17): modern macOS-style design language,
benchmarked against an owner-supplied Tendify screenshot** ("for example
that page"). The adopted direction is **D — "Mac Modern"** (Apple
HIG-inspired, Tendify-level polish), superseding the initial Direction A
recommendation. A rendered mockup of Direction D accompanies this plan
for approval. Concrete benchmark cues taken from the screenshot: soft
lavender-tinted light ground, white floating cards with large radii and
diffuse shadows, real product-UI previews embedded in marketing pages
(their pipeline card ↔ our score card), pill-shaped CTAs, quiet
hairlines. Deliberately NOT copied: their cookie banner/trackers (we run
none), mega-menu (our IA is 8 pages), "AI chat" framing (our story is
deterministic), any Tendify branding or copy.

- **D — "Mac Modern" (adopted).** Character: the calm, layered clarity of
  a modern macOS app. Frosted translucent surfaces (`backdrop-filter`
  vibrancy — pure CSS, CSP-safe), soft diffuse elevation, rounded
  geometry (10–16px radii), generous whitespace, restrained neutrals
  with one system-blue accent, first-class light AND dark themes
  (macOS's own strength — fixes the current unthemed status colors by
  construction). Typography: Apple system stack first
  (`-apple-system, BlinkMacSystemFont, …` → SF Pro on Apple devices,
  which cannot legally be self-hosted) with **self-hosted Inter** as the
  metric-compatible face everywhere else, plus a mono face for scores/
  CPV/dates. Controls follow HIG idioms: segmented control for the feed
  tabs, pill buttons, sheet-style dialogs, setup-assistant onboarding.
  Subtle motion (150–250ms ease-out transitions), always behind
  `prefers-reduced-motion`. The deterministic score breakdown stays the
  hero artifact — presented as a floating frosted card.

Directions considered and not adopted (kept for the record):

- **A — "Ledger".** Swiss/editorial audit-document precision; paper
  ground, hairline rules, monospace data. Was the initial
  recommendation; superseded by the owner's macOS-style directive. Its
  best discipline — tabular monospace for every number, score, CPV code
  and date — is carried into Direction D.
- **B — "Control Room".** Linear-adjacent dark technical authority.
  Strong pull for cyber/dev ICP; risk: reads startup-trendy to
  conservative DACH/Benelux buyers, and dark marketing sites are now a
  dev-tool convention.
- **C — "Civic Modern".** GOV.UK-influenced warm institutional clarity.
  Ages well with 40–60-year-old consultancy owners; less distinctive.

The one visual move no competitor can copy without changing their
product: making the deterministic score breakdown the hero image — in
Direction D, a floating frosted-glass score card.

### 4a. Premium-2026 treatment (owner's expanded brief, 2026-08-17)

- **Motion design** (all behind `prefers-reduced-motion`, CSS-first, no
  animation libraries): one orchestrated hero entrance (staggered
  fade/rise, 300–500 ms, once), scroll-triggered section reveals
  (IntersectionObserver toggling a class — CSP-safe), hover/press states
  on every interactive element (150 ms ease-out; defined per component
  in the system: hover raise on cards, press scale on buttons), a
  count-up on the hero score figure (deterministic number animating to
  84.5 — motion that _demonstrates the product's identity_), skeleton
  shimmer for loading. No parallax, no scroll-jacking.
- **Gradients/textures**: subtle only — a soft radial wash on the hero
  ground (lavender→blue tint at ≤ 6% saturation, macOS-wallpaper
  register) and optional ultra-fine noise on large surfaces; never
  behind body text, never as the accent's competitor. No loud
  multi-color gradient heroes (the 2023–24 SaaS cliché).
- **Interaction states**: full matrix specced per component in M0 —
  default/hover/active/focus-visible/disabled/loading — with tokens for
  each, so states are designed once, not improvised per page.

### 4b. Interactive & rich elements policy (what's in, what's not, why)

IN this cycle (each improves clarity for a skeptical technical buyer):

- **Interactive scoring demo** (D9 — now recommended YES per the
  owner's expanded brief): a marketing-page widget with static bundled
  sample data (sanitized real fixtures) — pick one of the 4 preset
  profiles, watch 3–4 real notices score live with visible point
  breakdowns. Pure client-side, no backend, no analytics, CSP-safe.
  Deterministic scoring makes this uniquely cheap for us and impossible
  for LLM competitors to ship as a static page.
- **Animated feature previews**: CSS/SVG-animated UI vignettes (digest
  email arriving, feed reordering by score) — hand-authored, no video.
- **FAQ accordions**: native `<details>/<summary>` (accessible,
  zero-JS), on Home — objection handling (coverage, "is this AI?",
  cancellation, no-relevant-tenders case). The pricing page stays
  frozen per directive, so the FAQ lives on Home/How-it-works.
- **Honest comparison module**: "BidMorrow vs typical tender-alert
  services" — attribute rows (price transparency, monthly vs annual
  upfront, explainable scoring, methodology published, trackers) with
  UNNAMED "typical" column, every row sourced from the documented
  research. Naming competitors would require re-verified per-claim
  evidence (decision D11 if the owner wants a named table).

OUT this cycle, with reasons:

- **Testimonials/logos**: zero customers + product-truth rules ban
  fabrication. The section ships as a design slot only when real pilot
  customers exist and consent (D10). Never faked, never "coming soon".
- **Sliders/carousels**: documented clarity anti-pattern (hidden
  content, poor a11y); the brief itself says "only where they improve
  clarity" — they don't here.
- **Video sections**: heavy assets + production cost; CSS/SVG animation
  delivers the same clarity within CSP/self-host constraints. Revisit
  post-launch if real product video is produced.
- **Stock photography / decorative AI imagery**: never — real UI only.

### 4c. Visual assets strategy (original or licensed, all self-hosted)

- **Icons**: a single consistent open-source set (Lucide, ISC license),
  subset to what's used, inlined as React SVG components — no icon
  font, no CDN. Covers UI + marketing.
- **Illustrations/diagrams**: original geometric SVGs authored in-repo
  (data-flow: TED → parse → score → shortlist → digest; coverage map
  motif), drawn from the design tokens so they theme automatically.
- **Product imagery**: REAL screenshots only, generated reproducibly by
  a Playwright capture script against seeded local data (both themes,
  retina scale) once M1/M2 restyles land — marketing images regenerate
  whenever the UI changes, so they never lie.
- **Background visuals**: the §4a gradient wash + optional noise,
  generated CSS/SVG, no raster downloads.
- **OG/social image**: designed static asset, self-hosted.
- Licensing rule: OFL/ISC/MIT assets only, licenses recorded in
  docs/dependency-versions.md; no unlicensed or "found" assets.

## 5. UI design system (M0 deliverable)

Vanilla CSS custom properties — **no Tailwind, no CSS-in-JS** (CSP-safe by
construction, zero new runtime deps, preserves the existing test suite and
the "simple, fast, secure" brief).

- **Tokens** (macOS-style semantics): full scale replacing the current 6 —
  color (bg/surface/raised + a TRANSLUCENT surface tier with
  `backdrop-filter` vibrancy and solid fallback, text/muted/subtle,
  border/hairline, system-blue accent + on-accent, and THEMED status
  colors: strong/worth-reviewing/possible/excluded/danger/warning/
  success — fixing the 5 unthemed hexes), spacing scale (4px base:
  1–24), type scale (fluid via `clamp()`, 12→40px), radii (6/10/16/999 —
  HIG-soft geometry), shadows (3 soft diffuse elevations), blur tokens,
  z-index scale, measure (65ch reading width), motion tokens
  (150/250ms ease-out, all behind `prefers-reduced-motion`).
- **Typography**: Apple system stack first (`-apple-system,
BlinkMacSystemFont, "Segoe UI", …` — SF Pro renders natively on Apple
  devices and cannot legally be self-hosted) with **self-hosted Inter
  variable** (OFL, subset woff2) covering non-Apple platforms, plus a
  mono face for all numerals, scores, CPV codes, dates and prices
  (tabular figures). Budget ≤ ~90 KB combined; `font-display: swap`.
  (Owner may decline fonts → pure system stack with
  `font-variant-numeric: tabular-nums`; decision point D2.)
- **Dark mode**: keep `prefers-color-scheme` auto as the base; ALL tokens
  themed including status colors (WCAG AA in both themes); optional
  manual toggle deferred to M3 (decision D5).
- **Components** (in `apps/web/src/components/`, `packages/ui` stays
  empty until a second consumer exists), HIG-idiom set: Button (pill,
  primary/secondary/danger/quiet), **SegmentedControl** (feed tabs),
  ScoreBadge v2 (size variants, themed, text always present),
  ScoreBreakdownTable (the hero asset — frosted card presentation),
  Card (soft elevation), FrostedPanel, SectionHeading, Chip(+remove),
  Disclosure (feed filters), **SetupAssistant frame + Stepper**
  (onboarding — see §6a), SkeletonRow, EmptyState, Callout
  (info/warning/danger), StickySectionNav (settings), Sheet-style
  dialog, PageIntro. All keyboard-first, all status text+color.
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
3. **Onboarding**: full overhaul — see §6a (owner priority).
4. **Post-checkout return**: dedicated `/app/billing/success` route
   (confirmation + "go to your feed"), replacing the silent return.
5. **Settings**: sticky in-page section nav (11 anchors), sections grouped
   into cards; per-section save preserved (no risky refactor of working
   forms).

### 6a. Client onboarding overhaul (owner priority, 2026-08-17)

The current wizard is 10 flat steps with text-only progress ("Step 3 of
10"), no visual structure, a flat list of 30 country checkboxes, and no
routing into it — new users land on a 403 message. Target: a
**macOS-setup-assistant experience** that gets a consultancy from signup
to a scoring-ready profile in minutes.

- **Entry**: automatic — after login/verification with no org, the user
  lands in onboarding, never on an error state.
- **Frame**: centered assistant card (frosted panel), one focused topic
  per screen, large friendly heading + one-line explanation of WHY each
  input improves scoring (e.g. "CPV codes drive 35 of your 100 points"),
  visible progress (stepper with labeled phases), Back always available,
  smooth step transitions behind `prefers-reduced-motion`.
- **Structure**: the 10 data steps regroup into 4 phases —
  1. Company (org + basics), 2) What you do (presets as rich selectable
     cards → CPV codes, keywords, capabilities/certifications),
  2. Where & what size (countries as grouped region picker with
     search, value range, deadline threshold, exclusions),
  3. Digest & review (digest prefs, review summary, complete).
     Server API unchanged — the same per-resource PUTs fire per phase;
     Skip preserved per phase (skippable without data loss).
- **Presets first-class**: the 4 presets rendered as selectable cards
  with a preview of what they prefill — defeating the cold start is the
  single highest-leverage onboarding feature (it already exists in
  domain; the UI undersells it).
- **Completion**: "You're all set" with the honest scope-overlap warning
  when applicable, then a guided first-feed moment (empty-state explains
  that ingestion runs daily and what to expect tomorrow).
- **Guardrails**: no dark patterns, all inputs keyboard-first, every
  step meets the axe gate; copy explains scoring truthfully (component
  weights from docs/matching-engine.md, never invented).

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
- **Pricing** — **owner directive 2026-08-17: no pricing changes.**
  Visual restyle within the design system ONLY: existing copy, prices,
  structure and CTAs stay exactly as they are (the copy-lock tests for
  this page stay untouched). The earlier proposals for this page
  (FAQ, extra microcopy, "what happens when founding is full") are
  withdrawn from this cycle.
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
Tokens (incl. motion tokens + full interaction-state matrix per §4a) +
type scale + fonts + layout-width fix + themed status colors + icon set
(Lucide subset, inlined SVG) + wordmark/favicon/OG assets +
robots/sitemap/meta/titles + `noindex` on app shells. All pages restyled
by tokens only (no structural rewrites). Accept: all suites + axe green;
width bug gone (header/main/footer share one max-width at
360/768/1024/1440px); both themes AA-contrast for every token pair;
fonts self-hosted ≤ 90 KB; icon licenses recorded; CSP tests
byte-identical; no new runtime deps beyond static SVG components.

**M1 — Client onboarding overhaul** (est. 1–2 sessions; **owner
priority 2026-08-17**) — the §6a setup-assistant experience: automatic
entry routing + `returnTo`, assistant frame (frosted panel, labeled
stepper, per-step "why this improves scoring"), 4-phase regrouping of
the 10 data steps, presets as rich preview cards, grouped-region country
picker with search, completion + guided first-feed empty state. Server
API unchanged. Accept: critical-path spec updated (new-user login lands
in onboarding, wizard completes through the new UI, skips still work,
scope-overlap warning preserved); axe green on every onboarding phase
(closing the "steps 2–10 unscanned" gap); keyboard-only completion
possible; no new endpoints; per-resource PUT payloads byte-compatible.

**M2 — App experience** (est. 1–2 sessions) — Feed (tabs → HIG
segmented control, filters → Disclosure with active-count badge, card
hierarchy: score prominent, title weight up, Strong accent treatment;
skeleton loading; 402 paywall state; `<title>`), TenderDetail polish
(facts grid, frosted breakdown card), `/app/billing/success`, Settings
sticky section nav + card grouping. Accept: critical-path spec green
including new 402 + success-route assertions; keyboard spec green
(segmented control keyboard model); axe green on app states; optimistic
save/ignore behavior unchanged; no server authz logic moved client-side.

**M3 — Marketing site redesign** (est. 2 sessions) —
Home/How-it-works/Methodology/Pilot/Contact per §7 in the Mac Modern
system; **Pricing/Privacy/Terms visual restyle only, zero content
changes** (owner directive); ScoreBreakdownTable worked-example hero
with count-up + hero entrance; **interactive scoring demo** (§4b, D9);
FAQ accordions; honest unnamed comparison module; animated feature
previews; original SVG diagrams; real-screenshot capture pipeline
(Playwright against seeded local data, both themes); copy updates
(non-pricing pages) with their locked tests. Accept: every claim
traceable to a doc or guardrail (product agent sign-off on copy — demo
data traceable to sanitized fixtures); marketing spec + new assertions
green (incl. demo interaction + FAQ semantics); pricing copy assertions
untouched and green; axe green on all marketing pages incl. the demo
widget; responsive at 4 widths; all motion inert under
`prefers-reduced-motion`; OG cards render (manual check);
disclaimers/attribution present exactly as before.

**M4 — Performance, QA hardening & reviews** (est. 1–2 sessions) — code
splitting (marketing/app/admin; ≤ 150 KB marketing entry, admin absent
from it), focus-on-route-change, `aria-current`, reduced-motion audit,
optional dark toggle (D5); mobile-viewport Playwright project, manual
zoom/reflow pass, visual-regression baselines, full gates, `security` +
`production-reviewer` + accessibility review, docs + ledger updated.
Accept: budgets verified from build output; all suites incl. new
projects green in CI; reviewer sign-offs recorded; then the paused
launch pipeline resumes (first-ingestion verification evidence → phase
tag → Phase 14 audit → owner go-live).

## 12. Workstream/role mapping

UX research (done — snippets + owner screenshot + CI rendered-page
capture) · product/UI design (Direction D system + page specs — lead
session with `product` copy sign-off) · **visual design** (icons,
original SVG illustrations, gradient/texture system, OG image,
screenshot pipeline — §4c) · frontend (`frontend` agent,
implementation) · backend (`backend` agent, only if D6/D7 approved) ·
security (`security` agent, read-only reviews M0/M1/M2) · accessibility/
performance (dedicated pass in M4 + budgets in M0/M4) · QA (`qa` agent,
spec extensions + visual baselines) · `production-reviewer` at every
milestone end. All specialists operate as senior reviewers of their own
lane; no fabricated credentials or employment claims anywhere.

## 13. Decisions — resolved by owner feedback + remaining defaults

Resolved by the owner (2026-08-17):

- **D1 — Visual direction: RESOLVED — Direction D "Mac Modern"**,
  benchmarked against the owner-supplied Tendify screenshot; mockup
  updated accordingly.
- **D-pricing — RESOLVED: no pricing changes.** Pricing page and all
  pricing copy stay exactly as they are; visual restyle only.
- **Priority — RESOLVED: client onboarding first** (M1).

Remaining, with recommended defaults (approving the plan with "defaults"
accepts these as stated):

- **D2 — Self-hosted webfonts** (Inter + mono subsets, ≤ 90 KB, OFL,
  CSP-compliant, Apple devices render SF Pro natively): default YES.
- **D3 — Copy changes to locked constants on NON-pricing pages**
  (subhead, section copy; tests updated in the same PRs; the headline
  tagline itself unchanged): default YES.
- **D4 — Vertical landing pages** ("/for/cybersecurity-consultancies"
  etc. — Tendify does the by-market equivalent): new public pages beyond
  the fixed V1 marketing list → default NO this cycle; revisit
  post-launch.
- **D5 — Dark-mode manual toggle** (localStorage, M4): default NO —
  auto `prefers-color-scheme` only (both themes fully designed either
  way).
- **D6 — Live founding-spots counter** (needs a small public API wired
  to the real cap): default NO.
- **D7 — First-party page-view counter** (privacy-preserving, no
  cookies): default NO for this cycle.
- **D8 — Founder note on Pilot page** (named, honest solo framing):
  owner's personal call; default NO until owner opts in.
- **D9 — Interactive scoring demo widget**: RESOLVED YES by the owner's
  expanded brief (interactive product demos requested) — static bundled
  sample data from sanitized real fixtures, pure client-side, §4b.
- **D10 — Testimonials/customer logos**: NO until real pilot customers
  exist AND consent — product-truth rules ban fabrication; the design
  reserves the slot, ships nothing fake. Revisit after the first
  consenting pilot customers.
- **D11 — Named-competitor comparison table**: default NO — the
  comparison module ships with an unnamed "typical tender-alert
  service" column (every row sourced from the research). Naming
  competitors requires re-verified per-claim evidence; owner may opt in
  later.
