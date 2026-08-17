/**
 * Regression test for the preset-prefill-loss defect (docs/redesign/
 * ux-strategy.md F14/§3.6/C7): applying a preset pre-fills CPV/keyword/
 * capability data into LOCAL state only via `PUT` calls the user hasn't
 * explicitly triggered yet — skipping those screens afterward must never
 * silently discard that data. The Review screen's reconciliation is the
 * fix: it force-saves any "will be saved when you finish" resource before
 * calling `POST /api/org/onboarding/complete`.
 */
import { expect, test } from '@playwright/test';
import { login, signUpAndVerify, TEST_PASSWORD, uniqueEmail } from './helpers';

test('onboarding: preset selection survives skipping every downstream screen', async ({ page }) => {
  const email = uniqueEmail('preset-reconciliation');
  await signUpAndVerify(page, {
    name: 'Preset Reconciliation User',
    email,
    password: TEST_PASSWORD,
  });
  await login(page, email, TEST_PASSWORD);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page
    .getByLabel('Organization name')
    .fill(`Preset Reconciliation Org ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  // Company basics — skip WITHOUT saving anything (the exact sequence that
  // used to discard a preset's data downstream).
  await page.getByRole('button', { name: 'Skip' }).click();

  // Pick a preset — presetKey is re-PUT immediately (§2.1), but
  // CPV/keywords/capabilities only exist in local state until their own
  // screens save them, or Review force-saves them on finish.
  await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // CPV is never skippable — save it as-is (preset codes pre-checked).
  await page.getByRole('button', { name: 'Save & continue' }).click();

  // Skip every remaining screen, INCLUDING keywords and capabilities/
  // certifications — the sequence that used to produce an empty scoring
  // profile even though a preset had been chosen.
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Skip' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Review your scoring profile' })).toBeVisible();
  // The reconciliation table must show the preset's data as queued to save
  // (visible "will-save" marker), never as empty — this is the regression
  // check for F14.
  await expect(page.getByText('9 keywords')).toBeVisible();
  await expect(page.getByText(/5 capabilities/)).toBeVisible();
  const willSaveMarkers = page.locator('.ob-review-row__state--will-save');
  expect(await willSaveMarkers.count()).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  // The preset's CPV divisions overlap the default ingestion scope.
  await expect(page.locator('.scope-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go to your feed' }).click();

  // Verify the preset's keywords/capabilities actually reached the server
  // — the whole point of the fix — via Settings, which reflects persisted
  // state independent of onboarding's own local state.
  await page.goto('/app/settings');
  await expect(page.getByText('penetration testing')).toBeVisible();
  await expect(page.getByText('Penetration testing')).toBeVisible();
});
