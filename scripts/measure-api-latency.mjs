#!/usr/bin/env node
/**
 * API latency measurement (F-06, PRODUCTION_READINESS_AUDIT.md).
 *
 * `docs/production-checklist.md` requires "API p95 < 500 ms excluding
 * upstream calls". That target existed only as prose — nothing had ever
 * measured it, so the box could not honestly be checked. This is the
 * measurement.
 *
 * WHAT IT MEASURES. Wall-clock time for a complete HTTP request/response
 * against a running BidMorrow worker, per route, over N iterations, reported
 * as p50/p95/p99. "Excluding upstream calls" is satisfied by route choice,
 * not by instrumentation: every route below is served from D1 alone. Nothing
 * here touches TED, Paddle or Resend.
 *
 * WHAT IT DOES NOT MEASURE. Against a local `wrangler dev` stack this covers
 * handler + D1 time with no network and no edge; real staging adds TLS, the
 * Cloudflare edge and remote-D1 latency on top. A local run is therefore a
 * FLOOR, not a prediction of production p95 — read the recorded numbers with
 * the environment they were taken in, which the output always states.
 *
 * USAGE
 *   node scripts/measure-api-latency.mjs [--base-url URL] [--iterations N]
 *                                        [--budget-ms MS] [--json]
 *
 * Against the local stack, start it first (the same one Playwright uses):
 *   bash scripts/e2e-webserver.sh    # 127.0.0.1:8787, builds + migrates + seeds
 *   node scripts/measure-api-latency.mjs
 *
 * Exits 1 if any route's p95 exceeds the budget, so this can gate.
 *
 * Authenticated routes need a real session. Rather than inventing one, the
 * script runs the actual signup -> verify -> sign-in flow over the API,
 * reading the verification link from the double-gated `/api/test/mailbox`
 * hook — the same hook the e2e suite uses, which 404s outside a local/test
 * environment with `E2E_TEST_HOOKS=true`. So this script runs against a local
 * or test stack by construction; pointed at staging or production it will
 * fail fast on the mailbox fetch rather than half-measure.
 */
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    // 127.0.0.1, not localhost: Better Auth's trustedOrigins is exactly
    // APP_BASE_URL, which scripts/e2e-write-dev-vars.mjs sets to
    // http://127.0.0.1:8787. A localhost origin is rejected as INVALID_ORIGIN.
    'base-url': { type: 'string', default: 'http://127.0.0.1:8787' },
    // A pre-seeded account (staging: the CI perf probe). When given, the
    // script signs straight in — no signup, no test mailbox — so it can
    // measure staging (F-06). Password comes from PERF_PASSWORD.
    email: { type: 'string' },
    // Pause between samples. Staging limits /api/org/* to 100 req/min per
    // IP — an unpaced run measures 429s, not routes. ~700 ms keeps a full
    // run under the limit; local runs keep 0.
    'delay-ms': { type: 'string', default: '0' },
    iterations: { type: 'string', default: '40' },
    'budget-ms': { type: 'string', default: '500' },
    json: { type: 'boolean', default: false },
  },
});

const BASE = values['base-url'].replace(/\/$/, '');
const ITERATIONS = Number.parseInt(values.iterations, 10);
const BUDGET_MS = Number.parseInt(values['budget-ms'], 10);
const DELAY_MS = Number.parseInt(values['delay-ms'], 10);
const SEEDED_EMAIL = values.email;
const PASSWORD =
  SEEDED_EMAIL === undefined
    ? 'correct horse battery staple 1!'
    : (process.env.PERF_PASSWORD ?? '');
if (SEEDED_EMAIL !== undefined && PASSWORD.length === 0) {
  console.error('--email requires PERF_PASSWORD in the environment');
  process.exit(2);
}

if (!Number.isFinite(ITERATIONS) || ITERATIONS < 5) {
  console.error('--iterations must be an integer >= 5');
  process.exit(2);
}

function percentile(sorted, p) {
  // Nearest-rank: the smallest value at or above the p-th percentile of the
  // sample. No interpolation — with N in the tens, an interpolated p95 would
  // imply a precision the sample does not have.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

async function timed(fetchFn) {
  const started = performance.now();
  const response = await fetchFn();
  // Drain the body: the response is not "complete" until it is read, and a
  // route that streams a large payload would otherwise look artificially fast.
  await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status };
}

