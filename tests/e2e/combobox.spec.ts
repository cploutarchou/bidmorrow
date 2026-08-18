/**
 * E2E coverage for the accessible autocomplete `Combobox`
 * (apps/web/src/components/Combobox.tsx) — the WAI-ARIA "combobox with
 * listbox popup, activedescendant" pattern shared by Settings' CPV/keyword/
 * country fields and Onboarding's CPV screen. Ranking logic itself is unit
 * tested (apps/web/src/lib/combobox-filter.test.ts); this file exercises
 * the real rendered widget: keyboard/mouse interaction, ARIA wiring, and
 * each caller's own commit semantics (add-to-list, dedupe-as-no-op,
 * free-typed fallback via the sibling "Add" button).
 *
 * One `test.describe.serial` block sharing a single bootstrapped account —
 * same idiom as critical-path.spec.ts/keyboard.spec.ts — since every
 * Settings scenario below only needs an authenticated, onboarded account
 * with a stable starting CPV list (the cybersecurity preset, which
 * `bootstrapOnboardedUserWithMatches` applies unedited: 79417000, 72222300,
 * 72220000, 48730000). The one onboarding-context check gets its own fresh
 * account (a different container instance of the same shared component).
 *
 * CPV/country codes used below were chosen by grepping
 * apps/web/src/data/cpv-suggestions.ts / lib/onboarding-reference-data.ts
 * for known-unique prefix/substring pairs — see inline comments — so every
 * ranking assertion is deterministic against the real static dataset, not
 * a guess.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  bootstrapOnboardedUserWithMatches,
  TEST_PASSWORD,
  uniqueEmail,
  signUpAndVerify,
  login,
} from './helpers';

/** Resolves a `Combobox` instance's tightly-coupled ARIA/DOM siblings from
 * its accessible label — the input itself stays label-first (`getByLabel`,
 * matching this suite's idiom), but the listbox/live-region/Add-button are
 * only reachable via the id Combobox.tsx derives from its own `id` prop, so
 * this reads that id off the rendered input rather than hardcoding it. */
async function comboboxParts(
  page: Page,
  labelText: string | RegExp,
): Promise<{ input: Locator; listbox: Locator; announcement: Locator; addButton: Locator }> {
  // `getByRole('combobox', ...)`, not `getByLabel` — Combobox.tsx's popup
  // `<ul role="listbox" aria-label={label}>` carries the SAME accessible
  // name as the `<input>` it belongs to, so a plain `getByLabel` matches
  // both and throws a strict-mode violation. `role="combobox"` is unique to
  // the input.
  const input = page.getByRole('combobox', { name: labelText });
  const id = await input.getAttribute('id');
  if (id === null) throw new Error(`combobox input for label "${String(labelText)}" has no id`);
  const wrapper = page.locator('.combobox').filter({ has: input });
  return {
    input,
    listbox: page.locator(`#${id}-listbox`),
    announcement: wrapper.locator('p[aria-live]'),
    addButton: page.locator('.combobox-add-row').filter({ has: input }).getByRole('button', {
      name: 'Add',
      exact: true,
    }),
  };
}

function cpvChips(page: Page): Locator {
  return page
    .locator('.settings-subsection')
    .filter({ has: page.getByRole('heading', { name: 'CPV codes' }) })
    .locator('.chip-list li');
}

function geographyChips(page: Page): Locator {
  return page
    .locator('.settings-subsection')
    .filter({ has: page.getByRole('heading', { name: 'Geographies' }) })
    .locator('.chip-list li');
}

