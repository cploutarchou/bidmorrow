/**
 * Phase 12 stage A — shared E2E helpers. Every helper drives the real UI
 * (never calls `/api/*` directly to fabricate state) EXCEPT the two
 * double-gated test-only hooks this phase adds specifically so E2E doesn't
 * have to wait on real email delivery or a queued scoring pass:
 * `GET /api/test/mailbox` (reads the captured verification link) and
 * `POST /api/test/score-now` (runs the real scoring engine synchronously).
 * Both 404 outside `E2E_TEST_HOOKS=true` — see
 * `apps/worker/src/routes/test-hooks.ts`.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const TEST_PASSWORD = 'correct horse battery staple 1!';

let emailCounter = 0;

/** A fresh, unique .example address per test run (never a real inbox). */
export function uniqueEmail(prefix = 'e2e'): string {
  emailCounter += 1;
  return `${prefix}-${Date.now()}-${String(emailCounter)}@example.test`;
}

interface CapturedMail {
  readonly kind: 'verification' | 'password_reset';
  readonly to: string;
  readonly url: string;
  readonly sentAt: number;
}

/** Polls the test-only mailbox hook until a mail of the given kind for `to` shows up. */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  kind: CapturedMail['kind'],
): Promise<CapturedMail> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`/api/test/mailbox?to=${encodeURIComponent(to)}`);
    expect(response.status(), 'test mailbox hook must be reachable (E2E_TEST_HOOKS=true)').toBe(
      200,
    );
    const body = (await response.json()) as { mails: CapturedMail[] };
    const found = body.mails.find((mail) => mail.kind === kind);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${kind} mail captured for ${to} after polling`);
}

/** Signs up via the real UI, reads the verification link from the test mailbox, and follows it. */
export async function signUpAndVerify(
  page: Page,
  args: { name: string; email: string; password: string },
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill(args.name);
  await page.getByLabel('Work email').fill(args.email);
  await page.getByLabel('Password').fill(args.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const mail = await waitForMail(page.request, args.email, 'verification');
  await page.goto(mail.url);
  await expect(page).toHaveURL(/\/verify-email/);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

/** Logs in via the real UI form. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** Triggers the real scoring engine synchronously against every seeded/ingested lot. */
export async function scoreNow(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/test/score-now');
  expect(response.status(), 'score-now test hook must succeed').toBe(200);
}

/**
 * A signed-up, verified, logged-in, onboarded-with-matches account, for
 * specs (accessibility, keyboard traversal) that need real authenticated
 * pages but don't themselves exercise the onboarding wizard's UI in detail
 * (`critical-path.spec.ts` covers that). Applies the cybersecurity-
 * consultancy preset unedited (its CPV divisions overlap the default
 * ingestion scope and the seeded demo lots), skips every optional step, then
 * runs `scoreNow` so the feed/tender-detail pages have real content to
 * render for the accessibility scan.
 */
export async function bootstrapOnboardedUserWithMatches(
  page: Page,
  orgNamePrefix: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(orgNamePrefix.toLowerCase().replace(/\s+/g, '-'));
  await signUpAndVerify(page, { name: `${orgNamePrefix} User`, email, password: TEST_PASSWORD });
  await login(page, email, TEST_PASSWORD);

  await page.goto('/onboarding');
  await page.getByLabel('Organization name').fill(`${orgNamePrefix} ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
  await page.getByRole('button', { name: 'Save & continue' }).click();
  // CPV codes step MUST be explicitly saved (not skipped) — "Skip" never
  // calls saveCpv(), and without a persisted org CPV preference the
  // division pre-filter (`scoreLotsForOrgs`) drops every pair with no match
  // row at all, leaving the feed empty. The preset's codes are already
  // pre-selected; saving them as-is is enough for the seeded demo lots to
  // produce matches.
  await page.getByRole('button', { name: 'Save & continue' }).click();
  // Remaining optional steps (geographies, keywords, capabilities/certs,
  // exclusions, value/deadline, digest) — skip.
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(page.getByText('Step 10 of 10: Review')).toBeVisible();
  await page.getByRole('button', { name: 'Finish onboarding' }).click();
  await expect(page.locator('.scope-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go to your feed' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await scoreNow(page.request);
  await page.reload();
  await expect(page.locator('article.tender-card').first()).toBeVisible();

  return { email };
}
