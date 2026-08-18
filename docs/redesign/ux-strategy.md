# BidMorrow — UX Strategy & Information Architecture Report

Author: ux-strategist lane, website-redesign workflow.
Date: 2026-08-17.
Status: strategy deliverable for the shared plan (docs/website-redesign-plan.md §6/§6a). No code changes made.

Grounding read for this report: `docs/conventions/ux-strategist.md`,
`docs/redesign/requirements.md` (pricing frozen; onboarding
top priority; three visual directions rejected — this report is
direction-agnostic and pattern-level), `docs/website-redesign-plan.md`,
`docs/product-scope.md`, `docs/matching-engine.md` (component weights),
`apps/web/src/App.tsx`, `apps/web/src/copy.ts`, all pages in
`apps/web/src/pages/{marketing,auth,app}`, `apps/web/src/components/{AppShell,
ProtectedRoute,MarketingLayout}.tsx`, and the worker routes that define the
real contract (`apps/worker/src/routes/org.ts` onboarding endpoints,
`apps/worker/src/routes/feed.ts` 402, `packages/billing/src/entitlement.ts`).

A note on the rejected directions: everything below is **structure, flow, and
behavior** — implementable under any visual direction. Where the owner-liked
"setup assistant" _pattern_ is referenced, it means the interaction pattern
(one topic per screen, visible labeled progress, Back always available,
explanatory framing), not any macOS visual treatment.

---

## 1. Proposed sitemap

### 1.1 Public site (all existing URLs kept — no route changes)

```
/                       Home — convert or route to understanding
├── /how-it-works       The 5-step mechanism (understanding)
├── /methodology        The trust asset: how scoring actually works
├── /pricing            FROZEN content; restyle only
├── /pilot              Founding-pilot terms; objection handling
├── /contact            Email-only contact
├── /privacy            Legal
├── /terms              Legal
├── /signup             Auth
├── /login              Auth (gains ?returnTo=)
├── /verify-email       Auth
├── /forgot-password    Auth
└── /reset-password     Auth
```

Cross-linking model (the change is edges, not nodes):

- Home → Methodology (trust path) and → Signup (conversion path) — both from
  the hero. Home → How-it-works for the "how" question.
- How-it-works → Methodology (depth) and → Signup (closing CTA — this page
  currently dead-ends; confirmed in code: no CTA after step 5).
- Methodology → Signup (closing CTA) + link back to How-it-works.
- Pilot → Signup (already exists).
- Every marketing page footer: TED attribution + decision-support disclaimer
  (already mandatory) + nav to all public pages.

Not added (agreeing with plan defaults): vertical landing pages (D4 — NO this
cycle), public tender pages (out of scope, standing rule), blog/changelog
(no content engine exists; empty blogs signal abandonment).

### 1.2 App

```
/onboarding                      Setup assistant (no AppShell chrome; own frame)
/app                             Feed — "What should you investigate today?"
├── /app/tenders/:matchId        Tender detail (score breakdown, risk flags)
├── /app/settings                Settings (grouped, in-page section nav)
└── /app/billing/success         NEW — post-checkout confirmation (plan §6 item 4)
/admin/*                         Unchanged, cloaked (out of this report's scope)
```

One new route only (`/app/billing/success`, already in the plan). Everything
else is behavior inside existing routes.

### 1.3 Routing rules (the part that is currently broken)

R1. **Login/verify landing**: after successful login (and after email
verification completes a session), route by state, not to a fixed URL: - `returnTo` param present and internal → go there (validated: same-origin
path starting with `/`, never a full URL — open-redirect guard). - else if org missing OR `profile.onboardingCompletedAt === null` →
`/onboarding`. - else → `/app`.
The org/onboarding probe is one existing call (`GET /api/org/profile`;
403 = no org). Cache the answer in auth context for the session; refresh it
when onboarding completes.
R2. **/app with no org** → redirect to `/onboarding` (client). Feed's 403
error message remains as backstop with a link, never as the primary path.
R3. **/onboarding with completed onboarding** → redirect to `/app` (prevents
re-running the wizard by accident; Settings is the editing surface).
R4. `ProtectedRoute` redirect to login carries `returnTo`
(`/login?returnTo=/app/tenders/abc`) so deep links from digest emails
survive an expired session. This is the highest-value use of `returnTo`:
digest links are the product's main re-engagement channel.

---

## 2. End-to-end journey maps

Persona anchor: managing director or delivery lead at a 5–50-person EU
IT/cyber consultancy; no bid team; skeptical of "AI tender tools"; evaluates
on a laptop between client work; will re-encounter the product on a phone via
the digest email. Every journey below must survive 390px.

### Journey A — Cold visitor → paying, activated customer (the master journey)

```
Stage        Landing → Understanding → Signup → Verify → Onboarding → Subscribe → First value → Habit
User asks    "What is  "How does it   "Fine,   "Where's  "What do    "Is it     "Was it      "Is it right
             this and   actually       let's    the       you need    worth      worth it?"    often enough
             is it for  work? Can I    try."    email?"   from me?"   €29?"                    to keep?"
             me?"       trust it?"
Surface      /          /how-it-works  /signup  /verify-  /onboarding Settings→  /app feed     digest email
                        /methodology            email                 Billing                  → /app
```

**A1. Landing (/).** Current state: headline + subhead + one CTA to /pilot +
a 4-bullet feature list. Frictions:

