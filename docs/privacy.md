# Privacy & Data Handling

Operational data inventory and the privacy controls BidMorrow commits to
building. **Status: as of Phase 11 stage A, all six implementation
commitments below are implemented and D1-integration-tested** (Phase 3/4
built account deletion + log redaction; Phase 11 stage A closed the
remaining gaps: organization deletion, the purge job, data export, and two
FK-safety fixes account deletion needed). Each control names the phase in
which it was built and validated; `(implemented Phase N)` markers below
reconcile the design against what actually shipped.

> **Not a compliance claim.** The presence of these controls is NOT a claim
> of GDPR compliance. The public privacy policy, lawful-basis analysis, DPA
> texts, and any compliance assertion require human legal review — see
> HUMAN_DECISION_BLOCKERS.md item 7 (business/legal information, privacy
> contact email). the assistant does not draft or publish legal claims.

## Data inventory & retention

| Category                  | Contents                                                                                                                     | Personal data?                                                                                                                         | Store                    | Retention                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Account identity          | email, password hash, email-verification state, session rows                                                                 | Yes                                                                                                                                    | D1 (Better Auth tables)  | Life of account; deleted on account deletion [implemented Phase 4, FK edges fixed Phase 11]                            |
| Org profile & preferences | org name, CPV preferences (≤30), keywords (≤50), digest settings, timezone                                                   | Low (org-level; names may identify sole traders)                                                                                       | D1                       | Life of organization; soft-deleted immediately on org deletion, hard-purged 30 days later [implemented Phase 11]       |
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

1. **Account deletion** [implemented Phase 4, hardened Phase 11 stage A] —
   self-service (`DELETE /api/account`). Deletes auth rows (`users`,
   `auth_accounts`, `auth_sessions`), and clears every membership row.
   Anonymizes the actor field on retained audit rows (`audit_events.actor_id`
   carries no FK — nulling is unnecessary, the row is just orphaned by
   design). Last-owner deletion of an ACTIVE organization requires deleting
   the organization first (409 `transfer_or_delete_organization_first`); an
   already-deleted organization does not block account deletion. **Phase 11
   stage A FK-safety fixes** (both discovered by D1 tests, both fixed by an
   additive nullable-column migration since `organizations`/`saved_tenders`/
   `ignored_tenders`/`customer_feedback` rows are never hard-deleted for a
   user's own sake — see migrations 0005/0006):
   - A departing MEMBER (non-owner) who had saved/ignored a tender or left
     feedback in an org they remain a member of would previously hit a
     foreign-key violation deleting their account (`saved_tenders.saved_by_
user_id` etc. are `NOT NULL` FKs to `users`). Fixed: those three
     columns are now nullable; account deletion SET NULLs the departing
     user's attribution on them (the ORG's row survives — a saved tender
     stays useful to the rest of the org) before calling Better Auth's
     `deleteUser`.
   - The creator of ANY organization — even one that was later deleted and
     purged — could never delete their own account, because
     `organizations.created_by_user_id` is a `NOT NULL` FK and the
     `organizations` row itself is never hard-deleted (see commitment 2).
     Fixed the same way: the column is now nullable, nulled at account
     deletion time.
