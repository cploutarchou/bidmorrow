/**
 * Full ingestion-pipeline integration tests: real local D1 + real R2
 * binding (workerd via @cloudflare/vitest-pool-workers), a FAKE TedClient
 * (injected fetch serving real SDK-example fixtures from
 * tests/fixtures/ted), covering the ted-ingestion-audit checklist.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import { TedClient } from '@bidmorrow/ted';
import type { TedFetch } from '@bidmorrow/ted';
import {
  DEFAULT_INGESTION_SCOPE,
  computeCatchUpWindows,
  gzipText,
  runIngestionCatchUp,
  runIngestionWindow,
  runPurge,
} from '@bidmorrow/procurement';
import {
  advanceCheckpoint,
  createDb,
  createOrganization,
  getCheckpoint,
  getNoticeByPublicationNumber,
  insertLots,
  insertSnapshotIfNewHash,
  newId,
  setFeatureFlag,
  upsertBuyer,
  upsertNoticeWithVersion,
} from '@bidmorrow/db';
import { schema } from '@bidmorrow/db';
import { FLAG_INGESTION_PAUSED } from '@bidmorrow/config';

// pool-workers tests run inside sandboxed workerd, not Node — real
// filesystem reads (`node:fs`) are not available for arbitrary host paths,
// so fixtures are inlined at build time via Vite's `?raw` loader instead of
// `readFileSync` (see src/test/env.d.ts for the ambient module type).
import normalXml from '../../../tests/fixtures/ted/1.15/normal.xml?raw';
import normalCorrectedXml from '../../../tests/fixtures/ted/1.15/normal-corrected.xml?raw';
import multiLotXml from '../../../tests/fixtures/ted/1.15/multi-lot.xml?raw';
import missingValueXml from '../../../tests/fixtures/ted/1.15/missing-value.xml?raw';
import malformedTruncatedXml from '../../../tests/fixtures/ted/1.15/malformed-truncated.xml?raw';

const T0 = Date.parse('2026-08-14T12:00:00Z');
const MS_PER_DAY = 86_400_000;

/** Search-API row for one notice: publication-number/date + the links.xml.MUL URL the fake fetch will serve. */
function searchRow(sourceNoticeId: string, publicationDate: string, xmlUrl: string) {
  return {
    'publication-number': sourceNoticeId,
    'publication-date': publicationDate,
    links: { xml: { MUL: xmlUrl } },
  };
}

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(body: unknown): FakeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function textResponse(body: string): FakeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  };
}

/**
 * A response whose `Content-Length` header declares an oversized body —
 * `TedClient.fetchNoticeXml` checks the header before buffering the body, so
 * `text()` is never actually invoked for this response.
 */
function oversizedXmlResponse(declaredBytes: number): FakeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'Content-Length' ? String(declaredBytes) : null) },
    json: () => Promise.reject(new Error('not json')),
    text: () =>
      Promise.reject(new Error('body should not be read when Content-Length rejects first')),
  };
}

/**
 * A scripted fake TED backend: `searchPages` is consumed one page per POST
 * /v3/notices/search call (in order, across the whole test's client
 * lifetime); `xmlByUrl` serves GET requests for notice XML.
 */
function makeFakeFetch(
  searchPages: readonly { notices: readonly Record<string, unknown>[] }[],
  xmlByUrl: Readonly<Record<string, string>>,
): TedFetch {
  const pages = [...searchPages];
  return (url) => {
    if (url.endsWith('/v3/notices/search')) {
      const page = pages.shift() ?? { notices: [] };
      return Promise.resolve(jsonResponse({ ...page, totalNoticeCount: page.notices.length }));
    }
    const body = xmlByUrl[url];
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not found')),
        text: () => Promise.resolve(''),
      });
    }
    return Promise.resolve(textResponse(body));
  };
}

