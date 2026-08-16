/**
 * Phase 12 stage A — marketing pages: render with the expected title +
 * disclosure strings (docs/product-scope.md's "honest, no vanity graphs"
 * requirement; docs/matching-engine.md's unknown-policy disclosures).
 * Unauthenticated, no test hooks needed.
 */
import { expect, test } from '@playwright/test';

test('home page renders headline and CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BidMorrow.*EU public procurement/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join the founding pilot' })).toBeVisible();
});

test('methodology page discloses the unknown-value scoring policy', async ({ page }) => {
  await page.goto('/methodology');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Every score component's unknown-field policy is disclosed as text.
  await expect(page.getByText('CPV fit')).toBeVisible();
  await expect(
    page.getByText(/50% \(10 pts\) when no matchable-language text exists/),
  ).toBeVisible();
});

test('pricing page renders both plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Founding plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Standard plan' })).toBeVisible();
  await expect(page.getByText('$29 / month')).toBeVisible();
  await expect(page.getByText('$49 / month')).toBeVisible();
});
