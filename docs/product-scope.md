# BidMorrow — Product Scope (V1)

Headline: **"Find the tenders worth pursuing. Skip the rest."**

BidMorrow is bid/no-bid qualification intelligence for EU public procurement.
It answers one question for its customer: _"Should a company like mine spend
time investigating this tender?"_

## Target customer

European cybersecurity, cloud, software-development and IT consultancies,
~5–50 employees, that pursue public-sector contracts without a dedicated
procurement/bid team.

## Core problem

TED already publishes all EU procurement notices. The customer's problem is not
access — it is deciding which of the thousands of daily notices are worth
investigating. BidMorrow prioritizes **qualification and relevance**, not
generic tender search.

## V1 scope — IN

1. **Account & organization**: signup, email verification, login/logout,
   password reset, session management, account deletion. Roles modeled
   (ORGANIZATION_OWNER, MEMBER, INTERNAL_ADMIN); V1 UI exposes owner
   functionality only.
2. **Onboarding**: company profile — capabilities, CPV preferences, geography
   (countries/NUTS), contract nature, value range, keywords + synonym groups,
   exclusions, certifications, deadline threshold, digest preferences.
   3–5 editable **preset profiles** (Cybersecurity consultancy, Cloud/DevOps
   consultancy, Software development house, IT services generalist) to defeat
   the empty-CPV-picker cold start.
3. **TED ingestion (scoped)**: incremental daily ingestion of COMPETITION
   notices within a configured CPV scope (see docs/ted-ingestion-scope.md).
   Lot-level modeling, notice versioning/corrections, retention/archival.
4. **Deterministic matching engine**: 0–100 explainable score per (org, lot),
   component breakdown, risk flags, hard exclusions, UNKNOWN handling,
   engine versioning. **No LLM in the production request path.**
5. **Customer feed**: Today's Matches / Strong / Worth Reviewing / Possible /
   Saved / Ignored, with filters and pagination. Tender detail with full
   explanation and link to the original TED notice.
6. **Feedback**: Useful / Not useful (+ structured reasons). Stored; no
   automatic opaque score adjustment.
7. **Daily digest email**: one per org per day, only when meaningful matches
   exist (unless the org opts into empty digests), DB-enforced dedupe.
8. **Billing**: Paddle Billing as Merchant of Record (ADR-0011) — Paddle.js
   checkout overlay + Paddle customer portal. Founding €29/mo (first 100,
   flag-controlled) and Standard €49/mo, **VAT included** (Paddle computes
   and collects the VAT share). Server-side entitlements.
9. **Internal admin**: org/user/subscription search, ingestion & digest
   debugging, match trace, feature flags, ingestion scope config, pause
   switches, audit log.
10. **Marketing site**: /, pricing, how-it-works, methodology, pilot, privacy,
    terms, contact. No fake customers/testimonials/statistics.

## V1 scope — OUT (deliberate exclusions)

| Excluded                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-TED sources (national portals, paid datasets)       | TED-only V1; `ProcurementSource` interface keeps the door open                                                                                                                                                                                                                                                                                                                                                |
| Contract **award** notices in matching                  | Competition notices are the bid/no-bid input; awards deferred to future buyer-history enrichment                                                                                                                                                                                                                                                                                                              |
| Exhaustive all-of-TED ingestion                         | D1 size limits + cost; scoped ingestion is the product promise (relevance, not completeness)                                                                                                                                                                                                                                                                                                                  |
| LLM scoring / summaries                                 | Cost, determinism, explainability; V1 must be auditable                                                                                                                                                                                                                                                                                                                                                       |
| Machine translation                                     | Cost; language-independent fields (CPV/NUTS/values/deadlines) dominate scoring; capability match marked UNKNOWN when no matchable-language text                                                                                                                                                                                                                                                               |
| ML-driven score learning from feedback                  | Opaque; V1 stores feedback and may later _suggest_ deterministic preference edits                                                                                                                                                                                                                                                                                                                             |
| Multi-seat collaboration UX                             | Memberships modeled; UI deferred                                                                                                                                                                                                                                                                                                                                                                              |
| Complex pricing tiers, annual plans, usage billing      | Two monthly prices; schema supports future plans                                                                                                                                                                                                                                                                                                                                                              |
| Mobile apps                                             | Responsive web only                                                                                                                                                                                                                                                                                                                                                                                           |
| Session replay / third-party analytics                  | Minimal first-party events only                                                                                                                                                                                                                                                                                                                                                                               |
| Programmatic/auto-generated public per-tender SEO pages | Thin content + leaks customer relevance signals; a tender has no universal fit score (the verdict depends on the supplier), and it creates ingestion/canonicalization/stale-notice/duplicate-content problems and the wrong acquisition loop before match quality is proven (owner decision 2026-08-17). A SMALL number of manually authored commercial category pages IS allowed — see "Product policy lock" |
| Permanent free plan / self-serve free tier              | Would create abuse/cost exposure and undercut paid positioning; the controlled public sample-verdict demo replaces it (owner decision 2026-08-17)                                                                                                                                                                                                                                                             |
| Automated 14/30-day SaaS free trial (at launch)         | Founding pilots are personally onboarded; a no-card manual 5-day validation is used instead (owner decision 2026-08-17)                                                                                                                                                                                                                                                                                       |

## Product-truth rules

