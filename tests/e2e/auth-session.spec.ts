/**
 * E2E coverage for the auth/session-flow-polish work: `ProtectedRoute`'s
 * `?returnTo=` redirect (apps/web/src/components/ProtectedRoute.tsx),
 * `useRedirectIfAuthenticated`'s no-flash guard on /login and /signup
 * (apps/web/src/lib/use-redirect-if-authenticated.ts), the shared 401
 * re-sync path (apps/web/src/lib/api.ts `setUnauthorizedHandler` +
 * apps/web/src/lib/auth-context.tsx), and /verify-email staying reachable
 * with no session.
 *
 * One `test.describe.serial` block sharing a single browser context/page —
 * same idiom as critical-path.spec.ts — signing up/logging in once and
 * reusing that account across the redirect scenarios that need a real
 * session, so the suite doesn't pay for N separate signup+verify round
 * trips.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, scoreNow, signUpAndVerify, TEST_PASSWORD, uniqueEmail } from './helpers';

test.describe.serial('auth: redirects, session expiry, verify-email', () => {
  let context: BrowserContext;
  let page: Page;
  const email = uniqueEmail('auth-session');
  const orgName = `E2E Auth Session Org ${String(Date.now())}`;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('unauthenticated visitor hitting /app is redirected to /login?returnTo=/app, then lands on /app after login', async () => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    // First-time login for this account: no organization yet, so
    // `resolvePostAuthDestination`'s explicit `returnTo` still wins over
    // the onboarding-vs-feed profile probe (ProtectedRoute.tsx docblock,
    // R4) — it must land on the ORIGINALLY requested /app, not /onboarding.
    await signUpAndVerify(page, { name: 'Auth Session User', email, password: TEST_PASSWORD });
    await page.goto(`/login?returnTo=${encodeURIComponent('/app')}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('/verify-email renders normally for a brand-new signup — no redirect away (no session pre-verification)', async ({
    page: freshPage,
  }) => {
    // Deliberately uses the FIXTURE-provided `page` (a fresh, unauthenticated
    // browser context Playwright creates per test regardless of `serial`
    // mode) rather than this file's shared `page` closure variable — by this
    // point in the file the shared page/context is already authenticated as
    // the step-1 account, and `useRedirectIfAuthenticated` would correctly
    // bounce an authenticated visit to /signup straight to /onboarding,
    // which is real app behavior but not what THIS scenario (a genuinely
    // new, logged-out signup) needs to exercise.
    const freshEmail = uniqueEmail('auth-session-verify');
    await freshPage.goto('/signup');
    await freshPage.getByLabel('Full name').fill('Verify Flow User');
    await freshPage.getByLabel('Work email').fill(freshEmail);
    await freshPage.getByLabel('Password').fill(TEST_PASSWORD);
    await freshPage.getByRole('button', { name: 'Create account' }).click();
    // Signing up with `requireEmailVerification: true` never creates a
    // session (auth-context.tsx docblock) — the verify-email screen itself
    // must render its real content, not bounce anywhere.
    await expect(freshPage).toHaveURL(/\/verify-email/);
    await expect(freshPage.getByRole('alert')).toHaveCount(0);
    await expect(freshPage.getByText(freshEmail)).toBeVisible();
  });

  test('an authenticated visitor cannot see the /login or /signup forms — no flash', async () => {
    // The shared `page`'s session is ALREADY authenticated from step 1 —
    // calling the `login` helper again here would itself hit the exact bug
    // under test (a `/login` visit while authenticated never renders the
    // form `login()` waits on, so it would hang). Just confirm the session
    // is still live.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/(app|onboarding)$/);

    // Navigating to /login while authenticated must never render the
    // sign-in form at any point — assert the heading/inputs never appear,
    // not just that the URL eventually changes (the "no flash" guarantee
    // useRedirectIfAuthenticated exists for).
    const loginFormAppeared = page
      .getByRole('heading', { name: 'Log in' })
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    await page.goto('/login');
    expect(
      await loginFormAppeared,
      'the /login form must never render for an authenticated visitor',
    ).toBe(false);
    await expect(page).not.toHaveURL(/\/login$/);

    const signupFormAppeared = page
      .getByRole('heading', { name: 'Create your account' })
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    await page.goto('/signup');
    expect(
      await signupFormAppeared,
      'the /signup form must never render for an authenticated visitor',
    ).toBe(false);
    await expect(page).not.toHaveURL(/\/signup$/);
  });

  test('double back-button navigation on /login during an auto-redirect settles on the right URL with no wedge/error', async () => {
    // Best-effort per the phase instruction: this is a race-condition probe,
    // not a strict guarantee. Land on the app first (authenticated), then
    // hit /login twice in a row (simulating a back-button double-nav during
    // the redirect window) and confirm the final state is sane — never
    // stuck on /login, never an error banner.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/(app|onboarding)$/);
    await page.goto('/login');
    await page.goto('/login');
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('session revoked server-side mid-use: the next app API call redirects to /login?returnTo=<path>, and logging back in returns to that path', async () => {
    // A real, fully onboarded account with a scored feed to interact with —
    // reuses the org from step 1's login if it already exists, otherwise
    // onboarding completes it here. Onboarding may already be done from an
    // earlier run of this file... `bootstrapOnboardedUserWithMatches`
    // isn't reused because it creates a brand-new account; this spec
    // deliberately keeps ONE account across the whole file (see the module
    // docblock), so onboarding is driven inline exactly once, only if not
    // already complete.
    await page.goto('/app');
    // The account has no organization yet at this point (test 1 only
    // signed up + logged in, never onboarded) — Feed.tsx's own 403
    // `no_organization` handling client-navigates to /onboarding
    // ASYNCHRONOUSLY, after its feed API call resolves, so `page.url()`
    // read synchronously right after `goto()` is a race: it can still read
    // `/app` for a moment before that navigate fires. Actively WAIT for the
    // redirect (or its absence) instead of sampling the URL once.
    const wentToOnboarding = await page
      .waitForURL(/\/onboarding$/, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (wentToOnboarding) {
      // Five steps, one Continue each (see tests/e2e/helpers.ts).
      await page.getByLabel('Organization name').fill(orgName);
      await page.getByRole('button', { name: 'Create workspace & continue' }).click();
      await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
      await page.getByRole('button', { name: 'Save & continue' }).click();
      await page.getByRole('button', { name: 'Save & continue' }).click();
      await page.getByRole('button', { name: 'Save & continue' }).click();
      await expect(
        page.getByRole('heading', { name: 'Review your scoring profile' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Finish setup' }).click();
      await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
      await page.getByRole('button', { name: 'Go to your feed' }).click();
      await scoreNow(page.request);
      await page.reload();
    }
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('article.tender-card').first()).toBeVisible();

    // Kill the session SERVER-SIDE via Better Auth's real sign-out endpoint
    // (apps/worker/src/auth.test.ts documents the same route) — a genuine
    // revoke, not merely dropping client-side cookies. `page.request`
    // shares the browser context's cookie jar, so the Set-Cookie clear also
    // propagates to `page` itself; the in-memory React `user` state does
    // NOT know yet, matching a real "session expired while a tab sat open"
    // scenario.
    // `page.request` is a raw HTTP client sharing the context's cookie
    // jar — unlike a real in-page `fetch`, it does not automatically send
    // an `Origin` header, which Better Auth requires on state-changing
    // requests (apps/worker/src/auth.test.ts `STATE_CHANGING_HEADERS`
    // documents the same requirement for its own raw-fetch sign-out call).
    const signOutResponse = await page.request.post('/api/auth/sign-out', {
      headers: { origin: 'http://127.0.0.1:8787' },
      data: {},
    });
    expect(signOutResponse.ok()).toBe(true);

    // Trigger a real app API call from the still-mounted page (not a
    // reload) — the "Save" button's `POST /api/tenders/.../save` — so the
    // shared 401 handler (lib/api.ts `setUnauthorizedHandler`) does the
    // resync and `ProtectedRoute` reacts to `user` flipping to `null`.
    const saveButton = page.locator('article.tender-card').first().getByRole('button', {
      name: 'Save',
      exact: true,
    });
    await saveButton.click();

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await login(page, email, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('forgot password: failure modes stay separated', () => {
  test('a network failure shows a visible error, never the sent confirmation', async ({ page }) => {
    // The original implementation had no catch: an unreachable server left
    // the form sitting silent while the rejection escaped unhandled. The
    // page must now say that NOTHING was sent — showing the privacy
    // confirmation here would leave someone waiting for an email that is
    // not coming.
    await page.route('**/api/auth/request-password-reset', (route) => route.abort());
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert')).toHaveText(/nothing was sent/i);
    await expect(page.getByText(/reset link has been sent/)).toHaveCount(0);
  });

  test('pre-submit validation catches an invalid email without a request', async ({ page }) => {
    let requested = false;
    await page.route('**/api/auth/request-password-reset', (route) => {
      requested = true;
      return route.continue();
    });
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert')).toHaveText(/does not look like an email/i);
    expect(requested).toBe(false);
  });

  test('the sent state offers send-again and reports the re-send', async ({ page }) => {
    await page.route('**/api/auth/request-password-reset', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toHaveText(/reset link has been sent/);
    await page.getByRole('button', { name: 'Send it again' }).click();
    await expect(page.getByRole('status')).toHaveText(/Sent again/);
  });
});

