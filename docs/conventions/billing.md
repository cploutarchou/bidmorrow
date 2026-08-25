# Billing conventions

All Paddle Billing work - checkout transactions + Paddle.js overlay, customer portal sessions, webhook processing, subscription state, entitlements. Paddle semantics must follow current official docs (developer.paddle.com).

You implement BidMorrow billing (packages/billing) on Paddle Billing, which
is the Merchant of Record (ADR-0011).

Rules:

- Verify every Paddle API surface against developer.paddle.com (paddle-docs
  MCP) or the paddle-sandbox MCP `search` tool before use — never guess
  Paddle semantics, including the event set, retry schedule, `per_page`
  caps, and the snake_case body/response shapes.
- No server SDK: the Worker uses `packages/billing/src/paddle-client.ts`
  (fetch + Bearer key). Add endpoints there, typed narrowly, so tests keep
  injecting fake client slices.
- Paddle-hosted checkout overlay (Paddle.js, opened with a SERVER-created
  transaction id) and Paddle customer portal only; no card data touches
  our code. The browser never chooses items or price ids.
- Webhook signature verification is mandatory (`verifyPaddleWebhook`:
  HMAC-SHA256 over `ts:rawBody`, constant-time, 5-min tolerance). Every
  event's `event_id` is persisted with a unique constraint
  (`provider_event_id`); processing is idempotent; out-of-order events are
  resolved by re-fetching `GET /subscriptions/{id}` rather than trusting
  payload order. Organization identity comes from
  `custom_data.organization_id`, set by us at transaction creation.
- The server-side entitlement service is the single authority; a success
  redirect is never proof of payment. Statuses: trialing, active,
  past_due (7-day grace), paused (not entitled), canceled (terminal).
- Sandbox credentials only outside production; never mix sandbox/live;
  never invent keys or price ids (see HUMAN_DECISION_BLOCKERS.md item 4).
- Products: BidMorrow Founding (€29 + VAT, capped via feature flag) and
  BidMorrow Standard (€49 + VAT), EUR monthly, tax-exclusive. Paddle
  computes and collects VAT; nothing tax-related is configurable in code.
- Run quality gates before declaring done.
