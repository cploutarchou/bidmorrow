/**
 * Phase 12 stage A — scripted keyboard traversal: tab through the login
 * form and feed card / detail actions, asserting (a) focus visibility (a
 * computed outline, or a box-shadow that APPEARS on focus — never "focus is
 * simply invisible") and (b) Enter-key activation of the Save action.
 * Findings feed docs/accessibility-review.md.
 *
 * The app styles focus via `:focus-visible` (styles/base.css), which Chromium
 * only applies to keyboard-driven focus — so every focus in this spec is
 * driven by real Tab keypresses, never bare `locator.focus()` (programmatic
 * focus would not match `:focus-visible` and would false-fail the checks).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapOnboardedUserWithMatches } from './helpers';

/**
 * True when the CURRENTLY FOCUSED element shows a visible focus style:
 * either a real outline, or a box-shadow that differs from its unfocused
 * box-shadow (a constant decorative shadow must not count as focus
 * visibility). Restores focus before returning.
 */
async function hasVisibleFocusStyle(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const focused = window.getComputedStyle(el);
    const outlineVisible = focused.outlineStyle !== 'none' && focused.outlineWidth !== '0px';
    const focusedShadow = focused.boxShadow;
    (el as HTMLElement).blur();
    const blurredShadow = window.getComputedStyle(el).boxShadow;
    (el as HTMLElement).focus();
    const shadowAppearsOnFocus = focusedShadow !== 'none' && focusedShadow !== blurredShadow;
    return outlineVisible || shadowAppearsOnFocus;
  });
}

/** Press Tab until `locator` is the active element (bounded); false if never reached. */
async function tabUntilFocused(page: Page, locator: Locator, maxTabs = 15): Promise<boolean> {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const reached = await locator
      .evaluate((el) => el === document.activeElement)
      .catch(() => false);
    if (reached) return true;
  }
  return false;
}

test('login form: tabbing reaches email, password, submit in order, each with visible focus', async ({
  page,
}) => {
  await page.goto('/login');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  const emailField = page.getByLabel('Email');
  expect(await tabUntilFocused(page, emailField), 'Tab must reach the email field').toBe(true);
  expect(await hasVisibleFocusStyle(emailField), 'email field focus must be visible').toBe(true);

  const passwordField = page.getByLabel('Password');
  expect(
    await tabUntilFocused(page, passwordField, 5),
    'Tab must reach the password field after email',
  ).toBe(true);
  expect(await hasVisibleFocusStyle(passwordField), 'password field focus must be visible').toBe(
    true,
  );

  const submitButton = page.getByRole('button', { name: 'Log in' });
  expect(
    await tabUntilFocused(page, submitButton, 5),
    'Tab must reach the submit button after password',
  ).toBe(true);
  expect(await hasVisibleFocusStyle(submitButton), 'submit button focus must be visible').toBe(
    true,
  );
});

/** Land keyboard-driven focus on `target`: park focus just before it, then Tab onto it. */
async function keyboardFocus(page: Page, target: Locator): Promise<void> {
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

test('feed card + tender detail: Save is keyboard-reachable and Enter-activatable', async ({
  page,
}) => {
  await bootstrapOnboardedUserWithMatches(page, 'Keyboard Traversal');

  const firstCard = page.locator('article.tender-card').first();
  const saveButton = firstCard.getByRole('button', { name: 'Save', exact: true });
  await keyboardFocus(page, saveButton);
  expect(
    await hasVisibleFocusStyle(saveButton),
    'feed card Save button focus must be visible',
  ).toBe(true);
  await page.keyboard.press('Enter');
  await expect(firstCard.getByRole('button', { name: 'Saved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Opening a tender from the feed now renders the slide-over sheet OVER the
  // feed, which stays mounted with its own Save button — so every locator
  // below is scoped to the dialog rather than the page.
  await firstCard.locator('h3 a').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const detailSaveButton = sheet.getByRole('button', { name: 'Saved', exact: true });
  await keyboardFocus(page, detailSaveButton);
  expect(
    await hasVisibleFocusStyle(detailSaveButton),
    'tender detail Save/Saved button focus must be visible',
  ).toBe(true);
  // Toggle it off and back on via Enter to prove keyboard activation, not
  // just focus, works end to end.
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('feed tabs: one tab stop, arrows move and activate (WAI-ARIA tabs)', async ({ page }) => {
  await bootstrapOnboardedUserWithMatches(page, 'Feed Tabs Keyboard');
  await page.goto('/app');
  await expect(page.locator('article.tender-card').first()).toBeVisible();

  const tablist = page.getByRole('tablist', { name: 'Feed tabs' });
  const active = tablist.getByRole('tab', { name: "Today's matches" });
  const next = tablist.getByRole('tab', { name: 'Strong' });

  // Roving tabindex: the active tab is the single stop; the rest are -1.
  await expect(active).toHaveAttribute('tabindex', '0');
  await expect(next).toHaveAttribute('tabindex', '-1');

  await active.focus();
  await page.keyboard.press('ArrowRight');
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('End');
  await expect(tablist.getByRole('tab', { name: 'Ignored' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(active).toBeFocused();
  await expect(active).toHaveAttribute('aria-selected', 'true');
});

test('route change moves focus to main and resets scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Scroll down, then navigate via the header nav. Without RouteFocus the
  // old scroll position carried over and focus stayed on the clicked link.
  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
  await page.locator('.nav-list').getByRole('link', { name: 'Methodology' }).click();
  await expect(page.getByRole('heading', { name: 'Deterministic on purpose.' })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 2000 }).toBe(0);
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
  expect(focused).toBe('MAIN');
});

test('feed card: "why this score" expander reveals the engine explanations', async ({ page }) => {
  await bootstrapOnboardedUserWithMatches(page, 'Why Score');
  await page.goto('/app');
  const firstCard = page.locator('article.tender-card').first();
  await expect(firstCard).toBeVisible();

  const why = firstCard.locator('details.tender-card__why');
  await expect(why).toBeVisible();
  const items = why.locator('li');
  await why.locator('summary').click();
  // Real engine explanation strings, not labels: every entry carries the
  // component's own prose (they all follow the "<Component>: ..." shape).
  await expect(items.first()).toBeVisible();
  const texts = await items.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text.length).toBeGreaterThan(10);
  }
});