- F1: No mechanism proof on the page — the score breakdown (the product's
  entire differentiation) is invisible. A skeptical buyer has nothing to
  evaluate. Fix: hero artifact = real rendered `ScoreBreakdownTable` of the
  canonical 84.5/100 worked example (plan §7 — endorsed; it's a real
  component, so it can't lie).
- F2: Single CTA routes to /pilot, adding a hop before /signup (see challenge
  C9). Fix: primary CTA → /signup with founding framing; "What's the founding
  pilot?" as an adjacent link. Secondary CTA → "See how scoring works"
  (/methodology).
- F3: No persona line — a visitor can't tell in 5 seconds it's for small
  IT/cyber consultancies. Fix per plan §7 (persona line under subhead).
- F4: No objection handling (Is this AI? What's covered? Can I cancel?). Fix:
  FAQ accordions on Home (plan §4b — endorsed), sourced only from documented
  truths.

**A2. Understanding (/how-it-works, /methodology).** Frictions:

- F5: /how-it-works dead-ends after step 5 (verified in code) — the most
  interested visitors get no next step. Fix: closing CTA block (signup +
  methodology links).
- F6: /methodology is written as a compliance document, not a sales asset —
  yet it's the only page that can substitute for testimonials (plan §1 gap 2).
  Fix: annotated worked example at top, "same inputs + same engine version =
  identical score" framing, closing CTA. Keep every existing statement
  verbatim (copy-locked; disclosure statements are mandatory).
- F7: The 5 steps have no visuals; text-only process descriptions are skimmed,
  not absorbed. Fix per plan (UI crops/diagrams).

**A3. Signup (/signup).** Mostly fine (3 fields, honest errors). Frictions:

- F8: No expectation-setting — the user doesn't know signup → verify → ~5 min
  profile setup → subscribe → matches tomorrow. Surprise sequencing is the
  killer of this funnel because _value arrives next-day by design_. Fix: one
  line under the form: "Next: verify your email, set up your company profile
  (about 5 minutes), and your first matches arrive with the next daily
  ingestion run." Honest, cheap, and reduces both drop-off and support mail.
- F9: No password requirements shown until server rejection. Fix: state the
  policy inline before submission.

**A4. Verification (/verify-email).** Frictions:

- F10: Dead-end page pattern ("check your inbox") with no resend affordance
  visible in flow and no statement of the sender address to search for. Fix:
  resend button (endpoint exists in Better Auth), "sent to {email}", "check
  spam" hint.
- F11: After clicking the emailed link, the user lands back on /verify-email —
  where do they go next? Fix: verified state on this page routes by rule R1
  (→ /onboarding for new users). This is the exact seam where the current
  product loses a new user into the 403 dead-end.

**A5. Onboarding.** Full spec in §3. Current frictions summarized:

- F12 (**critical**): no routing into it at all — a new user who lands on
  /app sees "Complete onboarding to see your feed." as an _error_, with no
  link. The single worst moment in the product today. Fix: R1–R3 + linked
  backstop message.
- F13: "Step 3 of 10" flat progress; 10 undifferentiated steps read as a tax
  form. Fix: 4 labeled phases (§3).
- F14: presets prefill locally but **skipping a step silently discards the
  preset's data** — a user who picks "Cybersecurity consultancy" then skips
  ahead finishes with an empty CPV list and will never see a single match
  (CPV pre-filter requires division overlap). This is a churn machine. Fix in
  §3.6 (review-step reconciliation) — implementable with the existing API.
- F15: the scope-overlap warning fires only at completion — after the user has
  invested all the effort. Fix: live in-scope indicator on the CPV screen
  (§3.4), server warning kept as authority.
- F16: 30-item flat country checkbox list; CPV codes rendered as bare numbers
  ("72000000") with no human labels. Fix: grouped region picker with search;
  CPV labels from a static label map for the preset-covered codes (data
  already known at build time — no API change).

**A6. Subscribe.** The feed is entitlement-gated (402 before any query —
`apps/worker/src/routes/feed.ts:66`), and there is no trial configured in
product scope. So the honest journey is: finish onboarding → subscribe →
first matches next ingestion run. Frictions:

- F17 (**critical**): 402 renders as "Could not load your feed. Please try
  again." — a paywall disguised as an outage. The user retries, concludes the
  product is broken, and leaves at the exact moment they were ready to pay.
  Fix: dedicated 402 state (§6.2).
- F18: the onboarding completion screen currently says "Go to your feed",
  which lands a non-subscribed user straight on the paywall unannounced. Fix:
  completion screen owns the seam honestly (§3.7): a next-steps checklist
  where "Start your subscription" is a visible, unforced step.
- F19: post-checkout return is silent (no confirmation route). Fix:
  `/app/billing/success` (plan §6 item 4 — endorsed).

**A7. First value.** Frictions:

- F20 (**structural**): even a subscribed, perfectly-onboarded org sees an
  empty feed until the next daily ingestion+matching run — `POST
/api/org/onboarding/complete` only stamps the timestamp and audits; it
  triggers no matching backfill (verified: `apps/worker/src/routes/org.ts:608`
  onward). Product scope accepts "< 1 day", but the user has just _paid_ and
  gets nothing to look at. Mitigations in priority order: (a) honest guided
  empty state ("Your profile is active. Ingestion and matching run daily —
  your first matches arrive by {tomorrow morning}; we'll email your digest
  when there's something worth your attention.") — pure frontend; (b)
  **challenge C3** to the plan's "no backend needs": a match-backfill on
  onboarding-complete against already-ingested notices would collapse
  time-to-first-value from ~24h to seconds. Owner decision; not assumed here.
- F21: empty state is identical across tabs and states (no matches yet vs.
  filters excluded everything vs. nothing saved). Fix: per-cause empty states
  (§6.1).

**A8. Habit.** The digest is the retention loop. Frictions:

- F22: digest deep links that hit an expired session lose the destination
  (no `returnTo`). Fix: R4.
- F23: "Not useful" feedback exists, but nothing tells the user their feedback
  is genuinely read (it is — it's a pilot promise on /pilot). Fix: after
  feedback submission, the confirmation line states the truth: "Recorded —
  feedback is reviewed directly by the person building BidMorrow." (Only if
  the owner commits to that; it's already the /pilot promise.)

### Journey B — Digest email → tender decision (the recurring core loop)

Digest email → tap tender link (phone, 390px) → [session expired? login w/
returnTo] → /app/tenders/:matchId → read score breakdown + risk flags → open
original TED notice / Save / Ignore / feedback → back to feed.

Frictions: F22 (returnTo, above); F24: TenderDetail's facts `<dl>` and score
table must reflow at 390px (never tested per plan §2 — M4 covers it); F25:
"back to feed" relies on browser back — add an explicit "← Feed" breadcrumb
so digest-entry users (no history stack) aren't stranded.

### Journey C — Returning subscriber, daily triage (steady state)

Login (routed straight to /app by R1) → Today's matches, Strong first → scan
score + deadline + buyer per card → open 2–3 → save/ignore → done in minutes.
Frictions: F26: the 9-field filter bar sits between the tabs and the list,
pushing the first tender below the fold — the page leads with the tool's
plumbing instead of the answer to "what should I investigate today?" Fix:
collapse filters (§6.1). F27: 6 tabs won't fit a 390px segmented control —
see challenge C5.

---

## 3. Onboarding overhaul — complete spec

**Contract: the existing API is used unchanged.** Every screen maps to the
endpoints the current wizard already calls, with identical payload shapes:

| Screen                        | Endpoint (existing)                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Create workspace              | `POST /api/org` `{name}`                                                                                           |
| Company basics / preset       | `PUT /api/org/profile` `{displayName, description, website, employeeBand, presetKey, onboardingCompletedAt: null}` |
| CPV codes                     | `PUT /api/org/cpv-preferences` `{cpvCodes}`                                                                        |
| Keywords                      | `PUT /api/org/keywords` `{keywords}`                                                                               |
| Capabilities + certifications | `PUT /api/org/capabilities` `{labels}` + `PUT /api/org/certifications` `{certifications}`                          |
| Countries/NUTS                | `PUT /api/org/geographies` `{geographies:[{kind,code}]}`                                                           |
| Value/nature/deadline         | `PUT /api/org/matching-preferences`                                                                                |
| Exclusions                    | `PUT /api/org/exclusions` `{exclusions}`                                                                           |
| Digest                        | `PUT /api/org/digest-preferences`                                                                                  |
| Finish                        | `POST /api/org/onboarding/complete` → `{scopeOverlapWarning}`                                                      |
| Resume prefill                | `GET /api/org/profile`, `GET /api/org/capabilities`, `GET /api/org/certifications` (as today)                      |

All PUTs are full-replacement and idempotent — which is exactly what makes
Back/edit/re-save safe with zero API work.

### 3.1 Pattern (visual direction open)

Setup-assistant _pattern_: a single focused card/panel per screen; a labeled
phase stepper always visible; Back always available; one primary action per
screen; a one-line "why we ask" under every heading, quantified from
docs/matching-engine.md (real weights — never invented):

- CPV: "CPV codes drive up to 35 of your 100 points — and decide which
  tenders get scored at all."
- Keywords/capabilities: "Capability and keyword fit is worth up to 20
  points."
- Geography: "Location match is worth up to 15 points."
- Value/deadline: "Value fit is worth up to 10 points; deadlines below your
  threshold are excluded outright."
- Exclusions: "Exclusions remove tenders before scoring — you'll never see
  them."
- Digest: "One email a day, only when there's something worth your
  attention."

### 3.2 Structure: 4 phases, 11 screens

Stepper shows the 4 phase labels; within a phase, screens advance with a
subtle sub-progress ("2 of 3"). This resolves the plan's phase/screen
conflation (challenge C1): a _phase_ is a stepper segment; a _screen_ is one
topic; saves stay per-resource per-screen.

```
Phase 1 — Your company
  1.1 Welcome            (no API) What happens next, ~5 minutes, what you'll
                         need (nothing — presets cover the cold start).
                         Skipped on resume.
  1.2 Create workspace   POST /api/org — org name only. Skipped if org exists.
  1.3 Company basics     PUT profile — displayName, description, website,
                         size band (select of bands, not free text — the
                         current free-text "e.g. 11-25" invites junk).

Phase 2 — What you do
  2.1 Preset picker      Rich cards for the 4 presets + "Start from scratch".
                         Each card previews EXACTLY what it prefills (n CPV
                         codes, n keywords, n capabilities — expandable list).
                         Selecting applies prefills to local state and
                         re-PUTs profile with presetKey (same endpoint,
                         same shape — allowed, idempotent).
  2.2 CPV codes          PUT cpv-preferences. Preset codes pre-checked, each
                         with a human label (static label map bundled for the
                         preset-covered codes + honest fallback to bare code
                         for manual entries). Manual add validates 8-digit
                         format client-side. LIVE SCOPE INDICATOR: see §3.4.
  2.3 Keywords           PUT keywords. Chip editor as today; preset chips
                         marked as "from preset" until edited.
  2.4 Capabilities &     PUT capabilities + PUT certifications (two calls,
      certifications     one screen, as today).

Phase 3 — Where & what size
  3.1 Countries          PUT geographies. Region-grouped checkboxes (Nordics /
                         Western Europe / Southern Europe / Central & Eastern
                         Europe / EEA) with full country names + search box +
                         per-group "select all". NUTS entry kept as the
                         optional advanced row it is today.
  3.2 Value & deadlines  PUT matching-preferences. Min/max EUR, contract
                         natures (all pre-checked, as today), minimum days
                         remaining. Inline validation: min ≤ max.
  3.3 Exclusions         PUT exclusions. Framed as optional ("Most companies
                         add these later, once they see their feed").

Phase 4 — Digest & finish
  4.1 Digest             PUT digest-preferences. Defaults on, min class
                         WORTH_REVIEWING, detected timezone shown (and
                         stated: "Your timezone: Europe/Nicosia — used for
                         digest timing").
  4.2 Review             The reconciliation screen — see §3.6. "Finish setup"
                         fires outstanding saves, then POST onboarding/complete.
  4.3 Done               See §3.7.
```

### 3.3 Navigation semantics

- **Back**: always enabled (except 1.1/1.2). Restores local state; nothing
  refetches; a re-save simply re-PUTs (idempotent full replacement).
- **Continue** (primary): saves the screen's resource, then advances. On save
  failure: inline error (existing `describeSaveError` incl. the 422
  cap_exceeded mapping — keep), user stays on the screen, state intact.
- **Skip for now** (secondary, de-emphasized): advances WITHOUT saving, and
  records the screen as skipped for the Review screen. Never shown on 2.2
  (CPV) — see §3.5.
- **Leaving mid-flow**: everything saved so far is persisted server-side; the
  resume path (existing profile/capabilities/certifications GETs) drops the
  user at the first incomplete phase, with completed phases ticked in the
  stepper. (Resume granularity beyond what the 3 GETs reveal is best-effort —
  acceptable; the review screen is the safety net.)

### 3.4 The scope guardrail, moved to where it helps (fix for F15)

On screen 2.2, compute client-side whether the selected CPV set shares a
division with the documented ingestion scope (72, 48, 79417000 ⇒ divisions
{72, 48, 79}) — the same public facts already hardcoded and copy-locked in
`SCOPED_COVERAGE_STATEMENT` (`apps/web/src/copy.ts`). Render a live,
non-blocking status line:

- In scope: "✓ n of your codes are inside BidMorrow's current ingestion
  scope."
- Zero overlap: warning callout (not an error): "None of these codes fall
  inside BidMorrow's current ingestion scope (IT services 72*, software 48*,
  and a reviewed extras list). With this list you won't see any matches.
  [What's covered →](/methodology)". Continue stays enabled — the server's
  `scopeOverlapWarning` at completion remains the authority (client constants
  could drift from the DB-configured scope; that drift risk is stated here
  deliberately and accepted because the fallback still fires at completion —
  see Open question O2 for the clean long-term fix).

### 3.5 CPV is not skippable — and that's honest, not coercive

Skipping CPV guarantees a dead product (the pre-filter never scores anything
without division overlap). Offering "Skip" there is offering a self-destruct
button. Screen 2.2 therefore has no Skip; its escape hatch is the preset
(one click fills a valid set). This is a _truthful-friction_ decision: the
constraint is real and explained on the screen, not manufactured. All other
screens keep Skip — their absence degrades score quality but not to zero
(UNKNOWN-neutral policy handles missing data honestly).

### 3.6 Review screen = reconciliation (fix for F14, the preset data-loss trap)

The Review screen renders one row per resource with explicit state:

| State                         | Meaning                                                         | Rendering                                                                                 |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Saved                         | PUT succeeded                                                   | ✓ + summary (e.g. "8 CPV codes") + Edit link (jumps to screen, Back-to-review afterwards) |
| Will be saved when you finish | screen skipped but local state non-empty (e.g. preset prefills) | ● + summary + Edit link                                                                   |
| Empty                         | skipped and nothing to save                                     | ○ + "Not set — using defaults/none" + Edit link                                           |

"Finish setup" first fires the outstanding PUTs for every "will be saved"
row (sequential, same endpoints), then `POST onboarding/complete`. Any save
failure stops before `complete`, shows which row failed, and leaves the user
on Review. Result: choosing a preset can never silently evaporate, and the
user sees exactly what their scoring profile is before it goes live. No API
change; only the client's bookkeeping of dirty/skipped state.

### 3.7 Done screen (owns the subscribe seam — fix for F18)

Content, in order:

1. "You're all set — your scoring profile is active." (+ the scope-overlap
   warning callout when `scopeOverlapWarning` is true — existing behavior and
   copy kept, since it's the server-authoritative check.)
2. Honest next-steps checklist:
   - ✓ Company profile saved
   - (if no active subscription — read from existing `GET /api/billing/status`)
     ○ "Start your subscription — your feed and daily digest activate with
     it." CTA → Settings→Billing (or directly `POST /api/billing/checkout`).
     Founding price shown only when `foundingAvailable` is true (real flag —
     never a fake counter).
   - ○ "First matches: ingestion and matching run daily — expect your first
     scored tenders by tomorrow, and a digest email when there's something
     worth your attention."
3. Primary action: "Go to your feed" (subscribed) / "Start subscription"
   (not subscribed), with the other as secondary. No countdowns, no "only X
   spots left" unless wired to the real cap (D6 is NO), no guilt copy on the
   secondary path.

### 3.8 Accessibility & quality gates (binding on M1)

- Every screen: single `<h1>` topic, focus moves to the heading on screen
  change, stepper is an `<ol>` with `aria-current="step"`, progress announced
  via the existing polite live region pattern.
- Keyboard-only completion of the entire flow (existing M1 acceptance —
  endorsed); all transitions behind `prefers-reduced-motion`.
- axe green on ALL screens (closes the "steps 2–10 unscanned" gap).
- Critical-path spec additions: new-user login lands in onboarding (R1);
  preset → skip-all → Review shows "will be saved" rows → finish persists
  them (regression test for F14); 402-after-completion path renders the
  paywall state, not an error.

---

## 4. Page-level IA — every public page

Format per page: **Job** (the one job) · **Hierarchy** (top→bottom) ·
**Primary action** · **States/notes**. All pages keep the mandatory footer
(TED attribution + decision-support disclaimer + nav). All hierarchies must
hold at 390px (single column, CTA within first 1.5 viewports).

### / (Home)

- **Job**: make the right visitor believe "this finds the tenders worth my
  time, and I can verify how" — then send them to signup or methodology.
- **Hierarchy**: 1) headline (unchanged, copy-locked) + mechanism subhead +
  persona line; 2) hero artifact: real ScoreBreakdownTable (84.5 worked
  example); 3) the-enemy section (3,000 notices/day — TED facts only); 4) 3-step how-it-works teaser → /how-it-works; 5) honest-coverage box
  (verbatim `SCOPED_COVERAGE_STATEMENT` framed as a feature); 6) interactive
  scoring demo (D9 — 4 preset profiles × bundled sanitized fixtures); 7) anti-fine-print trust checklist (monthly, cancel anytime, no demo calls,
  price on the page, no third-party trackers — every claim already true); 8) FAQ accordions (native details/summary): "Is this AI?", coverage,
  cancellation, "what if nothing matches?"; 9) pricing teaser (prices stated
  plainly, → /pricing); 10) closing CTA.
