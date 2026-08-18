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