test.describe.serial('combobox: Settings CPV + country fields', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await bootstrapOnboardedUserWithMatches(page, 'Combobox Settings');
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Matching profile' })).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('typing filters ranked results: prefix matches before substring-only matches', async () => {
    // "790" -> prefix match 79000000 ("79000000".startsWith("790")) ranks
    // before the substring-only match 48790000 (contains "790" at index 3,
    // never at the start) — verified against the real dataset (grep).
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('790');
    await expect(parts.listbox.getByRole('option')).toHaveCount(2);
    const sublabels = await parts.listbox.locator('.combobox__option-sublabel').allTextContents();
    expect(sublabels).toEqual(['79000000', '48790000']);
    await parts.input.fill('');
    await parts.input.press('Escape'); // closes without side effects (nothing typed to clear yet)
  });

  test('ArrowDown/ArrowUp cycles aria-activedescendant through the result list', async () => {
    // "794" -> exactly 4 prefix matches, numerically ordered: 79400000,
    // 79410000, 79417000, 79420000 (verified by grep).
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('794');
    await expect(parts.listbox.getByRole('option')).toHaveCount(4);
    await expect(parts.input).toHaveAttribute('aria-activedescendant', 'new-cpv-option-0');

    await parts.input.press('ArrowDown');
    await expect(parts.input).toHaveAttribute('aria-activedescendant', 'new-cpv-option-1');
    await parts.input.press('ArrowDown');
    await expect(parts.input).toHaveAttribute('aria-activedescendant', 'new-cpv-option-2');
    await parts.input.press('ArrowUp');
    await expect(parts.input).toHaveAttribute('aria-activedescendant', 'new-cpv-option-1');

    await parts.input.press('Escape');
    await parts.input.fill('');
  });

  test('Enter commits the active option and clears the field', async () => {
    // "fr" -> France is the ONLY match (prefix on both its code "FR" and
    // its label) — no competing substring match, so it's unambiguously the
    // active (index 0) option without any arrow presses.
    const parts = await comboboxParts(page, 'Add country code (opportunity country)');
    await parts.input.fill('fr');
    await expect(parts.listbox.getByRole('option')).toHaveCount(1);
    await parts.input.press('Enter');

    await expect(parts.input).toHaveValue('');
    await expect(parts.listbox).toHaveCount(0);
    await expect(geographyChips(page).filter({ hasText: 'FR' })).toHaveCount(1);
  });

  test('Escape closes the popup, and a second Escape clears the field', async () => {
    const parts = await comboboxParts(page, 'Add country code (opportunity country)');
    await parts.input.fill('ir'); // Ireland
    // Settings.tsx uppercases this field's `onValueChange` — the rendered
    // value is "IR", not the literal keystrokes typed.
    await expect(parts.input).toHaveValue('IR');
    await expect(parts.listbox.getByRole('option')).not.toHaveCount(0);

    await parts.input.press('Escape');
    await expect(parts.listbox).toHaveCount(0);
    await expect(parts.input).toHaveValue('IR'); // first Escape only closes

    await parts.input.press('Escape');
    await expect(parts.input).toHaveValue(''); // second Escape clears
  });

  test('Tab commits the active option and still moves focus to the next control', async () => {
    // "lux" -> uniquely Luxembourg.
    const parts = await comboboxParts(page, 'Add country code (opportunity country)');
    await parts.input.fill('lux');
    await expect(parts.listbox.getByRole('option')).toHaveCount(1);

    await parts.input.press('Tab');

    await expect(geographyChips(page).filter({ hasText: 'LU' })).toHaveCount(1);
    // Tab never calls preventDefault (Combobox.tsx) — focus must actually
    // move off the input, onto the field's own "Add" button (the next
    // element in DOM/tab order inside `.combobox-add-row`).
    await expect(parts.addButton).toBeFocused();
  });

  test('mouse click on a suggestion commits it and clears the field', async () => {
    // "482" -> three prefix matches (48200000, 48210000, 48220000); click
    // the first one with a real mouse click (not keyboard).
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('482');
    const option = parts.listbox.getByRole('option', { name: /48200000/ });
    await option.click();

    await expect(parts.input).toHaveValue('');
    await expect(cpvChips(page).filter({ hasText: '48200000' })).toHaveCount(1);
  });

  test('an already-added option renders the chosen state, and re-clicking it is a no-op', async () => {
    // 79417000 was already added by the cybersecurity preset during
    // onboarding — "79417" narrows the suggestion list to exactly that one
    // code.
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('79417');
    const option = parts.listbox.getByRole('option', { name: /79417000/ });
    await expect(option).toHaveClass(/combobox__option--chosen/);
    await expect(option.locator('.combobox__option-chosen-mark')).toBeVisible();

    const before = await cpvChips(page).count();
    await option.click();
    const after = await cpvChips(page).count();
    expect(after).toBe(before); // re-adding an already-chosen option must not duplicate it

    await expect(parts.input).toHaveValue(''); // still clears, per the shared onCommit contract
  });

  test('a free-typed CPV code that matches no suggestion still adds via the "Add" button', async () => {
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('72999999');
    await expect(parts.listbox.getByRole('option')).toHaveCount(0);
    await expect(parts.announcement).toHaveText('No matches');

    await expect(cpvChips(page).filter({ hasText: '72999999' })).toHaveCount(0);
    await parts.addButton.click();
    await expect(cpvChips(page).filter({ hasText: '72999999' })).toHaveCount(1);
    await expect(parts.input).toHaveValue('');
  });

  test('the live region announces the result count, and "No matches" when there are none', async () => {
    const parts = await comboboxParts(page, 'Add CPV code');
    await parts.input.fill('794');
    await expect(parts.announcement).toHaveText('4 suggestions available');

    await parts.input.fill('79417');
    await expect(parts.announcement).toHaveText('1 suggestion available');

    await parts.input.fill('zzz-no-such-code');
    await expect(parts.announcement).toHaveText('No matches');
  });
});

test('combobox: onboarding CPV screen commits a suggestion via keyboard, updates the scope indicator', async ({
  page,
}) => {
  const email = uniqueEmail('combobox-onboarding');
  await signUpAndVerify(page, { name: 'Combobox Onboarding User', email, password: TEST_PASSWORD });
  await login(page, email, TEST_PASSWORD);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Organization name').fill(`Combobox Onboarding Org ${String(Date.now())}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // company basics

  await expect(page.getByRole('heading', { name: 'Start from a preset' })).toBeVisible();
  await page.getByRole('radio', { name: 'Start from scratch' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Which CPV codes describe your work?' }),
  ).toBeVisible();
  await expect(page.locator('.ob-scope-indicator')).toHaveText(
    'Select at least one CPV code to continue.',
  );

  // "72130" -> uniquely 72130000 (verified by grep against the real
  // suggestion dataset), a code not in ANY bundled preset, so this is a
  // genuine free selection, not a preset carry-over.
  // `getByRole('combobox', ...)`, not `getByLabel` — see `comboboxParts`'s
  // comment above for why a plain label lookup is ambiguous here.
  const manualCpv = page.getByRole('combobox', { name: 'Add another 8-digit CPV code' });
  await manualCpv.fill('72130');
  const listbox = page.locator('#manual-cpv-listbox');
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await manualCpv.press('Enter');

  await expect(manualCpv).toHaveValue('');
  await expect(page.locator('.chip-list').getByText('72130000')).toBeVisible();
  // 72* is inside the current ingestion scope (docs/ted-ingestion-scope.md)
  // — the live scope-overlap indicator must reflect the commit immediately.
  await expect(page.locator('.ob-scope-indicator--ok')).toHaveText(/1 of your 1 code/);

  await page.getByRole('button', { name: 'Save & continue' }).click();
  await expect(
    page.getByRole('heading', { name: "Which countries' opportunities do you want to see?" }),
  ).toBeVisible();
});