- **Primary action**: "Start with the founding pilot — €29/mo" → **/signup**
  (see challenge C9). Secondary: "See how scoring works" → /methodology.
- **States**: demo widget needs loading-free static behavior (bundled data),
  keyboard operable, reduced-motion inert; FAQ works with JS disabled
  (native elements).

### /how-it-works

- **Job**: answer "what actually happens between TED and my inbox?"
- **Hierarchy**: 1) intro line; 2) the 5 existing steps, each with one visual
  (real UI crop or SVG diagram of TED → parse → score → shortlist → digest); 3) UNKNOWN-policy callout (existing statement — this page is where honest
  nerd-detail converts); 4) closing CTA block (NEW — fixes the dead end):
  primary → /signup, secondary → /methodology.
- **Primary action**: "Create your account".
- **States**: none dynamic.

### /methodology

- **Job**: be the testimonial substitute — prove the score is deterministic,
  inspectable, and honestly limited.
- **Hierarchy**: 1) thesis ("same inputs + same engine version = identical
  score — here's the whole method"); 2) annotated worked example (the 84.5
  breakdown, each component row annotated with its rule); 3) component
  weights table (from docs/matching-engine.md); 4) the mandatory disclosures
  verbatim: CPV pre-filter trade-off, UNKNOWN policy, hard exclusions, risk
  flags with evidence; 5) engine versioning note; 6) closing CTA.
