/**
 * E2E coverage for Settings' Billing section (apps/web/src/pages/app/
 * Settings.tsx). The local `wrangler dev` stack this suite runs against has
 * NO Paddle configuration (`scripts/e2e-write-dev-vars.mjs` deliberately
 * omits `PADDLE_*`, see its docblock) — `resolveBillingConfig` therefore
 * returns `null` for EVERY `/api/billing/*` route (apps/worker/src/
 * billing.ts), which responds `503 { error: 'not_configured' }` before it
 * ever looks at whether an organization has a subscription row.
 *
 * That has a real consequence for what this file can honestly test:
 * `billing.subscription` is ALWAYS `null` here (the only way it becomes
 * non-null is a completed Paddle checkout webhook, which never fires
 * locally) — so the entire `BillingActiveSubscription` branch of
 * Settings.tsx (plan card, cancel/reactivate panel, past-due notice, print
 * button) can never render in this environment. See the skip blocks below
 * for exactly what's covered vs. not, and why.
 */
import { expect, test } from '@playwright/test';
import { bootstrapOnboardedUserWithMatches, login, TEST_PASSWORD } from './helpers';

test.describe('billing: Settings', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';

  test('org with no subscription: Subscribe CTA visible, invoices area shows the exact honest not-configured state', async ({
    page,
  }) => {
    const account = await bootstrapOnboardedUserWithMatches(page, 'Billing No Sub');
    email = account.email;
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

    await expect(page.getByText('No active subscription.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Subscribe — Standard/ })).toBeVisible();

    // GET /api/billing/invoices -> 503 not_configured -> InvoicesState
    // 'not_configured' -> this EXACT rendered hint (Settings.tsx
    // BillingInvoiceHistory), not the generic loading/error copy.
    const invoiceHistory = page.locator('section[aria-labelledby="billing-invoices-heading"]');
    await expect(invoiceHistory.getByText('Loading invoices…')).toHaveCount(0);
    await expect(
      invoiceHistory.getByText('Billing is not available right now — please try again shortly.'),
    ).toBeVisible();
  });

  test('non-owner member sees billing status but invoices/mutation controls hidden: SKIPPED — no way to create a second org member in this harness', () => {
    // Neither the real UI nor `/api/*` (searched apps/worker/src/routes/
    // org.ts, account.ts) exposes an invite/add-member endpoint, and
    // apps/worker/src/routes/test-hooks.ts's double-gated E2E hooks are
    // limited to `/mailbox` and `/score-now` (no member-seeding hook).
    // There is no path — real UI, API, or test hook — to put a second user
    // into an existing organization as a non-owner from this suite. Faking
    // it via a direct D1 write would test something the app itself cannot
    // do, which is worse than an honest skip. Revisit if/when an
    // invite-member flow ships.
    test.skip(true, 'no invite/add-member seam exists anywhere in the app to create this state');
  });

  test("cancel-subscription confirmation gate: SKIPPED — the Cancel panel never renders without Paddle, and the handoff's assumed 409 is pre-empted by 503 locally", () => {
    // Two independent reasons this scenario is unreachable here, both
    // verified by reading the code (not assumed):
    // 1. Settings.tsx only renders the `BillingActiveSubscription`
    //    component (which owns the `ConfirmAction`
    //    typed-CANCEL_SUBSCRIPTION gate) when `billing.subscription !==
    //    null`. Locally, a subscription row is only ever created by a
    //    completed Paddle webhook — with no Paddle config and no seed data
    //    (checked scripts/seed-demo.sql: no `subscriptions` INSERTs) and no
    //    test hook to fabricate one, `billing.subscription` is always
    //    `null`, so the Cancel panel + confirmation gate never render at
    //    all — there is no button to test the gate on.
    // 2. Even if the panel DID render and `POST /api/billing/cancel` fired:
    //    apps/worker/src/routes/billing.ts checks
    //    `resolveBillingConfig(c.env) === null` FIRST and returns
    //    `503 not_configured` before it ever calls
    //    `cancelSubscriptionAtPeriodEnd` (the function that would produce
    //    the `409 no_subscription` the phase handoff describes) — so the
    //    "honest reachable path" is actually a 503, not a 409, contradicting
    //    the handoff's assumption. Documenting this as a real correction
    //    rather than asserting the wrong status code to force a green test.
    // The underlying `cancelSubscriptionAtPeriodEnd` no_subscription/
    // already_canceled/already_scheduled outcomes ARE covered — see
    // packages/billing/src/cancellation.test.ts.
    test.skip(true, 'Cancel panel is unreachable without a Paddle-backed subscription row locally');
  });

  test('print: #billing-print-area is the only visible content under print media', async ({
    page,
  }) => {
    test.skip(email === '', 'depends on the account created in the first test of this file');
    await login(page, email, TEST_PASSWORD);
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('#billing-print-area')).toBeVisible();
    await expect(page.locator('#billing-print-area')).toContainText('No active subscription.');
    // `visibility: hidden` (not `display: none`) is how the print
    // stylesheet hides everything else (styles/app.css `@media print`) — every
    // element outside `#billing-print-area`, including chrome that would
    // otherwise always render, must report as not-visible.
    await expect(page.locator('.app-header')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Company profile' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Delete account' })).toBeHidden();

    await page.emulateMedia({ media: 'screen' });
  });

  test('past-due notice and reactivate flow: SKIPPED — unreachable without a Paddle-backed subscription; covered at the unit level instead', () => {
    // `SubscriptionRequiredNotice` (apps/web/src/components/
    // SubscriptionRequiredNotice.tsx) and the `BillingActiveSubscription`
    // past-due banner/reactivate button both require
    // `billing.subscription.paymentState` in `('past_due' | 'unpaid')` or
    // `cancelAtPeriodEnd === true` — states this local stack can never
    // produce (same reasoning as the cancel-flow skip above). This repo has
    // no jsdom/React-Testing-Library test project (root vitest.config.ts is
    // `environment: 'node'` only, apps/web/src has zero `*.test.tsx`
    // files) — adding one is a test-infra change out of scope for this E2E
    // pass, not something to bolt on silently. The reachable, already-run
    // coverage for the underlying state machine is:
    // - packages/billing/src/entitlement.test.ts (`reasonFor` grace-window
    //   logic: past_due active-within-grace, expired-past-grace, canceled,
    //   unpaid — the exact `entitlement.reason` values
    //   `SubscriptionRequiredNotice` branches on)
    // - packages/billing/src/reactivation.test.ts (`reactivateSubscription`
    //   no_subscription/already_canceled/not_scheduled/reactivated outcomes
    //   — the exact `POST /api/billing/reactivate` response shapes
    //   Settings.tsx's `describeBillingError`/`reactivateRequiresCheckout`
    //   branch on)
    test.skip(
      true,
      'unreachable without a Paddle-backed subscription; see packages/billing unit tests',
    );
  });
});

