# HUMAN_DECISION_BLOCKERS

Genuinely human-required decisions, credentials, and console actions.
Claude must NEVER invent values for anything listed here. All implementation
proceeds with mocks / test-mode configuration until these are provided.

Status legend: `OPEN` (needs human), `PROVIDED` (done), `DEFERRED` (not needed yet).

---

## OPEN ITEMS SNAPSHOT — 2026-08-16 (production launch checklist)

Everything below is detailed in the numbered items further down; this is
the consolidated to-do. Nothing else blocks launch on the owner side.

1. **`production` GitHub environment secrets** (repo → Settings →
   Environments → production): `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` (item 1), live-mode `STRIPE_SECRET_KEY` +
   `STRIPE_PRICE_FOUNDING_MONTHLY` + `STRIPE_PRICE_STANDARD_MONTHLY` +
   `STRIPE_WEBHOOK_SECRET` (item 4), production `RESEND_API_KEY`
   (item 3.2). Variables: `ADMIN_EMAILS`; `EMAIL_FROM` after item 2.3.
   (`BETTER_AUTH_SECRET` already set ✓.)
2. **Production deploy gating — RESOLVED 2026-08-16 (with a plan-limit
   discovery)**: the owner HAS GitHub Pro, which enforces the `main`
   branch **ruleset** (PR + green `checks`/`secret-scan`, no force-push)
   on this private repo — but environment **Required reviewers** turned
   out to need GitHub **Enterprise** on private repos (the section
   simply doesn't render on the owner's environment page; Pro is not
   enough — an earlier note here claiming Pro suffices was wrong).
   Adopted gate instead: (a) production environment "Deployment
   branches" set to **Protected branches only** (owner console action —
   deploys only ever run ruleset-protected main), (b) deploy-production
   requires a typed `confirm: deploy-production` dispatch input, and
   (c) standing convention: Claude never dispatches a production deploy
   without an explicit owner instruction.
3. ~~Branch protection~~ DONE — enforced by the imported `main-protection`
   ruleset (Pro covers rulesets on private repos).
4. **Resend domain verification** — ~~verification~~ **VERIFIED
   2026-08-16** (owner screenshot: bidmorrow.com Verified in Resend,
   DKIM + SPF-send + tracking CNAME all green; "Enable Receiving"
   correctly OFF — inbound mail is item 5's Cloudflare Email Routing,
   not Resend). ~~REMAINING~~ **ALL DONE 2026-08-16** (owner confirmed):
   production `RESEND_API_KEY` created + stored, `EMAIL_FROM` variable
   set in BOTH `staging` and `production` environments. Both
   environments redeployed the same evening to push the new values —
   real signup-verification + digest email is LIVE.
5. **Stripe live mode** (item 4): activate as Individual, recreate
   products/prices, register the live webhook for
   `https://bidmorrow.com/api/webhooks/stripe` (can be done BEFORE the
   first deploy — the URL is fixed), enable Customer Portal (both modes).
6. **Legal inputs** (item 7): ~~postal address + privacy email~~ DECIDED
   2026-08-16 (email-only contact, implemented). ~~VAT approach~~ FINAL
   2026-08-16: **no VAT at launch** — owner has no VAT registration, so
   flat prices, no tax line, no VAT ID field; the flag-gated Stripe Tax
   integration stays dormant until VAT registration (details in item 7).
   No owner action needed.
7. ~~**Test-mode Stripe webhook URL update**~~ **DONE 2026-08-16**
   (owner confirmed): the test-mode endpoint now targets
   `https://staging.bidmorrow.com/api/webhooks/stripe`; signing secret
   unchanged.

Then launch = dispatch the **Deploy production** workflow (Actions tab)
and approve it; it bootstraps prod D1/queues/R2, migrates, deploys,
attaches bidmorrow.com, pushes secrets, and smoke-tests. Production
comes up with ingestion paused — unpausing is the final deliberate step.

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

