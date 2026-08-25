#!/usr/bin/env node
/**
 * BidMorrow run driver — launches the local stack and drives the REAL app
 * (marketing site + authenticated product) programmatically.
 *
 * Companion to .claude/skills/run-bidmorrow/SKILL.md. Agent tooling, not
 * product surface: it is allowed to be blunt.
 *
 * Why Playwright and not the E2E suite: `pnpm test:e2e` asserts and exits.
 * This drives a live stack you can keep poking — screenshot any route, dump
 * text, hit the API with the session cookie, or open a REPL.
 *
 * It deliberately REUSES tests/e2e/helpers.ts for signup/onboarding rather
 * than re-encoding the wizard's steps, so when onboarding changes the driver
 * follows the same source of truth the E2E suite does. Node 22+/24 strips the
 * .ts types natively; Playwright's `expect` works fine outside the runner.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const STATE = join(ROOT, '.run-state');
const SHOTS = join(STATE, 'shots');
const STORAGE = join(STATE, 'storage.json');
const ACCOUNT = join(STATE, 'account.json');
const SERVER_LOG = join(STATE, 'server.log');
const SERVER_PID = join(STATE, 'server.pid');

const BASE = process.env.BIDMORROW_BASE_URL ?? 'http://127.0.0.1:8787';

// System Chrome. This container has /usr/bin/google-chrome and no downloaded
// Playwright browsers; `npx playwright install` needs network + ~150MB, and
// the repo's own playwright.config.ts already honours a preinstalled binary
// via PLAYWRIGHT_CHROMIUM_PATH. Same idea here, same env var name.
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/usr/bin/google-chrome';
// --no-sandbox: Chrome's setuid sandbox does not work in an unprivileged
// container; without it every launch dies with "Running as root without
// --no-sandbox is not supported" / a namespace error.
const LAUNCH = { executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] };

mkdirSync(SHOTS, { recursive: true });

const die = (msg) => {
  console.error(`[driver] ${msg}`);
  process.exit(1);
};
const log = (msg) => console.log(`[driver] ${msg}`);

/* ------------------------------------------------------------------ stack */

