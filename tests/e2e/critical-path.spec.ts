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
    // Fix for F12/R1 (docs/redesign/ux-strategy.md §1.3): a new user with
    // no organization yet is routed straight to /onboarding — never
    // dumped on /app to hit the feed's 403 dead-end (the single worst
    // moment in the product before this fix).
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole('heading', { name: "Let's set up your scoring profile" }),
    ).toBeVisible();
  });

  test('onboarding: create workspace, apply preset, edit CPV + keywords, add capability + certification, complete', async () => {
    await page.goto('/onboarding');

    // Welcome (Company phase, screen 1 of 3) — no API call, no Back/Skip.
    await expect(
      page.getByRole('heading', { name: "Let's set up your scoring profile" }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Get started' }).click();

    // Create workspace (Company phase, screen 2 of 3).
    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    // Company basics (Company phase, screen 3 of 3).
    await expect(page.getByRole('heading', { name: 'Tell us about your company' })).toBeVisible();
    await page.getByLabel('Company name').fill('E2E Critical Path Consulting');
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Start from a preset (Coverage phase, screen 1 of 4).
    await expect(page.getByRole('heading', { name: 'Start from a preset' })).toBeVisible();
    await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // CPV codes (Coverage phase, screen 2 of 4 — NEVER skippable). Preset
    // codes are pre-selected; edit by adding the exact CPV of demo lot 1
    // (72150000) so it's guaranteed to be scored.
    await expect(
      page.getByRole('heading', { name: 'Which CPV codes describe your work?' }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /79417000/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
    await page.getByLabel('Add another 8-digit CPV code').fill('72150000');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    // Live scope-overlap indicator (fix for F15/§3.4) — non-blocking, shown
    // before the user commits, not only at the end of the wizard.
    await expect(page.locator('.ob-scope-indicator--ok')).toHaveText(/5 of your 5 codes/);
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Countries (Coverage phase, screen 3 of 4) — skip.
    await expect(
      page.getByRole('heading', { name: "Which countries' opportunities do you want to see?" }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Value & deadline (Coverage phase, screen 4 of 4) — skip.
    await expect(
      page.getByRole('heading', { name: 'What contract value and timing work for you?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Keywords (Signals phase, screen 1 of 3) — preset keywords pre-filled;
    // edit by adding one more.
    await expect(
      page.getByRole('heading', { name: 'What keywords describe the work you want?' }),
    ).toBeVisible();
    await expect(page.getByText('penetration testing')).toBeVisible();
    await page.getByLabel('Add a keyword').fill('cyber security services');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Capabilities & certifications (Signals phase, screen 2 of 3) — two
    // "Add" buttons on this screen; target each by proximity to its own
    // input, not by role name alone.
    await expect(
      page.getByRole('heading', { name: 'Capabilities & certifications' }),
    ).toBeVisible();
    await page.locator('#capability-input').fill('Critical infrastructure audits');
    await page.locator('#capability-input').locator('xpath=following-sibling::button[1]').click();
    await expect(page.getByText('Critical infrastructure audits')).toBeVisible();
    await page.getByLabel('Certification').selectOption('ISO_27001');
    await page.locator('#cert-code').locator('xpath=following-sibling::button[1]').click();
    await expect(page.getByText('ISO_27001', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Exclusions (Signals phase, screen 3 of 3) — skip.
    await expect(
      page.getByRole('heading', { name: 'Anything you want to exclude?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Digest (Review phase, screen 1 of 3) — skip.
    await expect(page.getByRole('heading', { name: 'Your daily digest' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Review (Review phase, screen 2 of 3) — the reconciliation screen: the
    // preset-prefilled-but-never-explicitly-saved Company profile row must
    // read as "will be saved when you finish", never as empty/lost (fix for
    // F14 — the preset-skip data-loss defect).
    await expect(page.getByRole('heading', { name: 'Review your scoring profile' })).toBeVisible();
    await expect(page.getByText('10 keywords')).toBeVisible();

    // Finish — the preset's CPV divisions (72/48/79) overlap the default
    // ingestion scope, so the scope-overlap warning must be absent.
    await page.getByRole('button', { name: 'Finish setup' }).click();
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

  test('tender detail: opens as a slide-over over the feed, score breakdown, TED link, save', async () => {
    const firstCardLink = page.locator('article.tender-card h3 a').first();
    firstMatchHref = await firstCardLink.getAttribute('href');
    await firstCardLink.click();
    // The sheet is a real route, not a state-only overlay: the URL changes,
    // so the tender stays linkable and Back closes it.
    await expect(page).toHaveURL(/\/app\/tenders\//);

    // Everything below is scoped to the dialog. The feed stays mounted
    // underneath with its own Save buttons and its own `role="status"`
    // region, so unscoped locators would match two nodes and fail strict
    // mode — a fair reflection of the fact that both are really on the page.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(page.locator('article.tender-card').first()).toBeVisible();

    // Summary lands first; the breakdown lives behind the Score tab.
    await sheet.getByRole('tab', { name: 'Score' }).click();
    await expect(sheet.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    await expect(sheet.getByRole('table', { name: 'Score component breakdown' })).toBeVisible();
    const rows = sheet.locator('table:has(caption:has-text("Score component breakdown")) tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);

    await sheet.getByRole('tab', { name: 'Summary' }).click();
    const tedLink = sheet.getByRole('link', { name: 'Open original TED notice' });
    await expect(tedLink).toBeVisible();
    const href = await tedLink.getAttribute('href');
    expect(href).toMatch(/^https:\/\/example\.invalid\/ted\/notice\//);
    await expect(tedLink).toHaveAttribute('target', '_blank');
    await expect(tedLink).toHaveAttribute('rel', 'noopener noreferrer');

    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('button', { name: 'Saved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The card underneath must not still claim the tender is unsaved: the
    // sheet publishes the change so the feed patches the row in place
    // (apps/web/src/lib/match-events.ts).
    await expect(
      page.locator('article.tender-card').first().getByRole('button', { name: 'Saved' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('tender detail: Escape closes the sheet and returns to the feed URL', async () => {
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/app$/);
    // The feed was never unmounted, so its cards are still there.
    await expect(page.locator('article.tender-card').first()).toBeVisible();
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
    // Two nodes now render this text by design (docs/redesign/
    // app-interface-spec.md §8.2): the accessible `role="status"` live
    // region (visually hidden, the source of truth for AT) and its
    // `aria-hidden` visual toast twin. Target the live region — it's the
    // one guaranteed to be unique and is the semantically correct assertion
    // for a status message.
    await expect(page.getByRole('status')).toHaveText('Ignored.');

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
    // See the toast-selector note above — target the accessible live region.
    await expect(page.getByRole('status')).toHaveText('Thanks — feedback recorded.');
  });

  test('settings: keyword cap error path (51 keywords -> 422)', async () => {
    // This step drives 55 sequential add-keyword UI round-trips before the
    // cap fires; it legitimately runs long, especially on a loaded CI/sandbox
    // box, so give it the tripled "slow" budget instead of the 30s default.
    test.slow();
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Company profile' })).toBeVisible();

    const input = page.getByLabel('Add keyword');
    // PR #58 wrapped the keyword input in the Combobox's `.combobox__field`
    // div, so the input no longer HAS a following-sibling button — the old
    // xpath resolved to zero elements and this test hung from 2026-08-19 on
    // (E2E is not in CI yet, so nothing caught it). Target the add-row's
    // real "Add" button instead.
    const addButton = page
      .locator('.combobox-add-row', { has: page.locator('#new-keyword') })
      .getByRole('button', { name: 'Add', exact: true });
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