- **Primary action**: "Put it to work — sign up".
- **States/notes**: all disclosure constants stay byte-identical (copy-locked
  - product-truth mandatory). Additions are framing, not modification.

### /pricing — FROZEN

- **Job**: state the two prices without a single question raised.
- **Hierarchy, copy, prices, structure, CTAs: unchanged** (owner directive;
  copy-lock tests untouched). Visual restyle only. The founding card's CTA →
  /pilot and standard card's → /signup remain as-is.
- **States**: none.
- Note for later cycles (not this one): when founding fills, the founding
  card's honesty depends on the flag — the "first 50" claim is governed by
  `founding_plan_open`. No change now; recorded so nobody "improves" this
  page mid-implementation.

### /pilot

- **Job**: convert the almost-convinced by making the founding deal and its
  obligations concrete — objection handling, not gatekeeping.
- **Hierarchy**: 1) what the pilot is (existing copy); 2) what you get / what
  we ask (existing two lists — keep; they're honest and good); 3) founder
  directness line per plan §7 ("direct line to the person building
  BidMorrow" — truthful singular; named founder note only if D8 opts in); 4) CTA.
- **Primary action**: "Start the founding pilot" → /signup (exists).
- **States**: if `founding_plan_open` is ever off, this page must not promise
  €29 — flag-aware copy is an M3 implementation detail to record (same
  honesty rule as pricing note above; requires reading the real flag, no
  fake counter).

### /contact

- **Job**: give a human path without pretending there's a support team.
- **Hierarchy**: heading, one line of what to expect, the email address as a
  `mailto:` link. Response-time promise only if the owner commits (plan —
  endorsed).
- **Primary action**: the mailto link.
- **States**: none.

### /privacy, /terms

- **Job**: legal reference. Restyle only; content untouched; "final legal
  text pending" flag stays until owner supplies text. Add in-page section
  anchors if the documents are long (reading aid, no content change).
- **Primary action**: none (deliberately).

### /signup

- **Job**: create the account in under a minute with the journey visible.
- **Hierarchy**: 1) title; 2) 3 fields with inline validation + stated
  password policy (F9); 3) what-happens-next line (F8); 4) submit; 5) link to
  /login; 6) reassurance microline: "€0 until you subscribe — setup first."
  (true: signup and onboarding cost nothing; the feed requires a
  subscription).
