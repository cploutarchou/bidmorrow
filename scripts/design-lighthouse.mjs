#!/usr/bin/env node
/**
 * Lighthouse pass for design review: the same five page/preset pairs as
 * the 2026-09-01 baseline (docs/design-audit.md), run against a local
 * stack or staging, with JSON + HTML reports under
 * artifacts/design-review/lighthouse/<label>/ and a Markdown table on
 * stdout (CI appends it to the job summary).
 *
 *   node scripts/design-lighthouse.mjs --label after --base-url http://127.0.0.1:8787
 *
 * Options: --label (required), --base-url (default http://127.0.0.1:8787),
 * --chrome (Chrome/Chromium binary; defaults to $CHROME_PATH, then
 * Playwright's Chromium), --pages (comma list of names below; default all).
 * Uses `npx --yes lighthouse@12`, which is not a workspace dependency
 * (docs/design-dependencies.md).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    label: { type: 'string' },
    'base-url': { type: 'string', default: 'http://127.0.0.1:8787' },
    chrome: { type: 'string' },
    pages: { type: 'string' },
  },
});
if (values.label === undefined) {
  console.error('--label is required (e.g. before, after, staging)');
  process.exit(2);
}

const PAGES = {
  'home-mobile': { path: '/', preset: 'perf' },
  'home-desktop': { path: '/', preset: 'desktop' },
  'pricing-mobile': { path: '/pricing', preset: 'perf' },
  'how-mobile': { path: '/how-it-works', preset: 'perf' },
  'sample-mobile': { path: '/sample-verdicts', preset: 'perf' },
};
const names = values.pages === undefined ? Object.keys(PAGES) : values.pages.split(',');
const base = values['base-url'].replace(/\/$/, '');
const out = `artifacts/design-review/lighthouse/${values.label}`;
mkdirSync(out, { recursive: true });
const chrome =
  values.chrome ??
  process.env.CHROME_PATH ??
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  chromium.executablePath();

const rows = [];
let failed = false;
for (const name of names) {
  const page = PAGES[name];
  if (page === undefined) {
    console.error(`unknown page ${name}; known: ${Object.keys(PAGES).join(', ')}`);
    process.exit(2);
  }
  const result = spawnSync(
    'npx',
    [
      '--yes',
      'lighthouse@12',
      `${base}${page.path}`,
      '--quiet',
      '--output=json',
      '--output=html',
      `--output-path=${out}/${name}`,
      `--preset=${page.preset}`,
      '--only-categories=performance,accessibility,best-practices,seo',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
    ],
    { env: { ...process.env, CHROME_PATH: chrome }, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    failed = true;
    console.error(`${name}: lighthouse exited ${String(result.status)}\n${result.stderr}`);
    continue;
  }
  const report = JSON.parse(readFileSync(`${out}/${name}.report.json`, 'utf8'));
  const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
  const audit = (id) => report.audits[id]?.displayValue ?? '';
  rows.push(
    `| ${name} | ${score('performance')} | ${score('accessibility')} | ${score('best-practices')} | ${score('seo')} | ${audit('largest-contentful-paint')} | ${audit('cumulative-layout-shift')} | ${audit('total-blocking-time')} |`,
  );
}

console.log(`Lighthouse 12, label \`${values.label}\`, base ${base}\n`);
console.log('| Page | Perf | A11y | BP | SEO | LCP | CLS | TBT |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(row);
if (failed) process.exit(1);
