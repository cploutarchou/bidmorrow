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
for (const notice of picked) {
  const number = notice['publication-number'];
  const xmlUrl = notice.links?.xml?.MUL;
  if (typeof number !== 'string' || typeof xmlUrl !== 'string') {
    console.log(`skipping row without publication-number/links.xml.MUL`);
    continue;
  }
  const xmlResponse = await fetch(xmlUrl);
  if (!xmlResponse.ok) {
    console.log(`skip ${number}: XML fetch HTTP ${xmlResponse.status}`);
    continue;
  }
  await writeFile(`raw-fixtures/raw/${number}.xml`, await xmlResponse.text());
  saved += 1;
  // Polite pacing — no documented quota exists, we do not assume unlimited.
  await new Promise((resolve) => setTimeout(resolve, 300));
}
console.log(`saved ${saved} raw notice XMLs`);
if (saved === 0) {
  console.error('no XMLs saved — inspect the skip logs above');
  process.exit(1);
}
