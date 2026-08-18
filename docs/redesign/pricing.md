# BidMorrow — canonical pricing specification (EUR)

Status: **canonical / single source of truth** for the marketing Pricing
page (`apps/web/src/pages/marketing/Pricing.tsx`), the Pilot page
(`apps/web/src/pages/marketing/Pilot.tsx`), and Stripe product/price
configuration. Written 2026-08-17 by the `billing` implementer per the
owner's product-policy lock. This document specifies pricing; it does not
implement it — no product code, Stripe object, or env var is created or
modified here.

Authority chain (do not re-derive, cite instead):

- `docs/redesign/requirements.md` §Standing decisions and
  §Decisions log (2026-08-17 entries) — pricing freeze, founding-cap
  revision, no-free-tier/no-trial policy.
- `docs/product-scope.md` §Pricing and §Product policy lock (owner decision
  2026-08-17) — plan substance, VAT posture, grandfathering rule.
- `HUMAN_DECISION_BLOCKERS.md` item 4 — Stripe Price IDs are human-provided,
  never invented.

---

## 1. The two tiers

Pricing substance is **frozen** by owner decision (reaffirmed 2026-08-17
"under competitive pressure" — see requirements.md §Standing decisions).
Do not propose different amounts, a third tier, usage-based fees, or an
annual contract.

|                  | **Founding**                                                                                                                     | **Standard**                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Price            | **€29 / month**                                                                                                                  | **€49 / month**                                             |
| Currency         | EUR, flat, no VAT line (see §6)                                                                                                  | EUR, flat, no VAT line (see §6)                             |
| Billing interval | Monthly, no annual contract                                                                                                      | Monthly, no annual contract                                 |
| Usage fees       | None                                                                                                                             | None                                                        |
| Availability     | Limited to the first 50 customers, feature-flag controlled (`founding_plan_open`) — see §2                                       | Unlimited; open once the founding plan is full, or any time |
| Price stability  | Locked for the life of the subscription while continuously subscribed (grandfathering — see §2); never auto-migrates to Standard | Standard price at signup                                    |
| **Feature set**  | **Identical to Standard**                                                                                                        | **Identical to Founding**                                   |

### Feature parity — stated plainly, not implied

Per `docs/product-scope.md` §V1 scope and the existing `Pricing.tsx` copy
("Both plans include the same feed, matching engine, daily digest, and
support"), **there is no feature gating between the two plans.** Both
Founding and Standard customers receive, without exception:

- Full customer feed (Today's Matches / Strong / Worth Reviewing /
  Possible / Saved / Ignored), filters and pagination.
- The complete deterministic matching engine: 0–100 explainable score per
  (org, lot), full component breakdown, risk flags, hard exclusions,
  UNKNOWN handling, engine versioning.
- Onboarding: company profile, CPV/geography/value/keyword preferences,
  preset profiles.
- Tender detail with full score explanation and source-notice link.
- Feedback (Useful / Not useful + structured reasons).
- The daily digest email (one per org per day, only when meaningful
  matches exist, unless the org opts into empty digests).
- Standard support.

The **only** differences between the plans are: price (€29 vs €49),
whether a founding slot is available (50 cap), and the price
grandfathering guarantee that comes with the founding slot. This document
does not invent a feature difference to justify the price gap — the gap is
early-adopter pricing plus a real scarcity constraint (see §2), not a
product tier.

---

## 2. Founding cap and grandfathering

**Grandfathering rule (settled, not a parameter):** a founding customer's
subscription is retained at €29/month for as long as they stay
continuously subscribed. It never auto-migrates to the €49 Standard price.
Any future price change to an existing subscriber would require its own
explicit, disclosed decision; none is planned for V1
(`docs/product-scope.md` §Pricing, PROD-P7-01).

**Founding cap — 50 (DECIDED by owner, 2026-08-17):**

- The owner's directive (`docs/redesign/requirements.md`
  §Decisions log, and `docs/product-scope.md` §Product policy lock) revised
  the cap from the originally shipped "first 20" to a **25–50** range, and
  on 2026-08-17 the owner selected the single number: **50**. This is the
  binding value, applied in place of the placeholder used in the draft of
  this document.
