/**
 * TED notice-XML fetch diagnostic (2026-08-18 staging ingest incident).
 *
 * Reproduces, from CI (the session sandbox cannot reach ted.europa.eu — CI
 * can), EXACTLY what the deployed worker's ingestion did for one
 * publication-date window: the production scope search, then the notice-XML
 * download for each returned row — in several header variants — and prints
 * full response diagnostics (status, final URL, content type, body size,
 * body head). Read the run log to see which variant the ted.europa.eu
 * front-end refuses (HTTP 200 + empty body is its documented refusal shape,
 * docs/ted-data-source.md).
 *
 * Used ONLY by .github/workflows/ted-diagnose.yml. Diagnostic: always exits
 * 0 unless the SEARCH itself fails; the per-variant results are the output.
 */

// Node 18+ globals via globalThis (scripts/ eslint config declares no runtime globals).
const { fetch, AbortSignal, setTimeout } = globalThis;

const DATE = process.env.WINDOW_DATE ?? '2026-08-17';
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`WINDOW_DATE must be YYYY-MM-DD, got: ${DATE}`);
  process.exit(1);
}
const ymd = DATE.replaceAll('-', '');

// Mirrors packages/ted/src/client.ts TED_USER_AGENT + XML_ACCEPT and
// packages/procurement/src/scope.ts buildScopeQuery for the default scope.
const PROD_UA = 'BidMorrow/1.0 (+https://bidmorrow.com; support@bidmorrow.com)';
const XML_ACCEPT = 'application/xml, text/xml;q=0.9, */*;q=0.5';
const QUERY =
  `classification-cpv IN (72*, 48*, 79417000) AND form-type = competition ` +
  `AND publication-date >= ${ymd} AND publication-date <= ${ymd} SORT BY publication-date`;

console.log(`window: ${DATE}`);
console.log(`query:  ${QUERY}`);

const searchResponse = await fetch('https://api.ted.europa.eu/v3/notices/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': PROD_UA,
  },
  body: JSON.stringify({
    query: QUERY,
    fields: ['publication-number', 'publication-date', 'links'],
    limit: 250,
    paginationMode: 'ITERATION',
  }),
  signal: AbortSignal.timeout(30_000),
});
console.log(`search: HTTP ${searchResponse.status}`);
if (!searchResponse.ok) {
  console.error((await searchResponse.text()).slice(0, 2000));
  process.exit(1);
}
const search = await searchResponse.json();
const notices = Array.isArray(search.notices) ? search.notices : [];
console.log(
  `search returned ${notices.length} notices (totalNoticeCount ${search.totalNoticeCount})`,
);