async function establishSession() {
  if (SEEDED_EMAIL !== undefined) {
    // Seeded-account path: the account and its org already exist (created
    // once, credentials in CI secrets) — sign in and go.
    const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: SEEDED_EMAIL, password: PASSWORD }),
    });
    if (!signIn.ok) throw new Error(`seeded sign-in failed (${String(signIn.status)})`);
    const seededCookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');
    if (seededCookie.length === 0) throw new Error('seeded sign-in returned no session cookie');
    return seededCookie;
  }
  const email = `perf-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@example.test`;

  const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Perf Probe' }),
  });
  if (!signUp.ok) {
    throw new Error(
      `sign-up failed (${String(signUp.status)}). If this is a pre-launch environment, ` +
        `registrations are closed by design.`,
    );
  }

  const mailbox = await fetch(`${BASE}/api/test/mailbox?to=${encodeURIComponent(email)}`);
  if (!mailbox.ok) {
    throw new Error(
      `/api/test/mailbox returned ${String(mailbox.status)}. This script needs the ` +
        `double-gated e2e hooks (local/test env with E2E_TEST_HOOKS=true); it cannot ` +
        `measure authenticated routes against staging or production.`,
    );
  }
  const { mails } = await mailbox.json();
  const verification = [...mails].reverse().find((mail) => mail.kind === 'verification');
  if (verification === undefined) throw new Error('no verification mail captured');
  // Follow the link exactly as a user would.
  await fetch(verification.url, { redirect: 'manual' });

  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed (${String(signIn.status)})`);
  const cookie = (signIn.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  if (cookie.length === 0) throw new Error('sign-in returned no session cookie');

  const org = await fetch(`${BASE}/api/org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify({ name: 'Perf Probe Ltd' }),
  });
  if (!org.ok && org.status !== 409) {
    throw new Error(`org creation failed (${String(org.status)})`);
  }
  return cookie;
}

const results = [];

async function measure(label, path, init = {}) {
  const samples = [];
  const statuses = new Set();
  // One warm-up: the first request to a cold isolate pays module-init and
  // connection setup that no subsequent real request pays, and including it
  // would make p99 a measurement of startup rather than of the route.
  await timed(() => fetch(`${BASE}${path}`, init));
  for (let i = 0; i < ITERATIONS; i += 1) {
    if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    const { ms, status } = await timed(() => fetch(`${BASE}${path}`, init));
    samples.push(ms);
    statuses.add(status);
  }
  // A route that answered 4xx/5xx measured an ERROR path — a rejected query
  // or an auth failure short-circuits before the work the budget is about,
  // and reporting that as the route's latency would be a fabricated number.
  // Fail loudly instead of quietly publishing a fast wrong answer.
  const bad = [...statuses].filter((status) => status < 200 || status >= 300);
  if (bad.length > 0) {
    console.error(
      `\n${label} (${path}) returned ${bad.join(',')} — that is an error path, not the ` +
        `route's real work. Fix the request (or the session setup) before trusting any ` +
        `number for it.`,
    );
    process.exit(2);
  }
  samples.sort((a, b) => a - b);
  results.push({
    label,
    path,
    statuses: [...statuses].sort((a, b) => a - b),
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: samples[samples.length - 1],
  });
}

const cookie = await establishSession();
const authed = { headers: { cookie } };

// Every route below is served from D1 alone — no TED, Paddle or Resend call
// on any of these paths, which is what "excluding upstream calls" means.
await measure('health (readiness, 1 D1 read)', '/api/health/ready');
await measure('public config (flags)', '/api/public-config');
await measure('account me', '/api/account/me', authed);
await measure('org profile bundle', '/api/org/profile', authed);
await measure('feed, first page', '/api/org/feed?tab=today', authed);
await measure('feed, saved shelf', '/api/org/feed?tab=saved', authed);
await measure('feed stats (7 counts)', '/api/org/feed/stats', authed);
await measure('saved searches', '/api/org/saved-searches', authed);

const breaches = results.filter((row) => row.p95 > BUDGET_MS);

if (values.json) {
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE,
        iterations: ITERATIONS,
        budgetMs: BUDGET_MS,
        results,
        ok: breaches.length === 0,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `\nAPI latency — ${BASE}, ${String(ITERATIONS)} iterations/route, budget p95 < ${String(BUDGET_MS)} ms`,
  );
  console.log(
    'Wall-clock per request including body read. Local runs exclude network and edge — a floor, not a production prediction.\n',
  );
  const pad = (value, width) => String(value).padEnd(width);
  const num = (value) => `${value.toFixed(1)} ms`.padStart(10);
  console.log(
    `${pad('route', 34)}${pad('status', 9)}${'p50'.padStart(10)}${'p95'.padStart(10)}${'p99'.padStart(10)}`,
  );
  for (const row of results) {
    console.log(
      `${pad(row.label, 34)}${pad(row.statuses.join(','), 9)}${num(row.p50)}${num(row.p95)}${num(row.p99)}`,
    );
  }
  console.log(
    breaches.length === 0
      ? `\nAll routes within budget (p95 < ${String(BUDGET_MS)} ms).`
      : `\nOVER BUDGET: ${breaches.map((row) => row.label).join(', ')}`,
  );
}

process.exit(breaches.length === 0 ? 0 : 1);
