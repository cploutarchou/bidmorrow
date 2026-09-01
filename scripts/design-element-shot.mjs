#!/usr/bin/env node
/**
 * Element screenshot for design review: renders one page of a running
 * BidMorrow stack and captures a single element at 2x, after an optional
 * wait (useful for catching an animation at a known point in its cycle).
 *
 *   node scripts/design-element-shot.mjs --selector .de --width 390 \
 *     --scheme light --wait 3300 --out artifacts/design-review/de-390.png
 *
 * `--click <selector>` (repeatable) clicks each selector in order before the
 * wait, e.g. a "how it works" step button, so a stateful panel can be
 * captured in the state under review.
 */
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://127.0.0.1:8787' },
    path: { type: 'string', default: '/' },
    selector: { type: 'string', default: '.de' },
    width: { type: 'string', default: '390' },
    scheme: { type: 'string', default: 'light' },
    wait: { type: 'string', default: '2600' },
    'reduced-motion': { type: 'boolean', default: false },
    click: { type: 'string', multiple: true, default: [] },
    out: { type: 'string', default: 'artifacts/design-review/element.png' },
  },
});

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
);
try {
  const context = await browser.newContext({
    viewport: { width: Number(values.width), height: 900 },
    colorScheme: values.scheme,
    reducedMotion: values['reduced-motion'] ? 'reduce' : 'no-preference',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${values['base-url']}${values.path}`, { waitUntil: 'networkidle' });
  const reject = page.getByRole('button', { name: 'Reject all' });
  if (await reject.count()) await reject.first().click();
  for (const selector of values.click) {
    await page.locator(selector).first().click();
  }
  const target = page.locator(values.selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(Number(values.wait));
  await target.screenshot({ path: values.out });
  console.log(values.out);
} finally {
  await browser.close();
}
