/**
 * Captures the built marketing pages at mobile / tablet / desktop widths in
 * BOTH themes, for responsive QA review before a UI change is finalized. Unlike
 * `capture-competitor-pages.mjs` (external hosts, CI-only), this points at a
 * LOCAL preview of our own built SPA and runs in the session sandbox.
 *
 * Usage:
 *   1. pnpm --filter @bidmorrow/web build
 *   2. (cd apps/web && npx vite preview --port 4173 --strictPort &)
 *   3. node scripts/shoot-marketing-responsive.mjs http://127.0.0.1:4173 <outDir>
 *
 * One-shot capture of our own public pages — no crawling, no login.
 */
/* global document -- referenced only inside page.evaluate (browser context) */
import { mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:4173';
const outDir = process.argv[3] ?? './responsive-shots';

const ROUTES = [
  ['home', '/'],
  ['pricing', '/pricing'],
  ['how-it-works', '/how-it-works'],
  ['methodology', '/methodology'],
  ['pilot', '/pilot'],
  ['contact', '/contact'],
];
const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844, isMobile: true, dsf: 2 },
  { label: 'tablet', width: 768, height: 1024, isMobile: false, dsf: 1 },
  { label: 'desktop', width: 1280, height: 900, isMobile: false, dsf: 1 },
];
const THEMES = ['dark', 'light'];

// The preinstalled Chromium (sandbox provides it; never `playwright install`).
const EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });

let captured = 0;
const overflow = [];
for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      colorScheme: theme,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dsf,
      isMobile: vp.isMobile,
    });
    const page = await ctx.newPage();
    for (const [name, path] of ROUTES) {
      await page.goto(baseURL + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      // Horizontal-overflow guard: body must never scroll sideways.
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (scrolls) overflow.push(`${name} ${vp.label} ${theme}`);
      const file = `${outDir}/${name}-${vp.label}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      captured += 1;
      console.log(`captured ${file}`);
    }
    await ctx.close();
  }
}
await browser.close();

console.log(`\ncaptured ${captured} screenshots`);
if (overflow.length > 0) {
  console.error(`HORIZONTAL OVERFLOW on: ${overflow.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('no horizontal overflow at any viewport/theme');
}
