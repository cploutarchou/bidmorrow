# HUMAN_DECISION_BLOCKERS

Genuinely human-required decisions, credentials, and console actions.
Claude must NEVER invent values for anything listed here. All implementation
proceeds with mocks / test-mode configuration until these are provided.

Status legend: `OPEN` (needs human), `PROVIDED` (done), `DEFERRED` (not needed yet).

---

## 1. Cloudflare account & deployment credentials — PROVIDED (2026-08-15)

**Provided**: the Cloudflare account is connected to the Claude session via
the Cloudflare MCP connector (verified with read-only listing: account
reachable, no D1/Workers resources exist yet). Claude can create/manage
D1, R2, and KV resources through this connector when the deployment phases
need them; resources will be created in their owning phases, not before.

**Also provided 2026-08-15**: scoped CI API token created (per
docs/setup-guide.md § 2a) and stored together with `CLOUDFLARE_ACCOUNT_ID`
in the GitHub **`staging` environment** secrets — deploy workflows must
declare `environment: staging` / `environment: production` to read them.
A `production` GitHub environment also exists.

**Workers Paid plan ($5/mo) purchased 2026-08-15** (dashboard shows
"Current plan: Paid") — Queues available.

**One remaining console action (found 2026-08-16 at first provisioning):
enable R2 once** — Dashboard → **R2** → Enable/accept terms. Bucket
creation via API returns 403 code 10042 ("Please enable R2 through the
Cloudflare Dashboard") until this is done; the free tier (10 GB) covers
staging+production snapshots. After enabling, re-run the "Deploy staging"
GitHub workflow — it creates the bucket itself.

## 2. Domain & DNS for bidmorrow.com — PARTIALLY PROVIDED (2026-08-15)

Needed for: production URLs and email deliverability (Phases 8/13).

**Provided**: bidmorrow.com DNS is on Cloudflare, on the account connected
to Claude via the MCP connector. Staging needs no DNS (workers.dev).

Still human-required / deferred to Phase 13:

1. ~~Confirm bidmorrow.com registration and move DNS to Cloudflare.~~ DONE.
2. App custom-domain attach (`bidmorrow.com` → Worker) happens at
   production deploy time via wrangler routes (`custom_domain: true`) —
   no manual DNS record needed now that the zone is on the account.
3. Email authentication (required before any digest email is sent to customers —
   deliverability depends on it):
   - Add the SPF, DKIM and DMARC records that Resend displays under
     Resend → Domains → Add Domain → bidmorrow.com. Exact values are
     account-specific; copy them from the Resend console.
   - Recommended DMARC starting policy: `v=DMARC1; p=none; rua=mailto:postmaster@bidmorrow.com`
     then tighten to `p=quarantine` after monitoring.

## 3. Resend account — PARTIALLY PROVIDED (2026-08-15)

Needed for: real email sending (Phase 8+). Local/test uses a mock provider.

**Provided**: Resend account created; `RESEND_API_KEY` stored in the GitHub
`staging` environment secrets.

Still human-required:

1. Verify domain bidmorrow.com in Resend (SPF/DKIM/DMARC records into the
   Cloudflare zone — see item 2.3). Unconfirmed as of 2026-08-15.
2. A second, separate API key for production (never reuse staging's).
3. Confirm sending addresses (suggested): `verify@bidmorrow.com` /
   `digest@bidmorrow.com`, support inbox `support@bidmorrow.com`.

## 4. Stripe account & prices — PARTIALLY PROVIDED (2026-08-15)

Needed for: Phase 9 billing. All Phase 9 development uses Stripe **test mode**;
test-mode keys are still human-provided (never invented).

**Provided**: Stripe account created (test mode); Founding/Standard
products+prices created; `STRIPE_SECRET_KEY`,
`STRIPE_PRICE_FOUNDING_MONTHLY`, `STRIPE_PRICE_STANDARD_MONTHLY` stored in
the GitHub `staging` environment secrets. Remaining: webhook endpoint +
`STRIPE_WEBHOOK_SECRET` (needs the deployed staging URL — Phase 13; must be
created with API version `2026-07-29.dahlia` and the 6-event set), Customer
Portal activation (unconfirmed), live-mode repeat before launch.

**No registered company needed** (owner question 2026-08-15): Stripe supports
signing up as an **Individual / sole trader** — during activation pick
business type "Individual" and use your personal tax ID instead of a company
registration. Test mode requires no activation at all, so nothing blocks
Phase 13 staging. Alternative for launch: a Merchant-of-Record platform
(Paddle / Lemon Squeezy / Polar) that acts as the legal seller and handles
EU VAT for you — but the billing package is built on Stripe, so switching
is a Phase-9-sized rewrite; decide only if the tax burden of selling as an
individual proves unacceptable. Default recommendation: stay on Stripe as
Individual.

Human actions:

1. Create a Stripe account (or use existing). Activate test mode first.
2. Create Products/Prices in test mode (repeat in live mode before launch):
   - `BIDMORROW_FOUNDING_MONTHLY` — $29/month recurring
   - `BIDMORROW_STANDARD_MONTHLY` — $49/month recurring
3. Provide secrets per environment (test keys for staging, live for production —
   never mixed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_FOUNDING_MONTHLY`, `STRIPE_PRICE_STANDARD_MONTHLY`.
4. Configure the webhook endpoint (URL will be documented in docs/deployment.md
   once deployed) and enable the event set listed in docs/architecture.md § billing.
5. Enable the Stripe Customer Portal in Dashboard settings (test + live).

## 5. Auth secret — PROVIDED (2026-08-15)

`BETTER_AUTH_SECRET` set by the owner in BOTH the `staging` and
`production` GitHub environments; owner confirmed 2026-08-15 the two
values are different. Local dev uses a checked-in-nowhere `.env` value the
developer generates.

## 6. Admin allowlist — PROVIDED (2026-08-15)

`ADMIN_EMAILS` = `cploutarchou@gmail.com`, set as a GitHub `staging`
environment variable by the owner. Repeat in the `production` environment
at production-deploy time.

## 7. Business / legal information — PARTIALLY PROVIDED (2026-08-15)

Needed for: terms, privacy policy, Stripe account, invoices.

**Decided by owner**: operate as an **Individual / sole trader** using a
personal tax ID (no registered company) — Stripe business type "Individual".

Still open:

- Registered address + contact email for privacy requests (terms/privacy
  pages need them before launch).
- Decision: is Stripe Tax needed at launch (EU B2B reverse charge)? Default
  assumption: launch B2B-only, collect VAT ID at checkout via Stripe; confirm.

## 8. GitHub settings — PARTIALLY PROVIDED (2026-08-15)

1. ~~Rename default branch to `main`~~ DONE (renamed from `master`;
   ci.yml trigger updated the same day). Branch protection on `main`
   (require PR + green CI) still unconfirmed.
2. ~~Create a GitHub "production" environment~~ DONE — confirm it has
   **Required reviewers** set so production deploys need a human click.

---

## Not blockers (deliberately)

- TED API: public, no credential required (verified in docs/ted-data-source.md).
- LLM keys: no production LLM usage in V1 by design.
- Analytics/monitoring SaaS: none used in V1.
