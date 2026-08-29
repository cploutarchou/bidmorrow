# Website redesign — standing owner requirements and decisions

Authoritative record for the redesign workflow. Update it whenever the
owner decides something; never re-litigate what is recorded here.

## Rejected design directions (2026-08-17 — owner)

The owner reviewed and REJECTED all three initial directions. Do not
implement them or produce minor variations of them; new concepts must be
substantially different.

1. "Ledger" — editorial audit-document: warm paper ground, ink text, deep
   blue accent, hairline rules, mono data blocks.
2. "Control Room" — single-theme dark technical: near-black ground, teal
   accent, grid-line texture, glowing score readouts.
3. "Mac Modern" (rev. 1) — literal macOS treatment: frosted sticky nav,
   macOS window chrome with traffic-light dots, #0071e3 accent.

"Substantially different" means a different concept (hero thesis, layout
model, storytelling device, personality) — not a re-skin of the above.

## Standing decisions

- **Pricing frozen**: €29/€49 flat EUR, plan structure and substance
  unchanged. Presentation may be restyled; content/claims may not change.
  Reaffirmed 2026-08-17 under competitive pressure (do NOT switch to USD;
  "$" in owner directives is shorthand for the existing EUR pricing). No
  pricing experiments until ~10 sales conversations + 3–5 payments; never
  discount below €29.
- **No free tier / no automated trial**; entry path is a no-card manual
  5-day validation pilot, personally onboarded (owner 2026-08-17).
