#!/usr/bin/env node
// Mockup review harness for the website-redesign skill: renders a local
// self-contained HTML mockup at desktop/mobile/dark/reduced-motion
// variants, scrolls through to trigger IntersectionObserver reveals
// (with instant scroll behavior so smooth-scroll pages don't swallow the
// steps), and reports horizontal overflow + console/page errors per
// variant. Full-page PNGs land in $OUTDIR.
//
// Usage: OUTDIR=/path/to/out node review-mockup.mjs /abs/path/mockup.html <name>
// Run from the repo root so @playwright/test resolves; Chromium is
// preinstalled at /opt/pw-browsers/chromium (never `playwright install`).
const { process, console } = globalThis;
import { chromium } from '@playwright/test';

const [, , file, name] = process.argv;
if (!file || !name || !process.env.OUTDIR) {
  console.error('Usage: OUTDIR=<dir> node review-mockup.mjs <mockup.html> <name>');
  process.exit(1);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const variants = [
  ['desktop', 1440, 900, 'light', 'no-preference'],
  ['mobile', 390, 844, 'light', 'no-preference'],
  ['desktop-dark', 1440, 900, 'dark', 'no-preference'],
  ['desktop-rm', 1440, 900, 'light', 'reduce'],
];
let failed = false;
for (const [label, w, h, scheme, rm] of variants) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: scheme,
    reducedMotion: rm,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const { document, window } = globalThis;
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    const total = document.documentElement.scrollHeight;
    for (let y = 0; y <= total; y += 500) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(1800);
  const overflow = await page.evaluate(() => {
    const { document } = globalThis;
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  await page.screenshot({ path: `${process.env.OUTDIR}/${name}--${label}.png`, fullPage: true });
  if (overflow > 0 || errors.length) failed = true;
  console.error(
    `${name} ${label}: overflow=${overflow}px errors=${errors.length}` +
      (errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''),
  );
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
