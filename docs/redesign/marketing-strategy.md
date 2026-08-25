# Marketing strategy — customer acquisition for BidMorrow

Author: `marketing-manager` role · First issued 2026-08-17
Scope: demand generation and customer acquisition for the V1 launch and the
first ~50 founding customers. The **sales motion** (positioning spine,
battlecards, objection handling, conversion levers) lives in
`docs/redesign/sales-strategy.md` and is owned by the `sales-strategist`;
this document does not edit it — it references it and defines the
marketing→sales handoff (§8).

**Binding constraints inherited** (from
`docs/redesign/requirements.md`,
`docs/product-scope.md`): pricing substance FROZEN (€29 Founding / €49
Standard, EUR); no free tier, no automated trial (no-card manual 5-day
pilot is the entry path); controlled public sample-verdict demo IS in
scope; deterministic/LLM-free/explainable engine is the wedge — no
"AI-powered" framing; truthful marketing only (no fake proof, no
exhaustive-coverage claims); privacy-first with **no third-party
analytics/trackers** (CSP-enforced) so measurement is first-party only;
GDPR/ePrivacy limits on outreach respected; bootstrapped budget (fixed
infra <$100/mo) — every paid line item is an explicit OWNER DECISION with
a cost estimate.

**Evidence discipline.** Market-size and channel-performance figures from
third-party vendors/analysts are labeled **UNVERIFIED ESTIMATE** or
**VENDOR-SOURCED**; only TED/EU-institutional figures and things checkable
against the repo are treated as fact. Sources are listed in §10.

---

## 1. Market analysis

### 1.1 Market size and shape (with honest caveats)

- **The broad market is large and growing, but it is the wrong denominator.**
  The European procurement-software market is estimated at **~$3.18B in
  2026, rising to ~$6.22B by 2034 (CAGR ~8.75%)** (Market Data Forecast,
  **UNVERIFIED ESTIMATE** — analyst report, not independently checked).
  This number covers source-to-pay, e-invoicing, spend management and
  enterprise procurement suites — **almost none of it is BidMorrow's
  market.** Quoting it in a pitch would be dishonest by omission. It
  matters only as context: digitization of public procurement is a funded,
  regulator-pushed tailwind, not a TAM we can claim.

- **The relevant demand substrate is real and quantified from the source.**
  TED publishes **~800,000 procurement notices a year (~2,000/day across
  250+ OJ S issues), worth €815B+** (ted.europa.eu — institutional, FACT).
  **SMEs are 99% of EU businesses** (ENISA/EU — FACT). The EU's own SME
  strategy, the eForms/CPV transition, and the **Public Procurement Data
  Space (launched Sept 2024)** are all pushing SME procurement
  participation — regulatory tailwind for a tool that helps small firms
  decide _which_ of those notices to chase.

- **BidMorrow's serviceable niche is deliberately tiny.** 5–50-person EU
  IT / cyber / cloud / software consultancies that bid without a dedicated
  bid team, within CPV 72*/48*/79417000, above TED threshold. There is
  **no published, credible count** of exactly this population, so I will
  not invent one. Order-of-magnitude reasoning only (**UNVERIFIED
  ESTIMATE**, stated as such and never for external use): tens of thousands
  of such firms exist across the EU, but the reachable, actively-bidding,
  tool-buying subset in year one is far smaller — realistically **a few
  hundred to low thousands of viable prospects** we can actually touch
  through the channels in §3. This is a **founder-scale, first-50-customers
  problem, not a growth-marketing-funnel problem.** The whole plan is sized
  to that truth.

  > **Challenge to any internal optimism:** the market being "large"
  > (procurement software) and the niche being "real" (IT/cyber SMEs on
  > TED) does **not** make it _easy to reach_. Our ICP does not gather in
  > one place, does not search for "bid/no-bid software," and mostly does
  > not yet know this category exists for them. Acquisition difficulty, not
  > market size, is the binding constraint. Plan accordingly.

### 1.2 Demand drivers (why this buyer would pay now)

1. **Capacity scarcity.** A 5–50-person consultancy has one or two people
   doing bid/no-bid _in addition to_ delivery. The pain is not "find
   tenders" (TED is free) — it is the hours wasted qualifying tenders that
   were never winnable. BidMorrow sells **time saved on the no's**. This is
   the felt pain; lead every message with it.