- **Public sample-verdict demo is IN** (controlled, no-signup, 3–5
  curated verdicts across Strong Match / Worth Reviewing / Low Fit /
  Excluded, each fully explained with source link; CTA "Get verdicts
  matched to your company"). It must NOT become a free tier: no anonymous
  tender submission, profile creation, alerts, or full-feed access.
- **Deterministic explainable scoring is REQUIRED**; no LLM in the core
  scoring path in V1 (LLM later only for doc summarization/requirement
  extraction, never manufacturing the verdict). Explainability — not
  "AI" — is the acquisition advantage.
- **Programmatic per-tender SEO pages OUT**; a small number of
  manually-authored commercial category pages (`/cybersecurity-tenders`,
  `/cloud-tenders`, later `/software-development-tenders`) is IN.
  Full policy: `docs/product-scope.md` §Product policy lock (2026-08-17).
- **Onboarding is the top UX priority** for the interface work.
- **Visual character: macOS-INSPIRED** — refined typography, generous
  spacing, layered surfaces, elegant depth, tasteful translucency, soft
  shadows, controlled gradients, polished icons, smooth transitions,
  meaningful micro-interactions, strong product storytelling. Inspiration
  only: never copy Apple's website, layouts, branding, proprietary assets
  (SF Pro cannot be self-hosted), or interface components.
- **Same stack**: approved designs are migrated faithfully into React 19 +
  Vite + react-router + vanilla-CSS tokens. No stack rebuild, no
  disconnected prototype as the deliverable.
- **English-only launch, i18n-ready architecture** (centralized message
  catalogs incl. metadata/validation/a11y labels/emails; mature i18n
  library; locale-aware formatting; RTL-prepared; language selector hidden
  until a second language; hreflang/localized sitemaps only at
  activation; documented activation process).
- **Testimonials/social proof**: only when real customers exist — never
  fabricated. Named competitor comparisons: not without owner approval.
- **Sliders/carousels**: only where they genuinely improve comprehension,
  and only fully accessible (keyboard, touch, screen reader, pause,
  reduced motion).

## Hard technical constraints

- CSP (load-bearing, triple-enforced): `script-src 'self'; style-src
'self'; font-src 'self'` — no unsafe-inline, no CDN assets, no runtime
  CSS-in-JS injection, no third-party scripts/analytics. Enforced in
  `apps/web/public/_headers`, Hono secureHeaders, and byte-exact in
  `tests/security/static-asset-headers.test.ts`. JSON-LD needs an
  explicit CSP-compatible mechanism.
- TypeScript strict; pnpm; modular monolith; no LLM in the production
  request path; fixed infra < $100/month.
- Marketing copy constants in `apps/web/src/copy.ts` are locked by
  `apps/web/src/app.test.ts` — copy changes update tests in the same PR.
- Procurement content is untrusted input — never render as HTML.
- Public tender-detail SEO pages are OUT of V1 scope.

## Content truth rules

No fake testimonials/logos/stats/reviews; no exhaustive-coverage claims;
no "AI-powered" framing (deterministic, LLM-free engine — stating that
truthfully is fine); TED attribution (Commission Decision 2011/833/EU)
and decision-support disclaimer mandatory; founding-cap honesty ("first
20"); honest CPV coverage statement. No keyword stuffing, hidden text,
doorway pages, or manipulative SEO.

## Libraries

New dependencies are allowed when they materially improve design quality,
interaction, accessibility, implementation speed, or reliability. Before
adding one, evaluate: framework compatibility, maintenance/maturity,
security history, accessibility, licensing, bundle-size and runtime
impact, whether the existing stack already covers it, and whether a small
internal implementation is more appropriate. Avoid overlap. Record every
added dependency and its rationale in `docs/dependency-versions.md` and
the shared plan. Verify current API syntax via the `verify-current-docs`
skill — never from memory.

## Approval and pause rules

- Mandatory stop at the Stage 3 approval checkpoint (13-item package).
- After direction approval, implement autonomously; pause only for:
  material design/scope changes, removal or change of existing
  functionality, paid services or restricted assets, credentials/
  production deployment/sensitive data, or serious security, privacy,
  legal, or architectural risks.
- Launch-pipeline note: the phase-13→14 go-live pipeline is ON HOLD until
  this redesign completes; production ingestion stays paused until the
  owner's explicit go.

## Decisions log

- 2026-08-17: Initial three directions rejected (see above); workflow
  restarted at research/creative exploration with this reusable system.
- 2026-08-17 (~06:05 UTC): **Owner APPROVED Direction G — "Strata"**
  ("i like strata"). ADOPTED for implementation. Reference mockup:
  claude.ai/code/artifact/d841bf21-aafa-4634-bbb8-0ca92f280ff5 (source
  committed at `docs/redesign/mockups/direction-g-strata.html`).
  Character: dark-first ink-navy (#0C142E family) with warm solar
  apricot→rose accent, fully designed daylight twin, tasteful glass with
  reduced-transparency/no-backdrop-filter fallbacks, Sora display +
  Hanken Grotesk body + JetBrains Mono data (self-hosted OFL, ≤90KB
  total — measure at install; trim weights/axes to fit). The mockup's
  in-page theme toggle is part of the approved design (supersedes the
  earlier D5 "auto-only" default). Round-2 E "Verdict" and F "Daylight"
  were NOT adopted (kept for the record; their research-backed devices —
  e.g. the funnel-reduction narrative, live-demo honesty — may inform
  Strata-styled sections only if they fit the Strata concept).
  Implementation caveat (recorded at checkpoint): mockup score-anatomy
  labels are illustrative — re-base all shipped score UI/demos on the
  real engine components in `docs/matching-engine.md`.
- 2026-08-17 (later): **Owner supplied new competitive intelligence and
  gated further Strata implementation on a competitive-risk + sales
  investigation.** Owner-reported (TO BE VERIFIED, not yet fact):
  GetTenderAI — unlimited match scores from €235/month; Tenderium —
  €9 pay-as-you-go tender risk scans + €99/month workspace; Stotles —
  limited free bid/no-bid reporting. Owner's own read: the wedge is
  being validated AND compressed (their internal score 91→90). Two
  permanent agents created: `competitive-intelligence` and
  `sales-strategist`. GATE: M0.1 technical foundations (tokens/fonts/
  icons — positioning-neutral, already in flight) may land; M0.2 onward
  and ALL positioning-sensitive work (copy, metadata, messaging,
  pricing presentation) wait until the investigation is integrated into
  the plan. Pricing substance remains FROZEN — competitive pressure does
  not unfreeze it; any pricing/packaging response is an owner decision.
- 2026-08-17 (~11:20 UTC): **Competitive investigation COMPLETE and
  verified.** CI Playwright capture (branch `competitor-shots`) confirmed
  the load-bearing snippet claims: Tendly (tendly.eu) is a real, distinct
  competitor at €29/mo (credit-metered, LLM matching) — R1 High stands;
  Tenderium's €9 PAYG scan is real but the site is pre-transactional
  (invoice-only, "coming soon") — threat lowered. Full register:
  `docs/redesign/competitive-risk-assessment.md`; positioning response:
  `docs/redesign/sales-strategy.md`. Net: the deterministic/auditable moat
  is intact; "explained score" is now table stakes so the claim escalates
  to "auditable arithmetic you can re-run, not generated prose."
- 2026-08-17 (~11:45 UTC): **Owner locked product policy** (full text:
  `docs/product-scope.md` §Product policy lock). Decisions: pricing NO
  CHANGE (€29/€49 EUR retained; "$" was shorthand); founding cap revised
  to first 25–50 (single number **50** selected 2026-08-17 — see below); no free
  tier; no automated trial (no-card manual 5-day pilot instead); **public
  sample-verdict demo IN** (controlled, not a free tier); manually
  authored commercial category pages IN; programmatic per-tender SEO OUT;
  **deterministic explainable scoring REQUIRED, no LLM in the core scoring
  path in V1**. **GATE LIFTED**: with the investigation integrated and
  policy locked, positioning-sensitive redesign work (messaging, the
  sample-verdict demo, methodology/category pages, M0.2+) is UNBLOCKED and
  proceeds under these decisions. Author identity for repo commits set to
  the owner (Christos <cploutarchou@gmail.com>) per owner request; Claude
  co-author trailers dropped going forward.
- 2026-08-17 (~17:00 UTC): **GTM investigation delivered.** Marketing
  (`docs/redesign/marketing-strategy.md`) and sales acquisition motion
  (`docs/redesign/sales-strategy.md` §8) produced by the marketing-manager
  and sales-strategist agents. Top acquisition channels: founder-led
  LinkedIn (free), the public sample-verdict demo as the conversion engine,
  and community/consultant referral; single highest-leverage first move =
  ship the demo + founder posting to it. GDPR/ePrivacy limits codified (no
  scraped bulk cold email; LinkedIn 1:1 as compliant outbound). No paid
  spend committed — all paid channels remain flagged owner decisions.
- _(Both figures in this entry were later superseded: the cap became 100 and prices became tax-inclusive, both by owner decision 2026-08-26. Kept verbatim as the dated record of what was decided on 2026-08-17.)_
- 2026-08-17 (~17:10 UTC): **Founding cap DECIDED = 50** (owner picked the
  single number from the 25–50 range; billing agent's non-binding rec had
  been 30). Canonical EUR pricing spec written
  (`docs/redesign/pricing.md`): €29/€49 frozen, feature-identical plans,
  Paddle prices required in EUR, monthly, tax-exclusive (ADR-0011),
  margin >99% at every modeled scale. Cap = 50 reconciled across every
  surface in one change: `Pricing.tsx`/`Pilot.tsx`/`Terms.tsx` copy +
  metas, `DEFAULT_FOUNDING_CAP = 50` (backs the `founding_cap` flag),
  `plans.test.ts` numeric lock, doc comments, and `docs/product-scope.md`.
  Correction: the prior note that cap copy lived in `copy.ts`/`app.test.ts`
  was stale — neither references the cap.
- 2026-08-18 (~09:55 UTC): **Owner SWITCHED the approved design direction to
  Direction B — "Control Room"** ("i just notice about new mockup control
  room and to be honest i like more"; confirmed via structured question).
  Decisions: **FULL SWITCH** — the public marketing site AND the app
  interface are re-skinned in Control Room; **SINGLE-THEME DARK ONLY, as
  designed** — the theme toggle is removed and the Strata daylight twin is
  retired. Structure, copy, IA, pricing presentation, and page set are
  UNCHANGED — this is a visual re-skin, not a content or scope change.
  Reference mockup: claude.ai/code/artifact/701f686f-c51b-470a-9d0d-ab5a5995549d
  (source committed at `docs/redesign/mockups/direction-b-control-room.html`).
  Character: near-black `#0b0d11` ground, panel `#12151b`/`#161a22`, ink
  `#e8edf4`, teal accent `#35d3c0` (on-accent `#062723`), strong `#4ade80`,
  risk `#f87171`, faint 64px grid-line texture, glowing tabular-mono score
  readouts, terminal wordmark (`BidMorrow` + teal `_` cursor), system sans
  (`-apple-system` stack) + `ui-monospace` stacks — NO webfonts (the
  @fontsource Sora/Hanken/JetBrains packages become removable). This entry
  SUPERSEDES the 2026-08-17 Strata adoption above (kept for the record);
  the round-1 "Control Room" rejection stands — Direction B is the distinct
  second-round concept, not a revival of the rejected one. Carried-over
  implementation caveats: mockup copy is illustrative where it conflicts
  with shipped copy (e.g. its "first 20 customers" line is stale — cap is
  50; shipped copy is authoritative); score-anatomy labels re-base on
  `docs/matching-engine.md`; brand mark + favicon are kept but re-colored
  from the solar gradient to the teal accent; CSP constraints unchanged
  (no inline styles — the mockup's inline `style="width:…"` bars must be
  implemented CSP-safe); WCAG 2.2 AA contrast verified on the dark ground.
