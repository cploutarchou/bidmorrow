/**
 * Generates apps/web/public/og/og-default.png from scripts/og/og-default.html.
 *
 * The share image is a designed asset, but it is generated rather than
 * hand-exported so it can be regenerated whenever the brand or the worked
 * example changes, and so the source of every pixel is reviewable text.
 *
 * Spec (docs/redesign/seo-content-strategy.md §3): 1200×630 PNG, ≤ 300 KB,
 * self-hosted, safe area 1120×550 centred. Both constraints are asserted here
 * rather than eyeballed.
 *
 * Usage: node scripts/generate-og-image.mjs
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'scripts/og/og-default.html');
const OUTPUT = resolve(ROOT, 'apps/web/public/og/og-default.png');

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 300 * 1024;

// Prefer a preinstalled Chromium when the environment provides one — same
// convention as playwright.config.ts, since sandboxed dev containers ship a
// revision that may not match this @playwright/test version's expected
// download path.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath !== undefined ? { executablePath } : {});
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'load' });
  // `font-display: block` on the self-hosted face means an unloaded font
  // renders nothing rather than falling back — wait for it, or the headline
  // silently ships blank.
  // eslint-disable-next-line no-undef -- runs in the page, not in Node
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await page.screenshot({ path: OUTPUT, type: 'png' });
} finally {
  await browser.close();
}

const { size } = await stat(OUTPUT);
if (size > MAX_BYTES) {
  throw new Error(`og-default.png is ${String(size)} bytes, over the ${String(MAX_BYTES)} limit`);
}
console.log(`wrote ${OUTPUT} (${String(size)} bytes, ${String(WIDTH)}x${String(HEIGHT)})`);
