/**
 * App navigation + operator entry (docs/redesign/navigation-and-admin-entry.md).
 *
 * - The customer header carries Feed / Saved / Settings / Billing; Saved is
 *   a real URL (`/app?view=saved`) and Billing lands on the Billing section.
 * - An ordinary user never sees an Admin link; an `ADMIN_EMAILS` member
 *   does, and the admin shell links back to the app and can sign out.
 * - A signed-in visitor on a marketing page gets "Open app", not Log in.
 *
 * The admin account comes from the per-run `ADMIN_EMAILS` value that
 * scripts/e2e-write-dev-vars.mjs writes into apps/worker/.dev.vars.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapOnboardedUserWithMatches, login, TEST_PASSWORD } from './helpers';

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

function e2eAdminEmail(): string {
  const devVars = readFileSync(resolve(__dirname, '../../apps/worker/.dev.vars'), 'utf8');
  const match = /^ADMIN_EMAILS=(.+)$/m.exec(devVars);
  if (match?.[1] === undefined) throw new Error('ADMIN_EMAILS missing from apps/worker/.dev.vars');
  return match[1].trim();
}

test.describe('customer navigation', () => {
  test('header links, linkable Saved view, Billing deep link, no Admin entry', async ({ page }) => {
    await bootstrapOnboardedUserWithMatches(page, 'Nav User');
    await page.goto('/app');

    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['Feed', 'Saved', 'Settings', 'Billing']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(nav.getByRole('img', { name: /Signed in as/ })).toBeVisible();
    await shot(page, 'app-header');
    // The 390px two-row bar still exposes every link (no hamburger by design).
    await page.setViewportSize({ width: 390, height: 780 });
    for (const name of ['Feed', 'Saved', 'Settings', 'Billing']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await shot(page, 'app-header-mobile');
    await page.setViewportSize({ width: 1280, height: 720 });

    await nav.getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page).toHaveURL(/\/app\?view=saved$/);
    await expect(page.getByRole('tab', { name: 'Saved' })).toHaveAttribute('aria-selected', 'true');
    await expect(nav.getByRole('link', { name: 'Saved', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Picking another tab writes the URL back (replace), so a reload keeps it.
    await page.getByRole('tab', { name: 'Strong' }).click();
    await expect(page).toHaveURL(/\/app\?view=strong$/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Strong' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await nav.getByRole('link', { name: 'Billing', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings#billing$/);
    await expect(page.getByRole('heading', { name: 'Billing', level: 2 })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Billing', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Marketing header for a signed-in visitor.
    await page.goto('/pricing');
    const mktHeader = page.locator('.site-header');
    await expect(mktHeader.getByRole('link', { name: 'Open app' })).toBeVisible();
    await expect(mktHeader.getByRole('link', { name: 'Log in' })).toHaveCount(0);
  });
});

test.describe('operator navigation', () => {
  test('ADMIN_EMAILS member sees the Admin entry; admin shell links back and signs out', async ({
    page,
  }) => {
    const email = e2eAdminEmail();
    // A reused local server may already hold this account from a previous
    // run; sign in directly in that case instead of signing up again.
    const probe = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password: TEST_PASSWORD },
      headers: { origin: 'http://127.0.0.1:8787' },
    });
    if (probe.ok()) {
      await login(page, email, TEST_PASSWORD);
    } else {
      await bootstrapOnboardedUserWithMatches(page, 'Nav Admin', { email });
    }
    await page.goto('/app');

    const nav = page.getByRole('navigation', { name: 'Main' });
    const adminLink = nav.getByRole('link', { name: 'Admin' });
    await expect(adminLink).toBeVisible();
    await shot(page, 'app-header-admin');
    await adminLink.click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    const rail = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(rail.getByRole('link', { name: /^Organizations/ })).toBeVisible();
    await expect(rail.getByText('Customers')).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await shot(page, 'admin-shell');
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(rail.getByRole('link', { name: /^Flags/ })).toBeVisible();
    await shot(page, 'admin-shell-mobile');
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByRole('link', { name: '← Open app' }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.goto('/admin/flags');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Signed out: the cloak is back.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toHaveCount(0);
  });
});
