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
    await expect(page.getByRole('heading', { name: 'Who is bidding?' })).toBeVisible();
  });

  test('onboarding: five steps — workspace, preset, scope, fit, review', async () => {
    await page.goto('/onboarding');

    // The 12-screen assistant is now five steps. Each screen body still
    // exists — they are grouped, not rewritten — so the per-section headings
    // below are the same ones, demoted under each step's own <h1>.

    // Step 1 — Company: naming the workspace is what creates the org, so the
    // create and the profile save happen behind one Continue.
    await expect(page.getByRole('heading', { name: 'Who is bidding?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tell us about your company' })).toBeVisible();
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByLabel('Company name').fill('E2E Critical Path Consulting');
    await page.getByRole('button', { name: 'Create workspace & continue' }).click();

    // Step 2 — Starting point.
    await expect(
      page.getByRole('heading', { name: 'What line of work are you in?' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Step 3 — Scope: CPV and countries together. Preset codes are
    // pre-selected; add the exact CPV of demo lot 1 (72150000) so it is
    // guaranteed to be scored.
    await expect(page.getByRole('heading', { name: 'What you sell, and where.' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Which CPV codes describe your work?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: "Which countries' opportunities do you want to see?" }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /79417000/ })).toBeChecked();
    // There is no Skip anywhere in the wizard now: a step covers several
    // resources, so leaving a field blank and continuing IS the skip.
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
    await page.getByLabel('Add another 8-digit CPV code').fill('72150000');
    await page.getByRole('button', { name: 'Add CPV code' }).click();
    // Live scope-overlap indicator (fix for F15/§3.4) — non-blocking, shown
    // before the user commits, not only at the end of the wizard.
    await expect(page.locator('.ob-scope-indicator--ok')).toHaveText(/5 of your 5 codes/);
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Step 4 — Fit: value, keywords, capabilities and exclusions on one step.
    await expect(
      page.getByRole('heading', { name: 'What counts as a real opportunity.' }),
    ).toBeVisible();
    // The preset seeds "penetration testing" as BOTH a keyword and a
    // capability, and those two lists now sit on the same step — so this has
    // to say which list it means.
    await expect(
      page.getByRole('button', { name: 'Remove keyword penetration testing' }),
    ).toBeVisible();
    await page.getByLabel('Add a keyword').fill('cyber security services');
    await page.getByRole('button', { name: 'Add keyword' }).click();
    // Grouping several sections onto one step put four bare "Add" buttons
    // side by side, so each now carries an accessible name saying what it
    // adds — better for screen readers, and unambiguous here.
    await page.locator('#capability-input').fill('Critical infrastructure audits');
    await page.getByRole('button', { name: 'Add capability' }).click();
    await expect(page.getByText('Critical infrastructure audits')).toBeVisible();
    await page.getByLabel('Certification', { exact: true }).selectOption('ISO_27001');
    await page.getByRole('button', { name: 'Add certification' }).click();
    await expect(page.getByText('ISO_27001', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // Step 5 — Digest & review. The reconciliation rows still matter: a
    // preset-prefilled resource must read as saved or "will be saved", never
    // as empty/lost (fix for F14 — the preset-skip data-loss defect).
    await expect(page.getByRole('heading', { name: 'How you hear about it.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your daily digest' })).toBeVisible();
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

  test('feed: KPI strip renders and the sort control genuinely reorders', async () => {
    // KPI tiles: presence and labels only — the numbers depend on the wall
    // clock (e.g. "Closing ≤ 7 days" is 0 until a demo deadline is near),
    // so asserting exact values would make this test rot with time.
    const statTerms = page.locator('.feed-stats dt');
    await expect(statTerms).toHaveCount(4);
    await expect(statTerms.nth(0)).toHaveText('New today');
    await expect(statTerms.nth(1)).toHaveText('Closing ≤ 7 days');

    // The demo seed gives deterministic, DISTINCT orders: values are
    // 250k/180k/150k and deadlines are Sep 15 vs Oct 1 — so each sort has a
    // known first card regardless of what the engine scored them.
    const firstTitle = page.locator('article.tender-card h3 a').first();
    await page.getByLabel('Sort').selectOption('value');
    await expect(firstTitle).toHaveText('Security monitoring software licences');
    await page.getByLabel('Sort').selectOption('deadline');
    await expect(firstTitle).toHaveText('Penetration testing and security assessment services');
    await page.getByLabel('Sort').selectOption('fit');
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

  test('settings: validation layer — bad inputs get field-adjacent errors, NUTS and timezone round-trip', async () => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Company profile' })).toBeVisible();

    // A malformed CPV code is rejected before any network round-trip.
    await page.getByLabel('Add CPV code').fill('123');
    await page
      .locator('.combobox-add-row', { has: page.locator('#new-cpv') })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    await expect(page.getByText('CPV codes are 8 digits (for example 72220000).')).toBeVisible();

    // An inverted value range flags the field pair, the page-level issues
    // banner, and the nav dot — and clears when the range is fixed.
    await page.getByLabel('Minimum contract value (EUR)').fill('500000');
    await page.getByLabel('Maximum contract value (EUR)').fill('10000');
    await expect(page.getByText('Minimum value must not exceed the maximum.')).toBeVisible();
    await expect(page.getByText(/to fix in your matching profile/)).toBeVisible();
    await page.getByLabel('Maximum contract value (EUR)').fill('900000');
    await expect(page.getByText(/to fix in your matching profile/)).not.toBeVisible();

    // NUTS entry: shape-checked, uppercased, saved through the same
    // geographies endpoint (kind preferred_nuts).
    await page.getByLabel('Add NUTS region code').fill('x');
    const nutsAdd = page
      .locator('.form-field.inline', { has: page.locator('#new-nuts') })
      .getByRole('button', { name: 'Add', exact: true });
    await nutsAdd.click();
    await expect(page.getByText(/NUTS codes are a 2-letter country/)).toBeVisible();
    await page.getByLabel('Add NUTS region code').fill('de30');
    await nutsAdd.click();
    await expect(page.locator('.chip-list li', { hasText: 'DE30' })).toBeVisible();
    await page.getByRole('button', { name: 'Save geographies' }).click();
    // Target the visually-hidden live region, not getByRole('status') — the
    // issues banner is also role=status, so the role query can be ambiguous.
    await expect(page.locator('p[role="status"].visually-hidden-status')).toHaveText(
      'Geographies saved.',
    );

    // Digest timezone select persists through save.
    await page.getByLabel('Timezone').selectOption('Europe/Berlin');
    await page.getByRole('button', { name: 'Save digest preferences' }).click();
    await expect(page.locator('p[role="status"].visually-hidden-status')).toHaveText(
      'Digest preferences saved.',
    );
    await page.reload();
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/Berlin');
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