function makeClient(fetchImpl: TedFetch, maxRequestsPerRun = 100): TedClient {
  return new TedClient({
    fetch: fetchImpl,
    budget: { maxRequestsPerRun },
    minRequestSpacingMs: 0,
    logger: createLogger({ test: true }),
  });
}

describe('runIngestionWindow', () => {
  it('happy path: creates notices/versions/lots/snapshots, run counts, checkpoint advances', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('happy-1', '2026-08-10', 'https://ted.europa.eu/notice/happy-1.xml'),
      searchRow('happy-2', '2026-08-10', 'https://ted.europa.eu/notice/happy-2.xml'),
    ];
    const client = makeClient(
      makeFakeFetch([{ notices: rows }], {
        'https://ted.europa.eu/notice/happy-1.xml': normalXml,
        'https://ted.europa.eu/notice/happy-2.xml': multiLotXml,
      }),
    );

    const result = await runIngestionWindow(
      {
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-10', windowTo: '2026-08-10' },
    );

    expect(result.status).toBe('succeeded');
    expect(result.run.noticesSeen).toBe(2);
    expect(result.run.noticesUpserted).toBe(2);
    expect(result.run.versionsCreated).toBe(2);
    // normal.xml has 1 lot, multi-lot.xml has 2 lots.
    expect(result.run.lotsCreated).toBe(3);
    expect(result.run.errorsCount).toBe(0);

    const notice1 = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'happy-1',
    });
    expect(notice1).not.toBeNull();
    expect(notice1?.publicationDate).toBe('2026-08-10');

    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-10');

    // Snapshot round-trip: the object exists in R2, gzip-decompresses back to the original XML.
    const expectedKey = 'ted/2026/happy-1/1.xml.gz';
    const object = await env.SNAPSHOTS.get(expectedKey);
    expect(object).not.toBeNull();
    const gzippedBytes = await object?.arrayBuffer();
    const decompressed = await new Response(
      new Blob([gzippedBytes as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    expect(decompressed).toBe(normalXml);

    // Re-gzipping the same input is deterministic enough to sanity-check via length (belt-and-suspenders).
    const reGzipped = await gzipText(normalXml);
    expect(reGzipped.length).toBeGreaterThan(0);
  });

  it('is idempotent: re-running the same window creates no duplicate notices/lots', async () => {
    const db = createDb(env.DB);
    const rows = [searchRow('idem-1', '2026-08-10', 'https://ted.europa.eu/notice/idem-1.xml')];
    const xmlByUrl = { 'https://ted.europa.eu/notice/idem-1.xml': normalXml };

    const first = await runIngestionWindow(
      {
        db,
        client: makeClient(makeFakeFetch([{ notices: rows }], xmlByUrl)),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-10', windowTo: '2026-08-10' },
    );
    expect(first.run.versionsCreated).toBe(1);

    const second = await runIngestionWindow(
      {
        db,
        client: makeClient(makeFakeFetch([{ notices: rows }], xmlByUrl)),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0 + 1000,
      },
      { windowFrom: '2026-08-10', windowTo: '2026-08-10' },
    );
    expect(second.status).toBe('succeeded');
    expect(second.run.noticesSeen).toBe(1);
    // Unchanged content hash — no new version, no new upsert count.
    expect(second.run.versionsCreated).toBe(0);
    expect(second.run.noticesUpserted).toBe(0);

    const lotCount = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM tender_lots l JOIN tender_notice_versions v ON l.notice_version_id = v.id JOIN tender_notices t ON v.notice_id = t.id WHERE t.source_notice_id = 'idem-1'",
    ).first<{ n: number }>();
    expect(lotCount?.n).toBe(1);
  });

  it('a malformed notice lands in ingestion_errors (never silently skipped); the run is partial; other notices still ingest', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('bad-1', '2026-08-11', 'https://ted.europa.eu/notice/bad-1.xml'),
      searchRow('good-1', '2026-08-11', 'https://ted.europa.eu/notice/good-1.xml'),
    ];
    const client = makeClient(
      makeFakeFetch([{ notices: rows }], {
        'https://ted.europa.eu/notice/bad-1.xml': malformedTruncatedXml,
        'https://ted.europa.eu/notice/good-1.xml': missingValueXml,
      }),
    );

    const result = await runIngestionWindow(
      {
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-11', windowTo: '2026-08-11' },
    );

    expect(result.status).toBe('partial');
    expect(result.run.errorsCount).toBe(1);
    expect(result.run.noticesUpserted).toBe(1); // only good-1

    const errorRow = await env.DB.prepare(
      'SELECT stage, source_notice_id, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .first<{ stage: string; source_notice_id: string; detail_json: string }>();
    expect(errorRow?.stage).toBe('parse');
    expect(errorRow?.source_notice_id).toBe('bad-1');
    expect(errorRow?.detail_json).toContain('snapshotR2Key');

    const goodNotice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'good-1',
    });
    expect(goodNotice).not.toBeNull();

    // Partial (not failed) — checkpoint still advances.
    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-11');
  });

  it('an oversized notice XML lands in ingestion_errors as XML_TOO_LARGE (fetch stage); the window proceeds', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('huge-1', '2026-08-11', 'https://ted.europa.eu/notice/huge-1.xml'),
      searchRow('good-2', '2026-08-11', 'https://ted.europa.eu/notice/good-2.xml'),
    ];
    const oversizedUrl = 'https://ted.europa.eu/notice/huge-1.xml';
    const goodUrl = 'https://ted.europa.eu/notice/good-2.xml';
    const pages = [{ notices: rows }];
    const fetchImpl: TedFetch = (url) => {
      if (url.endsWith('/v3/notices/search')) {
        const page = pages.shift() ?? { notices: [] };
        return Promise.resolve(jsonResponse({ ...page, totalNoticeCount: page.notices.length }));
      }
      if (url === oversizedUrl) {
        // Declared Content-Length far above TedClient's MAX_XML_BYTES cap.
        return Promise.resolve(oversizedXmlResponse(20_000_000));
      }
      if (url === goodUrl) {
        return Promise.resolve(textResponse(missingValueXml));
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not found')),
        text: () => Promise.resolve(''),
      });
    };
    const client = makeClient(fetchImpl);

    const result = await runIngestionWindow(
      {
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-11', windowTo: '2026-08-11' },
    );

    expect(result.status).toBe('partial');
    expect(result.run.errorsCount).toBe(1);
    expect(result.run.noticesUpserted).toBe(1); // only good-2

    const errorRow = await env.DB.prepare(
      'SELECT stage, source_notice_id, error_code, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .first<{
        stage: string;
        source_notice_id: string;
        error_code: string;
        detail_json: string;
      }>();
    expect(errorRow?.stage).toBe('fetch');
    expect(errorRow?.source_notice_id).toBe('huge-1');
    expect(errorRow?.error_code).toBe('XML_TOO_LARGE');
    expect(errorRow?.detail_json).toContain('maxBytes');

    const goodNotice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'good-2',
    });
    expect(goodNotice).not.toBeNull();

    // Partial (not failed) — checkpoint still advances.
    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-11');
  });

  it('a window-level failure (request budget exhausted) marks the run failed and does NOT advance the checkpoint', async () => {
    const db = createDb(env.DB);
    // Tests in this file share one D1 (vitest-pool-workers per-file
    // isolation) and the checkpoint is source-scoped, so capture whatever
    // the earlier tests already advanced it to rather than asserting a
    // hardcoded value — the only contract under test is "unchanged".
    const before = await getCheckpoint(db, { source: 'ted' });
    const rows = [searchRow('budget-1', '2026-08-12', 'https://ted.europa.eu/notice/budget-1.xml')];
    // Budget of 1 request: the search call spends it, so fetchNoticeXml's
    // request throws TedBudgetExceededError — a window-level failure.
    const client = makeClient(
      makeFakeFetch([{ notices: rows }], {
        'https://ted.europa.eu/notice/budget-1.xml': normalXml,
      }),
      1,
    );

    const result = await runIngestionWindow(
      {
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-12', windowTo: '2026-08-12' },
    );

    expect(result.status).toBe('failed');
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    // Durable diagnostic: a window-level failure must NOT be silent — it
    // records exactly one ingestion_errors row (stage fetch, budget code,
    // naming the notice/URL it died on) and bumps errors_count to match, so
    // the failure is diagnosable from D1 alone without live worker logs.
    expect(result.run.errorsCount).toBe(1);
    const diag = await env.DB.prepare(
      'SELECT stage, source_notice_id, error_code, message, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .all();
    expect(diag.results.length).toBe(1);
    const row = diag.results[0] as {
      stage: string;
      source_notice_id: string | null;
      error_code: string;
      message: string;
      detail_json: string | null;
    };
    expect(row.stage).toBe('fetch');
    expect(row.error_code).toBe('REQUEST_BUDGET_EXCEEDED');
    expect(row.source_notice_id).toBe('budget-1');
    const detail = JSON.parse(row.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['noticeXmlUrl']).toBe('https://ted.europa.eu/notice/budget-1.xml');
    expect(detail['windowFrom']).toBe('2026-08-12');
  });

  it('a window-level HTTP failure (notice XML fetch) records a durable NOTICE_FETCH_HTTP diagnostic and fails the run', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    // The notice appears in search, but its XML URL is absent from the fake
    // backend → GET returns a non-retryable 404 → TedRequestError propagates
    // as a window-level failure (this is the shape of the 2026-08-17 staging
    // incident: search OK, notice-XML fetch fails before any persistence).
    const rows = [searchRow('http-1', '2026-08-30', 'https://ted.europa.eu/notice/http-1.xml')];
    const client = makeClient(makeFakeFetch([{ notices: rows }], {}));

    const result = await runIngestionWindow(
      {
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-30', windowTo: '2026-08-30' },
    );

    expect(result.status).toBe('failed');
    // Nothing persisted: the abort is at fetch, before snapshot/upsert.
    expect(result.run.noticesSeen).toBe(1);
    expect(result.run.noticesUpserted).toBe(0);
    expect(result.run.errorsCount).toBe(1);
    // Checkpoint held — the window did not fully succeed.
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    const diag = await env.DB.prepare(
      'SELECT stage, source_notice_id, error_code, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .all();
    expect(diag.results.length).toBe(1);
    const row = diag.results[0] as {
      stage: string;
      source_notice_id: string | null;
      error_code: string;
      detail_json: string | null;
    };
    expect(row.stage).toBe('fetch');
    expect(row.error_code).toBe('NOTICE_FETCH_HTTP_404');
    expect(row.source_notice_id).toBe('http-1');
    const detail = JSON.parse(row.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['status']).toBe(404);
    expect(detail['noticeXmlUrl']).toBe('https://ted.europa.eu/notice/http-1.xml');
  });

  it('a correction (same notice, new XML) creates version 2; version 1 stays immutable', async () => {
    const db = createDb(env.DB);

    await runIngestionWindow(
      {
        db,
        client: makeClient(
          makeFakeFetch(
            [
              {
                notices: [
                  searchRow('corr-1', '2026-08-13', 'https://ted.europa.eu/notice/corr-1.xml'),
                ],
              },
            ],
            { 'https://ted.europa.eu/notice/corr-1.xml': normalXml },
          ),
        ),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      // Later than the window-level-failure test's window above — the
      // checkpoint only ever advances forward across this shared database.
      { windowFrom: '2026-08-13', windowTo: '2026-08-13' },
    );

    const second = await runIngestionWindow(
      {
        db,
        client: makeClient(
          makeFakeFetch(
            [
              {
                notices: [
                  searchRow('corr-1', '2026-08-14', 'https://ted.europa.eu/notice/corr-1-v2.xml'),
                ],
              },
            ],
            { 'https://ted.europa.eu/notice/corr-1-v2.xml': normalCorrectedXml },
          ),
        ),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-14', windowTo: '2026-08-14' },
    );
    expect(second.run.versionsCreated).toBe(1);

    const notice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'corr-1',
    });
    expect(notice).not.toBeNull();
    // First-publication date is preserved across the correction.
    expect(notice?.publicationDate).toBe('2026-08-13');

    const versions = await env.DB.prepare(
      'SELECT version_number FROM tender_notice_versions WHERE notice_id = ? ORDER BY version_number',
    )
      .bind(notice?.id)
      .all<{ version_number: number }>();
    expect(versions.results.map((v) => v.version_number)).toEqual([1, 2]);

    const currentTitle = await env.DB.prepare(
      'SELECT title FROM tender_lots WHERE notice_version_id = (SELECT current_version_id FROM tender_notices WHERE id = ?)',
    )
      .bind(notice?.id)
      .first<{ title: string }>();
    expect(currentTitle?.title).toContain('(Corrected)');
  });
  it('render-pending notices (HTTP 202) are requeued and collected on a later visit; the window succeeds', async () => {
    const db = createDb(env.DB);
    // TED's async front-end (docs/ted-data-source.md, 2026-08-18): the first
    // GET queues the render and answers 202/empty; a later GET is served the
    // cached XML. Fake: 202 on each URL's first visit, real XML on the second.
    const rows = [
      searchRow('rp-1', '2026-08-15', 'https://ted.europa.eu/notice/rp-1.xml'),
      searchRow('rp-2', '2026-08-15', 'https://ted.europa.eu/notice/rp-2.xml'),
    ];
    const xmlByUrl: Record<string, string> = {
      'https://ted.europa.eu/notice/rp-1.xml': normalXml,
      'https://ted.europa.eu/notice/rp-2.xml': multiLotXml,
    };
    const xmlHits = new Map<string, number>();
    const baseFetch = makeFakeFetch([{ notices: rows }], xmlByUrl);
    const fetchImpl: TedFetch = (url, init) => {
      if (url.endsWith('/v3/notices/search') || xmlByUrl[url] === undefined) {
        return baseFetch(url, init);
      }
      const hits = (xmlHits.get(url) ?? 0) + 1;
      xmlHits.set(url, hits);
      if (hits === 1) {
        return Promise.resolve({
          ok: true,
          status: 202,
          headers: { get: () => null },
          json: () => Promise.reject(new Error('not json')),
          text: () => Promise.resolve(''),
        });
      }
      return baseFetch(url, init);
    };

    const result = await runIngestionWindow(
      {
        db,
        client: makeClient(fetchImpl),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
        renderRetryDelayMs: 0,
      },
      { windowFrom: '2026-08-15', windowTo: '2026-08-15' },
    );

    expect(result.status).toBe('succeeded');
    expect(result.run.noticesSeen).toBe(2);
    expect(result.run.noticesUpserted).toBe(2);
    expect(result.run.errorsCount).toBe(0);
    // Each notice's XML URL was hit exactly twice: trigger, then collect.
    expect(xmlHits.get('https://ted.europa.eu/notice/rp-1.xml')).toBe(2);
    expect(xmlHits.get('https://ted.europa.eu/notice/rp-2.xml')).toBe(2);
    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-15');
  });

  it('a notice whose render never completes exhausts its visits: window fails with a NOTICE_RENDER_PENDING diagnostic, checkpoint held', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    const rows = [searchRow('ap-1', '2026-08-16', 'https://ted.europa.eu/notice/ap-1.xml')];
    let xmlHits = 0;
    const baseFetch = makeFakeFetch([{ notices: rows }], {});
    const fetchImpl: TedFetch = (url, init) => {
      if (url.endsWith('/v3/notices/search')) {
        return baseFetch(url, init);
      }
      xmlHits += 1;
      return Promise.resolve({
        ok: true,
        status: 202,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve(''),
      });
    };

    const result = await runIngestionWindow(
      {
        db,
        client: makeClient(fetchImpl),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
        renderRetryDelayMs: 0,
      },
      { windowFrom: '2026-08-16', windowTo: '2026-08-16' },
    );

    expect(result.status).toBe('failed');
    // MAX_RENDER_VISITS (4) trigger/collect attempts, then window-fatal —
    // never skip-and-advance (that would silently drop the notice).
    expect(xmlHits).toBe(4);
    expect(result.run.errorsCount).toBe(1);
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    const diag = await env.DB.prepare(
      'SELECT stage, source_notice_id, error_code, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .all();
    expect(diag.results.length).toBe(1);
    const row = diag.results[0] as {
      stage: string;
      source_notice_id: string | null;
      error_code: string;
      detail_json: string | null;
    };
    expect(row.stage).toBe('fetch');
    expect(row.error_code).toBe('NOTICE_RENDER_PENDING');
    expect(row.source_notice_id).toBe('ap-1');
    const detail = JSON.parse(row.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['status']).toBe(202);
  });
});

describe('runIngestionCatchUp', () => {
  it('bounds catch-up to maxWindowsPerRun windows even when far behind', async () => {
    const db = createDb(env.DB);
    // Tests in this file share one D1; the checkpoint only ever moves
    // forward, so advance it from wherever the earlier tests left it
    // (>= 2026-08-14) rather than assuming a fixed prior value.
    const before = await getCheckpoint(db, { source: 'ted' });
    const start = before?.lastPublicationDate ?? '2026-08-14';
    await advanceCheckpoint(db, { source: 'ted', lastPublicationDate: start });
    // Far enough in the future that "yesterday" leaves way more than
    // maxWindowsPerRun (3) days owed.
    const now = Date.parse('2026-09-01T00:00:00Z');
    const client = makeClient(
      makeFakeFetch(
        Array.from({ length: 5 }, () => ({ notices: [] })),
        {},
      ),
    );

    const result = await runIngestionCatchUp({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      maxWindowsPerRun: 3,
      now: () => now,
    });

    const expectedWindows = computeCatchUpWindows(start, now, 3);
    expect(result.paused).toBe(false);
    expect(result.results).toHaveLength(3);
    expect(expectedWindows).toHaveLength(3);
    expect(result.results.every((r) => r.status === 'succeeded')).toBe(true);

    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe(expectedWindows.at(-1)?.windowTo);
  });

  it('the ingestion_paused flag short-circuits catch-up: no runs created, checkpoint unchanged (P5-R-02)', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    await setFeatureFlag(db, {
      key: FLAG_INGESTION_PAUSED,
      valueJson: 'true',
      description: 'test: pause ingestion',
    });

    const runsBefore = await env.DB.prepare('SELECT COUNT(*) as n FROM ingestion_runs').first<{
      n: number;
    }>();
    const client = makeClient(makeFakeFetch([{ notices: [] }], {}));

    const result = await runIngestionCatchUp({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      maxWindowsPerRun: 3,
      now: () => Date.parse('2026-09-01T00:00:00Z'),
    });

    expect(result.paused).toBe(true);
    expect(result.results).toHaveLength(0);

    const runsAfter = await env.DB.prepare('SELECT COUNT(*) as n FROM ingestion_runs').first<{
      n: number;
    }>();
    expect(runsAfter?.n).toBe(runsBefore?.n);

    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    // Reset for any tests that might run after this one in the shared DB file.
    await setFeatureFlag(db, {
      key: FLAG_INGESTION_PAUSED,
      valueJson: 'false',
      description: 'test: unpause ingestion',
    });
  });
});

