/**
 * Pre-first-ingestion gates (docs/deployment.md, Phase 13): LIVE checks
 * against the real TED Search API. Gated behind `TED_LIVE=1` because normal
 * CI / dev environments must stay network-free — these tests run only from
 * the dispatchable `.github/workflows/ted-gates.yml` (GitHub runners have
 * open egress to api.ted.europa.eu).
 *
 * Gate 1 (TED-P5-01): round-trip the composed scope query through the live
 * API with `checkQuerySyntax: true` — proves the expert-query grammar in
 * `buildScopeQuery` is accepted before any real ingestion window runs.
 *
 * Gate 2 (volume measurement): one bounded request per day for the last 7
 * fully-published days, reading `totalNoticeCount` only (limit=1, one
 * field) — records actual scoped notices/day vs the 150–300/day planning
 * assumption (docs/cost-model.md, ADR-0003). This test MEASURES and
 * prints; the accept/tighten-scope decision is recorded in the ledger by a
 * human-reviewed step, so the test only fails on API errors, never on
 * volume.
 */
import { describe, expect, it } from 'vitest';
import { buildScopeQuery, DEFAULT_INGESTION_SCOPE } from '@bidmorrow/procurement';

const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';
const LIVE = process.env.TED_LIVE === '1';

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function tedSearch(body: Record<string, unknown>): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const response = await fetch(TED_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json };
}

// Vitest fails a file that yields zero tests, so the non-live path keeps a
// sentinel documenting how the real gates run.
describe.runIf(!LIVE)('TED live gates (network-gated)', () => {
  it('skips without TED_LIVE=1 — dispatch .github/workflows/ted-gates.yml to run them', () => {
    expect(LIVE).toBe(false);
  });
});

describe.runIf(LIVE)('TED live pre-first-ingestion gates', () => {
  it('gate 1 (TED-P5-01): the composed scope query passes live checkQuerySyntax', async () => {
    const query = buildScopeQuery(DEFAULT_INGESTION_SCOPE, {
      windowFrom: isoDaysAgo(3),
      windowTo: isoDaysAgo(3),
    });
    const { status, json } = await tedSearch({
      query,
      fields: ['publication-number'],
      limit: 1,
      checkQuerySyntax: true,
    });
    // A syntax rejection is a 4xx with an error payload; acceptance is 200.
    expect(status, `checkQuerySyntax response: ${JSON.stringify(json)}`).toBe(200);
  });

  it('gate 2: measures scoped notices/day for the last 7 full days (prints, never volume-fails)', async () => {
    const counts: { day: string; count: number }[] = [];
    for (let daysAgo = 9; daysAgo >= 3; daysAgo -= 1) {
      const day = isoDaysAgo(daysAgo);
      const query = buildScopeQuery(DEFAULT_INGESTION_SCOPE, {
        windowFrom: day,
        windowTo: day,
      });
      const { status, json } = await tedSearch({
        query,
        fields: ['publication-number'],
        limit: 1,
      });
      expect(status, `search failed for ${day}: ${JSON.stringify(json)}`).toBe(200);
      const total = json['totalNoticeCount'];
      expect(typeof total, `totalNoticeCount missing for ${day}`).toBe('number');
      counts.push({ day, count: total as number });
      // Self-imposed politeness spacing (mirrors TedClient's default).
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const avg = Math.round(counts.reduce((s, c) => s + c.count, 0) / counts.length);
    // These lines are the gate's deliverable — read from the workflow log
    // and recorded in docs/cost-model.md + the ledger.
    for (const { day, count } of counts) {
      console.warn(`TED_VOLUME day=${day} scoped_count=${String(count)}`);
    }
    console.warn(
      `TED_VOLUME_AVG avg_per_day=${String(avg)} assumption=150-300 tighten_if_over=600`,
    );
  }, 60_000);
});
