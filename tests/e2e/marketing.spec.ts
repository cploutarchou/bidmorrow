/**
 * Phase 12 stage A — marketing pages: render with the expected title +
 * disclosure strings (docs/product-scope.md's "honest, no vanity graphs"
 * requirement; docs/matching-engine.md's unknown-policy disclosures).
 * Unauthenticated, no test hooks needed.
 */
import { expect, test } from '@playwright/test';

test('home page renders headline and CTA', async ({ page }) => {
  await page.goto('/');
  // Home's title is now the M0.2 metadata string (lib/seo.ts MARKETING_META.home).
  // Asserting it here also proves React's hoisted per-page title wins over the
  // neutral static fallback in index.html.
  await expect(page).toHaveTitle(/BidMorrow — Bid\/No-Bid Intelligence for EU Tenders/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The 2026-08-21 handoff homepage repeats the CTA deliberately (hero,
  // pricing section, closing panel) — assert the first, not a unique one.
  await expect(page.getByRole('link', { name: 'Join the founding pilot' }).first()).toBeVisible();
});

test('home comparison module stays unnamed and states its evidence basis', async ({ page }) => {
  // The honest comparison module (docs/website-redesign-plan.md §7): a
  // "typical tender-alert services" column, never a named competitor —
  // named tables are owner-gated (decision D11) — and the note stating what
  // the right-hand column is based on must stay attached to the table.
  await page.goto('/');
  const section = page.locator('#compare');
  await expect(section.getByRole('table')).toBeVisible();
  await expect(
    section.getByRole('columnheader', { name: 'Typical tender-alert services' }),
  ).toBeVisible();
  await expect(section.getByRole('rowheader')).toHaveCount(6);
  await expect(section.getByText(/our own review of the public marketing pages/)).toBeVisible();
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
// (styles/marketing.css `MARKETING SITE` section) instead of wrapping the desktop
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

/**
 * The public sample-verdict demo (docs/product-scope.md "Product policy
 * lock", 2026-08-17).
 *
 * Two things are asserted that a screenshot would not catch: that the page
 * shows the engine's real arithmetic, and that it stays a demo rather than
 * becoming a free tier.
 */
test('sample verdicts page shows real engine output for real notices', async ({ page }) => {
  await page.goto('/sample-verdicts');
  await expect(page).toHaveTitle(/Sample Verdicts/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Every verdict is one article, each with a heading naming a real tender.
  const verdicts = page.locator('article.sample-verdict');
  await expect(verdicts).toHaveCount(5);

  // The strong match's breakdown is present and its components are the real
  // engine vocabulary, not illustrative labels.
  const strong = verdicts.first();
  await expect(strong.getByText('Strong match')).toBeVisible();
  await expect(strong.getByRole('rowheader', { name: 'CPV fit' })).toBeVisible();
  await expect(strong.getByRole('rowheader', { name: 'Deadline runway' })).toBeVisible();

  // The excluded verdict shows NO score and NO breakdown — the engine never
  // scored it, and showing a 0 would be a different, false claim.
  const excluded = verdicts.last();
  await expect(excluded.getByText('Excluded')).toBeVisible();
  await expect(excluded.getByRole('table')).toHaveCount(0);
  await expect(excluded.getByText(/never reached a score/i)).toBeVisible();

  // At least one verdict shows a real risk flag with its evidence — the
  // feature the demo exists to sell is otherwise invisible on it.
  await expect(page.getByRole('heading', { name: 'Detected risk flags' })).toHaveCount(1);

  // Every notice links to TED itself.
  const sourceLinks = page.getByRole('link', { name: /Read the original notice on TED/ });
  await expect(sourceLinks).toHaveCount(5);
  for (const href of await sourceLinks.evaluateAll((links) =>
    links.map((l) => l.getAttribute('href')),
  )) {
    expect(href).toMatch(/^https:\/\/ted\.europa\.eu\//);
  }
});

test('sample verdicts page is a demo, not a free tier', async ({ page }) => {
  await page.goto('/sample-verdicts');
  // The policy's hard boundary: an anonymous visitor cannot submit a tender,
  // build a profile or reach the feed from here. Enforced structurally —
  // there is nothing to type into and no link inward.
  await expect(page.locator('main input, main textarea, main select')).toHaveCount(0);
  await expect(page.locator('main a[href^="/app"]')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Get verdicts matched to your company' }),
  ).toBeVisible();
});

/**
 * /cybersecurity-tenders — first manually authored category page
 * (docs/product-scope.md "Product policy lock": methodology + sample
 * verdicts, never an auto-generated tender directory).
 */
test('cybersecurity category page explains the method and scores real notices', async ({
  page,
}) => {
  await page.goto('/cybersecurity-tenders');
  await expect(page).toHaveTitle(/Cybersecurity Tenders/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The CPV table shows official codelist labels, not invented ones.
  await expect(
    page.getByRole('cell', { name: 'Computer audit and testing services' }),
  ).toBeVisible();

  // Its sample verdicts are the cybersecurity-surface subset — real cards,
  // same component vocabulary as everywhere else.
  const verdicts = page.locator('article.sample-verdict');
  await expect(verdicts).toHaveCount(2);
  await expect(verdicts.first().getByRole('rowheader', { name: 'CPV fit' })).toBeVisible();

  // Not a directory and not a free tier: no inputs, no path into the app.
  await expect(page.locator('main input, main textarea, main select')).toHaveCount(0);
  await expect(page.locator('main a[href^="/app"]')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Get verdicts matched to your company' }),
  ).toBeVisible();
});

test('open consent banner never covers the footer', async ({ page }) => {
  // While the cookie choice is pending the banner is fixed over the page's
  // tail. The document gets matching bottom clearance
  // (body.consent-banner-open), because the footer holds the privacy policy
  // and the "Cookie preferences" reopener — the two links someone deciding
  // about cookies most needs, and exactly the ones a covering banner hides.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/privacy');
  // The page chunk is lazy; scrolling before it renders would measure a
  // page that is about to grow.
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  const contact = page.locator('.mkt-footer').getByRole('link', { name: 'Contact' });
  await contact.scrollIntoViewIfNeeded();
  const linkBox = await contact.boundingBox();
  const bannerBox = await page.locator('.consent-banner').boundingBox();
  expect(linkBox).not.toBeNull();
  expect(bannerBox).not.toBeNull();
  expect(linkBox!.y + linkBox!.height).toBeLessThan(bannerBox!.y);
});

test('marketing nav marks the current page', async ({ page, isMobile }) => {
  await page.goto('/methodology');
  // On phones the desktop list is hidden behind the hamburger; the panel
  // carries the same aria-current, so assert whichever nav is actually
  // rendered at this viewport.
  let nav = page.locator('.nav-list');
  if (isMobile) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    nav = page.locator('.mkt-menu-panel__links');
  }
  await expect(nav.getByRole('link', { name: 'Methodology' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});
