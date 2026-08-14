# Privacy & Data Handling

Operational data inventory and the privacy controls BidMorrow commits to
building. **Status: design document — nothing below is implemented yet
(project is at Phase 0/1).** Each control names the phase in which it is
built and validated.

> **Not a compliance claim.** The presence of these controls is NOT a claim
> of GDPR compliance. The public privacy policy, lawful-basis analysis, DPA
> texts, and any compliance assertion require human legal review — see
> HUMAN_DECISION_BLOCKERS.md item 7 (business/legal information, privacy
> contact email). Claude does not draft or publish legal claims.

## Data inventory & retention

| Category                  | Contents                                                                                                                     | Personal data?                                                                                                                         | Store                    | Retention                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Account identity          | email, password hash, email-verification state, session rows                                                                 | Yes                                                                                                                                    | D1 (Better Auth tables)  | Life of account; deleted on account deletion [validate: Phase 3]                                                       |
| Org profile & preferences | org name, CPV preferences (≤30), keywords (≤50), digest settings, timezone                                                   | Low (org-level; names may identify sole traders)                                                                                       | D1                       | Life of organization; deleted on org deletion [validate: Phase 3]                                                      |
| Product events            | first-party usage events (page/feature counters) keyed by org/user id                                                        | Pseudonymous                                                                                                                           | D1 (`analytics` package) | 12 months, then purged [validate: Phase 10]                                                                            |
| Feedback                  | match-quality feedback (thumbs/reasons), free-text                                                                           | Yes (free-text may contain anything)                                                                                                   | D1                       | Life of organization; deleted with org                                                                                 |
| Billing metadata          | Stripe customer id, subscription state, entitlements. Card data never touches BidMorrow — Stripe is the processor of record. | Yes (indirect)                                                                                                                         | D1 + Stripe              | D1 rows: life of org + accounting obligations; Stripe retains per its own policy                                       |
| Email delivery metadata   | `email_deliveries` rows: recipient, digest date, status, provider message id                                                 | Yes                                                                                                                                    | D1 (+ Resend logs)       | 12 months (aligned with `digest_runs` retention)                                                                       |
| Audit logs                | `audit_events`: actor id, action, target, timestamp — append-only (security control C8)                                      | Yes                                                                                                                                    | D1                       | 24 months; never user-deletable (security/legal record) — anonymize actor on account deletion instead of deleting rows |
| TED procurement data      | notices, lots, CPV/geo rows, matches; raw eForms XML in R2                                                                   | **Public, non-personal** — but raw snapshots may contain buyer contact persons (name/email/phone of public officials) published by TED | D1 + R2                  | D1: deadline+90d purge (ted-ingestion-scope.md); R2: 3-year lifecycle (ADR-0005)                                       |

Notes on TED data: it is public-sector data published by the EU; we treat it
as non-personal for product purposes, but buyer contact persons appearing in
raw snapshots are personal data in the strict sense. Mitigation: contact
fields are not surfaced beyond what TED itself publishes, snapshots live in
a private R2 bucket, and the 3-year lifecycle bounds retention. Revisit at
legal review (blocker 7).

## Subprocessors

| Subprocessor | Purpose                                            | Data received                                     | Location notes                                |
| ------------ | -------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| Cloudflare   | Hosting: Workers, D1, R2, Queues                   | All application data in transit and at rest       | EU jurisdiction analysis pending legal review |
| Stripe       | Payments, subscriptions, invoices, Customer Portal | Billing identity, payment details (Stripe-only)   | —                                             |
| Resend       | Transactional + digest email delivery              | Recipient email, message content, delivery events | —                                             |
| GitHub       | Source code, CI/CD                                 | No customer data (code + CI secrets only)         | Listed for completeness                       |

No analytics, monitoring, translation, or LLM SaaS in V1 (architecture.md
"deliberate non-choices") — the subprocessor list is intentionally short.

## Cookies

- **One session cookie** set by Better Auth: HttpOnly, Secure, SameSite
  (security.md C5). Strictly necessary; no consent banner required for it.
- **No tracking cookies, no third-party cookies, no fingerprinting.**
  Product analytics are first-party, server-side events tied to the
  authenticated session — no client-side analytics scripts.

## Implementation commitments

All are definitive designs to be built and validated in the named phase.

1. **Account deletion** [validate: Phase 3] — self-service. Deletes auth
   rows, sessions, and user-scoped data; anonymizes the actor field on
   retained audit rows. Last-owner deletion requires org deletion first.
2. **Organization deletion** [validate: Phase 3] — deletes org profile,
   preferences, saved tenders, matches, feedback, product events, email
   delivery rows; cancels the Stripe subscription; audit row recorded.
3. **Purge jobs** [validate: Phase 5/10] — daily retention cron enforces
   every retention period above (TED deadline+90d, product events 12 mo,
   delivery metadata 12 mo); each run records counts; covered by
   integration tests.
4. **Data export** [validate: Phase 10] — per-org JSON export (profile,
   preferences, saved tenders, feedback) generated server-side and
   downloaded via an authenticated endpoint; satisfies portability
   requests without manual DB work.
5. **Email preference deletion** [validate: Phase 8] — unsubscribe link in
   every digest disables sending immediately (no login required);
   suppression respected before any Resend call.
6. **Log redaction** [validate: Phase 2] — observability package redacts
   secrets/tokens and never logs email bodies; request logs carry ids, not
   payloads (security.md C10).

## Request handling

Privacy requests (access, deletion, correction) arrive via
support@bidmorrow.com (see docs/customer-support.md, "deletion requests").
Until self-service deletion ships, requests are executed manually by an
admin and recorded in audit_events. Response-time commitments are set at
legal review (blocker 7).
