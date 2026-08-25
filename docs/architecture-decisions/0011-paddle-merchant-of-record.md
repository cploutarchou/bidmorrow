# ADR-0011: Paddle Billing as Merchant of Record (replaces Stripe)

Status: Accepted (2026-08-25, owner decision). Supersedes the "stay on
Stripe as Individual" recommendation recorded in
`HUMAN_DECISION_BLOCKERS.md` item 4 (2026-08-15) and the "no VAT at
launch / dormant Stripe Tax" decision of 2026-08-16. ADR-0006's example of
"Stripe event IDs" as an idempotency key is now "provider event ids" —
the mechanism is unchanged.

## Context

- Billing was built on Stripe (Phase 9): hosted Checkout + Customer
  Portal, six webhook events, `stripe_*` columns, a `stripe_tax_enabled`
  flag left OFF because the owner — a Cyprus sole trader with no VAT
  registration — could not legally collect VAT, while selling to EU
  businesses in several member states.
- Selling as an Individual through a payment processor leaves VAT
  registration, per-country filing and invoicing compliance on the
  owner. A Merchant of Record (MoR) is the legal seller: it charges,
  collects and remits VAT itself, and issues the invoices.
- Production has never had a subscription: the pre-launch gate
  (`prelaunch` flag) has kept `POST /api/billing/checkout` closed since
  2026-08-21 and the production database was verified empty on
  2026-08-25 (staging may hold Stripe test-mode rows, which migration 0011
  carries across losslessly as inert canceled/orphan rows). There is no
  customer data to migrate — only schema and code.
- Launch is 2026-08-31. Paddle live-account approval and domain
  verification are asynchronous owner-side steps with a lead time of
  days, so the sandbox integration ships now and live wiring is a
  documented owner gate (blockers item 4).

## Decision

1. **Paddle Billing is the billing provider and Merchant of Record.**
   Paddle is the seller on the invoice; it computes and collects VAT for
   the customer's country and remits it. BidMorrow keeps a mirror of
   subscription state for entitlements only.
2. **Prices are tax-exclusive** (`tax_mode: external` on both Paddle
   prices, owner decision 2026-08-25): the customer pays €29 / €49 plus
   the VAT applicable to them; BidMorrow's net is the price minus
   Paddle's fee. Customer-facing copy says "+ VAT". The
   `stripe_tax_enabled` flag is removed — there is nothing left to
   toggle.
3. **No Paddle server SDK.** `packages/billing` uses a small typed
   `fetch` client (`paddle-client.ts`) over the REST API
   (`sandbox-api.paddle.com` / `api.paddle.com`, Bearer key) and verifies
   webhooks with Web Crypto HMAC-SHA256 (`webhook-signature.ts`):
   signed payload `${ts}:${rawBody}`, header `ts=…;h1=…`, constant-time
   compare, 5-minute timestamp tolerance (the SDKs default to 5 s; we
   accept more clock skew because replay is already neutralised by the
   unique `provider_event_id`). Rationale: the Worker runtime, five
   endpoints, zero new server dependencies, and test seams that inject a
   fake client slice exactly as before.
4. **Checkout = a server-created transaction opened by Paddle.js.**
   `POST /api/billing/checkout` keeps every guard (owner role, prelaunch,
   one subscription per org, founding flag/cap), calls
   `POST /transactions` with `items: [{ price_id }]`,
   `custom_data: { organization_id, plan }` and, on reactivation, the
   existing `customer_id`, and returns `{ transactionId }`. The SPA opens
   the Paddle overlay with `Paddle.Checkout.open({ transactionId })`. The
   browser never chooses items or price ids; the organization binding is
   set server-side and Paddle copies `custom_data` onto the subscription
   it creates, which is what makes webhook organization resolution
   order-independent.
5. **Webhook `POST /api/webhooks/paddle`**, subscribed to
   `subscription.created|activated|trialing|updated|past_due|paused|
resumed|canceled`. Same contract as before: idempotent on the unique
   event id (insert-first), state re-fetched from `GET /subscriptions/{id}`
   and never trusted from the payload, unknown price id → fail → non-2xx
   → Paddle retries, duplicate-checkout reconciliation cancels the
   incoming duplicate immediately. IP rate limit precedes verification
   (SEC-P9-02 unchanged).
