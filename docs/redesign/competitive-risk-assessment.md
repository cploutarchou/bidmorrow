# Competitive risk assessment — AI-scoring entrants and free-tier pressure

Living risk register maintained by the `competitive-intelligence` agent.
First issued 2026-08-17 in response to the owner's competitive-intelligence
gate (see `.claude/skills/website-redesign/requirements.md` §Decisions log,
2026-08-17 entry). Companion to `docs/redesign/competitor-findings.md`
(rendered-page analysis of the seven previously profiled sites).

**Evidence-quality labels** used throughout:

- **VERIFIED-direct** — observed on the competitor's own page via direct
  fetch, the CI Playwright capture pipeline, or owner-supplied
  screenshots of the live page (the GetTenderAI evidence below is
  owner-supplied screenshots, 2026-08-17: homepage, public tenders list,
  pricing page; the screenshots cannot be committed to the repo, so the
  observed content is described precisely in §1a/§2 instead).
- **VERIFIED-snippet** — corroborated by search-index snippets/cached
  descriptions of the competitor's own pages (content current as indexed;
  wording may be paraphrased by the search layer).
- **PARTIAL** — one component of a claim corroborated, another not.
- **UNVERIFIED** — searched for and not found; treated as not established.

Constraints honored: direct WebFetch to competitor hosts is egress-blocked
from this sandbox (confirmed 2026-08-17 for `gettenderai.com`,
`tenderium.net`, `ailucius.com`; `web.archive.org` also unreachable), so
new evidence is search-snippet grade except where owner-supplied
screenshots provide direct visual evidence (GetTenderAI). A
capture-pipeline upgrade queue is listed in §9. A competitor's claim
about itself is recorded as their claim, not as observed fact. All
retrievals: 2026-08-17.

---

## 0. VERIFICATION UPDATE — CI Playwright capture, 2026-08-17

The §9 capture queue was run (branch `competitor-shots`, full-page
desktop capture, 2026-08-17T11:20Z). It **confirms the two highest-stakes
snippet-grade items**; both are hereby upgraded to **VERIFIED-direct**.
Where this update and the body below disagree, this section governs.

- **Tendly (tendly.eu) — R1 CONFIRMED, stays High.** Real, distinct
  company (Tendly OÜ, Tallinn, Estonia + a UK office; tagline "Win More
  Tenders for Less Than 1€/day") — **not** a Tendify confusion. Pricing
  page confirms **Professional €29/month in EUR** (Free / Pro €29 /
  Enterprise €149 / Strategist €199; credit packs €15/€45/€69). The €29
  vs $29 ambiguity resolves to **€**. Sharpened nuance from the page: the
  paid €29 tier is **credit-metered** — 200 credits/month, and AI tender
  matching costs 5 credits per manual refresh (~40 matches/mo), with only
  the _insights_ (AI chat, detail, risk, competitor) unlimited on paid;
  matching itself is capped. Matching is explicitly **AI/LLM**
  ("AI insights", generated rationale) — non-reproducible and
  non-decomposable. Net effect: the price collides, but our
  differentiation is _stronger_ than the body first framed — BidMorrow's
  scoring is genuinely unlimited (no credits), deterministic, and
  auditable; theirs is metered AI. Use "unlimited, deterministic,
  auditable — no credits, no meter" as the direct counter.
- **Tenderium (tenderium.net) — owner claim (b) CONFIRMED; threat level
  LOWERED.** The **€9 pay-as-you-go "Quick Check" is REAL** (page chips:
  "€9 per Quick Check", "€20 for 3 Quick Checks") — upgrade claim (b)/R8
  from UNVERIFIED to VERIFIED-direct. A Quick Check is "an AI-assisted
  risk and preparation scan of one tender" (obligations, deadlines,
  source-linked risks; "not legal advice") — a per-tender AI risk scan,
  adjacent to but not identical with our bid/no-bid verdict. Tiers
  confirmed: Demo €0 / Starter €99 (€89 annual) / Growth €279 / top €699.
  **Decisive caveat, verbatim from the page:** _"This page is
  informational only. There is no live subscription checkout, billing
  integration, or automatic paid access gate on the site yet"_ —
  invoice-first, "request access", many features tagged "coming soon".
  Tenderium is therefore **early-stage / pre-transactional**: a real
  positioning signal, not yet a live commercial threat. Any risk-register
  severity for Tenderium should reflect "credible but not yet
  transacting."
- Captures that FAILED (record only): `gettenderai-pricing`
  (timeout — already VERIFIED-direct via owner screenshots, so no loss);
  `tenderlake-home` (HTTP/2 error). `tendly-compare-tendium` rendered
  near-empty (24KB) — the compare page is not load-bearing evidence.

---

## 1. Verification of the three owner-reported claims

### 1a. "GetTenderAI: unlimited match scores from €235/month"

**Verdict: VERIFIED — VERIFIED-direct via owner-supplied screenshots
(2026-08-17). The claim is accurate as stated, and the observed detail
around it changes its meaning substantially in our favor at the value
layer while revealing a sharper threat at the acquisition layer.**

Observed on the pricing page ("Transparent pricing. No surprises.";
billing toggle Monthly / 6-months −11% / Annual −17%; footer: no long
contracts, EUR, EN & FR support) — owner-supplied screenshots,
2026-08-17:

