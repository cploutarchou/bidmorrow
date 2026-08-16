/**
 * Phase 12 stage A — critical-path E2E: signup through the full onboarding
 * wizard, feed, tender detail, settings, and logout/login, against a real
 * `wrangler dev` (Worker + D1 + built SPA) with the demo seed
 * (`scripts/seed-demo.sql`) applied by `scripts/e2e-webserver.sh`.
 *
 * One `test.describe.serial` block sharing a single browser context/page —
 * each step depends on state the previous step created (the signed-up
 * account, the created org, the onboarding wizard's in-progress state, the
 * scored matches). `playwright.config.ts` runs this file with `workers: 1`
 * so it never races another spec file's writes to the same seeded worker.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, scoreNow, signUpAndVerify, TEST_PASSWORD, uniqueEmail } from './helpers';

test.describe.serial('critical path: signup -> onboarding -> feed -> detail -> settings', () => {
  let context: BrowserContext;
  let page: Page;
  const email = uniqueEmail('critical-path');
  const orgName = `E2E Critical Path Org ${String(Date.now())}`;
  let firstMatchHref: string | null = null;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('signup, mailbox capture, verification link, login', async () => {
    await signUpAndVerify(page, { name: 'E2E Critical Path', email, password: TEST_PASSWORD });
    await login(page, email, TEST_PASSWORD);
    // No org yet -> feed 403s with the onboarding prompt, not a crash.
    await expect(page.getByText('Complete onboarding to see your feed.')).toBeVisible();
  });

  test('onboarding: create org, apply preset, edit CPV + keywords, add capability + certification, complete', async () => {
    await page.goto('/onboarding');

    // Step 0: organization
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText('Step 2 of 10: Company basics')).toBeVisible();

    // Step 1: company basics — apply the cybersecurity consultancy preset.
    await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
    await page.getByLabel('Company name').fill('E2E Critical Path Consulting');
    await page.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.getByText('Step 3 of 10: CPV codes')).toBeVisible();

    // Step 2: CPV codes — preset codes are pre-selected; edit by adding the
    // exact CPV of demo lot 1 (72150000) so it's guaranteed to be scored.
    await expect(page.getByRole('checkbox', { name: '79417000' })).toBeChecked();
    await page.getByLabel('Add another 8-digit CPV code').fill('72150000');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.getByText('Step 4 of 10: Geographies')).toBeVisible();

    // Step 3: geographies — skip (not required for scoring to run).
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText('Step 5 of 10: Keywords')).toBeVisible();

    // Step 4: keywords — preset keywords pre-filled; edit by adding one more.
    await expect(page.getByText('penetration testing')).toBeVisible();
    await page.getByLabel('Add a keyword').fill('cyber security services');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.getByText('Step 6 of 10: Capabilities & certifications')).toBeVisible();

    // Step 5: capabilities + certifications (two "Add" buttons on this step
    // — target each by proximity to its own input, not by role name alone).
    await page.locator('#capability-input').fill('Critical infrastructure audits');
    await page.locator('#capability-input').locator('xpath=following-sibling::button[1]').click();
    await expect(page.getByText('Critical infrastructure audits')).toBeVisible();
    await page.getByLabel('Certification').selectOption('ISO_27001');
    await page.locator('#cert-code').locator('xpath=following-sibling::button[1]').click();
    await expect(page.getByText('ISO_27001', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.getByText('Step 7 of 10: Exclusions')).toBeVisible();

    // Steps 6-8: exclusions, value/deadline, digest — skip.
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText('Step 8 of 10: Value & deadline')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText('Step 9 of 10: Digest')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText('Step 10 of 10: Review')).toBeVisible();

    // Step 9: finish — the preset's CPV divisions (72/48/79) overlap the
    // default ingestion scope, so the scope-overlap warning must be absent.
    await page.getByRole('button', { name: 'Finish onboarding' }).click();
    await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
    await expect(page.locator('.scope-warning')).toHaveCount(0);

    await page.getByRole('button', { name: 'Go to your feed' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('feed: score-now hook produces matches for the seeded demo notices', async () => {
    await scoreNow(page.request);
    await page.reload();
    await expect(page.getByText('Loading your feed…')).toHaveCount(0);
    const cards = page.locator('article.tender-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tender detail: score breakdown, TED link, save', async () => {
    const firstCardLink = page.locator('article.tender-card h3 a').first();
    firstMatchHref = await firstCardLink.getAttribute('href');
    await firstCardLink.click();
    await expect(page).toHaveURL(/\/app\/tenders\//);

    await expect(page.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Score component breakdown' })).toBeVisible();
    const rows = page.locator('table:has(caption:has-text("Score component breakdown")) tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);

    const tedLink = page.getByRole('link', { name: 'Open original TED notice' });
    await expect(tedLink).toBeVisible();
    const href = await tedLink.getAttribute('href');
    expect(href).toMatch(/^https:\/\/example\.invalid\/ted\/notice\//);
    await expect(tedLink).toHaveAttribute('target', '_blank');
    await expect(tedLink).toHaveAttribute('rel', 'noopener noreferrer');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('feed: saved item appears in the Saved tab', async () => {
    await page.goto('/app');
    await page.getByRole('tab', { name: 'Saved' }).click();
    await expect(page.locator('article.tender-card')).toHaveCount(1);
  });

  test('feed: ignoring an item moves it to the Ignored tab', async () => {
    await page.getByRole('tab', { name: "Today's matches" }).click();
    // Retrying assertion, not an instant count() — the tab switch refetches
    // and re-renders the list, and an instant count can race the refetch.
    const ignoreButtons = page.getByRole('button', { name: 'Ignore', exact: true });
    await expect(ignoreButtons.first()).toBeVisible();
    await ignoreButtons.first().click();
    await expect(page.getByText('Ignored.')).toBeVisible();

    await page.getByRole('tab', { name: 'Ignored' }).click();
    await expect(page.locator('article.tender-card')).toHaveCount(1);
  });

  test('tender detail: not-useful feedback with a reason', async () => {
    test.skip(firstMatchHref === null, 'no tender detail link captured earlier');
    await page.goto(firstMatchHref as string);
    await page.getByRole('button', { name: 'Not useful' }).click();
    await page.getByRole('checkbox', { name: 'Wrong CPV / category' }).check();
    await page.getByLabel('Additional comment (optional, max 500 characters)').fill('E2E feedback');
    await page.getByRole('button', { name: 'Submit feedback' }).click();
    await expect(page.getByText('Thanks — feedback recorded.')).toBeVisible();
  });

  test('settings: keyword cap error path (51 keywords -> 422)', async () => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Company profile' })).toBeVisible();

    const input = page.getByLabel('Add keyword');
    const addButton = page.locator('#new-keyword').locator('xpath=following-sibling::button[1]');
    // Existing keywords from onboarding (preset + 1 manual) plus these must
    // exceed the 50-item cap (docs: COMPANY_KEYWORDS_CAP = 50).
    for (let i = 0; i < 55; i += 1) {
      await input.fill(`e2e-cap-keyword-${String(i)}`);
      await addButton.click();
    }
    await page.getByRole('button', { name: 'Save keywords' }).click();
    await expect(page.getByText(/reached the limit of 50 items for this list/)).toBeVisible();
  });

  test('settings: billing renders the honest no-subscription empty state', async () => {
    await expect(page.getByText('No active subscription.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Subscribe — Standard/ })).toBeVisible();
  });

  test('settings: account deletion blocked as sole org owner (409)', async () => {
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Permanently delete my account' }).click();
    await expect(page.getByText(/sole owner of an organization/)).toBeVisible();
  });

  test('logout, then login again', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await login(page, email, TEST_PASSWORD);
    await expect(
      page.getByRole('heading', { name: 'What should you investigate today?' }),
    ).toBeVisible();
  });
});