- The value **50** is applied consistently across every surface in the same
  change: marketing copy (`Pricing.tsx`, `Pilot.tsx`, `Terms.tsx`), the
  `DEFAULT_FOUNDING_CAP` default that backs the `founding_plan_open` /
  `founding_cap` flag, and the numeric lock in
  `packages/billing/src/plans.test.ts`. (The earlier note that the cap copy
  lived in `apps/web/src/copy.ts` and was locked by `app.test.ts` was
  stale — the cap text is inline in the marketing pages, and only
  `plans.test.ts` locks the numeric default.)

**Why 50 (owner's decision; the billing agent's non-binding recommendation
had been 30):**

- 50 is the top of the owner's approved 25–50 band. It maximizes the
  founding reference base, early product feedback, and MRR runway
  (50 × €29 = €1,450/month) while still reading as a credibly limited
  cohort — well above the "founding-20" figure that competitors' free
  tiers had made feel like faux scarcity (see §4/R5 in
  `docs/redesign/competitive-risk-assessment.md`).
- The grandfather cost of the higher cap is bounded and modest: at most
  €20/month per seat versus Standard, and only for customers who would
  otherwise have paid €49.
- Capacity caveat (carried forward from the sales motion): the founder-led,
  personally-run 5-day pilot in `docs/redesign/sales-strategy.md` §8.1 is
  high-touch. 50 pilots are sustainable only because they arrive
  sequentially over the founding period, not concurrently — the pilot
  cadence, not the cap, is the real throughput limit.

---

## 3. Entry path — no free tier, no automated trial

There is **no free tier** and **no automated 14/30-day SaaS trial**
(`docs/product-scope.md` §V1 scope — OUT table; requirements.md §Standing
decisions). The entry path is exclusively:

1. Public, no-signup **sample-verdict demo** (controlled; not a free tier —
   no anonymous tender submission, profile creation, alerts, or full-feed
   access) → CTA "Get verdicts matched to your company."
2. A short **pilot-request** (company, sector/CPV focus, countries bid in,
   monthly tender volume, name + business email) — a request for a
   founder-run pilot, not a signup or profile
   (`docs/redesign/sales-strategy.md` §8.1 stage 2).
3. A brief qualification call, then a **no-credit-card, personally
   onboarded 5-day validation pilot** on the prospect's real profile
   against the live TED stream (`docs/redesign/sales-strategy.md` §8.1
   stage 4; `apps/web/src/pages/marketing/Pilot.tsx`).
4. At day 5, the paid ask: **€29/month (founding, if 50
   slots remain, locked for the life of the subscription) or €49/month
   (standard)**, no card required until the prospect says yes, cancel
   anytime.