- BidMorrow is **decision support**. It never guarantees eligibility,
  compliance, award, or completeness/accuracy of source notices. Customers
  must verify requirements in the original procurement documents.
- Never fabricate a requirement: risk flags carry source evidence and
  confidence, with wording like "Possible requirement detected — verify in
  source documents."
- Coverage is scoped and documented — never imply exhaustive EU coverage.
- Scores are deterministic and reproducible; every score explains itself.

## Success signals for the founding pilot

- Time-to-first-relevant-match after onboarding < 1 day.
- Weekly active digest opens; Useful/Not-useful ratio trending up per org.
- Qualitative: pilot customers report shortlisting time reduced.

## Pricing

- Founding: €29/month, limited to first 100 customers (feature flag
  `founding_plan_open`, configurable cap; `DEFAULT_FOUNDING_CAP = 100` —
  owner decision 2026-08-26, raised from 50).
- Standard: €49/month.
- Currency is **EUR** — decided by the owner 2026-08-16 (natural fit for
  an EU procurement product); the Paddle prices are EUR and all
  customer-facing copy must state EUR amounts.
- **VAT is handled by Paddle as Merchant of Record** (ADR-0011, owner
  decision 2026-08-25, superseding the 2026-08-16 "no VAT at launch"
  decision): the owner has no VAT registration and needs none — Paddle is
  the seller, computes VAT for the customer's country at checkout,
  collects it, remits it and issues the invoice. Prices are
  **tax-INCLUSIVE** (`tax_mode: internal`, owner decision 2026-08-26,
  superseding the 2026-08-25 tax-exclusive choice): the customer pays
  exactly €29/€49 and Paddle carves the VAT for their country out of that
  amount; customer-facing copy says "incl. VAT". B2B customers enter their
  VAT ID in the Paddle checkout for reverse charge where applicable (they
  then pay the same €29/€49 with no VAT share). Nothing tax-related is
  configurable in BidMorrow code.
- The founding price is retained for the life of the subscription — a
  founding customer's plan never auto-migrates to the standard price
  (PROD-P7-01, Phase 7 review). Any future price change to an existing
  subscriber would require its own explicit, disclosed decision; none is
  planned for V1.

## Product policy lock — owner decision 2026-08-17

Settled in response to the competitive investigation
(`docs/redesign/competitive-risk-assessment.md`). These are firm for V1;
each is an owner decision, not to be re-litigated by implementation work.

- **Pricing: NO CHANGE.** €29 Founding / €49 Standard, flat **EUR**,
  retained. (The owner wrote the amounts with "$" in the directive; this
  is shorthand for the existing euro pricing — currency was deliberately
  set to EUR on 2026-08-16, and a currency switch
  would itself be a pricing change, which the directive forbids.) No
  pricing experiments until at least ~10 serious sales conversations and
  preferably the first 3–5 payments. Never discount below €29 to
  manufacture validation ("a €5 customer does not validate a €49
  product").
- **Founding cap: first 50 customers** — owner-revised from 20 to a 25–50
  range, then set to the single number **50** on 2026-08-17. Price
  grandfathered while continuously subscribed. This is now applied
  everywhere: the marketing copy (`Pricing.tsx`, `Pilot.tsx`, `Terms.tsx`),
  the `DEFAULT_FOUNDING_CAP = 50` default backing the `founding_plan_open` /
  `founding_cap` flag, and the numeric lock in
  `packages/billing/src/plans.test.ts`. (The earlier note that the cap copy
  lived in `copy.ts` and was locked by `app.test.ts` was inaccurate — the
  cap text is inline in the marketing pages; neither `copy.ts` nor
  `app.test.ts` references the cap.) Full rationale:
  `docs/redesign/pricing.md` §2.
- **No permanent free plan / free tier.** No self-serve free access.
- **No automated 14/30-day SaaS trial at launch.** Pilots are personally
  onboarded; a **no-credit-card manual 5-day validation/pilot** is the
  entry path.
- **Public sample-verdict demo: IN (controlled).** A public,
  no-signup demonstration — NOT a free version of the product. It shows a
  small curated set (target 3–5) of sample verdicts spanning the real
  outcome classes (Strong Match, Worth Reviewing, Low Fit, Excluded),
  each with a real-or-sanitized tender, a representative supplier
  profile, the score, the component breakdown, detected risk flags, the
  recommendation, and the source link — then a single CTA of the form
  "Get verdicts matched to your company." Hard boundaries (to prevent it
  becoming a free tier or an abuse/cost vector): anonymous visitors may
  NOT submit arbitrary tenders, create company profiles, receive alerts,
  or reach the full feed. The acquisition advantage demonstrated is
  **explainability** (why the decision was made), not "AI".
- **Manually authored commercial category pages: IN (bounded).** A small
  number — `/cybersecurity-tenders`, `/cloud-tenders`, later perhaps
  `/software-development-tenders` — each a hand-written page explaining
  the qualification methodology and showing sample verdicts. These are
  NOT auto-generated tender directories.
- **Programmatic public per-tender SEO pages: OUT for V1** (see the
  exclusions table).
- **Deterministic, explainable scoring: REQUIRED; no LLM in the core
  scoring path in V1.** Source-backed risk flags, decomposable score,
  engine versioning. An LLM may LATER summarize source documents or
  extract candidate requirements, but must never silently manufacture the
  verdict. This is the positioning spearhead against generic "AI tender
  matching": we show exactly why a tender fits and what could disqualify
  the supplier.