async function isLive() {
  try {
    const r = await fetch(`${BASE}/api/health/live`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitLive(seconds) {
  for (let i = 0; i < seconds; i += 1) {
    if (await isLive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function up() {
  if (await isLive()) {
    log(`already live at ${BASE}`);
    return;
  }
  log('starting stack (build SPA -> .dev.vars -> reset D1 -> migrate -> seed -> wrangler dev)...');
  // A cold start resets local D1, so any saved session/account belongs to a
  // database that no longer exists. Drop them so `smoke` (and `requireLive`
  // callers) re-bootstrap instead of driving the app with a dead cookie.
  rmSync(STORAGE, { force: true });
  rmSync(ACCOUNT, { force: true });
  // scripts/e2e-webserver.sh is the same command playwright.config.ts uses as
  // its webServer, so `up` and `pnpm test:e2e` produce an identical stack.
  const out = openSync(SERVER_LOG, 'a');
  const child = spawn('bash', ['scripts/e2e-webserver.sh'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  writeFileSync(SERVER_PID, String(child.pid));
  // Cold start = vite build + migrations + seed + workerd boot. 180s matches
  // the repo's own playwright webServer timeout.
  if (!(await waitLive(180))) {
    die(`stack did not become live within 180s — see ${SERVER_LOG}`);
  }
  log(`live at ${BASE} (log: ${SERVER_LOG})`);
}

function down() {
  if (!existsSync(SERVER_PID)) {
    log('no pid file; nothing started by this driver');
  } else {
    const pid = Number(readFileSync(SERVER_PID, 'utf8').trim());
    try {
      // The script `exec`s wrangler, but wrangler forks workerd children —
      // kill the whole process group (negative pid; `detached: true` above
      // made this process a group leader).
      process.kill(-pid, 'SIGTERM');
      log(`sent SIGTERM to process group ${pid}`);
    } catch (e) {
      log(`could not signal ${pid}: ${e.message}`);
    }
    rmSync(SERVER_PID, { force: true });
  }
  // wrangler dev can survive its parent; make sure :8787 is actually free.
  // `[w]rangler` not `wrangler`: pkill -f matches against full command lines,
  // INCLUDING the `bash -c` we are spawning here, so the literal pattern makes
  // the shell kill itself (exit 143/144) before it ever signals wrangler.
  spawn('bash', ['-c', "pkill -f '[w]rangler dev --port 8787' || true"], { stdio: 'ignore' });
}

async function requireLive() {
  if (!(await isLive()))
    die(`nothing listening at ${BASE} — run: node .claude/skills/run-bidmorrow/driver.mjs up`);
}

/* --------------------------------------------------------------- browser */

async function newContext({ authed = true } = {}) {
  const browser = await chromium.launch(LAUNCH);
  const useStorage = authed && existsSync(STORAGE);
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 900 },
    ...(useStorage ? { storageState: STORAGE } : {}),
  });
  return { browser, context };
}

/**
 * The marketing pages open with a cookie-consent banner that covers the
 * bottom of every screenshot and intercepts clicks near it. Dismiss it.
 * Harmless on /app routes where the banner is absent.
 */
async function dismissConsent(page) {
  const reject = page.getByRole('button', { name: 'Reject all' });
  if ((await reject.count()) > 0 && (await reject.first().isVisible())) {
    await reject.first().click();
    await page.waitForTimeout(200);
  }
}

async function gotoRoute(page, route) {
  await page.goto(route, { waitUntil: 'networkidle' });
  await dismissConsent(page);
  // Every /app route is lazy-loaded behind a Suspense boundary; the shell can
  // paint before the page chunk resolves. Wait for the skeletons to clear.
  await page
    .locator('.route-loading, [aria-busy="true"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => {});
}

/* ------------------------------------------------------------- bootstrap */

async function bootstrap(prefix = 'Driver Co') {
  await requireLive();
  const helpers = await import(join(ROOT, 'tests/e2e/helpers.ts'));
  const { browser, context } = await newContext({ authed: false });
  const page = await context.newPage();
  log(`signing up + onboarding "${prefix}" through the real UI (takes ~30-60s)...`);
  const { email } = await helpers.bootstrapOnboardedUserWithMatches(page, prefix);
  await context.storageState({ path: STORAGE });
  writeFileSync(
    ACCOUNT,
    JSON.stringify({ email, password: helpers.TEST_PASSWORD, orgPrefix: prefix }, null, 2),
  );
  await browser.close();
  log(`onboarded account: ${email}`);
  log(`session saved to ${STORAGE} — later commands reuse it`);
}

function account() {
  if (!existsSync(ACCOUNT)) die('no bootstrapped account — run: driver.mjs bootstrap');
  return JSON.parse(readFileSync(ACCOUNT, 'utf8'));
}

/* -------------------------------------------------------------- commands */

function shotPath(route, name) {
  if (name !== undefined) return isAbsolute(name) ? name : join(SHOTS, name);
  const slug = route.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home';
  return join(SHOTS, `${slug}.png`);
}

async function shot(route, name, { full = false } = {}) {
  await requireLive();
  const { browser, context } = await newContext();
  const page = await context.newPage();
  await gotoRoute(page, route);
  const path = shotPath(route, name);
  await page.screenshot({ path, fullPage: full });
  await browser.close();
  log(`${route} -> ${path}`);
  return path;
}

async function text(route) {
  await requireLive();
  const { browser, context } = await newContext();
  const page = await context.newPage();
  await gotoRoute(page, route);
  const body = await page.locator('body').innerText();
  console.log(`URL: ${page.url()}`);
  console.log(`TITLE: ${await page.title()}`);
  console.log('---');
  console.log(body);
  await browser.close();
}

async function consoleDump(route) {
  await requireLive();
  const { browser, context } = await newContext();
  const page = await context.newPage();
  const lines = [];
  page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) =>
    lines.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
  );
  await gotoRoute(page, route);
  await page.waitForTimeout(500);
  console.log(lines.length > 0 ? lines.join('\n') : '(no console output)');
  await browser.close();
}

/**
 * Authenticated API call using the bootstrapped session cookies, so you can
 * hit /api/org/*, /api/test/* etc. without re-doing auth in curl.
 */
async function api(method, path, bodyJson) {
  await requireLive();
  const { browser, context } = await newContext();
  const req = context.request;
  const opts = bodyJson === undefined ? {} : { data: JSON.parse(bodyJson) };
  const res = await req.fetch(path, { method: method.toUpperCase(), ...opts });
  console.log(`${res.status()} ${method.toUpperCase()} ${path}`);
  console.log(await res.text());
  await browser.close();
}

/** Re-run the real scoring engine (test hook) — after seeding or ingesting. */
async function scoreNow() {
  await api('POST', '/api/test/score-now');
}

/* ------------------------------------------------------------------ repl */

const REPL_HELP = `commands:
  goto <route>              navigate (consent banner auto-dismissed)
  url                       print current url + title
  text [selector]           innerText of body or selector
  ss [name]                 screenshot -> .run-state/shots/<name|repl>.png
  ssfull [name]             full-page screenshot
  click <role> <name>       getByRole(role, {name}).click()   e.g. click button "Save & continue"
  fill <label> <value>      getByLabel(label).fill(value)
  count <selector>          locator count
  eval <js>                 page.evaluate(() => <js>)
  size <w> <h>              resize viewport (mobile checks)
  help / quit`;

function splitArgs(line) {
  // Supports: click button "Save & continue"
  return (line.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''));
}

async function repl() {
  await requireLive();
  const { browser, context } = await newContext();
  const page = await context.newPage();
  await gotoRoute(page, '/');
  console.log(REPL_HELP);
  console.log(`[repl] at ${page.url()}`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const raw = line.trim();
    if (raw === '') continue;
    const [cmd, ...args] = splitArgs(raw);
    try {
      switch (cmd) {
        case 'goto':
          await gotoRoute(page, args[0]);
          console.log(`[repl] ${page.url()}`);
          break;
        case 'url':
          console.log(`${page.url()} | ${await page.title()}`);
          break;
        case 'text':
          console.log(
            await page
              .locator(args[0] ?? 'body')
              .first()
              .innerText(),
          );
          break;
        case 'ss':
        case 'ssfull': {
          const p = join(SHOTS, `${args[0] ?? 'repl'}.png`);
          await page.screenshot({ path: p, fullPage: cmd === 'ssfull' });
          console.log(`[repl] -> ${p}`);
          break;
        }
        case 'click':
          await page.getByRole(args[0], { name: args[1] }).first().click();
          // The feed's tender cards open a slide-over with a CSS transition;
          // 400ms screenshots it mid-animation. Settle the network, then the
          // animation.
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(800);
          console.log(`[repl] clicked; now ${page.url()}`);
          break;
        case 'fill':
          await page.getByLabel(args[0]).fill(args.slice(1).join(' '));
          console.log('[repl] filled');
          break;
        case 'count':
          console.log(await page.locator(args.join(' ')).count());
          break;
        case 'eval':
          console.log(JSON.stringify(await page.evaluate(args.join(' ')), null, 2));
          break;
        case 'size':
          await page.setViewportSize({ width: Number(args[0]), height: Number(args[1]) });
          console.log('[repl] resized');
          break;
        case 'help':
          console.log(REPL_HELP);
          break;
        case 'quit':
        case 'exit':
          rl.close();
          await browser.close();
          return;
        default:
          console.log(`[repl] unknown: ${cmd}`);
      }
    } catch (e) {
      console.log(`[repl] ERROR: ${String(e).split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  await browser.close();
}

/* ----------------------------------------------------------------- smoke */

/** One end-to-end pass: stack up, real account, screenshots of every surface. */
async function smoke() {
  await up();
  if (!existsSync(STORAGE)) await bootstrap('Smoke Co');
  const routes = ['/', '/pricing', '/how-it-works', '/app', '/app/settings'];
  for (const r of routes) await shot(r, undefined, { full: false });
  await requireLive();
  const { browser, context } = await newContext();
  const page = await context.newPage();
  await gotoRoute(page, '/app');
  const cards = await page.locator('article.tender-card').count();
  const title = await page
    .locator('article.tender-card')
    .first()
    .innerText()
    .catch(() => '(none)');
  await browser.close();
  log(`feed shows ${cards} tender card(s)`);
  log(`first card:\n${title}`);
  if (cards === 0) die('feed is empty — scoring did not produce matches');
  log('smoke OK');
}

/* ------------------------------------------------------------------ main */

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  up,
  down: async () => down(),
  status: async () => log((await isLive()) ? `live at ${BASE}` : `not running at ${BASE}`),
  bootstrap: () => bootstrap(rest[0]),
  whoami: async () => console.log(JSON.stringify(account(), null, 2)),
  shot: () => shot(rest[0] ?? '/', rest[1]),
  shotfull: () => shot(rest[0] ?? '/', rest[1], { full: true }),
  text: () => text(rest[0] ?? '/'),
  console: () => consoleDump(rest[0] ?? '/'),
  api: () => api(rest[0], rest[1], rest[2]),
  'score-now': scoreNow,
  repl,
  smoke,
};

if (cmd === undefined || commands[cmd] === undefined) {
  console.log(`usage: node .claude/skills/run-bidmorrow/driver.mjs <command>

  up | down | status         start / stop / check the local stack (:8787)
  smoke                      up + bootstrap + screenshot every surface
  bootstrap [OrgPrefix]      real signup -> verify -> onboard -> score; saves session
  whoami                     the bootstrapped account
  shot <route> [name]        screenshot a route as that user
  shotfull <route> [name]    full-page screenshot
  text <route>               dump rendered text
  console <route>            console / pageerror / failed requests
  api <METHOD> <path> [json] authenticated API call
  score-now                  re-run the scoring engine (test hook)
  repl                       interactive browser session (see 'help' inside)
`);
  process.exit(cmd === undefined ? 0 : 1);
}

await commands[cmd]();
