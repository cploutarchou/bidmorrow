/**
 * Captures full-page screenshots of competitor marketing pages as research
 * material for the website redesign plan (docs/website-redesign-plan.md).
 *
 * Used ONLY by .github/workflows/competitor-screenshots.yml — the session
 * sandbox's egress proxy blocks these hosts, CI runners do not. Public
 * marketing pages only, one-shot capture, no crawling, no login, no data
 * extraction beyond the rendered page image.
 */
import { mkdir, writeFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const TARGETS = [
  { name: 'tendify-home', url: 'https://www.tendify.eu/' },
  { name: 'tendify-pipeline', url: 'https://www.tendify.eu/features/tender-pipeline' },
  { name: 'stotles-home', url: 'https://www.stotles.com/' },
  { name: 'stotles-pricing', url: 'https://www.stotles.com/pricing' },
  { name: 'mercell-home', url: 'https://info.mercell.com/en/' },
  { name: 'tendersdirect-home', url: 'https://www.tendersdirect.co.uk/' },
  { name: 'openopps-home', url: 'https://openopps.com/' },
  { name: 'tenderlake-home', url: 'https://www.tenderlake.com/' },
  { name: 'ted-home', url: 'https://ted.europa.eu/en/' },
  { name: 'linear-home', url: 'https://linear.app/' },
  // Evidence-upgrade targets for the competitive risk assessment
  // (docs/redesign/competitive-risk-assessment.md §9): confirm the
  // snippet-grade Tendly €29 price-collision claim (R1) and the
  // Tenderium/Stotles pricing scope. Public marketing pages only.
  { name: 'tendly-home', url: 'https://tendly.eu/en' },
  { name: 'tendly-pricing', url: 'https://tendly.eu/en/pricing' },
  { name: 'tendly-compare-tendium', url: 'https://tendly.eu/en/compare/tendly-vs-tendium' },
  { name: 'tenderium-home', url: 'https://tenderium.net/' },
  { name: 'tenderium-pricing', url: 'https://tenderium.net/pricing' },
  { name: 'gettenderai-pricing', url: 'https://gettenderai.com/pricing' },
];

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

await mkdir('competitor-shots/raw', { recursive: true });

const browser = await chromium.launch();
let captured = 0;
const failures = [];
for (const target of TARGETS) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.goto(target.url, { waitUntil: 'load', timeout: 45_000 });
      // Give client-side rendering and webfonts a moment to settle.
      await page.waitForTimeout(3_000);
      const file = `competitor-shots/raw/${target.name}--${viewport.label}.png`;
      await page.screenshot({ path: file, fullPage: true });
      captured += 1;
      console.log(`captured ${file}`);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      failures.push({ name: target.name, viewport: viewport.label, url: target.url, message });
      console.log(`FAILED ${target.name} (${viewport.label}): ${message}`);
    } finally {
      await context.close();
    }
  }
}
await browser.close();

await writeFile(
  'competitor-shots/raw/capture-log.json',
  JSON.stringify({ capturedAt: new Date().toISOString(), captured, failures }, null, 2),
);
console.log(`captured ${captured} screenshots, ${failures.length} failures`);
if (captured === 0) {
  console.error('no screenshots captured — inspect the failure log above');
  process.exit(1);
}