test.describe('reset password: the confirmation must match before anything is sent', () => {
  // Both tests intercept the endpoint, so nothing reaches Better Auth and no
  // account state changes; the token value is therefore never checked. What
  // is under test is the form in front of it, which shipped with a single
  // password input and no way to catch a typo before the only single-use
  // link had been spent.
  const RESET_URL = '/reset-password?token=e2e-not-a-real-token';

  test('a mismatched confirmation blocks the request and says so in words', async ({ page }) => {
    let requested = false;
    await page.route('**/api/auth/reset-password', (route) => {
      requested = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(RESET_URL);
    await page.getByLabel('New password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm new password').fill(`${TEST_PASSWORD} typo`);
    await page.getByRole('button', { name: 'Set new password' }).click();

    await expect(page.getByRole('alert')).toHaveText(/do not match/i);
    // Never colour alone: the field is flagged to assistive technology too.
    await expect(page.getByLabel('Confirm new password')).toHaveAttribute('aria-invalid', 'true');
    expect(requested, 'a mismatch must not spend the single-use reset token').toBe(false);
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test('matching passwords send exactly the newPassword and token, never the confirmation', async ({
    page,
  }) => {
    let body: unknown = null;
    await page.route('**/api/auth/reset-password', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(RESET_URL);
    await page.getByLabel('New password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm new password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();

    // The server contract is unchanged, and the reset-done confirmation
    // still rides the navigation state onto /login.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status')).toHaveText(/Password updated/);
    expect(body).toEqual({ newPassword: TEST_PASSWORD, token: 'e2e-not-a-real-token' });
  });
});
