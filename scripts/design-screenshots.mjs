#!/usr/bin/env node
/**
 * Design-review screenshots (docs/design-audit.md, docs/design-upgrade-report.md).
 *
 * Renders every public route of a running BidMorrow stack at the review
 * widths, in both colour schemes, and writes PNGs under
 * artifacts/design-review/<label>/ (git-ignored: review evidence, not
 * product code). The hero is additionally captured viewport-only so its
 * composition can be compared before/after without the rest of the page.
 *
 * USAGE
 *   bash scripts/e2e-webserver.sh          # local stack on 127.0.0.1:8787
 *   node scripts/design-screenshots.mjs --label before
 *   node scripts/design-screenshots.mjs --label after --widths 390,1440
 *
 * Options: --base-url (default http://127.0.0.1:8787), --label (required),
 * --widths (default 390,768,1440), --schemes (default light,dark),
 * --routes (comma list; default: all public routes), --full (full-page
 * capture on; default on), --reduced-motion (emulate reduce).
 *
 * Runs the pre-installed sandbox Chromium when PLAYWRIGHT_CHROMIUM_PATH is
 * set (playwright.config.ts uses the same hook); otherwise Playwright's own.
 */
/* global window, document */
// (`page.evaluate` callbacks below run inside the browser page.)
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://127.0.0.1:8787' },
    label: { type: 'string' },
    widths: { type: 'string', default: '390,768,1440' },
    schemes: { type: 'string', default: 'light,dark' },
    routes: { type: 'string' },
    full: { type: 'boolean', default: true },
    'reduced-motion': { type: 'boolean', default: false },
  },
});

if (values.label === undefined) {
  console.error('--label is required (e.g. before, after)');
  process.exit(2);
}

const BASE = values['base-url'].replace(/\/$/, '');
const WIDTHS = values.widths.split(',').map((w) => Number.parseInt(w, 10));
const SCHEMES = values.schemes.split(',');
const OUT = `artifacts/design-review/${values.label}`;
mkdirSync(OUT, { recursive: true });

// Public routes only: marketing + auth entry. App/admin need a session and
// are not part of the marketing audit.
const ALL_ROUTES = [
  ['home', '/'],
  ['pricing', '/pricing'],
  ['how-it-works', '/how-it-works'],
  ['sample-verdicts', '/sample-verdicts'],
  ['cybersecurity-tenders', '/cybersecurity-tenders'],
  ['methodology', '/methodology'],
  ['pilot', '/pilot'],
  ['contact', '/contact'],
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['refunds', '/refunds'],
  ['login', '/login'],
  ['signup', '/signup'],
  ['forgot-password', '/forgot-password'],
];
const ROUTES =
  values.routes === undefined
    ? ALL_ROUTES
    : ALL_ROUTES.filter(([slug]) => values.routes.split(',').includes(slug));

const heightFor = (width) => (width < 600 ? 844 : width < 1000 ? 1024 : 900);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
);

const errors = [];
try {
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: heightFor(width) },
        colorScheme: scheme,
        reducedMotion: values['reduced-motion'] ? 'reduce' : 'no-preference',
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`${scheme}/${width}: ${message.text()}`);
      });
      page.on('pageerror', (error) =>
        errors.push(`${scheme}/${width}: pageerror ${error.message}`),
      );
      let consentDismissed = false;
      for (const [slug, path] of ROUTES) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
        // The consent banner is part of the real first impression (captured
        // separately as `-consent`), but it would hide the lower third of
        // every mobile frame: decline once per context (persists in
        // localStorage) so the remaining captures show the page itself.
        if (!consentDismissed) {
          await page.screenshot({ path: `${OUT}/${slug}-${String(width)}-${scheme}-consent.png` });
          const reject = page.getByRole('button', { name: 'Reject all' });
          if (await reject.count()) {
            await reject.first().click();
            consentDismissed = true;
          }
        }
        // Scroll-reveal content (`[data-reveal]`, lib/use-reveal.ts) only
        // becomes visible once it intersects the viewport, so walk the whole
        // page before a full-page capture; otherwise below-the-fold sections
        // are captured at opacity 0 and read as missing.
        await page.evaluate(async () => {
          // Paced so each IntersectionObserver callback (threshold 0.15) lands
          // while its element is still on screen; a faster walk left
          // below-the-fold sections unrevealed in the first capture set.
          const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 180));
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
          window.scrollTo(0, 0);
        });
        // Let entrance animations settle so the capture is the resting frame.
        await page.waitForTimeout(3200);
        const stem = `${OUT}/${slug}-${String(width)}-${scheme}`;
        await page.screenshot({ path: `${stem}.png`, fullPage: values.full });
        if (slug === 'home') {
          await page.screenshot({ path: `${stem}-hero.png`, fullPage: false });
        }
        // Horizontal overflow check: the document must never be wider than
        // the viewport (docs/design-audit.md responsive gate).
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0)
          errors.push(`${scheme}/${width} ${path}: horizontal overflow ${String(overflow)}px`);
        console.log(`${stem}.png`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (errors.length > 0) {
  console.error(`\n${String(errors.length)} console error(s) / overflow finding(s):`);
  for (const line of errors) console.error(`  ${line}`);
  process.exit(1);
}
console.log('\nno console errors, no horizontal overflow');