- **Primary action**: "Create account".
- **States**: submitting (disabled + progress), server error verbatim mapping
  (existing), success → /verify-email.

### /login

- **Job**: get a returning user to where they were going.
- **Hierarchy**: fields, submit, forgot-password link, signup link.
- **Primary action**: "Log in" → routes by R1 (`returnTo` honored).
- **States**: error, unverified-email guidance (link back to /verify-email
  with resend).

### /verify-email

- **Job**: bridge the inbox gap without losing the user.
- **Hierarchy**: 1) "Check your inbox" + the address it was sent to; 2)
  resend button with cooldown + spam-folder hint (F10); 3) on return from the
  emailed link: success state → auto-route by R1 (→ /onboarding for new
  users) — this closes the funnel's biggest hole; error state (`?error=`)
  with resend.
- **Primary action**: contextual — resend (waiting) / continue (verified).
- **States**: waiting / verified / link-error.

### /forgot-password, /reset-password

- **Job**: recover access; nothing else. Existing flows kept; restyle;
  neutral confirmation copy that doesn't disclose whether an email exists
  (account-enumeration hygiene — verify current copy at implementation).

### 404

- **Job**: recover the lost. Product name, one line, links to Home and (if
  authenticated) the Feed. Same page serves the admin cloak — its content
  must stay generic (do not add admin-revealing links).

---

## 5. App-screen IA fixes

### 5.1 Feed (/app)