~~One remaining console action: enable R2 once~~ **DONE 2026-08-16**
(owner enabled R2 in the dashboard; the staging deploy then created the
bucket itself). **Item 1 fully PROVIDED for staging.** For production:
confirm `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are also set in
the GitHub **`production` environment** secrets (same token is fine, or
mint a second one with identical scopes per docs/setup-guide.md § 2a).

## 2. Domain & DNS for bidmorrow.com — PARTIALLY PROVIDED (2026-08-15)

Needed for: production URLs and email deliverability (Phases 8/13).

**Provided**: bidmorrow.com DNS is on Cloudflare, on the account connected
to Claude via the MCP connector. Staging serves on the
`staging.bidmorrow.com` custom domain since 2026-08-16 (owner request;
attached automatically at deploy, no console action — but see snapshot
item 7 for the test-mode Stripe webhook URL update it requires).

Still human-required / deferred to Phase 13:

1. ~~Confirm bidmorrow.com registration and move DNS to Cloudflare.~~ DONE.
2. App custom-domain attach (`bidmorrow.com` → Worker) happens at
   production deploy time via wrangler routes (`custom_domain: true`).
   **OPEN console action (found at first production deploy 2026-08-16,
   API error 100117)**: the zone has pre-existing address records on the
   apex — Cloudflare refuses to overwrite them. Dashboard →
   bidmorrow.com → DNS → Records: **delete the A / AAAA / CNAME
   record(s) whose name is `bidmorrow.com`** (root/apex). Keep TXT and
   MX records — they don't conflict. Then re-run "Deploy production".
   ~~DONE 2026-08-16~~ — domain attached on deploy run #2.

   ~~OPEN console action #2~~ **DONE 2026-08-16** (owner disabled the
   challenge; deploy run #5 green — bidmorrow.com LIVE). Original
   finding kept for the record: the zone served a **Managed Challenge**
   (`cf-mitigated:
challenge`, "Just a moment…" interstitial) on EVERY request — this
   blocks health checks, the Stripe webhook endpoint, and the SPA's own
   API fetches. Dashboard → bidmorrow.com → **Security**: turn **Bot
   Fight Mode OFF** (it challenges all non-browser clients and cannot
   be scoped/bypassed on Free), ensure **Security Level is not "I'm
   Under Attack"**, and disable any Quick-Start one-click feature whose
   action is "challenge". The Worker already enforces its own rate
   limiting + security headers (docs/security.md); zone-level
   challenges must stay off the app origin.

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
the GitHub `staging` environment secrets. **Test-mode webhook +
`STRIPE_WEBHOOK_SECRET` PROVIDED 2026-08-16** (registered against the
staging workers.dev URL, API version `2026-07-29.dahlia`, 6-event set;
secret pushed to the staging Worker). Remaining for launch: **live-mode
repeat** — activate the account (business type Individual), recreate the
two products/prices in live mode, live webhook against
`https://bidmorrow.com/api/webhooks/stripe`, live keys into the
`production` environment secrets — and Customer Portal activation in
BOTH modes (unconfirmed).

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
   - `BIDMORROW_FOUNDING_MONTHLY` — €29/month recurring
   - `BIDMORROW_STANDARD_MONTHLY` — €49/month recurring (currency EUR
     per the owner's live-mode products, 2026-08-16)
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

**Decided by owner 2026-08-16**: the terms/privacy pages publish **no
postal address** — contact is **email-only** (`support@bidmorrow.com` for
terms/general, `privacy@bidmorrow.com` for data requests). Implemented in
Terms.tsx/Privacy.tsx the same day. Known trade-off (owner informed): some
EU member states' e-commerce rules (strictest: German-style Impressum)
expect an address; can be added later with a one-line edit if ever needed.
⚠️ Consequence: item 2's email-forwarding test is now REQUIRED, not
optional — the published support@/privacy@ inboxes must actually deliver
(Cloudflare Email Routing if the old Namecheap forwarding is dead).

**FINAL owner decision 2026-08-16 — NO VAT at launch**: the owner has
**no VAT registration** (Cyprus sole trader), so VAT cannot legally be
collected; Stripe Tax activation stalled on exactly that ("Cyprus —
Needs attention" wants a registration number that doesn't exist). This
supersedes the same-day "use Stripe Tax" decision. Current state:
flat prices (€29/€49), no VAT line, no VAT ID field, plain-price copy;
`stripe_tax_enabled` flag OFF in every environment (staging was briefly
ON for testing, flipped back the same evening). The Stripe Tax
integration stays built and dormant. **Revisit trigger**: when the
owner registers for VAT (threshold or voluntary) — then: add the
registration in Stripe (both modes) + set price tax_behavior + flip
the flag + restore "excl. VAT" copy. Owner informed that monitoring
the registration threshold is their/their accountant's responsibility.

## 8. GitHub settings — PARTIALLY PROVIDED (2026-08-15)

1. ~~Rename default branch to `main`~~ DONE (renamed from `master`;
   ci.yml trigger updated the same day). ~~Branch protection~~ DONE
   2026-08-16: owner imported the `main-protection` ruleset (PR + green
   `checks`/`secret-scan` required, approvals 0, force-push/deletion
   blocked).
2. ~~Create a GitHub "production" environment~~ DONE — ~~Required
   reviewers~~ DONE 2026-08-16: production deploys now pause for the
   owner's approval in the Actions tab.

---

## Not blockers (deliberately)

- TED API: public, no credential required (verified in docs/ted-data-source.md).
- LLM keys: no production LLM usage in V1 by design.
- Analytics/monitoring SaaS: none used in V1.
