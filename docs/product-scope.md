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
8. **Billing**: Stripe Checkout + Customer Portal. Founding €29/mo (first 20,
   flag-controlled) and Standard €49/mo. Server-side entitlements.
9. **Internal admin**: org/user/subscription search, ingestion & digest
   debugging, match trace, feature flags, ingestion scope config, pause
   switches, audit log.
10. **Marketing site**: /, pricing, how-it-works, methodology, pilot, privacy,
    terms, contact. No fake customers/testimonials/statistics.

## V1 scope — OUT (deliberate exclusions)

| Excluded                                           | Why                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-TED sources (national portals, paid datasets)  | TED-only V1; `ProcurementSource` interface keeps the door open                                                                                  |
| Contract **award** notices in matching             | Competition notices are the bid/no-bid input; awards deferred to future buyer-history enrichment                                                |
| Exhaustive all-of-TED ingestion                    | D1 size limits + cost; scoped ingestion is the product promise (relevance, not completeness)                                                    |
| LLM scoring / summaries                            | Cost, determinism, explainability; V1 must be auditable                                                                                         |
| Machine translation                                | Cost; language-independent fields (CPV/NUTS/values/deadlines) dominate scoring; capability match marked UNKNOWN when no matchable-language text |
| ML-driven score learning from feedback             | Opaque; V1 stores feedback and may later _suggest_ deterministic preference edits                                                               |
| Multi-seat collaboration UX                        | Memberships modeled; UI deferred                                                                                                                |
| Complex pricing tiers, annual plans, usage billing | Two monthly prices; schema supports future plans                                                                                                |
| Mobile apps                                        | Responsive web only                                                                                                                             |
| Session replay / third-party analytics             | Minimal first-party events only                                                                                                                 |
| Public tender SEO pages                            | Risk of thin content + leaking customer relevance signals                                                                                       |

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

- Founding: €29/month, limited to first 20 customers (feature flag
  `founding_plan_open`, configurable cap).
- Standard: €49/month.
- Currency is **EUR** — decided by the owner 2026-08-16 when creating the
  live-mode Stripe prices (natural fit for an EU procurement product);
  all customer-facing copy must state EUR amounts.
- **VAT via Stripe Tax** — decided by the owner 2026-08-16 (over the
  B2B-only reverse-charge default): prices are **tax-exclusive** — €29/€49
  plus VAT, calculated at checkout by Stripe Tax; business customers can
  enter a VAT ID. All customer-facing prices must say "excl. VAT".
  Checkout's automatic tax is gated by the `stripe_tax_enabled` feature
  flag until the owner activates Stripe Tax in the Stripe Dashboard
  (both modes — see HUMAN_DECISION_BLOCKERS item 7).
- The founding price is retained for the life of the subscription — a
  founding customer's plan never auto-migrates to the standard price
  (PROD-P7-01, Phase 7 review). Any future price change to an existing
  subscriber would require its own explicit, disclosed decision; none is
  planned for V1.