No automated trial period, no self-serve free access, and no discounting
below €29 to force a close (`docs/redesign/sales-strategy.md` §8.3: "a €5
customer does not validate a €49 product").

---

## 4. Competitive price positioning

Grounded only in verified findings in
`docs/redesign/competitive-risk-assessment.md` and
`docs/redesign/competitor-findings.md`. No unverified numbers are
re-asserted here.

**Where €29/€49 sits, in verified EUR terms:**

| Entrant                       | Verified price (EUR)                                                                                                       | Evidence grade                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tendly (tendly.eu)            | Professional **€29/month**, credit-metered (200 credits/mo; matching itself capped at ~5 credits/refresh)                  | VERIFIED-direct (competitive-risk-assessment.md §0, §2)                                                     |
| Tenderium (tenderium.net)     | Starter €99/mo (€89 annual), Growth €279/mo, Demo €0 (3 lifetime workspaces) — invoice-first, pre-transactional            | VERIFIED-snippet / VERIFIED-direct (competitive-risk-assessment.md §0, §1b, §2)                             |
| GetTenderAI (gettenderai.com) | Free (5 match-score checks/mo) → Basic **€235/mo** (unlimited scores) → Pro €319/mo (adds explanations) → Business €420/mo | VERIFIED-direct via owner-supplied screenshots (competitive-risk-assessment.md §1a, §2)                     |
| Stotles (stotles.com)         | Free (£0, unlimited users, free AI bid/no-bid report) → real capability from ~£475/mo                                      | VERIFIED-snippet + prior direct capture (competitive-risk-assessment.md §1c, §2; competitor-findings.md §2) |

**The positioning is accessible + explainable/auditable — not a
cheapest-price race:**

- €29 is **not** distinctive as a number by itself: Tendly charges the
  same €29/month (competitive-risk-assessment.md §3, "R1"). What remains
  distinctive is the _shape_ of the price — BidMorrow's €29/€49 is flat
  and unmetered (no credits, no reveal quotas, no score-check caps, no
  workspace quotas), whereas Tendly's €29 is credit-metered AI matching
  and GetTenderAI paywalls both unlimited scoring (€235) and explanations
  (€319) above a 5-score-per-month free tier. The counter-move recorded in
  competitive-risk-assessment.md §5.3 is to frame this as **"no meters,"
  not "cheap."**
- GetTenderAI's verified €235–€420 ladder and Tenderium's €99–€279 ladder
  are read in the risk assessment (§3, §7) as **third-party validation of
  what unlimited, explained match scoring is worth to this market** — not
  evidence that BidMorrow should be positioned as the discount option.
  €29/€49 sits far below those anchors while including, unmetered, what
  those vendors meter or paywall (unlimited scores + full component
  explanations).
- Stotles' free AI bid/no-bid report validates that qualification is a
  felt pain worth giving away as a hook, but its real capability starts
  near £475/month behind a sales call — BidMorrow's flat, self-serve,
  transparent EUR price is a structural contrast, not a price-matching
  response to a hook.
- The genuinely defensible differentiator at any price, per
  competitive-risk-assessment.md §3 ("Differentiation map"), is
  **deterministic, LLM-free, component-inspectable, reproducible
  scoring with hard-exclusion/risk-flag "walk-away" logic** — none of the
  profiled entrants can truthfully claim this at any price point. €29/€49
  is priced to make that mechanism accessible to a 5–50-person consultancy
  without a dedicated bid team, not to win a race to the bottom.

---

## 5. Stripe mapping

### Env var → plan mapping

| Env var (`apps/worker/src/env.ts`) | Plan                                    | Amount | Interval |
| ---------------------------------- | --------------------------------------- | ------ | -------- |
| `STRIPE_PRICE_FOUNDING_MONTHLY`    | `BIDMORROW_FOUNDING_MONTHLY` (Founding) | €29    | month    |
| `STRIPE_PRICE_STANDARD_MONTHLY`    | `BIDMORROW_STANDARD_MONTHLY` (Standard) | €49    | month    |

Both are Stripe **Price** object IDs, required (non-optional) in
staging/production, human-provided per `HUMAN_DECISION_BLOCKERS.md` item
4 — **never invented, never hardcoded in this document or in code.**
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are the companion
required env vars for the billing package; test-mode credentials outside
production, live-mode only in the `production` GitHub environment, never
mixed (`HUMAN_DECISION_BLOCKERS.md` item 4).

### Requirement on the underlying Stripe Price objects

Both `BIDMORROW_FOUNDING_MONTHLY` and `BIDMORROW_STANDARD_MONTHLY`
**MUST be created as EUR, monthly-recurring Price objects** in the Stripe
Dashboard/API (test mode for staging, live mode for production, per
`HUMAN_DECISION_BLOCKERS.md` item 4's existing instructions). This
document does not create or reference a specific Price ID — only the
currency/interval requirement the Price objects must satisfy.

### Stripe API verification (verify-current-docs skill)

Direct `WebFetch` to `docs.stripe.com` is **blocked by this sandbox's
network egress proxy** (same class of constraint already recorded in
`docs/redesign/competitive-risk-assessment.md` §0 for competitor domains —
not specific to Stripe). Verification below is therefore
**search-snippet grade** against the official Stripe API reference pages
(not model memory), retrieved 2026-08-17:

- **Currency is fixed at Price creation.** The `currency` parameter on
  `POST /v1/prices` is required and must be a three-letter ISO currency
  code (lowercase) that Stripe supports. A Price object has one default
  currency; Stripe's multi-currency mechanism (`currency_options`) adds
  _additional_ currencies onto an existing Price's default currency
  rather than letting a single Price float across currencies
  arbitrarily — "Make sure all of your prices have the same default
  currency." BidMorrow does not use `currency_options` or Adaptive
  Pricing: each Price object (Founding, Standard) is created directly
  with `currency: eur` and no other currency is offered, consistent with
  the owner's EUR-only decision (`docs/product-scope.md` §Pricing,
  owner decision 2026-08-16).
  Sources: <https://docs.stripe.com/api/prices/create>,
  <https://docs.stripe.com/api/prices/object>,
  <https://docs.stripe.com/products-prices/manage-prices> (search-snippet
  grade, retrieved 2026-08-17).