describe('runPurge', () => {
  async function seedLot(
    db: ReturnType<typeof createDb>,
    sourceNoticeId: string,
    deadlineAt: number | null,
    publicationDate: string,
  ): Promise<{ noticeId: string; lotId: string }> {
    const snapshot = await insertSnapshotIfNewHash(db, {
      source: 'ted',
      sourceNoticeId,
      versionNumber: 1,
      r2Key: `ted/2020/${sourceNoticeId}/1.xml.gz`,
      contentHash: `hash-${sourceNoticeId}`,
      sizeBytes: 10,
      contentType: 'application/xml',
    });
    const upsert = await upsertNoticeWithVersion(db, {
      source: 'ted',
      sourceNoticeId,
      noticeType: 'cn-standard',
      sourceLanguagesJson: '[]',
      sourceUrl: 'https://example.test/notice',
      publicationDate,
      contentHash: `hash-${sourceNoticeId}`,
      snapshotId: snapshot.snapshot.id,
    });
    const [lot] = await insertLots(db, {
      noticeVersionId: upsert.versionId,
      lots: [
        {
          lotNumber: '1',
          title: `Lot for ${sourceNoticeId}`,
          valueIsDerived: false,
          deadlineAt,
        },
      ],
    });
    if (lot === undefined) {
      throw new Error('seedLot: insertLots returned no row');
    }
    return { noticeId: upsert.noticeId, lotId: lot.id };
  }

  it('purges only expired, unsaved notices — saved and active notices are retained', async () => {
    const db = createDb(env.DB);
    await upsertBuyer(db, { source: 'ted', name: 'Purge Test Buyer' });

    const now = T0;
    const expiredDeadline = now - 200 * MS_PER_DAY; // + 90d retention is long past
    const recentDeadline = now + 30 * MS_PER_DAY; // still active

    const expired = await seedLot(db, 'purge-expired', expiredDeadline, '2020-01-01');
    const saved = await seedLot(db, 'purge-saved', expiredDeadline, '2020-01-01');
    const active = await seedLot(db, 'purge-active', recentDeadline, '2026-08-01');

    const userId = newId(T0);
    await db.insert(schema.users).values({
      id: userId,
      email: 'purge-test@example.test',
      emailVerified: true,
      name: 'Purge Tester',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    });
    const { organization } = await createOrganization(db, {
      name: 'Purge Test Org',
      createdByUserId: userId,
    });
    await db.insert(schema.savedTenders).values({
      id: newId(T0),
      organizationId: organization.id,
      lotId: saved.lotId,
      noticeId: saved.noticeId,
      savedByUserId: userId,
      createdAt: T0,
    });

    const result = await runPurge({
      db,
      logger: createLogger({ test: true }),
      now: () => now,
      retentionDays: 90,
      limit: 500,
    });

    // This D1 is shared across the whole test file (vitest-pool-workers
    // per-file isolation) — earlier tests' fixtures (real eForms deadlines
    // in the past relative to `now`) are ALSO legitimately purge-eligible,
    // so only assert the specific inclusion/exclusion contract under test,
    // not an exact total.
    expect(result.eligibleNoticeIds).toContain(expired.noticeId);
    expect(result.eligibleNoticeIds).not.toContain(saved.noticeId);
    expect(result.eligibleNoticeIds).not.toContain(active.noticeId);
    expect(result.noticesDeleted).toBe(result.eligibleNoticeIds.length);

    expect(
      await getNoticeByPublicationNumber(db, { source: 'ted', publicationNumber: 'purge-expired' }),
    ).toBeNull();
    expect(
      await getNoticeByPublicationNumber(db, { source: 'ted', publicationNumber: 'purge-saved' }),
    ).not.toBeNull();
    expect(
      await getNoticeByPublicationNumber(db, { source: 'ted', publicationNumber: 'purge-active' }),
    ).not.toBeNull();
  });
});
