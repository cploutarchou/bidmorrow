# BidMorrow — canonical pricing specification (EUR)

Status: **canonical / single source of truth** for the marketing Pricing
page (`apps/web/src/pages/marketing/Pricing.tsx`), the Pilot page
(`apps/web/src/pages/marketing/Pilot.tsx`), and Paddle product/price
configuration (ADR-0011; this section was rewritten 2026-08-25). Written 2026-08-17 by the `billing` implementer per the
owner's product-policy lock. This document specifies pricing; it does not
implement it — no product code, Paddle object, or env var is created or
modified here.

Authority chain (do not re-derive, cite instead):

- `.claude/skills/website-redesign/requirements.md` §Standing decisions and
  §Decisions log (2026-08-17 entries) — pricing freeze, founding-cap
  revision, no-free-tier/no-trial policy.
- `docs/product-scope.md` §Pricing and §Product policy lock (owner decision
  2026-08-17) — plan substance, VAT posture, grandfathering rule.
- `HUMAN_DECISION_BLOCKERS.md` item 4 — Paddle price ids are human-provided
  (sandbox ones created 2026-08-25 and recorded in docs/setup-guide.md §4b),
  never invented in code.

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

- The owner's directive (`.claude/skills/website-redesign/requirements.md`
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

## 5. Paddle mapping (ADR-0011)

### Env var → plan mapping

| Env var (`apps/worker/src/env.ts`) | Plan                          | Amount (excl. VAT) | Interval |
| ---------------------------------- | ----------------------------- | ------------------ | -------- |
| `PADDLE_PRICE_FOUNDING_MONTHLY`    | BidMorrow Founding (Founding) | €29                | month    |
| `PADDLE_PRICE_STANDARD_MONTHLY`    | BidMorrow Standard (Standard) | €49                | month    |

Both are Paddle **price** ids (`pri_…`), required (non-optional) in
staging/production, human-provided per `HUMAN_DECISION_BLOCKERS.md` item
4 — **never hardcoded in code.** Sandbox ids are recorded in
`docs/setup-guide.md` §4b; live ids will differ (separate account).
Companion required names: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`
(secrets), `PADDLE_CLIENT_TOKEN`, `PADDLE_ENVIRONMENT` (variables) —
sandbox outside production, live only in the `production` GitHub
environment, never mixed.

### Requirement on the underlying Paddle prices

Both prices **MUST be EUR, `billing_cycle: { interval: month, frequency:
1 }`, `tax_mode: external`** (tax-exclusive — owner decision 2026-08-25),
on a product with `tax_category: saas`. Quantity is locked to 1
(`quantity: { minimum: 1, maximum: 1 }`) — one subscription per
organization. Verified against the Paddle API reference via the
paddle-docs MCP on 2026-08-25 (`unit_price.amount` is a lowest-unit string,
`"2900"`; `unit_price.currency_code: EUR`); the sandbox prices were created
with exactly these parameters and read back.

### What the customer sees

Paddle, as Merchant of Record, computes VAT for the customer's country in
the checkout overlay and on the invoice: an EU business with a valid VAT
ID pays €29/€49 under reverse charge; a Cyprus consumer pays €29 + 19%.
Marketing/app copy therefore states amounts as "€29 / month + VAT".

### Webhook event set and idempotency (existing, cited for completeness)

`subscription.created|activated|trialing|updated|past_due|paused|resumed|canceled`
(docs/dependency-versions.md § Paddle facts). Ordering is not guaranteed
(at-least-once delivery) — dedupe on the Paddle event id with a unique DB
constraint (`provider_event_id`) and re-fetch current subscription state
from the API rather than trusting payload order. This pricing document
does not change that contract.

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

**Variable cost:** Paddle's Merchant-of-Record fee, **5% + 50¢ per
transaction** (Paddle's published rate, verified 2026-08-25 —
`docs/cost-model.md` §Variable / revenue-linked costs). Approximated in
EUR as 5% + ~€0.45 for this margin sketch. In exchange Paddle carries VAT
calculation, collection, remittance and invoicing. Net per subscription:
**≈ €27.10 on €29** (Founding), **≈ €46.10 on €49** (Standard).

**Headline margin conclusion:** at 50 founding customers
(25–50 per the owner's range) paying €29/month, monthly revenue is
€725–€1,450 against fixed infrastructure of **~$6/month** (well under the
10-customer cost-model row) — **gross margin comfortably above 99% before
Paddle fees**, and still above ~93% net of Paddle's 5% + €0.45 per
transaction (€27.10 net × 50 = €1,355/month against ~$6 of infrastructure). At 100 mixed customers (a blend of grandfathered €29
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

| #   | Question                                                                                                                                                                                                                                                     | Status                                                                                               | Recommendation                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Founding cap — the exact number in 25–50.** Governed shipping founding-cap copy, the `DEFAULT_FOUNDING_CAP` default behind the `founding_cap` flag, and the numeric lock in `plans.test.ts`.                                                               | **DECIDED — owner selected `50` on 2026-08-17.** Applied across all surfaces in this change; see §2. | 50 — owner's decision (top of the approved 25–50 band; the billing agent's non-binding recommendation had been 30). See §2.                                                                                                                                                                                                                                             |
| 2   | **Public pilot-waitlist once the cap fills.** Once 50 founding slots are taken, should the marketing site show a waitlist/"join the standard plan now" state, or simply stop advertising founding availability and route new pilots straight to Standard?    | **OPEN — not decided in any reviewed doc.**                                                          | Recommend: once the cap fills, `Pricing.tsx`/`Pilot.tsx` should route new pilot requests straight to the €49 Standard plan with honest copy ("the founding plan is full — you'll start on the standard plan"), rather than a waitlist, because a waitlist implies future founding slots may reopen, which is not a stated policy and would need its own owner decision. |
| 3   | **VAT.** SETTLED 2026-08-25 (ADR-0011): Paddle is Merchant of Record and charges VAT itself; prices are tax-exclusive (`tax_mode: external`) — the customer pays €29/€49 **+ VAT**. The earlier "no VAT at launch / dormant Stripe Tax" arrangement is gone. | **Closed.**                                                                                          | Customer-facing copy states "+ VAT"; the headline amounts are unchanged. No revisit trigger — VAT registration is Paddle's, not the owner's.                                                                                                                                                                                                                            |

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