- **Recurring monthly interval.** The `recurring` parameter is a map of
  the price's recurring components; `recurring.interval` accepts one of
  `day`, `week`, `month`, `year`. Both BidMorrow Price objects use
  `recurring.interval: month` (`recurring.interval_count` defaults to 1 —
  not verified in this session; standard SDK examples show
  `Interval: month` with no explicit count for a plain monthly price).
  Source: <https://docs.stripe.com/api/prices/create> (search-snippet
  grade, retrieved 2026-08-17).
- **Current API version already on record**: `2026-07-29.dahlia`
  (`docs/dependency-versions.md` §Stripe facts, verified in Phase 9).
  Not re-verified in this session; carried forward from the existing
  record.

**Caveat, stated per the verify-current-docs skill's rule 5:** because
direct WebFetch of `docs.stripe.com` was unavailable in this sandbox
session, the currency/interval facts above are corroborated via web-search
snippets of the official API reference pages rather than a full page
fetch. They are treated as verified-but-lower-confidence-than-a-direct-
fetch, not as memory, and should be re-confirmed with a direct fetch the
next time `docs.stripe.com` is reachable (mirrors the standing caution
already recorded for `Stripe webhook-set page wording` in
`docs/dependency-versions.md` §Unverified / to re-check when network
allows — add this currency/interval line to that same list at the next
docs.stripe.com-reachable session).

### Webhook event set and idempotency (existing, cited for completeness)

Already verified and recorded (`docs/dependency-versions.md` §Stripe
facts, Phase 9): `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`. Ordering is not guaranteed (at-least-once
delivery) — dedupe on Stripe event ID with a unique DB constraint and
re-fetch current subscription state from the API rather than trusting
payload order, per the standing rule in `docs/project-guide.md`/billing agent
instructions. This pricing document does not change that contract; it is
cited so the pricing/Stripe-mapping section is self-contained.

---

## 6. Cost / margin note (cost-audit skill)

Source of record: `docs/cost-model.md` (fixed infrastructure prices
verified 2026-08-14; hard constraint **< $100/month**, target
**$5–30/month**, alert band **$60–80/month** projected run rate).

**Fixed infrastructure (from `docs/cost-model.md`):**

| Customers | Fixed monthly cost                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| 0–10      | ~$6/mo                                                                                                              |
| 100       | ~$26/mo                                                                                                             |
| 1,000     | ~$30–105/mo (crosses the alert band only via email volume + matching-write scale; both have identified mitigations) |

**Variable cost:** Stripe payment processing, ~2.9% + $0.30/transaction
(EU-card rates vary — `docs/cost-model.md` §Variable / revenue-linked
costs; not re-verified against current Stripe fee pages in this session,
carried forward as the existing modeled figure). Approximated in EUR as
~2.9% + ~€0.28 for this margin sketch.