- **Job**: answer "what should I investigate today?" in the first viewport.
- **Order of the page (the fix for F26)**: 1) H1 (existing question —
  keep); 2) view switcher; 3) **collapsed** filter disclosure ("Filters" +
  active-count badge, e.g. "Filters · 2"); 4) the list, Strong first; 5)
  Load more.
- **View switcher (challenge C5 to the plan's segmented control)**: 6 items
  don't fit a non-scrolling segmented control at 390px. Split by meaning:
  the first four are _score views_ (Today's · Strong · Worth reviewing ·
  Possible) → segmented control (fits at 390px with short labels); Saved and
  Ignored are _your shelves_, not score bands → two quiet links/buttons
  aligned right of (or below) the control. Clearer model AND it fits.
- **Filters**: keep all 9 fields (they're legitimate), but grouped inside the
  disclosure in 3 labeled rows: Score & value (min score, min/max EUR) ·
  Where & who (country, CPV prefix, buyer) · Dates (deadline before/after,
  published after). Country becomes a `<select>` populated from the org's
  saved opportunity countries + "Any" (data available via existing
  geographies GET) instead of a bare 2-letter text input. Apply +
  Clear-all buttons; applied state summarized in the badge. Filter state in
  the URL query (shareable/back-safe) — client-only change.
- **Card hierarchy**: score badge + classification first, title heavier,
  deadline-relative and buyer as the second line, CPV/value as quiet
  metadata, Save/Ignore as compact actions. Strong matches get the accent
  treatment (visual direction decides how).
- **States**:
  - Loading: skeleton rows (not "Loading…" text).
  - Empty (no matches ever / not today): "No matches yet — ingestion and
    matching run daily. Your next chance: tomorrow. Widen CPV preferences in
    Settings if this persists." + link.
  - Empty (filters active): "No matches with these filters. [Clear filters]" —
    distinct from the above (F21).
  - Empty (Saved/Ignored): explain what the shelf is for.
  - 403 no-org: auto-redirect (R2); backstop message becomes a link:
    "Finish setting up your profile → /onboarding".
  - **402**: never the generic error — see §5.4.
  - Error: generic retry only for genuine failures.
  - `<title>`: "Feed — BidMorrow" (currently missing).

### 5.2 Tender detail (/app/tenders/:matchId)

- **Job**: let the user make the bid/no-bid call on one tender, then leave.
- **Order**: 1) "← Feed" breadcrumb (F25); 2) score + classification +
  title + lot; 3) decision facts (deadline first — it's the perishable
  fact — then value, buyer, geography, nature, procedure, CPV, languages); 4) description; 5) score breakdown table (the artifact — give it the hero
  treatment of the design system); 6) risk flags with evidence quotes
  (existing honest pattern — keep verbatim structure); 7) actions row
  (Save/Ignore/Useful/Not useful); 8) "Open original TED notice" —
  promote to a primary-strength action near the top as well as bottom
  (the product's endpoint is always the source documents); 9) TED
  attribution.
- **States**: loading skeleton; not-available error (existing copy fine);
  feedback confirmation via live region (existing); facts grid reflows to
  single column at 390px; long CPV lists wrap as chips, not comma strings.

### 5.3 Settings (/app/settings)

- **Job**: edit the scoring profile and subscription without a scavenger hunt.
- **Fix for the 11-section wall (refines plan's "11 anchors" — challenge
  C4)**: group into 5 navigable groups; the section nav lists groups, with
  the 11 existing cards nested under them (per-section save untouched — no
  form refactor):
  1. **Billing** (subscription status, checkout, portal)
  2. **Company** (profile)
  3. **Matching profile** (CPV · Keywords · Geographies · Capabilities ·
     Certifications · Exclusions · Value & deadline) — one group, because
     these are all "what the engine scores against", and this grouping
     mirrors onboarding phases 2–3 (same mental model in both surfaces)
  4. **Digest** (preferences)
  5. **Danger zone** (delete account — visually separated, never adjacent to
     routine saves)
- Nav is sticky on desktop, a jump-select on mobile; `aria-current` on the
  active group; URL hash per group so Billing is deep-linkable
  (`/app/settings#billing`) — required by the 402 CTA.
- **States**: per-section save/success/error stay as-is (they work); billing
  errors keep the existing verbatim mappings.

### 5.4 The 402 state (fix for F17) — a designed screen, not an error

Rendered by Feed (and any future entitlement-gated surface) when the API
returns 402 `{error:'subscription_required', reason}`:

- Title: "Your profile is ready — a subscription activates your feed."
- Body: what activates (scored feed + daily digest), plain prices (€29
  founding while `foundingAvailable`, €49 standard — reuse the real billing
  status), no urgency theatrics.
- Tailor by `reason` where the server provides it: a lapsed/past-due org gets
  "Your subscription has lapsed — reactivate to restore your feed" +
  Manage-billing (portal) CTA instead of first-subscribe framing.
- Primary CTA: Subscribe → `/app/settings#billing` (or direct checkout).
  Secondary: "Review your profile settings".
- Truth constraint: this screen states what exists; it never claims matches
  are "waiting" unless the product can truthfully show a count (it can't
  without a new endpoint — so it doesn't).

### 5.5 App shell & layout

- One `--layout-max` token applied to header/main/footer alike (kills the
  44rem/64rem mismatch — plan §5, endorsed; it's a one-token fix).
- App nav: Feed · Settings · Log out (existing) + active-state
  (`aria-current="page"`), product name → /app.
- Onboarding renders in its own assistant frame (no AppShell nav) — a
  deliberate "you're setting up" mode; the only exits are Log out and
  finishing.

---

## 6. Prioritized conversion opportunities

Ordered by (funnel severity × implementation cost). No analytics exist and
none are being added (product rule), so "expected impact" is stated
qualitatively with its reasoning, not invented percentages. Signals available
for verification: Stripe funnel, signup counts, `product_events`
(`onboarding_completed`), digest opens are NOT tracked — support mail and
pilot feedback are the qualitative check.

| #   | Opportunity                                                                                                | Funnel stage            | Expected impact & why                                                                                                                                                                             | Truthful-persuasion note                                                                                 | Cost          |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Post-login/verify routing to /onboarding (R1–R4) + linked 403 backstop                                     | Activation              | **Highest.** Today every new user hits a dead-end error at the moment of peak intent; this converts a guaranteed stall into a guided path.                                                        | Pure navigation; nothing persuasive to abuse.                                                            | Small (M1)    |
| 2   | 402 paywall as designed state (§5.4)                                                                       | Purchase                | **High.** The only moment the product asks for money currently looks like an outage. Rendering the real prices and a working CTA at the moment of intent is the cleanest possible conversion fix. | Real prices, real founding flag; no urgency, no fake counts of "waiting matches".                        | Small (M2)    |
| 3   | Onboarding overhaul (§3), esp. preset reconciliation (3.6) + CPV scope guardrail (3.4) + no-skip CPV (3.5) | Activation → retention  | **High.** Prevents the two silent-failure modes (empty CPV via skip; out-of-scope CPV discovered too late) that produce zero-match feeds — the most likely churn cause for paying pilot users.    | Friction is added only where the constraint is real, and the constraint is explained on-screen.          | Medium (M1)   |
| 4   | Done-screen next-steps checklist owning the subscribe seam (§3.7)                                          | Purchase                | **Medium-high.** Puts the subscription ask at the moment the user has just invested effort — with honest expectation of when value arrives.                                                       | Checklist states facts; subscription is presented, never forced; no countdowns.                          | Small (M1)    |
| 5   | Home: mechanism subhead + persona line + real score-card hero + trust checklist + FAQ                      | Landing → understanding | **Medium-high.** The technical ICP converts on inspectable proof; the current page offers none. The hero artifact is the one asset no competitor can copy without changing their product.         | Hero is a real component rendering real fixture data; every checklist claim is an existing product rule. | Medium (M3)   |
| 6   | How-it-works closing CTA + Methodology promoted to trust asset                                             | Understanding           | **Medium.** Fixes a literal dead end on the page the most-interested visitors read; methodology substitutes for the testimonials we truthfully cannot have.                                       | Disclosure statements stay verbatim; framing only.                                                       | Small (M3)    |
| 7   | /verify-email resend + verified-state auto-route                                                           | Signup                  | **Medium.** Inbox gap is a classic silent-loss point; resend + routing removes both failure modes.                                                                                                | None needed.                                                                                             | Small (M1)    |
| 8   | Guided first-feed empty state + digest expectation (§A7)                                                   | First value             | **Medium (retention).** A paying user staring at an unexplained empty feed on day 0 is a refund risk; honest expectation-setting is the cheapest retention tool available.                        | States the daily cadence truthfully; promises only the digest behavior that exists.                      | Small (M1/M2) |
| 9   | `returnTo` on digest deep links (R4)                                                                       | Habit                   | **Medium.** Protects the recurring re-engagement loop from session expiry.                                                                                                                        | None needed.                                                                                             | Small (M1)    |
| 10  | Post-checkout `/app/billing/success`                                                                       | Purchase                | **Low-medium.** Removes "did my payment work?" doubt and the support mail it generates.                                                                                                           | Confirmation states plan + price actually purchased.                                                     | Small (M2)    |
| 11  | Signup expectation line + password policy inline                                                           | Signup                  | **Low-medium.** Cheap drop-off reduction.                                                                                                                                                         | Honest sequencing disclosure.                                                                            | Trivial (M1)  |
| 12  | Interactive scoring demo (D9)                                                                              | Understanding           | **Medium but speculative** — genuinely differentiating, but it converts only those who already scrolled past the hero; build after 1–8.                                                           | Bundled sanitized real fixtures; labeled as sample data.                                                 | Medium (M3)   |

Explicitly rejected as conversion tactics (dark-pattern screen): fake or
flag-unwired "X spots left" counters (D6 stays NO), exit-intent modals,
trial-countdown pressure, auto-opted marketing email, hiding the standard
plan to funnel into founding, "matches are waiting for you" claims without a
real count, testimonial placeholders.

---

## 7. Challenges to the existing plan (in writing, with reasons)

**C1 — §6a conflates phases and screens, and its list is garbled.** The
plan's 4-phase list is mis-numbered (1, 2, 2, 3) and reads as if 10 steps
compress into 4 screens. Ten data resources cannot honestly share 4 screens
without recreating the wall-of-form problem onboarding is being rescued from.
Resolution: §3.2 — 4 _phases_ as stepper segments, 11 focused _screens_,
per-screen saves. The plan text should be corrected to this model.

**C2 — Scope-overlap warning only at completion is a design defect, not a
detail.** The plan keeps the warning at the end (§6a "Completion"). By then
the user has spent all their effort; the warning reads as "you did it wrong".
The check is cheap client-side against the same public scope facts the
marketing site already states. Resolution: §3.4 live indicator at the CPV
screen; server check retained as authority. (See O2 for the drift caveat.)

**C3 — §8 "None required for M0–M1" ships a paid product with a guaranteed
empty first day.** Verified in code: `POST /api/org/onboarding/complete`
stamps a timestamp and writes audit/product events — no matching backfill
(`apps/worker/src/routes/org.ts:608–657`). A user can complete onboarding,
pay €29–49, and see nothing until the next daily cron. Product scope's
"< 1 day" target technically holds, but "pay, then wait a day" is the
weakest moment of the entire journey and no amount of empty-state copy fully
fixes it. Request: an owner/architect decision item — "score this org against
already-ingested in-scope notices on onboarding completion" (deterministic,
bounded by the existing pre-filter, plausibly within the cost model since
it's one org × current notice window). Not assumed in any spec above; §A7's
frontend mitigation stands either way.

**C4 — Settings "sticky in-page section nav (11 anchors)" reproduces the
problem one level up.** Eleven flat anchors is the same undifferentiated wall
in miniature, and at 390px an 11-item nav is its own scroll problem.
Resolution: §5.3 — 5 groups (Billing / Company / Matching profile / Digest /
Danger zone) mirroring the onboarding phase model, 11 cards preserved
beneath them, per-section save untouched.

**C5 — A segmented control cannot hold the feed's 6 tabs on mobile.** The
plan prescribes "tabs → HIG segmented control" (M2). Segmented controls
don't scroll and 6 labels ("Worth reviewing", "Today's matches"…) cannot fit
390px at readable sizes. Resolution: §5.1 — 4-way segmented control for the
score views + Saved/Ignored as separate shelf links. Semantically cleaner
(score bands vs. user shelves) and it physically fits. If the implementing
lane insists on one control, it must be a scrollable tab list, not a
segmented control — but the split is the better IA.

**C6 — The plan's journey has a hole between onboarding and feed: the
subscribe seam is unowned.** M1 ends at "guided first-feed empty state"; M2
adds the 402 state; but nothing decides _when the product asks for money_.
Since the feed 402s immediately for unsubscribed orgs, the ask happens on
first feed visit whether designed or not. Resolution: §3.7 makes the
onboarding Done screen own the seam (checklist with subscription as an
explicit honest step), and §5.4 designs the 402 as the backstop. This should
be added to §6a's scope so M1 and M2 don't each assume the other handles it.

**C7 — "Skip preserved per phase (skippable without data loss)" is currently
false and the plan doesn't name the bug.** Today Skip discards preset
prefills permanently (F14): preset application is local-only, so preset →
skip → finish produces an empty scoring profile. The plan's phrase "without
data loss" must be made real by an explicit mechanism. Resolution: §3.6
review-screen reconciliation ("will be saved on finish" rows). This needs to
be a named M1 acceptance criterion with a regression test, or it will be
lost in implementation.

**C8 — Free-text country filter (feed) and free-text employee band
(onboarding) are data-quality holes the plan doesn't touch.** A 2-letter
uppercase text input for country invites "UK"/"EL"/typos silently returning
zero results; free-text size band invites junk. Resolution: selects fed from
known values (§5.1, §3.2 screen 1.3). Zero API impact.

**C9 — Home's primary CTA → /pilot adds a hop before /signup.** Plan §7
keeps "Join the founding pilot" as the hero CTA. Every added hop sheds
users, and /pilot's real function is objection handling, not gatekeeping —
its content (what you get / what we ask) belongs on the path but shouldn't
_be_ the path. Resolution proposed: hero primary → /signup with founding
framing; "What's the founding pilot?" as the adjacent link; /pilot keeps its
page and its own CTA. This changes no frozen copy (pricing page untouched;
the headline untouched; CTA labels are D3-territory copy with tests updated
in-PR). If the owner prefers the pilot-first funnel for vetting reasons,
that's a legitimate override — but it should be decided, not inherited.

**C10 — Feed filter bar: the plan fixes presentation (Disclosure) but not
placement or grouping.** Endorsed and extended: §5.1 specifies collapsed-by-
default, 3 labeled groups, active-count badge, URL-persisted filter state,
and per-cause empty states — the last two are absent from the plan and cheap.

Endorsed without change (for the record): route-preserving public IA; the
worked-example hero; D6/D7 NO defaults; D10 no-fake-testimonials;
`/app/billing/success`; per-resource PUT byte-compatibility as an M1
acceptance criterion; the accessibility gate list.

---

## 8. Open questions (owner / architect decisions)

- **O1 (from C3)**: Approve or reject a matching backfill on onboarding
  completion (backend, cost-model check needed). Biggest single
  time-to-first-value lever.
- **O2 (from C2/§3.4)**: The ingestion scope is DB-configured; the client
  guardrail uses the documented public scope constants. If the scope is ever
  reconfigured, client hint and server truth drift until copy is updated. A
  tiny public "current scope divisions" endpoint would remove the drift —
  out of the plan's "no backend" stance, so: accept drift risk (server check
  remains authoritative) or approve the endpoint. Recommend: accept for this
  cycle; revisit if scope config actually changes.
- **O3 (from C9)**: Hero primary CTA → /signup (recommended) or keep /pilot
  as the funnel gate.
- **O4 (from §A6)**: A Stripe trial would let users see the feed before
  paying — but a free trial changes the _substance_ of the frozen pricing,
  so it is strictly an owner call and is NOT recommended-by-default here;
  the honest no-trial journey above works without it.
- **O5 (from §4 pilot/pricing notes)**: When `founding_plan_open` closes,
  /pilot and the pricing founding card need their flag-aware honest states
  defined. Not urgent (cap is 20, currently open); should be specced before
  it can surprise anyone.

---

## 9. Traceability: known defects → resolution in this report

| Defect (task brief / plan §2)                       | Resolution                                    |
| --------------------------------------------------- | --------------------------------------------- |
| No post-login routing to /onboarding (403 dead-end) | §1.3 R1–R3, §5.1 states, journey F12          |
| HTTP 402 rendered as generic error                  | §5.4 designed paywall state, opportunity #2   |
| 9-field filter bar dominates feed                   | §5.1 collapsed grouped disclosure, C10        |
| Settings: 11 sections, no navigation                | §5.3 five-group nav, C4                       |
| Layout width inconsistency (44/64rem)               | §5.5 single `--layout-max` (endorses plan §5) |
| Preset-skip data loss (found during this audit)     | §3.6, C7                                      |
| Scope warning too late (found during this audit)    | §3.4, C2                                      |
| How-it-works dead end                               | §4, F5, opportunity #6                        |
| Missing `<title>` on /app, /onboarding              | §5.1, §3.8 (plan M0 also covers)              |
