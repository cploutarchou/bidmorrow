/**
 * Regression test for the preset-prefill-loss defect (docs/redesign/
 * ux-strategy.md F14/§3.6/C7): applying a preset pre-fills CPV/keyword/
 * capability data into LOCAL state only — walking past those fields without
 * touching them must never silently discard it.
 *
 * The five-step flow changes WHEN that data is written, not whether it has
 * to be. Each step's single Continue saves every resource on that step, so
 * the preset's keywords and capabilities are persisted by step 4 rather
 * than swept up by Review. Review's reconciliation survives as the safety
 * net for anything still unsaved (a resumed session that jumps straight to
 * it), and `POST /api/org/onboarding/complete` is still the last gate.
 *
 * What this test asserts is therefore the outcome, not the mechanism: a user
 * who picks a preset and never edits a field ends up with that preset's data
 * on the SERVER. That is the defect F14 was about.
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
  // Step 1 — Company: name the workspace and touch nothing else.
  await page
    .getByLabel('Organization name')
    .fill(`Preset Reconciliation Org ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create workspace & continue' }).click();

  // Step 2 — pick a preset. `presetKey` is re-PUT immediately (§2.1), but the
  // CPV codes, keywords and capabilities it brings exist only in local state
  // until a step's Continue writes them.
  await page.getByRole('radio', { name: /Cybersecurity consultancy/ }).check();
  await page.getByRole('button', { name: 'Save & continue' }).click();

  // Steps 3 and 4 — walk straight through without editing a single field.
  // This is the sequence that used to produce an empty scoring profile even
  // though a preset had been chosen.
  await page.getByRole('button', { name: 'Save & continue' }).click();
  await page.getByRole('button', { name: 'Save & continue' }).click();

  await expect(page.getByRole('heading', { name: 'Review your scoring profile' })).toBeVisible();
  // The preset's data is on the review table, with the real counts.
  await expect(page.getByText('9 keywords')).toBeVisible();
  await expect(page.getByText(/5 capabilities/)).toBeVisible();
  // Every resource the user walked past is already saved — its own step's
  // Continue wrote it. Exactly one row is still queued: Digest shares the
  // last step with Review, which has no Continue of its own, so Finish is
  // what writes it. That single row is the reconciliation sweep still doing
  // real work rather than being decorative.
  await expect(page.locator('.ob-review-row__state--will-save')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  // The preset's CPV divisions overlap the default ingestion scope.
  await expect(page.locator('.scope-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go to your feed' }).click();

  // Verify the preset's keywords/capabilities actually reached the server
  // — the whole point of the fix — via Settings, which reflects persisted
  // state independent of onboarding's own local state. Scoped per section
  // since the preset's keyword "penetration testing" and capability
  // "Penetration testing" differ only in case (Playwright's default text
  // match is case-insensitive, so an unscoped query is ambiguous).
  await page.goto('/app/settings');
  // The keyword "penetration testing" and the capability "Penetration
  // testing" differ only in case. Playwright's string getByText is
  // case-insensitive, and the M2 Settings restyle groups the matching-
  // profile subsections under one <section>, so a section-scoped string
  // query now matches both. Use case-sensitive regexes (capital vs
  // lowercase P) to assert each persisted chip unambiguously.
  await expect(page.getByText(/penetration testing/).first()).toBeVisible();
  await expect(page.getByText(/Penetration testing/).first()).toBeVisible();
});