**Headline margin conclusion:** at 50 founding customers
(25–50 per the owner's range) paying €29/month, monthly revenue is
€725–€1,450 against fixed infrastructure of **~$6/month** (well under the
10-customer cost-model row) — **gross margin comfortably above 99% before
Stripe fees**, and still above ~95% net of Stripe's ~2.9%+€0.30 per
transaction. At 100 mixed customers (a blend of grandfathered €29
founding and €49 standard), revenue is in the €2,900–€4,900/month range
against ~$26/month fixed infrastructure — margin remains above ~99%
before payment fees. The cost model's own conclusion
(`docs/cost-model.md`: "by then revenue is ≥$29k/mo") confirms that even
at the 1,000-customer scale where fixed costs could approach the
$60–80/month alert band, revenue (≥€29,000/month at all-founding pricing,
more at any standard mix) outpaces infrastructure cost by roughly two
orders of magnitude. **€29/€49 monthly holds a strongly positive margin
at every modeled scale (10 / 100 / 1,000 customers) under the
fixed-infrastructure-under-$100/month constraint; margin is not a
constraint on this pricing.**

---

## 7. Owner decisions / open questions

| #   | Question                                                                                                                                                                                                                                                  | Status                                                                                               | Recommendation                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Founding cap — the exact number in 25–50.** Governed shipping founding-cap copy, the `DEFAULT_FOUNDING_CAP` default behind the `founding_cap` flag, and the numeric lock in `plans.test.ts`.                                                            | **DECIDED — owner selected `50` on 2026-08-17.** Applied across all surfaces in this change; see §2. | 50 — owner's decision (top of the approved 25–50 band; the billing agent's non-binding recommendation had been 30). See §2.                                                                                                                                                                                                                                             |
| 2   | **Public pilot-waitlist once the cap fills.** Once 50 founding slots are taken, should the marketing site show a waitlist/"join the standard plan now" state, or simply stop advertising founding availability and route new pilots straight to Standard? | **OPEN — not decided in any reviewed doc.**                                                          | Recommend: once the cap fills, `Pricing.tsx`/`Pilot.tsx` should route new pilot requests straight to the €49 Standard plan with honest copy ("the founding plan is full — you'll start on the standard plan"), rather than a waitlist, because a waitlist implies future founding slots may reopen, which is not a stated policy and would need its own owner decision. |
| 3   | **Whether Stripe Tax / VAT activation changes this doc.** Currently no VAT is collected (owner decision 2026-08-16, `docs/product-scope.md` §Pricing: sole trader, no VAT registration, flat prices, `stripe_tax_enabled` flag OFF everywhere).           | **Not open — settled, but has a documented revisit trigger.**                                        | No action for this doc; when the owner registers for VAT, this doc's €29/€49 headline prices and the "no VAT line" language in §1/§5 need a follow-up revision alongside the code-side flag flip (`docs/product-scope.md` §Pricing already documents the mechanical steps). Recorded here only so a future editor of this pricing doc doesn't miss it.                  |

---

## 8. Reconciliation targets (RECONCILED to 50, 2026-08-17)

The following code surfaces formerly said "first 20," which was stale
relative to the owner's cap revision. With the cap now DECIDED at **50**
(§2), they are updated to "50" **in the same change that finalizes this
spec** — no longer deferred:

- `apps/web/src/pages/marketing/Pricing.tsx` — body copy and the
  `<meta name="description">` tag → "first 50 customers". ✅ reconciled.
- `apps/web/src/pages/marketing/Pilot.tsx` — body copy and the
  `<meta name="description">` tag → "up to 50 customers" / "first 50
  customers". ✅ reconciled. (A separate, larger reshape of this page to
  describe the full no-card pilot-request → qualification-call → 5-day
  pilot sequence from §3 remains a distinct M3 follow-up — the number is
  corrected now; the flow rewrite ships with the marketing-page milestone.)
- `apps/web/src/pages/marketing/Terms.tsx` — "the first 50 customers".
  ✅ reconciled.
- `packages/billing/src/plans.ts` — `DEFAULT_FOUNDING_CAP` 20 → 50, backing
  the `founding_cap` / `founding_plan_open` flag default. ✅ reconciled.
- `packages/billing/src/plans.test.ts` — the numeric lock now asserts 50.
  ✅ reconciled. (This is the only test that locks the number; the earlier
  claim that `apps/web/src/app.test.ts` and `apps/web/src/copy.ts` held the
  cap copy was stale — neither actually references the founding cap.)
- Doc comments in `packages/config/src/feature-flags.ts` and
  `packages/db/src/repositories/billing.ts` that quoted "first 20" → "50".
  ✅ reconciled.