6. **Status vocabulary is Paddle's**: `trialing | active | past_due |
paused | canceled`. `paused` is a first-class non-entitled state (the
   customer portal can pause/resume); Stripe's `unpaid` is gone. The
   7-day `past_due` grace window is unchanged.
7. **Cancel / reactivate / portal / invoices**:
   `POST /subscriptions/{id}/cancel` (`effective_from:
next_billing_period`) sets `scheduled_change.action = cancel`;
   `PATCH /subscriptions/{id} { scheduled_change: null }` reverses it;
   `POST /customers/{id}/portal-sessions` → `urls.general.overview`
   (temporary, never cached); invoices are `completed|paid|billed|past_due`
   transactions listed by the server-stored customer id, with the PDF URL
   resolved on demand via `GET /transactions/{id}/invoice` behind
   `GET /api/billing/invoices/:transactionId/pdf` (ownership re-proved
   server-side, JSON `{ url }` rather than a redirect).
8. **Provider-neutral schema** (migration `0011_paddle_billing.sql`,
   table rebuild per the migration-safety skill):
   `subscriptions.billing_customer_id`, `billing_subscription_id`,
   `billing_events.provider_event_id`, status CHECK updated.
9. **CSP** (docs/security.md C3) now allows exactly Paddle's origins:
   `script-src https://cdn.paddle.com`, `frame-src https://buy.paddle.com
https://sandbox-buy.paddle.com`, `connect-src`/`img-src
https://*.paddle.com`, and `style-src https://cdn.paddle.com
https://sandbox-cdn.paddle.com 'unsafe-inline'` (Paddle.js loads its
   overlay stylesheet from its CDN and sets inline styles on the overlay
   container — found with a CSP probe against the sandbox, not from docs).
   `'unsafe-inline'` is granted for styles only; script-src stays strict.
   The same list lives in `apps/web/public/_headers`.
   9b. **Organization provenance** (SEC-PDL-01, found in security review): the
   Paddle.js client token is public, so a Paddle-signed event is not proof
   that our server created the transaction. Checkout signs
   `custom_data.organization_id` with an HMAC (`organization_sig`, keyed
   with the notification secret); the webhook trusts the id only when the
   HMAC verifies and `ignore`s anything else. Stateless, no schema change.
10. **Environment names**: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
    `PADDLE_PRICE_FOUNDING_MONTHLY`, `PADDLE_PRICE_STANDARD_MONTHLY`
    (secrets); `PADDLE_CLIENT_TOKEN` (public Paddle.js token),
    `PADDLE_ENVIRONMENT` (`sandbox` | `production`) (variables). All six
    are `DEPLOYED_REQUIRED_NAMES`. `/api/public-config` exposes the client
    token + environment (or `paddle: null` when unconfigured).

## Consequences

- **Fees**: Paddle's published MoR fee is **5% + 50¢ per transaction**
  (developer.paddle.com, "How does Paddle compare?", verified
  2026-08-25) vs Stripe's ~2.9% + €0.30. Net per €29 subscription ≈
  €27.10; per €49 ≈ €46.10 (EUR/USD parity assumed for the fixed part).
  Margin against infrastructure stays >95% at every modelled scale
  (`docs/cost-model.md`, `docs/redesign/pricing.md` §6). In exchange the
  owner carries no VAT registration, filing, or invoicing obligation for
  subscription revenue.
- **Third-party script in the SPA**: `@paddle/paddle-js` loads Paddle.js
  from `cdn.paddle.com` at runtime — the first non-self origin in the CSP.
  Paddle mandates loading from its CDN (no self-hosting), so this is a
  supply-chain trust decision recorded in docs/threat-model.md T21.
- **Owner gates before real money** (blockers item 4): Paddle live-account
  approval, website/domain approval for `bidmorrow.com`, default payment
  link, live catalog, live notification destination, production
  secrets/vars with `PADDLE_ENVIRONMENT=production`.
- **Terms/privacy**: Paddle is the seller of record and a sub-processor
  for billing identity and payment data; the legal pages must say so.
- **No reconciliation cron** still (accepted risk unchanged); replays are
  available from Paddle's notification log and via
  `client.notifications.replay`.
- **Removed**: `stripe` npm dependency (both packages), `stripe-client.ts`,
  `stripe-types.ts`, the Stripe Tax code path and flag, the
  `staging-flag.yml` `stripe_tax_enabled` choice, Stripe secrets in the
  deploy workflows. The Stripe test-mode account, webhook and GitHub
  `STRIPE_*` secrets are to be deleted by the owner after merge.
