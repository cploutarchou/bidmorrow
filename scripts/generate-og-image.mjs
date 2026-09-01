/**
 * Generates apps/web/public/og/og-default.png from
 * apps/web/public/og/og-default.svg.
 *
 * Supersedes the previous scripts/og/og-default.html + this same script
 * (the 84.5/100 worked-example score card), which rendered the OLD OG
 * design; that HTML source has been deleted (2026-08-26, brand-elevation
 * phase — see apps/web/public/og/og-default.svg's own header comment for
 * why the design changed, docs/redesign/brand-elevation-phase.md §2 "the
 * funnel" motif). If you need the old score-card design back, recover
 * scripts/og/og-default.html from git history rather than reinventing it.
 *
 * The SVG is the single source of truth (also a valid, directly-viewable
 * standalone asset); this script's only job is turning it into the PNG
 * every social platform actually fetches. Navigating straight to the .svg
 * file (rather than embedding it in a wrapper HTML page) is enough here —
 * the "SVG loaded as an image is font-isolated" gotcha applies to `<img
 * src>` / CSS background contexts, not to loading the SVG itself as the
 * top-level document, which is what this script does.
 *
 * Spec (docs/redesign/brand-elevation-phase.md §2/§4c): 1200×630 PNG,
 * ≤ 300 KB, self-hosted. Both constraints are asserted here rather than
 * eyeballed, same convention as the file this supersedes.
 *
 * Usage: node scripts/generate-og-image.mjs
 */
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'apps/web/public/og/og-default.svg');
const OUTPUT = resolve(ROOT, 'apps/web/public/og/og-default.png');

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 300 * 1024;

// Prefer a preinstalled Chromium when the environment provides one — same
// convention as playwright.config.ts and the file this supersedes, since
// sandboxed dev containers ship a revision that may not match this
// @playwright/test version's expected download path.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath !== undefined ? { executablePath } : {});
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  // The SVG references its fonts as site-absolute `/fonts/*.woff2` (so it
  // also renders when opened on the deployed site). Under file:// that
  // path has no meaning, so render a temporary copy whose font URLs point
  // at the same files in apps/web/public/fonts.
  const fontsDir = pathToFileURL(resolve(ROOT, 'apps/web/public/fonts')).href;
  const svg = (await readFile(SOURCE, 'utf8')).replaceAll("url('/fonts/", `url('${fontsDir}/`);
  const tempSource = resolve(tmpdir(), `bidmorrow-og-${String(process.pid)}.svg`);
  await writeFile(tempSource, svg);
  await page.goto(pathToFileURL(tempSource).href, { waitUntil: 'load' });
  // `font-display: block` on the self-hosted face means an unloaded font
  // renders nothing rather than falling back — wait for it, or the
  // headline silently ships blank.
  // eslint-disable-next-line no-undef -- runs in the page, not in Node
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUTPUT, type: 'png' });
} finally {
  await browser.close();
  await rm(resolve(tmpdir(), `bidmorrow-og-${String(process.pid)}.svg`), { force: true });
}

const { size } = await stat(OUTPUT);
if (size > MAX_BYTES) {
  throw new Error(`og-default.png is ${String(size)} bytes, over the ${String(MAX_BYTES)} limit`);
}
console.log(`wrote ${OUTPUT} (${String(size)} bytes, ${String(WIDTH)}x${String(HEIGHT)})`);