- **FREE**: 10 AI searches/mo, 5 AI document analyses/mo, **5 match
  score checks/mo**, full EU tender catalog.
- **BASIC €235/mo**: 200 searches, 20 doc analyses, **unlimited match
  scores**, full catalog. ← the owner's claim, confirmed.
- **PRO €319/mo** ("Popular"): 500 searches, 40 analyses, unlimited
  match scores, **AI relevance explanations**, search history.
- **BUSINESS €420/mo**: 1,000 searches, 70 analyses, priority API.

Three observed facts matter more than the headline number:

1. **Match scores are metered, and explanations are a paid add-on.**
   Free users get 5 score checks/month; unlimited scoring starts at
   €235; the _explanation_ of why a tender is relevant is paywalled a
   tier higher, at €319/month. BidMorrow ships unlimited deterministic
   scores with full component-level explanations included at €29.
2. **The "EU" claim is thin in practice.** Observed catalog facets:
   countries FR 22,215 · DE 12 · IT 2 · ES 0 · GB 0 — with a stats row
   of "46,156 tenders indexed · 22,027 still active · 3 EU countries."
   Honest arithmetic, but effectively a **France product** today.
3. **They ingest France's national bulletin (BOAMP: 4,163 notices vs
   TED 18,066 in the source facet).** BOAMP carries French
   **sub-threshold** national notices that TED does not — a genuine
   coverage advantage over BidMorrow _for French buyers_, since
   sub-threshold contracts are exactly where very small firms often
   play.

Also observed (homepage): violet/indigo AI-SaaS branding; pill badge
"AI-powered EU tender discovery"; H1 "Find EU tenders. Faster, smarter,
in any language."; subhead "Semantic AI search across 46,156 European
public procurement notices — and growing daily"; primary interaction is
a search box with a "Search with AI" button and example chips
(Construction Paris, IT consulting, Healthcare equipment, Renewable
energy); how-it-works header **"From thousands of notices to the few
that matter"** — a near-collision with BidMorrow's reduction/inversion
messaging space (see R9); cookie-consent banner disclosing analytics and
marketing cookies; EN/FR language toggle. The public tenders list is
browsable without login, with per-tender SEO URLs (French-language
notices dominate) and category facets including Consulting 3,214 · IT &
Telecom 1,434 · Construction 5,845.

Method note: none of this pricing content was present in the search
index (repeated domain-restricted and exact-phrase searches on
2026-08-17 returned no pricing at all) — a caution about relying on
snippet-grade evidence for young sites, and the reason the earlier draft
of this section wrongly leaned toward "unverified." The owner-supplied
screenshots supersede those snippet-level conclusions. Separately, the
snippet phrase "unlimited reveals" also led this investigation to
**Tendly** (`tendly.eu`), which is retained below as an
analyst-identified threat in its own right — an unlimited-AI-matching
competitor at ~€29/month.

### 1b. "Tenderium: €9 pay-as-you-go tender risk scans and €99/month workspace"

**Verdict: PARTIAL — the €99/month workspace tier is VERIFIED-snippet;
the €9 pay-as-you-go risk scan is UNVERIFIED.**

What was found (VERIFIED-snippet from `tenderium.net` and
`tenderium.net/pricing` snippets, retrieved 2026-08-17):

- Tenderium exists at <https://tenderium.net/> — "AI-Powered Tender
  Analysis," EU and UK procurement sources.
- Pricing is "built around Tender Workspaces":
  - Free demo tier: 3 Tender Workspaces (lifetime), 1 country,
    source-aware tender browsing, basic AI summary and insights.
  - **Starter: €99/month (€89 billed annually)** — 25 Tender Workspaces
    per month, 2 countries, unlimited AI chat inside workspaces, smart
    filters and alerts.
  - Growth ("Most popular"): €279/month (€249 billed annually) — 100
    Tender Workspaces per month.
- Mechanism (their claims): the system "highlights participation
  requirements, deadlines, and procedural conditions directly from tender
  documents, with references to the source text" and "identifies key
  contractual clauses and risk indicators … with traceability to the
  original source"; plus document checklists, relevance-ranked alerts,
  and participation analytics. So a "risk scan"-like capability exists.
- One indexed description states plans are "offered through contact and
  tailored setup" rather than instant self-serve checkout — i.e., the
  listed tiers appear to be contact-gated, not one-click purchases
  (snippet-grade; the two snippets are not fully consistent with each
  other and this should be capture-verified).

What was NOT found (exact-phrase and domain-restricted searches for
"€9", "pay-as-you-go", "risk scan", "per scan"):

- Any €9 price, any pay-as-you-go or per-scan pricing on Tenderium.
  **UNVERIFIED.** No indexed source associates Tenderium with PAYG
  pricing at all. (A possible confusion source exists in the category:
  "TenderScan Decision Engine" at `tenderscanai.com` advertises a
  per-report price of AED 99 — a different company, different price,
  different currency.)

Net: Tenderium is **not** a bottom-undercutting €9 threat on current
evidence. It is a €99–279/month, workspace-metered, apparently
contact-gated team product with a small free demo.

### 1c. "Stotles gives away limited bid/no-bid reporting" (free tier)

**Verdict: VERIFIED — VERIFIED-snippet on current pages, consistent with
our prior VERIFIED-direct capture of the pricing page.**