2. **Rising formal barriers.** ISO 27001, NIS2-implementation experience,
   and framework/lot structures increasingly gate cyber/IT tenders
   (ENISA/DIGITAL SME evidence). Firms need to know _early_ whether they're
   even eligible — exactly what our hard-exclusion/risk-flag logic surfaces.
3. **"AI tender matching" fatigue is arriving.** The category is saturating
   with LLM match tools (competitive assessment: GetTenderAI, Tendly,
   Tenderium, Stotles). Buyers burned by hallucinated or non-reproducible
   "reasons" are a receptive audience for _auditable arithmetic you can
   re-run_ — but only once they've been burned. Early adopters first.
4. **Regulatory push toward SME participation** (EU SME strategy, PPDS,
   eForms) legitimizes the whole "help SMEs win public work" space.

### 1.3 How these buyers currently find tools (the uncomfortable truth)

Verified pattern from the bootstrapped-SaaS research and the competitor
IA analysis:

- **They mostly don't search for us.** "Tender software" head terms are
  owned by incumbents (Stotles, Mercell, Tendify) and aggressive content
  players (TenderMetric, Jorpex, TenderRadar). Our SEO ground is
  **long-tail informational** (CPV guides, bid/no-bid methodology, "how is
  a tender scored") — a compounding _year-plus_ asset, per
  `seo-content-strategy.md`, **not a launch channel.**
- **They discover tools socially and by referral** — a peer in an MSP/IT
  community, a bid consultant, a LinkedIn post that names their exact pain,
  a G2/AlternativeTo listing when actively shopping (tools like Jorpex,
  LicitIn, TenderLedger surface there).
- **Competitors capture them early via free tiers and public tender
  catalogs** (GetTenderAI's 46k-notice SEO surface; four free tiers around
  us). We have deliberately opted out of that floor — which means our
  _entry_ must be **founder-led and demonstration-led (the sample-verdict
  demo)**, not a free-signup race we've chosen not to run.

**Conclusion:** for the first 50 customers, acquisition is
**founder-relationship-led and proof-led**, with content/SEO planted now
to compound later. This directly shapes §4's ranking.

---

## 2. Positioning-to-market and the core acquisition narrative

The **sales spine** is already set in `sales-strategy.md` §1 and is not
re-litigated here: _the only bid/no-bid tool whose verdict is auditable
arithmetic you can re-run — the explanation and the reasons to walk away
included on every tender, flat €29, no meters — not an AI rationale you
have to trust._ Marketing's job is to translate that spine into
**acquisition language for cold audiences** who don't yet know the category.

### The core acquisition narrative (one paragraph, cold-audience version)

> **"TED publishes ~2,000 public tenders every working day. For a small IT
> or cyber consultancy, the expensive problem isn't finding them — it's the
> hours spent qualifying tenders you were never going to win. BidMorrow
> scores every in-scope TED notice against your company's profile and shows
> the arithmetic behind each verdict — the same tender always gets the same
> score, every point traces to a rule you can read, and it tells you when to
> walk away. Not an AI paragraph you have to trust. Flat €29/month, no
> meters, no credits. See a real verdict explained before you talk to
> anyone."**

Three narrative pillars, in priority order for cold reach:

1. **The pain, named precisely** ("saying no fast," not "find more
   tenders"). This is the hook that makes the right buyer stop scrolling
   and the wrong buyer self-deselect.
2. **The proof that only we can show** (deterministic, decomposable,
   re-runnable — demonstrated, not claimed). This is what converts interest
   to trust and defuses "isn't this just another AI matcher?"
3. **The honesty posture** (prices on the page, TED provenance, honest
   scope, no trackers, solo builder, "first 50" cap). In a category of
   demo-gated pricing and vague "AI-powered" claims, radical candor is
   itself the differentiator — and it is free.

**Narrative discipline (hard rules restated):** never "win more bids,"
never exhaustive coverage, never "AI-powered," never fabricated proof.
Decision-support disclaimer and TED attribution travel with every asset,
including social posts and the OG share image.

> **Challenge to the existing docs:** the sales/competitive docs correctly
> escalate the _claim_ to "auditable arithmetic." But "auditable
> arithmetic you can re-run" is **seller language**, not buyer language. A
> founder scrolling LinkedIn does not wake up wanting reproducibility; they
> want their Tuesday back. Marketing must lead cold with the **pain and the
> time saved on the no's**, and let auditability/reproducibility be the
> _reason to believe_ that arrives second. If we lead cold audiences with
> the epistemology, we will sound like a whitepaper. Lead with the wound,
> prove with the arithmetic.

---

## 3. Segment map + where to reach each segment

The ICP is one buyer, but it clusters into reachable sub-segments, each
with distinct watering holes. **Reachability**, not size, drives priority.

### Segment A — Cybersecurity consultancies (5–50 ppl) · HIGHEST PRIORITY

Best-defined pain (ISO 27001/NIS2 gating), clearest community
infrastructure, and the segment with the most acute "am I even eligible"
question — where hard-exclusion logic shines.

- **European DIGITAL SME Alliance** (digitalsme.eu) — runs the
  "Cybersecurity Made in Europe" label with ECSO; a pan-EU SME cyber body.
  A genuine partnership/awareness target (§7 owner decision).
- **ENISA ecosystem** — SME cyber resources and cross-border communities;
  useful for content credibility and event presence, not direct selling.
- **LinkedIn roles:** founder/MD/partner, "Head of Bids"/"Bid Manager"
  (where one exists part-time), business-development leads at named cyber
  SMEs. Founder-led posting + targeted 1:1 connection is the primary motion.
- **Content anchor:** a genuinely useful "CPV codes + NIS2 + ISO 27001 in
  EU cyber tenders" methodology piece — maps exactly to our honest CPV-scope
  story and to a real SERP cluster (TenderMetric already ranks an "EU
  Cybersecurity Tenders 2026: NIS2, CPV Codes" piece — proof of demand).

### Segment B — IT services / MSPs / cloud-DevOps consultancies · HIGH

Larger population, slightly more diffuse pain, strong online community life.

- **MSPGeek** (mspgeek.org — community + Slack): the most established
  free MSP community. **Show up as a practitioner, never as a vendor.**
- **Reddit:** r/msp, r/sysadmin, r/ITManagers — tool-recommendation and
  "how do you win public contracts" threads occur; answer helpfully, link
  only when genuinely on-topic and disclosed. (Reddit self-promotion rules
  are strict — value-first or get removed.)
- **Regional MSP/IT events:** Connect IT Europe and national MSP meetups.
- **LinkedIn roles:** owner/director of managed-services and cloud
  consultancies; "public sector" or "government" business-development leads.

### Segment C — Software development houses bidding public-sector · MEDIUM

Broadest and least self-identifying; reach opportunistically via LinkedIn
and the govtech content/event surface rather than a dedicated push in v1.

- **GovTech events:** The GovTech Summit (The Hague, govtechsummit.eu —
  offers complimentary SME passes), Handelsblatt GovTech Summit (Germany,
  Feb 2026). Supplier-side attendance = credibility + face-to-face pipeline.
- **National digital-gov ecosystems:** country-level GovTech associations
  and SME procurement helpdesks (e.g. national chambers, SMEunited member
  federations across 30+ countries).

### Cross-segment intermediaries (partners, not segments)

- **Bid/tender consultants and freelance bid writers** (Bid Solutions
  directory, Thornton & Lowe, national bid consultancies, bid2tender). They
  advise exactly our ICP, they qualify tenders manually today, and a
  deterministic pre-qualifier makes their triage faster. **Highest-leverage
  partnership candidate** (§4 P4, §7).
- **SMEunited** and national SME federations — awareness/credibility and
  content distribution, not a sales channel.
- **Startup/indie-hacker communities** (for the _build-in-public_ founder
  narrative, not for buyers) — a secondary amplification surface only.

> **Challenge:** the competitive docs implicitly assume our ICP is a
> coherent, reachable audience. It is not one list. Segment A (cyber) has
> real associations and a labeling body; Segment B lives in MSP
> communities; Segment C barely self-identifies. **Concentrate launch
> effort on Segment A**, borrow B's communities carefully, and treat C as
> content/event spillover. Trying to address all three equally at solo
> scale will produce three shallow efforts.

---

## 4. Channel strategy, ranked by leverage-per-euro

Ranking logic for a solo, bootstrapped founder pre-product-market-fit:
**cheap + founder-controllable + evidence-backed for the 0→50 stage ranks
above scalable-but-slow or paid.** Cost tiers: **FREE** (time only) /
**LOW** (<€50/mo tools) / **NEEDS BUDGET → OWNER DECISION**.

| Rank   | Channel                                                               | Cost tier              | Effort              | Funnel role              | Why this rank                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------- | ---------------------- | ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**  | **Founder-led LinkedIn (organic)**                                    | FREE                   | High, sustained     | Awareness → demo → pilot | Personal profiles out-reach company pages ~7x (VENDOR-SOURCED); the 0→10 customers come from founder outreach, not ads (verified pattern). Founder credibility _is_ product credibility at this stage. |
| **2**  | **The public sample-verdict demo as the conversion engine**           | LOW (already in scope) | Medium (build once) | Consideration → pilot    | Our within-rules answer to the free-tier floor. Every other channel points here. Proof-of-mechanism a free-tier competitor can't replicate as a static reproducible page.                              |
| **3**  | **Community participation (MSPGeek/Slack, Reddit, cyber SME bodies)** | FREE                   | High, sustained     | Awareness → trust        | Where Segment A/B already gather and evaluate tools. Practitioner-first, disclosed, value-led. Zero cash, high trust, slow.                                                                            |
| **4**  | **Partnerships / referral — bid consultants + DIGITAL SME Alliance**  | FREE→NEEDS BUDGET      | Medium (outreach)   | Referral → warm pipeline | Intermediaries who already own the relationship and the trust. One good consultant partner can refer several ICP firms. Some co-marketing may need budget (§7).                                        |
| **5**  | **Content/SEO (methodology-led, long-tail)**                          | FREE (time)            | High, slow          | Awareness (compounding)  | The durable asset per `seo-content-strategy.md`, but a _year-plus_ payoff — **not a launch channel.** Plant now; harvest later.                                                                        |
| **6**  | **Targeted, GDPR-compliant 1:1 outreach**                             | LOW                    | Medium              | Awareness → demo         | Legally viable only as _manual, individually-relevant, opt-out-respecting_ outreach (see §4a). NOT scaled cold email. Founder-time-bounded.                                                            |
| **7**  | **Events (GovTech Summit SME pass, MSP meetups)**                     | LOW→NEEDS BUDGET       | High (travel)       | Trust → pipeline         | High-quality face-to-face pipeline in Segment A/C; but travel cost + time for a solo founder. Selective, 1–2 events.                                                                                   |
| **8**  | **Founder PR / "build in public" / podcasts**                         | FREE                   | Medium              | Awareness                | Amplifies the honesty narrative; indie/procurement podcasts and newsletters. Opportunistic, not core.                                                                                                  |
| **9**  | **Paid ads (LinkedIn/Google)**                                        | NEEDS BUDGET           | Low-med             | (Deferred)               | **Not recommended pre-PMF.** Expensive CAC against a €29–49 ACV, and we lack the conversion data to spend efficiently. Owner decision only after ~10 sales conversations validate messaging (§7).      |
| **10** | **Named "BidMorrow vs X" comparison pages**                           | FREE (time)            | Medium              | Consideration (SEO)      | Strong SEO (Tendly does it), but **owner-gated** (standing decision requires approval for named comparisons) and invites retaliation. §7.                                                              |

### The three channels that carry the launch (top-3)

1. **Founder-led LinkedIn (organic)** — the single most leverage-rich
   channel for a solo bootstrapper with domain credibility and a sharp,
   contrarian, honest story ("auditable, not AI"). Cheap, controllable,
   compounds into inbound DMs within weeks (VENDOR-SOURCED: first signals
   3–6 weeks, real pipeline over 60–180 days).
2. **The sample-verdict demo** as the destination every touch drives
   toward — it converts curiosity into a pilot conversation without a free
   tier and without a sales call, and it _shows_ the differentiator words
   can only assert.
3. **Community + consultant partnerships** — the warm, referral-shaped
   pipeline that a €29–49 product needs because it cannot afford paid CAC.

### 4a. GDPR / ePrivacy limits on outreach (hard constraint on channel 6)

Researched this session (**VENDOR-SOURCED legal summaries — not legal
advice; owner should confirm with counsel before any outbound program**):

- **GDPR permits B2B outreach under legitimate interest** (Art. 6(1)(f),
  Recital 47 names direct marketing) _only if_ there is genuine
  role-relevance, the message is substantively relevant to that person's
  function, the data source is documented, a clear opt-out is provided, and
  a Legitimate Interest Assessment is on file.
- **ePrivacy is the stricter gate for email.** The ePrivacy Directive is
  _lex specialis_ and, in several member states, requires **prior consent
  for marketing email even in B2B** — most notably **Germany (UWG)**.
  **France (CNIL)** allows B2B legitimate-interest email but demands strict
  opt-out. Enforcement varies by country.
- **EU AI Act (Reg. 2024/1689):** GPAI provisions apply **from 2 Aug
  2026**; AI-drafted/AI-sent outreach should carry disclosure.

**Practical rules for BidMorrow (self-imposed, conservative):**

- **No scraped-list bulk cold email.** It breaches the truth/no-spam hard
  rules and is legally fragile (especially DE). Do not build it.
- **LinkedIn 1:1 connection + conversation is the compliant, preferred
  outbound path** — it is relationship messaging, not marketing email under
  ePrivacy, and it fits the founder-led motion.
- If any email outreach happens, it is **manual, individually researched,
  role-relevant, opt-out-honoring, one-at-a-time**, avoiding Germany until
  counsel confirms, with a documented LIA. Treat volume as a red flag, not
  a goal.

---

## 5. Funnel + first-party, privacy-compliant measurement

### The funnel (matched to product policy — no free tier)

```
Awareness ─▶ Interest ─▶ Sample-verdict demo ─▶ Pilot request ─▶ 5-day pilot ─▶ Paid
(LinkedIn,   (profile    (no-signup public    (contact/       (no-card,     (Paddle
 community,   visit,      demo, real          pilot form)     personally    checkout)
 referral,    OG share)   attributed TED)                     onboarded)
 content)
```

Marketing owns Awareness → **Pilot request**. The **pilot request is the
handoff** to the founder-as-sales motion (§8).

### Realistic acquisition metrics (targets are directional, not promises)

At solo/founder scale the honest goal is **quality of conversation, not
funnel volume.** Illustrative first-90-day targets (**UNVERIFIED — planning
assumptions to be replaced by real baselines, never quoted as achievements**):

- Awareness: consistent LinkedIn posting → first inbound DMs by week 4–6.
- Demo engagement: a modest but real share of visitors reaching the
  sample-verdict demo and expanding at least one verdict.
- **~10 substantive sales conversations** (the product-policy threshold
  before any pricing experiment) as the primary 90-day success signal.
- **3–5 pilots started; 1–3 conversions to paid** would be a strong solo
  launch quarter. Do not inflate these; the ledger records reality.

### First-party measurement (no third-party analytics — CSP forbids it)

Fully aligned with `seo-content-strategy.md` §9; nothing here adds a tracker.

1. **Server-side funnel from data that already exists** (zero client
   beacons): pilot-request form submissions, signup started/completed,
   email verified, onboarding completed/preset chosen, Paddle
   checkout/subscription events. Report as a read-only admin query. This is
   the spine of acquisition measurement.
2. **Paddle** is the source of truth for conversion, MRR, churn — no site
   script needed.
3. **Cloudflare zone/HTTP analytics** (server-side, aggregate, no beacon)
   for marketing-site traffic per path. **Do NOT enable Cloudflare Web
   Analytics** (beacon flavor = third-party script; CSP violation).
4. **Google Search Console + Bing Webmaster Tools** (DNS-verified, no
   script) for SEO impressions/clicks/queries.
5. **Channel attribution without client JS:** distinct landing _paths_ per
   channel (e.g. a dedicated `/pilot` link in outreach, a separate path for
   community vs LinkedIn) rather than UTM+JS capture. The server can read a
   referer/query string on the pilot-form POST if the owner later wants it
   (a D7-class decision — defer).
6. **Qualitative loop:** log why each pilot conversation was won/lost in the
   ledger. At 0→50, the transcript of 10 real conversations is worth more
   than any dashboard.
7. **Never:** GA/GTM/Hotjar/Plausible-cloud/any third-party origin; no
   cookie banner is needed because nothing requiring consent runs — and
   "no trackers" is itself a marketing message.

> **Honest limit:** with no page-view beacon, the top of the funnel
> (visits → demo) is only _aggregately_ measurable via Cloudflare zone
> data, not per-user. That is an accepted, principled trade — we measure
> from the pilot request down with precision, and treat the top as a trend.
> Do not let a measurement gap tempt a tracker; the privacy stance is a
> feature.

---

## 6. Concrete 90-day plan + lightweight content calendar

Sequenced for **one person** who is also building the product. Each phase
assumes ~1–1.5 days/week on marketing; do not over-commit.

### Phase 0 — Foundations (pre-launch / weeks 0–2)

- Finish and QA the **sample-verdict demo** (the conversion engine — it
  gates everything else; coordinate with frontend/redesign milestones).
- Ship launch SEO hygiene from `seo-content-strategy.md` M0 (OG image,
  metadata, robots/sitemap) so every shared link renders well.
- **Set up the founder's LinkedIn** as a publishing surface: rewrite the
  headline/about around the honest thesis; no company page reliance.
- Draft the **methodology-led cornerstone article** (Segment A: CPV +
  NIS2 + ISO 27001 in EU cyber tenders) — the reusable content asset.
- Write the server-side **funnel admin query** so measurement exists on day 1.
- **Owner-decision pack** (§7) prepared and sent for sign-off.

### Phase 1 — Founder presence + warm pipeline (weeks 3–6)

- **LinkedIn: 3 posts/week**, founder voice, honest/contrarian angle
  (see calendar). Goal: consistency, not virality. Expect first inbound
  DMs weeks 4–6.
- **Community: join and lurk-then-help** — MSPGeek/Slack, r/msp,
  DIGITAL SME channels. **Contribute value for 2–3 weeks before ever
  mentioning BidMorrow**, and only when on-topic and disclosed.
- **Direct 1:1 outreach:** identify 30–50 named Segment-A firms; personal
  LinkedIn connection + a genuinely relevant note (NOT a pitch template).
  Target ~5–8 quality conversations.
- Publish the cornerstone article; share natively on LinkedIn.

### Phase 2 — Demo-led conversion + partnerships (weeks 7–10)

- Every LinkedIn/community touch now drives to the **sample-verdict demo**
  → pilot request.
- **Partner outreach:** approach 5–10 bid/tender consultants and the
  DIGITAL SME Alliance with a "makes your triage faster / member benefit"
  angle (§7 for any co-marketing budget).
- Convert warm conversations into **3–5 personally-onboarded 5-day pilots**.
- Publish article #2 (methodology/worked-example flavored, links to the
  live demo).

### Phase 3 — Convert, learn, decide (weeks 11–13)

- **Convert pilots → paid;** capture every objection in the ledger.
- **Review gate:** by now we should have ~10 substantive conversations —
  the product-policy threshold. Assemble the evidence for the owner's
  pricing/free-verdict decisions (do NOT enact — §7).
- Decide, with data, whether a small **paid-ads test** is now justified
  (§7 P9) or whether organic is still the better euro.
- Publish article #3; a "what we learned in 90 days building in public"
  founder post (honesty narrative, no fabricated wins).

### Lightweight content calendar (LinkedIn = the engine; ~3/week)

Rotate four repeatable post types so it's sustainable solo:

1. **Pain posts** — name the exact wound ("the hours you lose qualifying
   tenders you were never going to win"). Highest cold-reach.
2. **Proof/teardown posts** — walk through _one_ real scored verdict; show
   the arithmetic and the walk-away flags. The demo, in post form.
3. **Category-honesty posts** — the "auditable, not AI" thesis; metered
   scores and paywalled explanations as the pattern we don't do (no naming
   competitors publicly — sales-doc landmine).
4. **Build-in-public posts** — solo-founder candor; what's hard, what's
   shipped. Fuels trust and the "first 25–50" story.

Long-form cadence: **one cornerstone article every ~3–4 weeks** (methodology
and CPV/scope clusters per `seo-content-strategy.md`), each seeded across
LinkedIn and, where genuinely useful, community threads.

---

## 7. Owner decisions and open questions (each with a recommendation)

Nothing here is enacted. Pricing substance is FROZEN; competitive pressure
does not unfreeze it. Costs are rough planning estimates.

| #        | Decision                                                                                                                                                                           | Rough cost                                                             | Recommendation                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-M1** | **Free-verdict exposure** (mirror of sales-strategy §5.1). The controlled sample-verdict demo is already approved; the open question is whether to go further toward a free taste. | €0 for the approved demo                                               | **Ship the approved demo; do NOT add a free tier.** It captures most defensive value at least cost. Revisit only after ~10 conversations.                          |
| **D-M2** | **Paid ads test** (LinkedIn and/or Google) once messaging is validated.                                                                                                            | ~€300–1,000 for a bounded test                                         | **Defer to after Phase 3.** Against a €29–49 ACV, unproven-message ad spend is the worst euro pre-PMF. Only test with a specific validated hook and a hard cap.    |
| **D-M3** | **LinkedIn outreach/scheduling tooling** (e.g. Sales Navigator, a scheduler).                                                                                                      | ~€60–100/mo (Sales Navigator ~€80/mo)                                  | **Optional, low.** Sales Navigator helps precise Segment-A targeting; a free-first month can validate before committing. Not required to start.                    |
| **D-M4** | **Partner co-marketing** with DIGITAL SME Alliance / bid consultants (member webinar, referral arrangement, listing).                                                              | €0–low; some bodies charge membership/sponsorship (**verify per org**) | **Pursue the free/referral versions first** (guest content, referral goodwill). Treat any paid sponsorship as a separate decision with named cost.                 |
| **D-M5** | **Event attendance** (GovTech Summit SME pass — often complimentary for SMEs; national MSP meetup).                                                                                | €0–500+ travel; summit SME passes may be free                          | **Pick at most one** Segment-A/C event this quarter; prefer a complimentary-pass event to control cost.                                                            |
| **D-M6** | **Named "BidMorrow vs X" comparison pages** (SEO).                                                                                                                                 | €0 (time)                                                              | **Hold.** Standing decision requires owner approval for named comparisons; invites retaliation and maintenance. Re-verify competitor claims first. Not for launch. |
| **D-M7** | **Directory/marketplace listings** (G2, AlternativeTo, Capterra) where shoppers compare tender tools.                                                                              | €0 for basic listings                                                  | **Low-effort yes** — claim free listings so we appear when the ICP is actively shopping. No budget needed for basic presence.                                      |
| **D-M8** | **"Team" vs solo-builder language** in public copy (truth-rule tension flagged in seo doc §4).                                                                                     | €0                                                                     | **Recommend solo/"builder" framing** — it's truthful (sole trader per docs) and the honesty is on-brand. Owner to confirm (D8 in the seo doc).                     |

**Open questions for the owner:**

- Is the founder willing to be **the public face** on LinkedIn 3x/week for
  a quarter? The #1 channel depends entirely on this. If not, the plan's
  center of gravity must shift to content+community and the timeline
  lengthens materially. (Role rule: I will not invent a founder biography —
  the founder supplies their own voice and story.)
- Which **home markets** to prioritize for Segment A (language, national
  ecosystem)? English-only launch is set, but outreach targeting is
  country-shaped and CNIL/UWG rules differ (§4a).
- Counsel sign-off on any outbound email program before it starts (§4a).

---

## 8. Marketing ↔ sales handoff

- **Marketing owns Awareness → Pilot request.** Sales
  (`sales-strategy.md`) owns Pilot request → Pilot → Paid, plus all
  battlecards and objection handling.
- **The handoff object is the pilot request** (form submission or inbound
  DM expressing intent). Marketing's job is to deliver a _warm, correctly
  self-qualified_ prospect who has already seen a real verdict via the demo
  — so the founder's first conversation starts at trust, not education.
- **Shared spine, divided register:** sales owns the precise claim
  ("auditable arithmetic you can re-run"); marketing owns the cold-audience
  translation (the pain-led narrative in §2) that _earns the right_ to make
  that claim. Neither contradicts the other; they operate at different
  funnel temperatures.
- **Shared landmines** (honored in all marketing assets): never quote
  competitor prices as fact (PROVISIONAL evidence); never name competitors
  publicly without owner approval; never claim broader coverage than
  reality (concede French sub-threshold and qualify out); never "AI-powered."
- **Feedback loop:** every objection sales logs in a pilot conversation
  feeds back into marketing's message testing (which pain post landed, which
  hook drew the wrong buyer). At 0→50, this loop _is_ the growth engine.

---

## 9. Where I challenge the existing docs (in writing)

1. **The competitive/sales docs are proof-obsessed at the expense of
   pain.** They correctly identify that "explained score" is now table
   stakes and escalate to auditability. But for **cold acquisition**, the
   binding question isn't "how is your explanation built" — it's "do you
   understand my Tuesday." The docs give marketing a sharp _reason to
   believe_ and a thin _reason to care_. This plan puts the pain first and
   the proof second for cold audiences (§2). Sales can lead with proof
   because sales conversations are already warm; marketing cannot.
2. **The market is real; its reachability is overstated by omission.** No
   doc states plainly that our ICP does not gather in one place, does not
   search for our category, and mostly doesn't know it exists for them.
   That is the actual constraint, and it reshapes everything toward
   founder-led + referral over scalable channels (§1.3, §3, §4). Naming it
   prevents the classic bootstrapped mistake of over-investing in SEO/ads
   too early.
3. **The free-tier floor is treated mainly as a positioning problem; it is
   also an acquisition problem.** Four competitors give a zero-risk first
   taste; we deliberately don't. The docs answer this rhetorically
   ("report is the wrong noun"). Acquisition needs a _mechanism_, not a
   rebuttal — hence the sample-verdict demo is elevated here from "a lever"
   to **the #2 channel and the conversion engine of the entire plan** (§4).
4. **Content/SEO's timeline is honest in the SEO doc but easy to
   misread as a launch channel.** It is a year-plus compounding asset. This
   plan explicitly ranks it #5 and sequences it as "plant now, harvest
   later," so it is never mistaken for a source of first customers (§4, §6).
5. **The plan quietly depends on a founder willing to be public.** No doc
   states that the strongest, cheapest channel (founder-led LinkedIn) is
   contingent on the owner's personal willingness to post consistently. I
   flag it as the single largest execution risk and an explicit open
   question (§7) rather than assuming it.

---

## 10. Sources

TED / EU-institutional (FACT):

- TED notice volume & value — <https://ted.europa.eu/en/simap/statistics-on-ted-notices>;
  European Commission TED page — <https://single-market-economy.ec.europa.eu/single-market/public-procurement/digital-procurement/tenders-electronic-daily_en>
- EU SME procurement strategy / SMEunited — <https://www.smeunited.eu/policies/policies/single-market/public-procurement>;
  <https://single-market-economy.ec.europa.eu/single-market/public-procurement_en>
- ENISA SME cybersecurity — <https://www.enisa.europa.eu/topics/awareness-and-cyber-hygiene/smes-cybersecurity>
- European DIGITAL SME Alliance — <https://www.digitalsme.eu/cybersecurity-privacy/>,
  <https://www.digitalsme.eu/cybersecurity-label/>

Market size (UNVERIFIED ESTIMATE — third-party analyst):

- Europe procurement software market — <https://www.marketdataforecast.com/market-reports/europe-procurement-software-market>;
  <https://www.grandviewresearch.com/industry-analysis/procurement-software-market-report>

GDPR / ePrivacy / outreach (VENDOR-SOURCED legal summaries — not legal advice):

- <https://overloop.com/blog/cold-email-illegal>;
  <https://scrap.io/gdpr-cold-email-b2b>;
  <https://salesforceeurope.com/blog/what-is-legitimate-interest-for-gdpr-cold-email-b2b-rules>;
  <https://www.knowlee.ai/blog/gdpr-compliant-cold-email-2026>

Bootstrapped B2B SaaS acquisition & founder-led LinkedIn (VENDOR-SOURCED):

- <https://productmarketfitisexpiring.com/how-to-get-your-first-100-customers/>;
  <https://www.kuverly.com/blog/how-solo-founders-get-their-first-10-b2b-saas-customers/>;
  <https://gallium.ai/blog/founder-led-linkedin-content-strategy-2026>;
  <https://startupcookie.com/guides/founder-led-content/>

Communities / events / partners:

- MSPGeek — <https://mspgeek.org/>
- GovTech Summit — <https://www.govtechsummit.eu/>;
  Handelsblatt GovTech Summit 2026 — <https://www.bmz-digital.global/en/event/handelsblatt-govtech-summit-2026/>;
  public-sector events guide — <https://www.tussell.com/insights/top-26-public-sector-events-of-2026>
- Bid consultants — <https://bidsolutions.com/bid-consulting/consultant-directory/>;
  <https://www.bid2tender.com/consultants-eu-tenders>
- EU cyber tender demand signal — <https://tendermetric.com/insights/eu-cybersecurity-tenders-2026>