2. **Organization deletion** [implemented Phase 11 stage A] —
   self-service, OWNER only (`DELETE /api/org`), gated by an exact-match
   `{ confirm: <organization name> }` body verified server-side against the
   real row. Effect is immediate soft-delete (`organizations.status =
'deleted'`): every member's `/api/org/*` access 403s on their very next
   request (`organization_deleted`, distinct from the onboarding-shaped
   `no_organization`), and the org drops out of scoring/digest eligibility
   on the same request (`listOrgsEligibleForScoring`/
   `listOrgsWithDigestEnabled`, both filter `status = 'active'`). Data is
   NOT hard-deleted at this point — see commitment 3 for the purge and the
   retention rationale below. Best-effort Stripe `cancel_at_period_end`
   cancellation (never blocks the deletion itself; every outcome — canceled,
   no subscription, already canceled, Stripe not configured, or a Stripe API
   error — is written into the audit row for manual follow-up when
   automatic cancellation didn't happen). An `organization.deleted` audit
   row is recorded either way.
3. **Purge jobs** [implemented Phase 5 (tender corpus) / Phase 11 stage A
   (deleted organizations)] — the daily retention cron (06:30 UTC) runs TWO
   independent sweeps back to back:
   - Tender-corpus retention (Phase 5, unchanged): TED deadline+90d /
     no-deadline publication+180d, unless pinned by a save or feedback row.
   - Deleted-organization hard purge (Phase 11 stage A,
     `packages/procurement/src/org-purge.ts`): organizations
     `status = 'deleted'` for at least 30 days (the reversal window — a
     30-day grace buffer for support to catch an accidental deletion before
     it becomes unrecoverable; there is no self-service "undelete") are
     hard-deleted in FK-safe order: `customer_feedback`/`digest_items` (both
     reference matches and must go first), `match_components`/
     `match_risk_flags`/`tender_matches`, `saved_tenders`/`ignored_tenders`,
     `digest_runs`, `email_deliveries`, every `company_*` and
     `matching_preferences`/`digest_preferences` row, `support_notes`,
     `product_events`, and any leftover `organization_members` rows. A
     save/ignore/feedback row being present does NOT protect it from this
     purge — "pinning" only ever meant "protect the underlying TED lot from
     the corpus retention sweep above"; here the ORG chose deletion, so its
     own rows go regardless. **Never purged**, by design, with the FK
     reasoning documented in-file (`identity.ts`'s `tombstoneOrganization`,
     `org-purge.ts`'s module doc):
     - `subscriptions` — kept as a billing/legal accounting record beyond
       the life of the org relationship (docs/data-model.md §9).
     - `audit_events` / `billing_events` — append-only ledgers (security
       forensics / Stripe webhook idempotency); `organization_id` stays on
       these rows exactly like `actor_id` stays on an account-deletion audit
       row.
     - The `organizations` row itself — kept forever as a tombstone
       (`status` stays `deleted`, `name` becomes `deleted-<id>` for PII
       minimization) rather than hard-deleted, because the two retained
       ledgers above still FK-reference it.
   - Both sweeps log structured counts on every run; covered by D1
     integration tests (org-lifecycle.d1.test.ts): full purge removes every
     owned row, a not-yet-grace-expired org is left untouched, a second run
     is a no-op (idempotent via the tombstone name), and the global tender
     corpus is provably untouched by the org purge.
4. **Data export** [implemented Phase 11 stage A] — `GET /api/org/export`,
   OWNER only, rate-limited by the same `API_RATE_LIMITER` binding as every
   other `/api/org/*` route, audit-evented. Returns a single bounded JSON
   bundle (each collection capped at 500 rows, `truncated: true` signals a
   follow-up export is needed): `organizationId`, `generatedAt`, `profile`,
   `capabilities`, `certifications`, `cpvPreferences`, `geographies`,
   `keywords`, `exclusions`, `matchingPreferences`, `digestPreferences`,
   `savedTenders` (lot id/notice id/title/saved-at), `ignoredTenders` (same
   shape + reason), `feedback` (match id/verdict/reasons/comment/created
   at). Deliberately does NOT include the global tender corpus beyond the
   display `title` already denormalized onto saved/ignored rows — TED notice
   content is public-sector data, not something a portability request needs
   re-exported wholesale (see the TED procurement data row above).
5. **Email preference deletion** [implemented Phase 8, org-deletion
   cascade added Phase 11 stage A, `email_deliveries` FK edge fixed Phase 11
   fix batch (P11-R-04)] — `digest_preferences.enabled = false` disables
   sending immediately; the digest scheduler filters on it
   (`listOrgsWithDigestEnabled`). Org deletion cascades this the same way
   as every other preference table (commitment 3's purge). Transactional
   auth email (verification, password reset) follows the ACCOUNT lifecycle,
   not a separate preference — there is no opt-out for it, matching every
   SaaS's standard treatment of security-critical mail; it stops the moment
   the account is deleted. Before Better Auth's `deleteUser` removes the
   `users` row, `routes/account.ts` SET NULLs every `email_deliveries.
user_id` row this user authored (`nullifyUserEmailDeliveries`, same
   "anonymize the author, keep the row" pattern as `nullifyOrganizationCreator`
   / `nullifyUserAuthorship`) — the delivery-metadata rows themselves are
   `email_deliveries` history, not opt-in preference state, and are governed
   by the 12-month retention row in the data inventory above (and the
   time-based purge in commitment 3), not this commitment.
6. **Log redaction** [implemented Phase 2] — observability package redacts
   secrets/tokens and never logs email bodies; request logs carry ids, not
   payloads (security.md C10).

## Request handling

Privacy requests (access, deletion, correction) arrive via
support@bidmorrow.com (see docs/customer-support.md, "deletion requests").
Self-service now covers the two most common requests directly (account
deletion, organization deletion, data export — commitments 1/2/4); requests
that fall outside those (e.g. correcting a specific field, or a request from
someone who cannot access their account) are still executed manually by an
admin and recorded in `audit_events`. Response-time commitments are set at
legal review (blocker 7).