- Current `stotles.com` pages state, as indexed 2026-08-17: "see if you
  can win an open tender in minutes with a **free, AI-powered bid/no-bid
  report**," and describe the free plan as including unlimited users,
  tender discovery, and core workflow tools
  (<https://www.stotles.com/pricing>,
  <https://www.stotles.com/platform/win-bids>).
- Our own 2026-08-17 Playwright captures (see `competitor-findings.md`
  §2) had already directly verified a Free £0 plan (tender tracking +
  pre-tenders) and the homepage step "Go straight from bid/no-bid to
  first draft."
- Scope of the giveaway, per their own framing: the bid/no-bid report is
  the **hook into their AI bid-writing upsell** (Bid Studio), not a
  standalone qualification product; the platform remains UK-first and
  GBP-priced, with real capability starting near £475/month.

---

## 2. Entrant profiles (to the depth the evidence supports)

### GetTenderAI (gettenderai.com)

Evidence: owner-supplied screenshots, 2026-08-17 (VERIFIED-direct),
plus search snippets of the same date. Full pricing detail in §1a.

- **Positioning**: "AI-powered EU tender discovery" — multilingual,
  search-first ("Search with AI" box as the primary interaction), not
  verdict-first. A **search-pull** model: the user asks a question and
  gets candidates. BidMorrow is **qualification-push**: a standing
  profile, a continuously scored feed, and a verdict per tender. These
  are different jobs, and the distinction must stay visible in our copy.
- **Product mechanism as claimed/observed**: daily TED + BOAMP
  ingestion; semantic AI search over 46,156 indexed notices (22,027
  active); 3–5-bullet AI summaries (snippet); metered per-tender match
  scores; "AI relevance explanations" as a €319-tier feature; free
  accounts with saved tenders and alerts; public no-login tender catalog
  with per-tender SEO URLs; EN/FR locales.
- **Pricing model** (VERIFIED-direct): freemium with usage meters —
  Free (10 searches / 5 doc analyses / 5 match score checks per month)
  → €235 Basic (unlimited match scores) → €319 Pro (adds relevance
  explanations, history) → €420 Business (priority API); monthly /
  6-month −11% / annual −17%; EUR; no long contracts.
- **Target customer**: in practice, **French bidders** across sectors
  (FR 22,215 notices vs DE 12 · IT 2 · ES 0 · GB 0); the "EU" framing
  is aspiration, honest only via the "3 EU countries" stats line.
- **Real strengths**: BOAMP sub-threshold depth for France (a coverage
  layer BidMorrow does not have); zero-friction public catalog and a
  compounding programmatic SEO surface; multilingual semantic search;
  transparent self-serve EUR pricing; honest live stats row.
- **Real weaknesses**: scoring is AI/semantic — non-deterministic and
  unexplained below €319, and _nothing_ in the observed product commits
  to reproducibility or auditable components at any price; "EU"
  positioning is attackable on their own facet numbers; metered free
  tier (5 score checks) creates a value cliff at €235 — an enormous
  step for a small firm; no visible ICP or qualification thesis;
  analytics/marketing cookies posture vs. our tracker-free CSP stance.
- **Threat type**: at the **value layer**, mostly favorable to us —
  their price ladder proves scoring + explanations carry €235–420/month
  willingness-to-pay, and makes our all-inclusive €29 look like the
  honest version rather than the budget version. At the **acquisition
  layer**, a real threat: the free metered tier and the public
  per-tender SEO pages capture exactly the early-funnel searches our
  ICP makes (their catalog already shows Consulting 3,214 and IT &
  Telecom 1,434 categories), and their "From thousands of notices to
  the few that matter" line squats on our reduction-narrative messaging
  space (R9).

### Tenderium (tenderium.net)

- **Positioning** (VERIFIED-snippet): "AI-Powered Tender Analysis" for
  procurement teams — deep single-tender analysis inside metered
  "Tender Workspaces," EU + UK sources.
- **Product mechanism as claimed**: per-tender workspace bundling
  document-grounded AI extraction of requirements, deadlines, and
  procedural conditions with source references; contractual-clause and
  risk-indicator identification with traceability; document checklists
  and preparation tracking; relevance-ranked alerts; participation
  analytics; unlimited AI chat inside a workspace.
- **Pricing model**: free demo (3 lifetime workspaces, 1 country);
  Starter €99/mo (25 workspaces, 2 countries); Growth €279/mo (100
  workspaces); apparently contact-gated setup rather than self-serve.
- **Target customer**: small-to-mid bid teams that go deep on a
  meaningful number of tenders per month across 1–2 countries — a step
  up from BidMorrow's tiny-firm ICP in both workflow weight and price.
- **Apparent strengths**: source-traceable extraction ("with references
  to the source text") is the closest any entrant comes to an
  evidence-linked analysis story; workspace metering maps price to
  usage; free demo lowers first contact.
- **Apparent weaknesses**: analysis starts _after_ you have chosen a
  tender — it does not decide the portfolio question ("which of these
  200 is worth opening?"); €99 for 2 countries is expensive next to
  flat-price EU-wide alternatives; contact-gated checkout adds friction;
  LLM extraction quality is asserted, not auditable.
- **Threat type**: adjacent, not head-on. It sells depth-per-tender;
  BidMorrow sells the upstream verdict across the stream. The risk is
  vocabulary overlap ("requirements, deadlines, risk indicators") more
  than customer overlap.

### Tendly (tendly.eu) — analyst-identified; not in the owner's list

- **Positioning** (VERIFIED-snippet): "AI Tender Management Software to
  Win More Bids" — AI matching with per-match written rationale, plus
  AI document generation, across 23 monitored countries including TED
  and national/local portals.
- **Product mechanism as claimed**: every matched tender gets a match
  score with "a written reason why a tender fits your company
  specifically," banded (98–100 perfect / 85–97 strong / 60–84
  possible); credit-metered actions on free tier; "unlimited reveals"
  (full match detail: title, AI rationale, metadata, actions, no credits
  deducted) on the paid plan; document auto-fill/generation; comparison
  marketing pages (e.g. `tendly.eu/en/compare/tendly-vs-tendium`).
- **Pricing model**: free plan (10 credits/month; 20 credits at signup;
  no card); **Professional ~€29/month** ("full AI matching, unlimited
  document generation, priority support"; currency rendered as € in one
  snippet and $ in another — flagged for capture verification);
  Enterprise ~€149/month; EUR credit packs €15/€45/€69.
- **Target customer**: SMB bidders EU-wide, sector-agnostic.
- **Apparent strengths**: **price-point collision — unlimited AI match
  scoring with per-match rationale at the same €29 BidMorrow charges**,
  plus a free tier under it; scored-match-with-reasoning is precisely
  the surface a buyer will compare against BidMorrow's verdict; active
  comparison-page SEO shows go-to-market aggression.
- **Apparent weaknesses**: LLM-generated rationale is non-reproducible
  and unauditable (their "reason" is generated text, not a decomposable
  score); credit mechanics complicate the "free" story; generalist
  breadth, no ICP depth, no visible provenance/coverage honesty; no
  observed risk-flag or hard-exclusion concept — "fit" without
  "disqualifiers" is half a verdict.
- **Threat type**: the most direct wedge threat found in this
  investigation — same price, adjacent claim, lower floor (free).

### Stotles free tier — scope (stotles.com)

- Free plan (their description): £0, unlimited users, tender discovery
  and tracking across "countless portals," pre-tender signals, core
  workflow tools, and a **free AI-powered bid/no-bid report** ("see if
  you can win an open tender in minutes").
- Function in their funnel: top-of-funnel bait for a sales-led ladder
  (£99 thin tier → ~£475 real tier → enterprise), and the explicit
  trigger for their AI bid-drafting upsell ("go straight from bid/no-bid
  to first draft").
- Limits: UK-first, GBP-only, enterprise-flavored proof (logo wall);
  the report's methodology is unexplained ("AI-powered" is the entire
  justification). Scope labeled VERIFIED-snippet; exact free-tier
  feature boundaries beyond the above are not established.

---

## 3. Threat analysis — what this validates, what it compresses

### What each development validates about our market

- **Stotles giving bid/no-bid reporting away** validates that
  qualification is a felt, nameable pain — a well-funded player uses our
  core noun as its free hook. The category language BidMorrow bet on
  ("bid/no-bid") is now market-standard vocabulary.
- **Tendly at ~€29 with scored matches** validates that the tiny-firm,
  self-serve, low-flat-price EU segment is real and reachable — someone
  else built for exactly that buyer.
- **Tenderium at €99–279** validates willingness to pay for _analysis
  depth with source traceability_ — evidence-linked reasoning sells.
- **GetTenderAI's €235–420 ladder** validates, at directly observed
  prices, that match scoring and relevance explanations are worth
  hundreds of euros a month to this market — they meter the scores and
  paywall the explanations because those are the valuable parts. That
  is the strongest third-party confirmation yet of what BidMorrow's
  engine is worth; we currently include both, unmetered, at €29.
- **GetTenderAI's free tier and public catalog** also validate that
  TED-based ingestion plus friendly presentation attracts users — and
  confirm discovery alone is racing to free.

### Which part of the wedge each one compresses

- **Tendly compresses the price-and-claim wedge directly.** "Flat €29,
  scored matches with reasons" was a two-part differentiator; Tendly now
  makes both halves of that sentence, at the same number, with a free
  tier underneath. What it does NOT compress: determinism,
  reproducibility, auditability, provenance honesty, ICP depth, or
  hard-exclusion logic. The wedge survives but narrows from "explained
  scores at a fair flat price" to "**deterministic, reproducible,
  auditable** scores at a fair flat price."
- **Stotles compresses the phrase, not the product.** A free "AI-powered
  bid/no-bid report" makes "bid/no-bid reporting" sound like a checkbox
  a bigger platform tosses in. It does not compress the substance: their
  report is an unexplained LLM output serving an AI-writing upsell, UK/
  GBP-first, from a vendor whose real price starts near £475. The risk
  is narrative (a prospect saying "Stotles does that for free"), and the
  answer must be methodological, not rhetorical.
- **Tenderium compresses vocabulary at the edges** (requirements,
  deadlines, risk indicators, traceability) but sits downstream of our
  decision and at 2–10x our price for a metered, contact-gated product.
  The owner's feared €9 PAYG undercut of trial-to-value **did not
  verify** — there is no evidence Tenderium lets anyone buy a €9 scan.
  The real trial-to-value pressure comes from free tiers (Stotles,
  Tendly, Tenderium's demo, GetTenderAI's free accounts), not PAYG.
- **GetTenderAI compresses the wedge at the acquisition edge, not the
  value core — and hands us a pricing gift at the core.** The verified
  €235 unlimited-scoring anchor (with explanations at €319) does not
  reposition BidMorrow as "the budget option"; it repositions the
  category's meters and paywalls as the thing we honestly don't do.
  The compression is elsewhere: their free metered tier and public
  per-tender SEO catalog intercept early-funnel prospects before a
  qualification product is ever considered, their BOAMP ingestion
  out-covers us _in France below the TED threshold_, and their
  "thousands → the few that matter" line crowds the reduction
  narrative our copy was likely to use. The above-us anchors are now
  GetTenderAI (€235–420), Tenderium (€99–279), TenderApp (€339–699),
  and Stotles (~£475). Being far below all of them is _helpful_ — it
  frames €29/€49 as the honest tool among metered suites — but only if
  the methodology story carries the credibility; below a €29 twin
  (Tendly) and several free tiers, the price alone signals nothing.

### Differentiation map — what still holds vs. what is now table stakes

Still holding (and now more load-bearing):

- **Deterministic, LLM-free, component-inspectable scoring.** Every
  entrant's "reasoning" found in this investigation is LLM-generated
  prose. None can truthfully say "same tender in, same score out, every
  component inspectable, engine versioned." This is now the single
  clearest verifiable differentiator — but only if we prove it in
  public (methodology page, worked example), because "score with written
  reasoning" as a _claim_ is now table stakes.
- **Official-TED-only provenance with mandatory attribution.** Nobody
  found leads with data provenance; coverage claims are portal-count
  bragging. Unchanged and uncontested.
- **Honest scoped coverage.** Coverage arms-race numbers (23 countries,
  2,000+ portals, 50+ countries) make honesty _harder to sell_ but more
  distinctive; it must be framed as deliberate depth, never apologized
  for.
- **Tiny-firm IT/cyber ICP.** Every entrant profiled is sector-agnostic.
  Depth for one buyer remains structurally unavailable to them.
- **Hard exclusions / risk flags as part of the verdict.** Competitors
  score fit; none observed scores _disqualification_. "Why you should
  NOT bid" remains ours.

Demoted to table stakes:

- **A match score with an explanation attached** (as a claim on a
  website) — Tendly, TenderStria, and others all say it.
- **EU-native, EUR pricing** — shared with Tendly and Tenderium.
- **€29 as a price point** — no longer distinctive by itself; the
  distinctive remainder is **flat with no meters** (no credits, no
  reveals, no workspace quotas), which no new entrant offers.
- **Free-of-friction discovery** — racing to free across the category.

---

## 4. Risk register

Severity: Critical / High / Medium / Low. Trajectory: worsening /
stable / improving. Confidence reflects evidence quality (snippet-grade
unless noted). Status: OPEN unless noted.

| ID  | Threat                                                                     | Severity | Trajectory | Confidence                   |
| --- | -------------------------------------------------------------------------- | -------- | ---------- | ---------------------------- |
| R1  | Exact price-point collision: Tendly ~€29 unlimited AI matching + free tier | High     | Worsening  | Medium                       |
| R2  | "Explained match score" claim commoditized across entrants                 | High     | Worsening  | High                         |
| R3  | "Bid/no-bid" becomes a checkbox phrase (Stotles free report)               | Medium   | Worsening  | High                         |
| R4  | Price-anchoring from above (€99–€699 metered suites) misread as "toy"      | Low      | Stable     | High                         |
| R5  | Free tiers reset trial-to-value expectations below our paid-only entry     | High     | Worsening  | High                         |
| R6  | Competitors own programmatic tender-page SEO surface excluded from our V1  | Medium   | Worsening  | High                         |
| R7  | Coverage arms race makes honest TED-only scope read as narrow              | Medium   | Worsening  | High                         |
| R8  | Owner-feared €9 PAYG undercut (Tenderium)                                  | Low      | Unproven   | High (that it is unverified) |
| R9  | Messaging-space collision on the reduction narrative (GetTenderAI)         | Medium   | Stable     | High                         |
| R10 | Sub-threshold national coverage gap vs BOAMP-ingesting rivals (France)     | Medium   | Worsening  | High                         |

Notes per threat:

- **R1 (Tendly collision).** Same headline price, adjacent claim
  ("unlimited match reveals with AI rationale"), free tier below,
  aggressive comparison-page SEO. Severity High rather than Critical
  because their rationale is non-reproducible LLM text, they have no ICP
  depth, no exclusion logic, and currency/tier details are snippet-grade
  pending capture. This is the risk the owner's report missed entirely.
- **R2 (claim commoditization).** TenderStria advertises "qualification
  score with written reasoning" across 50+ countries; Tendly banded
  match scores with reasons; the _sentence_ BidMorrow planned to lead
  with is now ambient. Counter is proof-of-mechanism, not louder copy.
- **R3 (checkbox phrase).** Verified. The phrase is commoditizing while
  the substance is not; danger is prospects equating our product with a
  free teaser. Mitigation is making "report" the wrong noun for what we
  do (a reproducible verdict with evidence, on every matching tender,
  continuously — not a one-off generated document).
- **R4 (anchor above).** Now VERIFIED-direct for GetTenderAI
  (€235/€319/€420 with metered scores and paywalled explanations) and
  snippet-grade for the rest. Mostly a positioning asset: honest flat
  all-inclusive pricing under metered suites. Only harmful if our site
  fails to carry methodological seriousness; a cheap price plus an
  unexplained score would read as a toy. The counter is §5.1–5.3, not a
  price move.
- **R5 (free floor).** Four free surfaces now exist around us (Stotles
  free plan, Tendly free credits, Tenderium demo, GetTenderAI's free
  tier — 10 AI searches / 5 doc analyses / 5 match score checks per
  month, VERIFIED-direct; TenderWolf €0 tier also indexed). BidMorrow's
  paid-only entry is a deliberate standing decision, but the market's
  default first step is becoming "try it free." This is the strongest
  pressure on trial-to-value and is strictly owner territory (§6B).
  Nuance: GetTenderAI's free tier demonstrates the _metered_ freemium
  pattern — 5 free score checks is a taste designed to hit a wall; any
  BidMorrow response (owner-level) should avoid recreating that wall.
- **R6 (SEO surface).** VERIFIED-direct: GetTenderAI's public no-login
  catalog (46,156 notices, per-tender SEO URLs, category facets incl.
  Consulting 3,214 and IT & Telecom 1,434) plus Tendly's comparison
  pages occupy acquisition ground our V1 scope explicitly excludes
  (public tender-detail SEO pages are out of V1; named comparisons need
  owner approval). Not urgent for launch; compounding over quarters.
- **R7 (coverage framing).** "TED-only" must be presented as official-
  source depth and freshness, with the honest CPV statement worn as
  trust; presented flatly, it will lose spec-sheet comparisons to
  "2,000+ portals" claims. Note the counter-ammunition GetTenderAI's own
  facets provide: loud "EU" claims can hide DE 12 · IT 2 · ES 0 —
  breadth claims in this category are frequently thinner than they
  sound, which is exactly the honesty argument our coverage statement
  makes (usable without naming anyone).
- **R8 (PAYG undercut).** Recorded to close it out: no evidence found.
  Keep on the register at Low until Tenderium's pages are captured, then
  close if still absent.
- **R9 (reduction-narrative collision).** VERIFIED-direct: GetTenderAI's
  how-it-works header is "From thousands of notices to the few that
  matter" — the same thousands-to-few reduction framing BidMorrow's
  copy was likely to lead with (and which the Round-2 "Verdict"
  direction's funnel-reduction device used). Generic reduction language
  is no longer ownable. Our articulation must move from _reduction_
  (fewer tenders) to _verdict with evidence_ (a defensible decision per
  tender) — see §5.9. Severity Medium: a copy-strategy constraint, not
  a structural threat, but it directly gates M0.2+ messaging work.
- **R10 (sub-threshold gap).** VERIFIED-direct: GetTenderAI ingests
  BOAMP (4,163 notices in the source facet vs 18,066 TED), i.e. French
  national sub-threshold notices TED does not carry — and sub-threshold
  is where 5–50-person firms often actually win. For French prospects,
  a rival can truthfully say "we see contracts BidMorrow cannot." Today
  the exposure is France-only and our honest-coverage statement already
  disclaims it; trajectory is worsening because national-bulletin
  ingestion is an obvious roadmap move for every entrant. Any response
  (adding national sources) is an owner-level scope/cost decision
  (§6.5); the within-rules mitigation is stating the above-threshold
  scope plainly (§5.4).

---

## 5. Counter-moves (A) — implementable within standing decisions

Messaging, methodology transparency, proof, and site emphasis only. No
pricing, packaging, free-tier, trial, or scope changes. Hand-off: these
feed the `sales-strategist` and the Strata implementation plan (M0.2+
positioning-sensitive work).

1. **Escalate the differentiation claim one level of proof.** Retire
   "match scores you can understand" as the spearhead (now table
   stakes); lead with what only we can say: deterministic, LLM-free,
   reproducible — "the same tender always gets the same score, and every
   point is traceable to a rule you can read." Position generated-prose
   "AI rationales" (without naming vendors) as the thing our engine is
   not: a score you can audit vs. a paragraph you have to trust. This is
   the single most important counter-move in this category.
2. **Publish the methodology as a first-class page.** A public "how
   scoring works" page grounded in `docs/matching-engine.md`: real
   components, hard exclusions, unknown-handling, hierarchical CPV
   gradient, risk-flag evidence, engine versioning — with one worked
   example on a real, properly attributed TED notice. No LLM-based
   competitor can publish a reproducible methodology; make them feel
   that. (Also satisfies the recorded Strata caveat: shipped score UI
   re-based on real engine components.)
3. **Reframe flat pricing as "no meters," not "cheap."** The €29 number
   no longer differentiates; the _shape_ does. Presentation emphasis
   (content/claims unchanged): no credits, no reveal quotas, no
   workspace caps, no score-check meters, no explanations sold as an
   upgrade — every matching tender scored and explained, always.
   Truthful, and aimed squarely at the observed category pattern
   (scores metered on free tiers, unlimited scoring from €235,
   explanations paywalled at €319, credit packs, workspace quotas)
   without naming anyone. "The explanation is not an add-on" is now a
   verifiable, category-specific line.
4. **Wear provenance and freshness as features — and state the scope
   plainly.** TED attribution (Commission Decision 2011/833/EU), a
   last-sync/freshness signal, and the honest CPV coverage statement
   presented with spec-sheet dignity — the whole category is silent
   here (already a convergent finding in `competitor-findings.md`; now
   urgent because it is the trust story the free tiers cannot copy
   cheaply). The coverage statement should also say clearly what we do
   NOT cover — above-threshold EU-wide via official TED, not national
   sub-threshold bulletins — because a French rival already out-covers
   us below the threshold (R10) and honesty stated first beats honesty
   extracted later. Observed facet arithmetic in this market (an "EU"
   product with DE 12 · IT 2 · ES 0) is standing proof that our honest
   framing is the trustworthy posture, no naming required.
5. **Sharpen the exclusion story.** Competitors score fit; we also score
   "walk away." Site emphasis on hard exclusions and risk flags — "know
   which tenders NOT to pursue" — occupies the half of the verdict
   nobody else claims, and it is the half a capacity-constrained
   5–50-person firm actually pays for.
6. **Sell auditability to the ICP's own culture.** IT/cyber
   consultancies sell defensible process; message the verdict as
   something they can defend to a managing partner ("here is the rule
   that fired"), not a black-box tip. Deepens the tiny-firm wedge no
   generalist can follow.
7. **Time-to-first-verdict as the activation promise.** Onboarding is
   the standing top UX priority; express it as a concrete promise
   (profile in, first scored verdicts out, in minutes) — our within-
   rules answer to free-tier instant gratification and to Tendify's
   "Day 1" microcopy pattern.
8. **Do not punch down on price.** Avoid "budget," "cheapest," or
   premium-suite envy in copy. Anchor on trust-per-euro between the
   free-teaser floor and the €235–£475 metered-suite ceiling: "priced
   for firms that bid four times a year, built like it matters."
9. **Vacate the generic reduction narrative; own the verdict-with-
   evidence articulation.** "From thousands of notices to the few that
   matter" is now occupied (R9), and thousands-to-few phrasing is
   generically available to every discovery tool. BidMorrow's copy
   should articulate the next step after reduction — the defensible
   decision: not "fewer tenders" but "a verdict you can open up" (the
   score, its components, the rule that fired, the risk flags, the
   evidence). Search tools shrink a list; BidMorrow closes a question.
   This also keeps the approved Strata storytelling distinct from the
   rejected Round-2 funnel-reduction device. Concretely for the
   sales-strategist: pull-vs-push is the frame — they answer "find me
   tenders about X," we answer "of everything published, which merit
   your next two weeks, and why."

## 6. Counter-moves (B) — OWNER DECISIONS ONLY

Stated as options with tradeoffs. Nothing here is planned, promised, or
started. Pricing substance remains FROZEN; competitive pressure does not
unfreeze it.

1. **Free-verdict exposure (the decision that matters most).** The
   market's floor is now free. Options, in ascending commitment:
   (i) status quo — paid-only entry; preserves revenue purity and
   support load, but every competitor now offers a zero-risk first
   taste and our trial-to-value story competes with "free forever";
   (ii) a no-signup interactive sample verdict on the marketing site
   using real attributed TED data — no account, no free tier, pure
   demonstration; cheapest concession, no billing change, but it is
   positioning-sensitive work and needs an owner call on whether it
   counts as "free product"; (iii) a genuinely free limited tier —
   maximum funnel response, but permanent support cost, devaluation
   risk, and direct conflict with the founding-20 scarcity framing.
   Recommendation to consider, not a decision: option (ii) captures
   most of the defensive value at least cost.
2. **Trial mechanics** (length, card requirement, what a trial shows
   first): owner-level; note that competitors' free tiers make a
   card-gated or short trial comparatively harsher than it was when the
   pricing was frozen.
3. **Named comparison pages** (e.g. honest "BidMorrow vs X" pages):
   effective SEO (Tendly is already doing it to Tendium), but standing
   decisions require owner approval for named competitor comparisons,
   and they invite retaliation and maintenance burden.
4. **Public per-tender SEO pages** are out of V1 scope by standing
   decision. Flagged only as a V2 agenda item: GetTenderAI demonstrates
   the acquisition surface compounds; entering it later costs more.
   Tradeoffs: crawl/infra cost against the <$100 ceiling, D1 size
   limits, untrusted-content rendering rules, and TED attribution at
   scale.
5. **Coverage/scope expansion** (second source or country set beyond
   TED): would blunt R7/R10 but contradicts official-TED-only
   provenance — currently our cleanest trust story — and touches the
   cost model and ingestion scope. The concrete pressure is now
   specific: a rival verifiably ingests France's BOAMP and therefore
   covers French sub-threshold notices we do not (R10) — sub-threshold
   being where our tiny-firm ICP often competes. If the owner ever
   revisits scope, national sub-threshold bulletins for the ICP's home
   markets are the highest-value candidate — but each national source
   adds ingestion cost, parsing surface, and a provenance story more
   complicated than "official TED only." Not recommended on current
   evidence for V1; recorded because every entrant's roadmap points
   here.
6. **Pricing/packaging response of any kind** (annual billing, founding
   pricing, a third tier): FROZEN; recorded only so the register is
   complete. Current evidence does not argue for a price change — it
   argues for a proof change (§5.1–5.2).

---

## 7. Honest assessment of the owner's 91→90 read

**The compression is real, but it is not where the owner's three data
points put it — and the one-point adjustment misprices both the threat
and the good news.**

- Scorecard on the three claims: (a) verified exactly as stated —
  GetTenderAI Basic is €235/mo with unlimited match scores; (b) half
  right — Tenderium's €99 workspace tier is real, the €9 PAYG scan is
  not established anywhere; (c) verified — Stotles gives away an
  AI-powered bid/no-bid report on its free plan.
- But the verified €235 tier is not the compression the owner read it
  as. Seen in full, GetTenderAI's ladder (scores metered at 5/month on
  free, unlimited only from €235, explanations paywalled at €319) is
  **validation of our value at category prices 8–14x ours** — it makes
  "unlimited scores with explanations included at €29" a stronger
  sentence, not a weaker one. Their real pressure on us is different:
  a free tier, a public 46k-notice SEO catalog, French sub-threshold
  coverage we lack, and occupation of the thousands-to-few messaging
  space. The below-us threat the owner priced in (€9 PAYG undercutting
  trial-to-value) did not verify; the actual floor pressure is free
  tiers, which is a different problem with different (owner-level)
  answers.
- The threat the owner's read missed entirely is the sharpest one:
  **Tendly at ~€29/month with unlimited AI match scoring, per-match
  written rationale, a free tier, and comparison-page SEO** — a direct
  collision with our exact price point and our headline claim shape.
  Add the verified Stotles free bid/no-bid report, and the compression
  concentrates precisely on the two things our positioning leaned on
  hardest: the price point and the phrase.
- So: **91→90 is directionally right but mislocated, and understated
  for positioning risk.** If the score measures the uniqueness of our
  sellable claim as currently worded, the honest move is closer to 3–5
  points, not 1 — "explained match scores at a flat fair price" is no
  longer ours alone at any price, including ours. If the score measures
  the durable moat — deterministic reproducibility, auditable
  components, official-TED provenance, exclusion logic, ICP depth —
  then almost nothing was lost, because no entrant found in this
  investigation touches any of it, and GetTenderAI's price ladder is
  affirmative third-party evidence of what that moat is worth. The
  correct conclusion is not "the wedge is gone" but "the wedge has
  moved one level down, from claim to proof" — and the counter-moves in
  §5 re-arm it without touching a single frozen decision.

---

## 8. Sources (all retrieved 2026-08-17, snippet-grade unless noted)

- GetTenderAI — **owner-supplied screenshots, 2026-08-17
  (VERIFIED-direct visual evidence)**: homepage, public tenders list
  with facets, pricing page. The screenshots are not committed to the
  repo; their observed content is transcribed in §1a and §2.
- GetTenderAI (snippet corroboration): <https://gettenderai.com/en>,
  <https://gettenderai.com/en/tenders>, per-tender pages under
  `/en/tenders/ted/...` and `/en/tenders/boamp/...`
- Tenderium: <https://tenderium.net/>, <https://tenderium.net/pricing>,
  <https://tenderium.net/tenders/uk>
- Stotles: <https://www.stotles.com/pricing>,
  <https://www.stotles.com/platform/win-bids>,
  <https://www.stotles.com/> (plus 2026-08-17 VERIFIED-direct Playwright
  captures on branch `competitor-shots`)
- Tendly: <https://tendly.eu/en/pricing>,
  <https://tendly.eu/en/features/ai-matching>,
  <https://tendly.eu/en/faq>, <https://tendly.eu/en/buy-credits>,
  <https://tendly.eu/en/compare/tendly-vs-tendium>
- Category scan: <https://www.tenderstria.com/product>,
  <https://tender-match.com/>,
  <https://tenderwolf.com/en/blog/tender-software-belgium-europe-2026-comparison/>,
  <https://ailucius.com/blog/best-tender-management-software-2026>,
  <https://www.tenderscanai.com/>, <https://www.capterra.com/p/252598/Tendium/>

## 9. Verification queue (evidence upgrades)

Direct fetches to all competitor hosts and web.archive.org are
egress-blocked from this sandbox. To upgrade snippet-grade findings to
VERIFIED-direct, run the CI Playwright pipeline
(`scripts/capture-competitor-pages.mjs` + `competitor-screenshots.yml`,
scratch branch `competitor-shots`) against:

1. ~~`https://tendly.eu/en/pricing`~~ — **DONE 2026-08-17 (see §0):**
   €29 EUR confirmed, credit-metering confirmed, R1 upgraded to
   VERIFIED-direct.
2. ~~`https://tenderium.net/pricing`~~ — **DONE 2026-08-17 (see §0):**
   €9 PAYG Quick Check confirmed (claim b / R8 VERIFIED-direct); site is
   invoice-only / pre-transactional, threat level lowered.
3. `https://www.stotles.com/pricing` refresh (free-plan bid/no-bid
   report scope) — still snippet-grade; low priority (already
   VERIFIED-snippet + prior direct capture).
4. GetTenderAI pricing and tenders pages — already VERIFIED-direct via
   owner-supplied screenshots (2026-08-17); the 2026-08-17 capture
   timed out (record only), no loss.

Register review cadence: re-verify R1/R5 (and refresh competitor prices)
before any positioning-sensitive M0.2+ work ships, and at each
subsequent phase review. R2/R8 now rest on VERIFIED-direct evidence.
