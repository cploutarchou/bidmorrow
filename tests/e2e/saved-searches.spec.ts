/**
 * The feed's left rail: saving a filter set, re-applying it, and deleting it.
 *
 * Driven through the UI rather than the API because the point of the feature
 * is that the rail captures what the filter bar currently holds — a test that
 * POSTed the filters itself would prove the endpoint works while saying
 * nothing about whether the rail reads the right state.
 */
import { expect, test } from '@playwright/test';
import { bootstrapOnboardedUserWithMatches } from './helpers';

test('feed rail: save the current filters, re-apply them, delete the search', async ({ page }) => {
  test.slow();
  await bootstrapOnboardedUserWithMatches(page, 'Saved Search');
  await page.goto('/app');
  await expect(page.locator('article.tender-card').first()).toBeVisible();

  const rail = page.getByRole('complementary', { name: 'Saved searches and shelves' });
  await expect(rail).toBeVisible();
  await expect(rail.getByText(/Filter the feed, then save it/)).toBeVisible();

  // Saving is refused until there is something to save — an unfiltered feed
  // is not a search.
  await expect(rail.getByRole('button', { name: '+ New' })).toBeDisabled();

  // Set one real filter through the filter bar. It is a <details>/<summary>,
  // which Chromium does not expose as a button role, so target the element.
  await page.locator('.feed-filters summary').click();
  await page.getByLabel('Minimum score').fill('40');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(rail.getByRole('button', { name: '+ New' })).toBeEnabled();
  await rail.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Name this search').fill('Score 40+');
  await rail.getByRole('button', { name: 'Save', exact: true }).click();

  // `exact` matters: the delete button's label contains the search name too.
  const saved = rail.getByRole('button', { name: 'Score 40+', exact: true });
  await expect(saved).toBeVisible();

  // Clear the filters, then re-apply the saved search and confirm the filter
  // bar really was restored — not just that the button highlighted.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByLabel('Minimum score')).toHaveValue('');
  await saved.click();
  await expect(page.getByLabel('Minimum score')).toHaveValue('40');
  await expect(saved).toHaveAttribute('aria-current', 'true');

  // A second search with the same name is refused, with a message that says
  // why rather than a generic failure.
  await rail.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Name this search').fill('Score 40+');
  await rail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rail.getByRole('alert')).toHaveText(
    'You already have a saved search with that name.',
  );

  await rail.getByRole('button', { name: 'Delete saved search Score 40+' }).click();
  await expect(rail.getByRole('button', { name: 'Score 40+', exact: true })).toHaveCount(0);

  // It is really gone server-side, not just from local state.
  await page.reload();
  await expect(page.locator('article.tender-card').first()).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Score 40+', exact: true })).toHaveCount(0);
});
