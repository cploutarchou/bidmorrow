# Customer Support

Support process for the founding-pilot phase. **Status: Phase 0/1 — no
customers yet; the admin tools referenced are Phase 10 features.** This is
the definitive process, to be validated with the first pilot customers
[validate: Phase 10/13].

## Channels

- **support@bidmorrow.com** — the single support channel (inbox decision:
  HUMAN_DECISION_BLOCKERS.md item 3). No chat, no phone in V1.
- In-app feedback widget feeds the matching-quality loop (below), not
  general support.

## SLA statement

Best-effort support appropriate to a founding pilot: **first response
target 1 business day** (Europe business hours). No contractual uptime SLA
in V1 — the terms say so explicitly. Incidents are handled per
docs/incident-response.md regardless of tickets. Be honest in replies about
what "best-effort" means; never promise response times the solo operation
cannot keep.

## Triage categories → admin tools (Phase 10)

| Category                                          | First steps                                                                                                                                                                                                                                                                               | Admin tool                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Access / auth                                     | Verify email-verification state; resend verification; check rate-limiter lockout; password reset is self-service (anti-enumeration — never confirm account existence to a third party)                                                                                                    | User lookup: verification status, session state, recent auth audit_events                                 |
| Billing                                           | **Paddle customer portal first** ("Manage payment details" in Settings → Billing) — card updates, invoices/PDFs, cancellation are self-service there; Paddle is the Merchant of Record, so refunds/disputes and VAT questions go to the Paddle dashboard (and Paddle's own buyer support) | Org billing view: subscription state, entitlements, link to Paddle customer; entitlement reconcile button |
| Matching quality ("why did/didn't X match?")      | Pull the match explanation — every match is deterministic, versioned, component-scored, so "why" always has a concrete answer; check the org's CPV prefs/keywords; log the case as feedback                                                                                               | Match inspector: components, ENGINE_VERSION, org preferences; feedback list feeding scope/engine review   |
| Data correctness ("this tender is wrong/missing") | Get the **TED notice ID** from the customer; missing → check it against the ingestion scope (docs/ted-ingestion-scope.md) — out-of-scope CPV is the common, non-bug answer; in-scope → ingestion debugging: `ingestion_errors`, run windows, raw R2 snapshot vs normalized rows           | Notice lookup by TED ID: ingestion status, snapshot link, parse errors                                    |
| Deletion / privacy requests                       | Follow docs/privacy.md request handling; identity-verify via the account email; execute account/org deletion; confirm in writing; audit row recorded                                                                                                                                      | Deletion tools (self-service from Phase 3; admin-executed fallback)                                       |

## Identity verification

Before any account-affecting action (deletion, email change, billing
detail):

- Only act on requests **from the account's registered email address**.
- Never confirm to a third party whether an account or email exists
  (consistent with the anti-enumeration auth policy).
- For org-level actions (org deletion, member removal), verify the
  requester holds the owner role — check server-side, never on the
  requester's say-so.
- Requests failing verification get a neutral reply pointing to
  self-service flows; log the attempt if it looks like social engineering.

## Digest email after a cancellation

"I cancelled and I am still getting your emails" has a definite answer, so
check the state before replying. The only recurring email BidMorrow sends is
the daily digest; there is no marketing mail, and transactional mail
(verification, password reset) always sends regardless of billing state.

Digest eligibility is: `digest_preferences.enabled = 1`, the organization is
`active` and not suspended, and, when the `entitlement_enforced` flag is on,
`@bidmorrow/billing` `getEntitlement` reports `active`. That is the same
entitlement rule the feed's 402 uses, applied both when the hourly cron
enqueues a digest and again when the queue consumer runs it.

By subscription state, with `entitlement_enforced` on:

| State                                                        | Digest                               |
| ------------------------------------------------------------ | ------------------------------------ |
| `trialing`, `active`                                         | sends                                |
| `active` with a scheduled cancel, before period end          | sends (they paid through the period) |
| `past_due` inside the 7-day grace window                     | sends                                |
| `past_due` past grace, `paused`, `canceled`, no subscription | stops                                |

Two things to tell the customer honestly:

- A cancellation scheduled for the end of the billing period does not stop
  the digest immediately, and should not: the period is paid for. Digests
  stop when Paddle moves the subscription to `canceled` at the period end.
- Anyone can stop digest mail immediately without touching billing, through
  the unsubscribe link in the footer of every digest or the digest toggle in
  Settings.

If neither explanation fits, check whether `entitlement_enforced` is set in
that environment: while the flag is off the product is in V1-pilot mode and
nothing is gated on billing state at all, so a canceled organization does
keep receiving digests until its digest preference is turned off.

## Escalation to incident response

Anything revealing a bug, outage, or security concern leaves support and
enters docs/incident-response.md triage immediately:

- A tenant-isolation report ("I can see another company's data") in a
  support ticket is a **SEV1, not a ticket** — pause first, reply after.
- Multiple tickets with the same symptom → treat as one incident (SEV2/3),
  not N tickets.
- Reply to the reporter with an honest holding message; the incident
  process owns the timeline from there, and the ticket is closed with the
  incident outcome.

## Canned-answer principles

Templates live with the support inbox; all replies follow these rules:

1. **Honest about scoped coverage.** BidMorrow ingests competition notices
   in documented CPV families (72*, 48*, small extras list) — never imply
   exhaustive EU coverage. "Not covered because out of current scope" is a
   legitimate, complete answer; log it as scope-widening evidence.
2. **Decision-support disclaimer.** Match scores support a bid/no-bid
   decision; they do not make it. Never state or imply that a score is a
   recommendation to bid, a prediction of winning, or legal/eligibility
   advice.
3. **Explain, don't hand-wave.** Matching is deterministic and explainable
   by design — answer "why" questions with the actual components, not
   "the algorithm decided".
4. **No invented commitments.** No roadmap dates, refunds, or legal
   statements in support replies. Refund and legal-question templates
   require human sign-off (blockers 7).
5. **Data corrections at the source.** We normalize what TED publishes;
   errors in the underlying notice are the buyer's/TED's to fix — we can
   only fix our parsing of it. Say which case applies.

## Ticket hygiene

Even at pilot scale: every ticket gets category + org + outcome recorded
(lightweight — a label in the inbox suffices until volume justifies more).
Weekly: review categories for patterns → feeds the phase reviews (matching
quality → engine/scope; data correctness → parser fixtures; access →
UX/docs). Support is the pilot's primary product-feedback instrument —
treat the archive as data, not exhaust.