/**
 * M2 leftover (template-conversion audit "402/success e2e assertions").
 *
 * The 402 paywall is normally unreachable locally: entitlement enforcement
 * defaults off, and with no Paddle there is no subscription to satisfy it
 * when on. The double-gated test hook POST /api/test/entitlement-enforced
 * (local-only, session-gated) flips the flag for exactly the window of the
 * first test — the flag is GLOBAL, so it is always reset in `finally`
 * before the test ends, and this file runs serially.
 */
test.describe('billing: 402 paywall and checkout-success page', () => {
  test.describe.configure({ mode: 'serial' });

  test('entitlement enforced without a subscription: the feed renders the designed paywall, not an error', async ({
    page,
  }) => {
    await bootstrapOnboardedUserWithMatches(page, 'Paywall 402');
    const enable = await page.request.post('/api/test/entitlement-enforced', {
      data: { enabled: true },
    });
    expect(enable.ok()).toBe(true);
    try {
      await page.goto('/app');
      await expect(
        page.getByRole('heading', {
          name: 'Your profile is ready — a subscription activates your feed.',
        }),
      ).toBeVisible();
      // The designed paywall state (F17), never the generic failure copy —
      // and no feed content or KPI strip behind it.
      await expect(page.getByText('Could not load your feed.')).toHaveCount(0);
      await expect(page.locator('article.tender-card')).toHaveCount(0);
      await expect(page.locator('.feed-stats')).toHaveCount(0);
    } finally {
      const disable = await page.request.post('/api/test/entitlement-enforced', {
        data: { enabled: false },
      });
      expect(disable.ok()).toBe(true);
    }
    // Flag reset: the same session's feed works again.
    await page.goto('/app');
    await expect(page.getByRole('tab', { name: "Today's matches" })).toBeVisible();
  });

  test('checkout success: confirmed state renders the plan and price from the API response (stubbed)', async ({
    page,
  }) => {
    await bootstrapOnboardedUserWithMatches(page, 'Checkout Confirmed');
    // Local stack has no Paddle, so a real subscription row can never exist.
    // Stubbing GET /api/billing/status at the network layer tests the PAGE's
    // real rendering contract against the documented response shape — the
    // shape itself is pinned server-side by packages/billing tests.
    await page.route('**/api/billing/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entitlement: { active: true, reason: 'active' },
          subscription: {
            plan: 'standard',
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodEndAt: Date.now() + 30 * 86_400_000,
            price: {
              amountMinorUnits: 4900,
              currency: 'EUR',
              interval: 'month',
              taxInclusive: true,
            },
            paymentState: 'active',
          },
          foundingAvailable: false,
        }),
      }),
    );
    await page.goto('/app/billing/success');
    await expect(page.getByRole('heading', { name: "You're subscribed" })).toBeVisible();
    // Plan and price come from the response, never the URL (the page's rule 1).
    await expect(page.getByText('Standard plan')).toBeVisible();
    await expect(page.getByText(/€49(\.00)?\s*\/\s*month incl\. VAT/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to your feed' })).toBeVisible();
  });

  test('checkout success: with no subscription the poll exhausts into the honest still-activating state', async ({
    page,
  }) => {
    // Real server, no stub: /api/billing/status returns subscription: null
    // every attempt, so the page must land on "Still activating" — never a
    // failure message, never a fabricated confirmation. The poll runs ~15s
    // (SUBSCRIPTION_POLL_DELAYS_MS), so give the final assertion room.
    test.slow();
    await bootstrapOnboardedUserWithMatches(page, 'Checkout NotYet');
    await page.goto('/app/billing/success');
    await expect(page.getByRole('heading', { name: 'Completing your subscription' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Still activating' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole('link', { name: 'Check billing settings' })).toBeVisible();
  });
});
