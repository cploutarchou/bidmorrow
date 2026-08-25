---
name: billing-audit
description: Audit the Paddle billing surface — server-side authorization, tenant scoping, hosted-portal preference, webhook consistency, subscription/invoice state coverage, and no-fabrication rules. Use during review of any billing-touching change, before marking a billing phase complete, and when diagnosing billing incidents.
---

# Billing audit

Scope: the billing package (`packages/billing`), the billing/webhook routes
(`apps/worker/src/routes/billing.ts`, `webhooks.ts`), the subscriptions
repository, and the client billing UI. NOT for pricing/plan decisions
(owner-frozen — see `.claude/skills/website-redesign/requirements.md`) or
Paddle dashboard work (owner-only, HUMAN_DECISION_BLOCKERS).

When to use: reviewing any change that touches billing code, webhooks, or
subscription state; phase sign-off for billing work; diagnosing a customer
billing report. When NOT to use: pure copy changes on the pricing page
(product agent), infrastructure cost questions (cost-audit skill).

Inputs: the diff or module under review + the current
`docs/dependency-versions.md` Paddle facts. Outputs: severity-tagged
findings (Critical/High/Medium/Low) with file:line evidence; PASS only
when every checklist item was verified by reading code or running tests —
never from an implementer's claim.

## Checklist

1. **Server-side resolution only.** Every Paddle id (customer,
   subscription) used in a handler is loaded from the org-scoped
   repository row for the AUTHENTICATED org context — never from request
   body, query, or headers. The one client-supplied id (invoice PDF
   `transactionId`) must be re-proved against the org's customer id
   before any URL is returned. Grep the routes for `paddle` + `req`
   proximity.
2. **Authorization.** Billing reads and mutations require organization
   context; mutations (checkout, portal, cancel, reactivate) and financial
   reads (invoices) require `ORGANIZATION_OWNER`. Verify the middleware
   chain on each route, then verify a d1 test exercises the denial path.
3. **Hosted portal preference.** Payment-method changes and anything
   touching card data go through the Paddle-hosted portal/checkout overlay —
   the app never collects or proxies card details. Any new in-app mutation
   must be justified against "the portal already does this".
4. **Webhook remains authoritative.** Optimistic local-row updates (e.g.
   cancel-at-period-end) must converge with webhook reconciliation —
   check the webhook handler processes the same transition idempotently
   and later events can overwrite the optimistic state, never fight it.
5. **State coverage.** UI and API handle: no subscription, trialing,
   active, past_due (overdue/failed payment, grace), paused, canceled,
   cancel-scheduled (period end shown), reactivation, billing
   not-configured (503 pattern), Paddle API failure (502/5xx mapped, no
   internals leaked). Each state has a test or an explicit gap note.
6. **No fabrication.** No invented invoices, amounts, dates, or provider
   responses anywhere — including tests (tests use clearly fake fixtures
   through the established fake-Paddle-client seams) and UI empty states
   (absence is shown as absence). If credentials/config are missing, the
   integration boundary returns the not-configured error; it never
   simulates success.
7. **Secrets hygiene.** No Paddle API key/webhook secret in logs beyond
   what the existing logging policy allows (counts + metadata); webhook
   signature verification unchanged (`verifyPaddleWebhook`, HMAC over
   `ts:rawBody`, before parsing, IP rate limit before it); only the PUBLIC
   client token reaches the browser (`/api/public-config`) — grep
   `apps/web/dist` for `pdl_` if built.
8. **Docs current.** Paddle API syntax used was verified against current
   official docs / the paddle MCP `search` tool (verify-current-docs
   skill), and `docs/dependency-versions.md` § Paddle facts records
   anything new. CSP allowlist (docs/security.md C3) matches both
   `apps/worker/src/index.ts` and `apps/web/public/_headers`.

## Verification requirements

Re-run yourself: `pnpm exec vitest run packages/billing`, the worker d1
billing/webhook tests, and typecheck. Report actual numbers.

## Coordination

Read-only toward product code during audit — findings go to the
implementing agent, never fixed in-place by the auditor. When multiple
agents work billing concurrently, the route file
(`apps/worker/src/routes/billing.ts`) has a single writer at a time; the
coordinator serializes.
