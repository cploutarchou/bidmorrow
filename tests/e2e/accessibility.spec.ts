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

async function seriousOrCriticalViolations(page: Page): Promise<SeriousViolation[]> {
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

  test('onboarding step 1', async ({ page }) => {
    email = `axe-onboarding-${String(Date.now())}@example.test`;
    const { email: createdEmail } = await bootstrapOnboardedUserWithMatchesForAxe(page, email);
    email = createdEmail;
  });

  test('feed (seeded, with matches)', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await expect(page.locator('article.tender-card').first()).toBeVisible();
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/app (feed)');
  });

  test('tender detail', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await page.locator('article.tender-card h3 a').first().click();
    await expect(page.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/app/tenders/:matchId');
  });

  test('settings', async ({ page }) => {
    await login(page, email, TEST_PASSWORD);
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expectNoSeriousViolations(await seriousOrCriticalViolations(page), '/app/settings');
  });
});

// A distinct helper (not `bootstrapOnboardedUserWithMatches` directly) so the
// onboarding-step-1 axe scan runs BEFORE the wizard is filled in — the phase
// instruction asks for "onboarding step 1" specifically, i.e. the freshly
// created, still-empty company-basics step, not the completed wizard.
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
  await page.goto('/onboarding');
  await page.getByLabel('Organization name').fill(`Axe Org ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByText('Step 2 of 10: Company basics')).toBeVisible();

  // Scan onboarding step 1 (company basics) exactly as a real user first
  // sees it — empty, no preset chosen yet.
  const violations = await seriousOrCriticalViolations(page);
  expect(violations, `onboarding step 1: ${JSON.stringify(violations, null, 2)}`).toEqual([]);

  // Then finish the wizard so the later feed/detail/settings scans have real
  // seeded matches to render (same preset-CPV-save pattern as
  // bootstrapOnboardedUserWithMatches — duplicated here rather than shared
  // because that helper starts a NEW signup, and this one must reuse the
  // already-created + already-scanned account).
  await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
  await page.getByRole('button', { name: 'Save & continue' }).click();
  await page.getByRole('button', { name: 'Save & continue' }).click();
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Skip' }).click();
  }
  await page.getByRole('button', { name: 'Finish onboarding' }).click();
  await page.getByRole('button', { name: 'Go to your feed' }).click();
  await page.request.post('/api/test/score-now');

  return { email };
}
