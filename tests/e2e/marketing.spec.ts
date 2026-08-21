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
  // The 2026-08-21 handoff homepage repeats the CTA deliberately (hero,
  // pricing section, closing panel) — assert the first, not a unique one.
  await expect(page.getByRole('link', { name: 'Join the founding pilot' }).first()).toBeVisible();
});

test('methodology page discloses the unknown-value scoring policy', async ({ page }) => {
  await page.goto('/methodology');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Every score component's unknown-field policy is disclosed as text.
  // exact: the redesigned page also mentions "CPV fit is the exception".
  await expect(page.getByText('CPV fit', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/50% \(10 pts\) when no matchable-language text exists/),
  ).toBeVisible();
});

test('pricing page renders both plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Founding plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Standard plan' })).toBeVisible();
  await expect(page.getByText('€29 / month')).toBeVisible();
  await expect(page.getByText('€49 / month')).toBeVisible();
});

// Mobile header: the nav collapses into a hamburger menu below ~56rem
// (styles.css `MARKETING SITE` section) instead of wrapping the desktop
// `.nav-list`/`.nav-actions` into stacked rows.
test.describe('mobile nav menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens on tap, exposes every link, Esc closes it and returns focus', async ({ page }) => {
    await page.goto('/');

    // A stable locator (the toggle's accessible name flips between "Open
    // menu"/"Close menu" as `menuOpen` changes — MarketingLayout.tsx).
    const toggle = page.locator('.mkt-menu-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName('Open menu');
    // The desktop-only inline nav must stay out of the way at mobile width
    // (it exists in the DOM for the ≥56rem case, but must not be visible
    // here — this is the "3 stacked rows" bug the menu fixes).
    await expect(page.locator('.nav-list').first()).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Close menu');

    const panel = page.locator('.mkt-menu-panel.is-open');
    await expect(panel.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'How it works' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Methodology' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Founding pilot' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Sign up' })).toBeVisible();

    // Focus moved into the panel on open.
    await expect(panel.getByRole('link', { name: 'Pricing' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Open menu');
    await expect(toggle).toBeFocused();
    await expect(page.locator('.mkt-menu-panel.is-open')).toHaveCount(0);
  });

  test('closes when a link inside it is clicked', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mkt-menu-toggle').click();
    await page.locator('.mkt-menu-panel.is-open').getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('.mkt-menu-panel.is-open')).toHaveCount(0);
  });
});
