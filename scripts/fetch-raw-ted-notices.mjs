/**
 * Fetches recent REAL competition notices from the TED Search API and saves
 * their raw multilingual XML + search metadata into ./raw-fixtures/.
 *
 * Used ONLY by .github/workflows/ted-fixture-fetch.yml (the session sandbox
 * cannot reach ted.europa.eu — CI can), as raw material for the
 * ted-fixture-refresh skill: the fixtures that land in tests/fixtures/ted/
 * are sanitized + labeled from these by hand, never committed raw.
 *
 * API surface per docs/ted-data-source.md (verified 2026-08-14):
 * POST https://api.ted.europa.eu/v3/notices/search — anonymous, JSON body,
 * expert query with yyyymmdd date literals (same shape
 * packages/procurement/src/run-window.ts uses); `links.xml.MUL` is the
 * authoritative multilingual XML per notice.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

// Node 18+ globals, referenced via globalThis because this repo's
// flat ESLint config declares no runtime globals for scripts/.
const { fetch, AbortSignal } = globalThis;

// Run #1 (2026-08-16, 31976779119) got HTTP 200 with a ZERO-BYTE body for
// every notice XML when fetching links.xml.MUL bare. The website front-end
// (ted.europa.eu, not api.ted.europa.eu) evidently expects a client that
// identifies itself and states what it accepts, so send both and record
// full diagnostics for any response that still is not XML.
const XML_REQUEST_HEADERS = {
  accept: 'application/xml, text/xml;q=0.9, */*;q=0.5',
  'user-agent': 'BidMorrow-fixture-fetch/1.0 (+https://bidmorrow.com; support@bidmorrow.com)',
};

/** True when the body looks like an HTML page rather than notice XML. */
function looksLikeHtml(contentType, body) {
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('html')) return true;
  const head = body.trimStart().slice(0, 15).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

const DAYS_BACK = Number(process.env.DAYS_BACK ?? '5');
const MAX_NOTICES = Number(process.env.MAX_NOTICES ?? '40');
if (!Number.isInteger(DAYS_BACK) || DAYS_BACK < 1 || DAYS_BACK > 30) {
  console.error(`DAYS_BACK must be an integer 1..30, got: ${process.env.DAYS_BACK}`);
  process.exit(1);
}
if (!Number.isInteger(MAX_NOTICES) || MAX_NOTICES < 1 || MAX_NOTICES > 100) {
  console.error(`MAX_NOTICES must be an integer 1..100, got: ${process.env.MAX_NOTICES}`);
  process.exit(1);
}

const since = new Date(Date.now() - DAYS_BACK * 86_400_000);
const ymd = since.toISOString().slice(0, 10).replaceAll('-', '');

const searchBody = {
  query: `form-type = competition AND publication-date >= ${ymd} SORT BY publication-date`,
  fields: [
    'publication-number',
    'publication-date',
    'notice-type',
    'buyer-country',
    'classification-cpv',
    'links',
  ],
  page: 1,
  limit: 100,
  scope: 'LATEST',
  paginationMode: 'PAGE_NUMBER',
  onlyLatestVersions: true,
};

const searchResponse = await fetch('https://api.ted.europa.eu/v3/notices/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(searchBody),
});
if (!searchResponse.ok) {
  console.error(`search failed: HTTP ${searchResponse.status}`);
  console.error((await searchResponse.text()).slice(0, 2000));
  process.exit(1);
}
const search = await searchResponse.json();
const notices = Array.isArray(search.notices) ? search.notices : [];
console.log(`search returned ${notices.length} notices (total ${search.totalNoticeCount})`);
if (notices.length === 0) {
  console.error('no notices in window — widen DAYS_BACK');
  process.exit(1);
}

await mkdir('raw-fixtures/raw', { recursive: true });
await writeFile(
  'raw-fixtures/raw/search-results.json',
  JSON.stringify({ fetchedAt: new Date().toISOString(), request: searchBody, search }, null, 2),
);

// Spread the picks across the whole result page for case diversity
// (different days/countries/notice types) instead of taking one dense run.
const step = Math.max(1, Math.floor(notices.length / MAX_NOTICES));
const picked = notices.filter((_, i) => i % step === 0).slice(0, MAX_NOTICES);

let saved = 0;
const failures = [];
for (const notice of picked) {
  const number = notice['publication-number'];
  const xmlUrl = notice.links?.xml?.MUL;
  if (typeof number !== 'string' || typeof xmlUrl !== 'string') {
    console.log(`skipping row without publication-number/links.xml.MUL`);
    continue;
  }
  const xmlResponse = await fetch(xmlUrl, {
    headers: XML_REQUEST_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await xmlResponse.text();
  const summary = {
    notice: number,
    url: xmlUrl,
    finalUrl: xmlResponse.url,
    status: xmlResponse.status,
    contentType: xmlResponse.headers.get('content-type'),
    bytes: body.length,
  };
  // A zero-byte or HTML body written to disk would silently poison the raw
  // material (run #1 failure mode) — only real XML counts as saved.
  if (!xmlResponse.ok || body.trim().length === 0 || looksLikeHtml(summary.contentType, body)) {
    failures.push({
      ...summary,
      responseHeaders: Object.fromEntries(xmlResponse.headers.entries()),
      bodyPreview: body.slice(0, 400),
    });
    console.log(
      `skip ${number}: status=${String(summary.status)} type=${String(summary.contentType)} bytes=${String(summary.bytes)} finalUrl=${summary.finalUrl}`,
    );
  } else {
    await writeFile(`raw-fixtures/raw/${number}.xml`, body);
    saved += 1;
    console.log(`saved ${number}: ${String(summary.bytes)} bytes (${String(summary.contentType)})`);
  }
  // Polite pacing — no documented quota exists, we do not assume unlimited.
  await sleep(300);
}

await writeFile(
  'raw-fixtures/raw/diagnostics.json',
  JSON.stringify({ fetchedAt: new Date().toISOString(), saved, failures }, null, 2),
);
console.log(`saved ${saved} raw notice XMLs, ${failures.length} failures`);
if (saved === 0) {
  // The push step never runs on failure, so surface the first failure's full
  // diagnostics in the job log — that must be enough to debug from.
  console.error('no XMLs saved — first failure diagnostics:');
  console.error(JSON.stringify(failures[0] ?? null, null, 2));
  process.exit(1);
}
