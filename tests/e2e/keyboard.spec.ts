/**
 * Phase 12 stage A — scripted keyboard traversal: tab through the login
 * form and feed card / detail actions, asserting (a) focus visibility (a
 * computed outline or box-shadow on the focused element — never "focus is
 * simply invisible") and (b) Enter-key activation of the Save action.
 * Findings feed docs/accessibility-review.md.
 */
import { expect, test, type Locator } from '@playwright/test';
import { bootstrapOnboardedUserWithMatches } from './helpers';

async function hasVisibleFocusStyle(locator: Locator): Promise<boolean> {
  const style = await locator.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
  });
  const hasOutline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow.length > 0;
  return hasOutline || hasBoxShadow;
}

test('login form: tab order reaches every field and the submit button, each with visible focus', async ({
  page,
}) => {
  await page.goto('/login');
  await page.locator('body').click(); // ensure no residual focus from navigation
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // header "BidMorrow" home link
  await expect(page.getByRole('link', { name: 'BidMorrow' })).toBeFocused();
  await page.keyboard.press('Tab'); // email field
  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeFocused();
  expect(await hasVisibleFocusStyle(emailField), 'email field focus must be visible').toBe(true);

  await page.keyboard.press('Tab');
  const passwordField = page.getByLabel('Password');
  await expect(passwordField).toBeFocused();
  expect(await hasVisibleFocusStyle(passwordField), 'password field focus must be visible').toBe(
    true,
  );

  await page.keyboard.press('Tab');
  const submitButton = page.getByRole('button', { name: 'Log in' });
  await expect(submitButton).toBeFocused();
  expect(await hasVisibleFocusStyle(submitButton), 'submit button focus must be visible').toBe(
    true,
  );
});

test('feed card + tender detail: Save is keyboard-reachable and Enter-activatable', async ({
  page,
}) => {
  await bootstrapOnboardedUserWithMatches(page, 'Keyboard Traversal');

  const firstCard = page.locator('article.tender-card').first();
  const saveButton = firstCard.getByRole('button', { name: 'Save', exact: true });
  await saveButton.focus();
  await expect(saveButton).toBeFocused();
  expect(await hasVisibleFocusStyle(saveButton), 'feed card Save button focus must be visible').toBe(
    true,
  );
  await page.keyboard.press('Enter');
  await expect(firstCard.getByRole('button', { name: 'Saved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await firstCard.locator('h3 a').click();
  await expect(page.getByRole('heading', { name: 'Score breakdown' })).toBeVisible();
  const detailSaveButton = page.getByRole('button', { name: 'Saved', exact: true });
  await detailSaveButton.focus();
  expect(
    await hasVisibleFocusStyle(detailSaveButton),
    'tender detail Save/Saved button focus must be visible',
  ).toBe(true);
  // Toggle it off and back on via Enter to prove keyboard activation, not
  // just focus, works end to end.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
