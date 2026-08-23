/**
 * Phase 12 stage A — automated accessibility scans (`@axe-core/playwright`).
 * Asserts zero 'serious'/'critical'-impact violations on the pages listed in
 * the phase instruction. No rule exclusions (the goal stated in the phase
 * instruction) — if a real violation is found, it is reported as a genuine
 * finding (docs/accessibility-review.md), not silenced here.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, TEST_PASSWORD } from './helpers';

interface SeriousViolation {
  readonly id: string;
  readonly impact: string | null | undefined;
  readonly help: string;
  readonly nodes: number;
}

/**
 * QA fix (2026-08-18): WCAG 1.4.3 contrast applies to the settled, static
 * rendering of text — not to a transient mid-transition animation frame —
 * but axe-core has no concept of "wait for animations to finish". The
 * suite-level `reducedMotion: 'reduce'` context option (playwright.config.ts)
 * is meant to keep every animation/transition dead everywhere (the app's own
 * `prefers-reduced-motion: reduce` kill-switch, styles.css), but wasn't
 * reliably re-applied across every client-side SPA navigation in this
 * sandboxed/software-rendered browser — producing an intermittent
 * false-positive `color-contrast` finding on `.cta` buttons caught mid-way
 * through the onboarding `.assistant-screen` `rise-in` mount animation
 * (opacity ramping 0→1: a real but non-representative paint frame, not the
 * shipped, settled UI a user actually reads). Re-asserting the emulation
 * before every scan (a native browser feature, never a stylesheet — the
 * simpler `page.addStyleTag` alternative is itself refused by the app's own
 * CSP, `style-src 'self'`, which is correct and must stay that way) makes
 * every scan deterministically evaluate the true end state.
 */
async function reassertReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function seriousOrCriticalViolations(page: Page): Promise<SeriousViolation[]> {
  await reassertReducedMotion(page);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
}

function expectNoSeriousViolations(violations: SeriousViolation[], where: string): void {
  expect(violations, `${where}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

test.describe('unauthenticated pages', () => {
  test('home', async ({ page }) => {
    await page.goto('/');
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/');
  });

  test('methodology', async ({ page }) => {
    await page.goto('/methodology');
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/methodology');
  });

  test('pricing', async ({ page }) => {
    await page.goto('/pricing');
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/pricing');
  });

  test('login', async ({ page }) => {
    await page.goto('/login');
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/login');
  });

  test('signup', async ({ page }) => {
    await page.goto('/signup');
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/signup');
  });
});

test.describe('authenticated pages', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';

  test('onboarding — every screen (M1 §3.8 gate: axe green on ALL screens)', async ({ page }) => {
    email = `axe-onboarding-${String(Date.now())}@example.test`;
    const { email: createdEmail } = await bootstrapOnboardedUserWithMatchesForAxe(page, email);
    email = createdEmail;
  });

  test('feed (seeded, with matches)', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await expect(page.locator('article.tender-card').first()).toBeVisible();
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/app (feed)');
  });

  // Opening a tender FROM the feed now renders the slide-over sheet over the
  // feed; the same URL visited directly renders the full page. They are two
  // different renderings of the same content, so both are scanned.
  test('tender detail (slide-over sheet, opened from the feed)', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await page.locator('article.tender-card h3 a').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // Summary is the landing tab; the score table lives behind the second one.
    await sheet.getByRole('tab', { name: 'Score' }).click();
    await expect(sheet.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    expectNoSeriousViolations(
      await seriousOrCriticalViolations(page),
      '/app/tenders/:matchId (sheet)',
    );
  });

  test('tender detail (full page, opened directly)', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    const href = await page.locator('article.tender-card h3 a').first().getAttribute('href');
    expect(href).not.toBeNull();
    // A direct visit carries no `backgroundLocation`, so there is no feed
    // behind it and the full page renders instead of the sheet.
    await page.goto(href as string);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Score' }).click();
    await expect(page.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    expectNoSeriousViolations(
      await seriousOrCriticalViolations(page),
      '/app/tenders/:matchId (page)',
    );
  });

  test('settings', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/app/settings');
  });
});

/**
 * Scans the CURRENT screen and asserts it's axe-clean, tagging any failure
 * with which onboarding screen it came from.
 */
async function scanScreen(page: Page, label: string): Promise<void> {
  const violations = await seriousOrCriticalViolations(page);
  expectNoSeriousViolations(violations, `/onboarding — ${label}`);
}

// A distinct helper (not `bootstrapOnboardedUserWithMatches` directly) so
// EVERY onboarding screen gets its own axe scan — the M1 accessibility gate
// (docs/redesign/ux-strategy.md §3.8 "axe green on ALL screens", closing
// the old wizard's "steps 2–10 unscanned" gap) — then finishes the wizard
// so the later feed/detail/settings scans have real seeded matches to
// render.
async function bootstrapOnboardedUserWithMatchesForAxe(
  page: Page,
  emailHint: string,
): Promise<{ email: string }> {
  const email = emailHint;
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Axe Onboarding User');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  const mailResponse = await page.request.get(`/api/test/mailbox?to=${encodeURIComponent(email)}`);
  const mailBody = (await mailResponse.json()) as { mails: { kind: string; url: string }[] };
  const verification = mailBody.mails.find((m) => m.kind === 'verification');
  if (verification === undefined) throw new Error('no verification mail captured');
  await page.goto(verification.url);

  await login(page, email, TEST_PASSWORD);
  // A brand-new user with no organization lands on /onboarding directly
  // (R1) — no separate page.goto needed.
  await expect(
    page.getByRole('heading', { name: "Let's set up your scoring profile" }),
  ).toBeVisible();
  await scanScreen(page, 'welcome');
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
  await scanScreen(page, 'create workspace');
  await page.getByLabel('Organization name').fill(`Axe Org ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Tell us about your company' })).toBeVisible();
  await scanScreen(page, 'company basics');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: 'Start from a preset' })).toBeVisible();
  await scanScreen(page, 'preset picker');
  await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Which CPV codes describe your work?' }),
  ).toBeVisible();
  await scanScreen(page, 'CPV codes');
  await page.getByRole('button', { name: 'Save & continue' }).click();

  await expect(
    page.getByRole('heading', { name: "Which countries' opportunities do you want to see?" }),
  ).toBeVisible();
  await scanScreen(page, 'countries');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(
    page.getByRole('heading', { name: 'What contract value and timing work for you?' }),
  ).toBeVisible();
  await scanScreen(page, 'value & deadline');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(
    page.getByRole('heading', { name: 'What keywords describe the work you want?' }),
  ).toBeVisible();
  await scanScreen(page, 'keywords');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: 'Capabilities & certifications' })).toBeVisible();
  await scanScreen(page, 'capabilities & certifications');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: 'Anything you want to exclude?' })).toBeVisible();
  await scanScreen(page, 'exclusions');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: 'Your daily digest' })).toBeVisible();
  await scanScreen(page, 'digest');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: 'Review your scoring profile' })).toBeVisible();
  await scanScreen(page, 'review');
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await scanScreen(page, 'done');
  await page.getByRole('button', { name: 'Go to your feed' }).click();
  await page.request.post('/api/test/score-now');

  return { email };
}