const VARIANTS = [
  { name: 'prod-headers (worker parity)', headers: { Accept: XML_ACCEPT, 'User-Agent': PROD_UA } },
  {
    name: 'prod-headers, redirect:manual',
    headers: { Accept: XML_ACCEPT, 'User-Agent': PROD_UA },
    redirect: 'manual',
  },
  { name: 'bare fetch (control — expect refusal)', headers: {} },
  {
    name: 'browser-like UA + Accept-Language',
    headers: {
      Accept: XML_ACCEPT,
      'Accept-Language': 'en',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
  },
];

for (const notice of notices.slice(0, 5)) {
  const number = notice['publication-number'];
  const xmlUrl = notice.links?.xml?.MUL;
  console.log(`\n=== notice ${String(number)} ===`);
  console.log(`xml url: ${String(xmlUrl)}`);
  if (typeof xmlUrl !== 'string') continue;

  for (const variant of VARIANTS) {
    try {
      const res = await fetch(xmlUrl, {
        headers: variant.headers,
        redirect: variant.redirect ?? 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      const body = variant.redirect === 'manual' ? '' : await res.text();
      const head = body.trimStart().slice(0, 120).replaceAll('\n', ' ');
      console.log(
        `[${variant.name}] status=${String(res.status)} finalUrl=${res.url} ` +
          `content-type=${String(res.headers.get('content-type'))} ` +
          `content-length=${String(res.headers.get('content-length'))} bodyBytes=${String(body.length)}`,
      );
      if (variant.redirect === 'manual') {
        console.log(`  location=${String(res.headers.get('location'))}`);
      } else {
        console.log(`  bodyHead: ${head}`);
      }
    } catch (cause) {
      console.log(
        `[${variant.name}] FETCH ERROR: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}
console.log('\ndiagnostic complete');

// ---------------------------------------------------------------------------
// v2 probes (2026-08-18): the /en/notice/<id>/xml front-end now answers HTTP
// 202 + empty body to EVERY client (see run 32131289081) — find the working
// download route.
// ---------------------------------------------------------------------------

const first = notices[0];
if (first !== undefined) {
  console.log('\n=== v2: full links object of first row ===');
  console.log(JSON.stringify(first.links ?? null, null, 2));

  const num = String(first['publication-number']);
  const xmlUrl = first.links?.xml?.MUL;

  // Probe A: 202-as-async — re-GET the same URL with growing delays.
  if (typeof xmlUrl === 'string') {
    console.log('\n=== v2 probe A: retry-after-delay on the 202 URL ===');
    for (const delayMs of [0, 5_000, 20_000]) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const res = await fetch(xmlUrl, {
        headers: { Accept: XML_ACCEPT, 'User-Agent': PROD_UA },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.text();
      console.log(
        `after +${String(delayMs)}ms: status=${String(res.status)} bytes=${String(body.length)} ` +
          `head=${body.trimStart().slice(0, 80).replaceAll('\n', ' ')}`,
      );
      if (body.length > 0) break;
    }
  }

  // Probe B: candidate API-host endpoints for the notice document.
  console.log('\n=== v2 probe B: candidate api.ted.europa.eu endpoints ===');
  const candidates = [
    `https://api.ted.europa.eu/v3/notices/${num}/xml`,
    `https://api.ted.europa.eu/v3/notices/${num}`,
    `https://ted.europa.eu/en/notice/${num}/xml?download=true`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { Accept: XML_ACCEPT, 'User-Agent': PROD_UA },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.text();
      console.log(
        `${url} -> status=${String(res.status)} ct=${String(res.headers.get('content-type'))} ` +
          `bytes=${String(body.length)} head=${body.trimStart().slice(0, 100).replaceAll('\n', ' ')}`,
      );
    } catch (cause) {
      console.log(`${url} -> ERROR ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  // Probe C: current API docs text — what do they say about notice XML now?
  console.log('\n=== v2 probe C: docs.ted.europa.eu grep ===');
  for (const docUrl of [
    'https://docs.ted.europa.eu/api/latest/index.html',
    'https://ted.europa.eu/en/simap/developers-corner',
  ]) {
    try {
      const res = await fetch(docUrl, {
        headers: { 'User-Agent': PROD_UA },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      console.log(`\n--- ${docUrl} (HTTP ${String(res.status)}, ${String(text.length)} bytes) ---`);
      const lines = text
        .split('\n')
        .filter((line) => /xml|download|202|package/i.test(line))
        .slice(0, 40);
      for (const line of lines) console.log(line.trim().slice(0, 200));
    } catch (cause) {
      console.log(`${docUrl} -> ERROR ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}
console.log('\nv2 probes complete');

// ---------------------------------------------------------------------------
// v3 probe (2026-08-18): the /xml endpoint renders ASYNC (202 first, 200 +
// XML once cached — proven by probe A across runs). Decisive question: does
// `?download=true` bypass the async render on a COLD notice? Tested on rows
// 10..12, untouched by earlier runs; row 13 without the param is the cold
// control (expected 202).
// ---------------------------------------------------------------------------

console.log('\n=== v3 probe: ?download=true on COLD notices ===');
for (const [offset, withParam] of [
  [10, true],
  [11, true],
  [12, true],
  [13, false],
]) {
  const row = notices[offset];
  const base = row?.links?.xml?.MUL;
  if (typeof base !== 'string') continue;
  const url = withParam ? `${base}?download=true` : base;
  try {
    const res = await fetch(url, {
      headers: { Accept: XML_ACCEPT, 'User-Agent': PROD_UA },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    console.log(
      `[row ${String(offset)}${withParam ? ' +download=true' : ' (cold control)'}] ${url}` +
        ` -> status=${String(res.status)} ct=${String(res.headers.get('content-type'))}` +
        ` bytes=${String(body.length)} head=${body.trimStart().slice(0, 80).replaceAll('\n', ' ')}`,
    );
  } catch (cause) {
    console.log(
      `[row ${String(offset)}] ERROR ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}
console.log('v3 probe complete');
