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
  FETCH_RETRY_MAX_ATTEMPTS,
  FETCH_RETRY_SUSPENDED_CANARY_ROWS,
  PENDING_RETRY_BACKLOG_ALERT_THRESHOLD,
  checkFetchResilienceAlerts,
  computeCatchUpWindows,
  drainFetchRetries,
  gzipText,
  nextIsoDate,
  runIngestionCatchUp,
  runIngestionWindow,
  runPurge,
} from '@bidmorrow/procurement';
import {
  advanceCheckpoint,
  createDb,
  createOrganization,
  createRun,
  getCheckpoint,
  getNoticeByPublicationNumber,
  insertLots,
  insertSnapshotIfNewHash,
  newId,
  recordError,
  setFeatureFlag,
  upsertBuyer,
  upsertFetchRetry,
  upsertNoticeWithVersion,
} from '@bidmorrow/db';
import { schema } from '@bidmorrow/db';
import { FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED, FLAG_INGESTION_PAUSED } from '@bidmorrow/config';

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

  it('ADR-0008 §1: a notice-XML HTTP failure is record-and-continue — the window is partial (not failed), with a durable NOTICE_FETCH_HTTP diagnostic and a retry row', async () => {
    const db = createDb(env.DB);
    // The notice appears in search, but its XML URL is absent from the fake
    // backend → GET returns a non-retryable 404 → TedRequestError. ADR-0008
    // §1 changed this from window-fatal to record-and-continue: below the §2
    // threshold floor (1 < FETCH_FAILURE_FAIL_MIN=5), so the window finishes
    // `partial` and the checkpoint still advances (this is the shape of the
    // 2026-08-17 staging incident, now resolved rather than blocking the day
    // forever).
    const rows = [searchRow('http-1', '2026-08-12', 'https://ted.europa.eu/notice/http-1.xml')];
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
      { windowFrom: '2026-08-12', windowTo: '2026-08-12' },
    );

    expect(result.status).toBe('partial');
    // Nothing persisted for this notice: the skip happens at fetch, before snapshot/upsert.
    expect(result.run.noticesSeen).toBe(1);
    expect(result.run.noticesUpserted).toBe(0);
    expect(result.run.errorsCount).toBe(1);
    expect(result.run.noticesFetchFailed).toBe(1);
    // Checkpoint advances — a partial window (isolated skip) is not window-fatal.
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe('2026-08-12');

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

    const retryRow = await env.DB.prepare(
      "SELECT status, last_error_code FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = 'http-1'",
    ).first<{ status: string; last_error_code: string }>();
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.last_error_code).toBe('NOTICE_FETCH_HTTP_404');
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

  it('ADR-0008 Amendment §A1: a notice whose render never completes exhausts its visits and is record-and-continue — the window is partial (not failed), with a NOTICE_RENDER_PENDING diagnostic and a retry row', async () => {
    const db = createDb(env.DB);
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

    expect(result.status).toBe('partial');
    // MAX_RENDER_VISITS (6) trigger/collect attempts, then record-and-
    // continue (Amendment §A1) — never lost: it lands in ingestion_errors
    // AND the retry table, and the window still finishes for every other
    // notice.
    expect(xmlHits).toBe(6);
    expect(result.run.errorsCount).toBe(1);
    // ADR-0009 §1: render-pending exhaustion is a distinct counter with NO
    // fail ceiling — it never bumps noticesFetchFailed (genuine failures
    // only).
    expect(result.run.noticesFetchFailed).toBe(0);
    expect(result.run.noticesRenderPending).toBe(1);
    // Checkpoint advances — a partial window (isolated skip) is not window-fatal.
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe('2026-08-16');

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
    expect(detail['visits']).toBe(6);

    const retryRow = await env.DB.prepare(
      "SELECT status, last_error_code FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = 'ap-1'",
    ).first<{ status: string; last_error_code: string }>();
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.last_error_code).toBe('NOTICE_RENDER_PENDING');
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

/** Response that never renders — every visit answers 202/empty (TedRenderPendingError, every time). */
function alwaysPendingResponse(): FakeResponse {
  return {
    ok: true,
    status: 202,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(''),
  };
}

/** Response that is a non-retryable HTTP failure on every visit (TedRequestError, every time). */
function alwaysHttpErrorResponse(status: number): FakeResponse {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('not found')),
    text: () => Promise.resolve(''),
  };
}

// ADR-0008: poison-pill notice-fetch resilience (record-and-continue for
// per-notice fetch failures, the systemic threshold, the retry drain).
// Dates continue strictly forward from wherever `runIngestionCatchUp` above
// left the checkpoint (>= 2026-08-18) — see this file's shared-D1 note at
// the top of `describe('runIngestionWindow', ...)`'s failure tests.
describe('ADR-0008 fetch resilience', () => {
  it('§1: a TedRequestError fetch failure is record-and-continue — window is partial, siblings land, a retry row is created', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('rr-bad-1', '2026-08-19', 'https://ted.europa.eu/notice/rr-bad-1.xml'),
      searchRow('rr-good-1', '2026-08-19', 'https://ted.europa.eu/notice/rr-good-1.xml'),
    ];
    const badUrl = 'https://ted.europa.eu/notice/rr-bad-1.xml';
    const goodUrl = 'https://ted.europa.eu/notice/rr-good-1.xml';
    const base = makeFakeFetch([{ notices: rows }], { [goodUrl]: normalXml });
    const fetchImpl: TedFetch = (url, init) => {
      if (url === badUrl) return Promise.resolve(alwaysHttpErrorResponse(404));
      return base(url, init);
    };

    const result = await runIngestionWindow(
      {
        db,
        client: makeClient(fetchImpl),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-19', windowTo: '2026-08-19' },
    );

    expect(result.status).toBe('partial');
    expect(result.run.noticesSeen).toBe(2);
    expect(result.run.noticesUpserted).toBe(1); // only rr-good-1
    expect(result.run.errorsCount).toBe(1);
    expect(result.run.noticesFetchFailed).toBe(1);

    const goodNotice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: 'rr-good-1',
    });
    expect(goodNotice).not.toBeNull();

    // Checkpoint advances — a partial window (isolated skip) is not window-fatal.
    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-19');

    const errorRow = await env.DB.prepare(
      'SELECT stage, source_notice_id, error_code FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .first<{ stage: string; source_notice_id: string; error_code: string }>();
    expect(errorRow?.stage).toBe('fetch');
    expect(errorRow?.source_notice_id).toBe('rr-bad-1');
    expect(errorRow?.error_code).toBe('NOTICE_FETCH_HTTP_404');

    const retryRow = await env.DB.prepare(
      "SELECT status, attempts, last_error_code FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = 'rr-bad-1'",
    ).first<{ status: string; attempts: number; last_error_code: string }>();
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.attempts).toBe(0);
    expect(retryRow?.last_error_code).toBe('NOTICE_FETCH_HTTP_404');
  });

  it('§4: TedBudgetExceededError still fails the window (not partial), even with an earlier notice already persisted', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    const rows = [
      searchRow('budget-multi-1', '2026-08-20', 'https://ted.europa.eu/notice/budget-multi-1.xml'),
      searchRow('budget-multi-2', '2026-08-20', 'https://ted.europa.eu/notice/budget-multi-2.xml'),
    ];
    // Budget of 3: 1 search page + 1 fetch for notice 1 leaves exactly 1
    // request, spent inside upsert/insert bookkeeping is DB, not HTTP — the
    // second notice's fetchNoticeXml call is the one that finds the budget
    // exhausted.
    const client = makeClient(
      makeFakeFetch([{ notices: rows }], {
        'https://ted.europa.eu/notice/budget-multi-1.xml': normalXml,
        'https://ted.europa.eu/notice/budget-multi-2.xml': normalXml,
      }),
      2,
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
      { windowFrom: '2026-08-20', windowTo: '2026-08-20' },
    );

    expect(result.status).toBe('failed');
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    const diag = await env.DB.prepare(
      'SELECT error_code FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .all<{ error_code: string }>();
    expect(diag.results.map((r) => r.error_code)).toEqual(['REQUEST_BUDGET_EXCEEDED']);
  });

  it('Amendment §A1: render-pending exhaustion is record-and-continue — window is partial, siblings land, a retry row is created', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('exh-1', '2026-08-20', 'https://ted.europa.eu/notice/exh-1.xml'),
      searchRow('exh-2', '2026-08-20', 'https://ted.europa.eu/notice/exh-2.xml'),
      searchRow('exh-stuck', '2026-08-20', 'https://ted.europa.eu/notice/exh-stuck.xml'),
    ];
    const xmlByUrl: Record<string, string> = {
      'https://ted.europa.eu/notice/exh-1.xml': normalXml,
      'https://ted.europa.eu/notice/exh-2.xml': multiLotXml,
    };
    const base = makeFakeFetch([{ notices: rows }], xmlByUrl);
    const fetchImpl: TedFetch = (url, init) => {
      if (url === 'https://ted.europa.eu/notice/exh-stuck.xml') {
        return Promise.resolve(alwaysPendingResponse());
      }
      return base(url, init);
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
      // Same date as the previous (failed, checkpoint-holding) test — legal:
      // the checkpoint never moved past 2026-08-19.
      { windowFrom: '2026-08-20', windowTo: '2026-08-20' },
    );

    expect(result.status).toBe('partial');
    expect(result.run.noticesUpserted).toBe(2); // exh-1, exh-2 — exh-stuck skipped
    expect(result.run.errorsCount).toBe(1);
    // ADR-0009 §1: render-pending exhaustion increments the NEW counter
    // only, never noticesFetchFailed (genuine fetch failures only).
    expect(result.run.noticesFetchFailed).toBe(0);
    expect(result.run.noticesRenderPending).toBe(1);

    const checkpoint = await getCheckpoint(db, { source: 'ted' });
    expect(checkpoint?.lastPublicationDate).toBe('2026-08-20');

    const errorRow = await env.DB.prepare(
      'SELECT source_notice_id, error_code, detail_json FROM ingestion_errors WHERE ingestion_run_id = ?',
    )
      .bind(result.run.id)
      .first<{ source_notice_id: string; error_code: string; detail_json: string }>();
    expect(errorRow?.source_notice_id).toBe('exh-stuck');
    expect(errorRow?.error_code).toBe('NOTICE_RENDER_PENDING');
    const detail = JSON.parse(errorRow?.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['visits']).toBe(6); // MAX_RENDER_VISITS

    const retryRow = await env.DB.prepare(
      "SELECT status, last_error_code FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = 'exh-stuck'",
    ).first<{ status: string; last_error_code: string }>();
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.last_error_code).toBe('NOTICE_RENDER_PENDING');
  });

  it('§2: threshold breach via TedRequestError failures fails the window (checkpoint held)', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    // 6 notices, 5 fail fetch (>= FETCH_FAILURE_FAIL_MIN and 5/6 > 20%) —
    // the 5th failure trips the threshold before the 6th is ever attempted.
    const rows = Array.from({ length: 6 }, (_, i) =>
      searchRow(
        `thresh-${String(i)}`,
        '2026-08-21',
        `https://ted.europa.eu/notice/thresh-${String(i)}.xml`,
      ),
    );
    const base = makeFakeFetch([{ notices: rows }], {
      'https://ted.europa.eu/notice/thresh-5.xml': normalXml,
    });
    const fetchImpl: TedFetch = (url, init) => {
      if (
        url.endsWith('/v3/notices/search') ||
        url === 'https://ted.europa.eu/notice/thresh-5.xml'
      ) {
        return base(url, init);
      }
      return Promise.resolve(alwaysHttpErrorResponse(404));
    };

    const result = await runIngestionWindow(
      {
        db,
        client: makeClient(fetchImpl),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => T0,
      },
      { windowFrom: '2026-08-21', windowTo: '2026-08-21' },
    );

    expect(result.status).toBe('failed');
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe(before?.lastPublicationDate);

    const diag = await env.DB.prepare(
      'SELECT error_code, detail_json FROM ingestion_errors WHERE ingestion_run_id = ? ORDER BY id DESC LIMIT 1',
    )
      .bind(result.run.id)
      .first<{ error_code: string; detail_json: string }>();
    expect(diag?.error_code).toBe('FETCH_FAILURE_THRESHOLD_EXCEEDED');
    const detail = JSON.parse(diag?.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['noticesFetchFailed']).toBe(5);
    expect(detail['min']).toBe(5);
    expect(detail['maxRatio']).toBe(0.2);
  });

  it('ADR-0009 §1: a 100%-render-pending window (the 2026-08-20 incident shape) does NOT trip the threshold — partial, checkpoint ADVANCES, every notice gets a retry row, and one RENDER_PENDING_DEGRADED alert row is written', async () => {
    const db = createDb(env.DB);
    // 5 notices, ALL always-202 — every skip is a NOTICE_RENDER_PENDING
    // exhaustion, no TedRequestError involved at all. Same shape as the
    // ADR-0009 2026-08-20 incident (156/156 render-pending), scaled down to
    // exactly RENDER_PENDING_DEGRADED_MIN so the degraded signal's floor is
    // also exercised at 100% ratio.
    const rows = Array.from({ length: 5 }, (_, i) =>
      searchRow(
        `exh-thresh-${String(i)}`,
        '2026-08-22',
        `https://ted.europa.eu/notice/exh-thresh-${String(i)}.xml`,
      ),
    );
    const base = makeFakeFetch([{ notices: rows }], {});
    const fetchImpl: TedFetch = (url, init) => {
      if (url.endsWith('/v3/notices/search')) return base(url, init);
      return Promise.resolve(alwaysPendingResponse());
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
      { windowFrom: '2026-08-22', windowTo: '2026-08-22' },
    );

    // No fail ceiling for render-pending: the window finishes partial, NOT
    // failed, even at 100% render-pending.
    expect(result.status).toBe('partial');
    expect(result.failureCode).toBeNull();
    expect(result.run.noticesSeen).toBe(5);
    expect(result.run.noticesUpserted).toBe(0);
    expect(result.run.noticesFetchFailed).toBe(0);
    expect(result.run.noticesRenderPending).toBe(5);

    // Checkpoint ADVANCES — render-pending exhaustion is not window-fatal.
    const after = await getCheckpoint(db, { source: 'ted' });
    expect(after?.lastPublicationDate).toBe('2026-08-22');

    // Every skipped notice landed a retry row (idempotent upsert, none lost).
    const retryCount = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id LIKE 'exh-thresh-%' AND status = 'pending'",
    ).first<{ n: number }>();
    expect(retryCount?.n).toBe(5);

    // Exactly one durable RENDER_PENDING_DEGRADED signal row for the whole
    // window (evaluated once at window end, never per-skip).
    const degraded = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM ingestion_errors WHERE ingestion_run_id = ? AND error_code = 'RENDER_PENDING_DEGRADED'",
    )
      .bind(result.run.id)
      .first<{ n: number }>();
    expect(degraded?.n).toBe(1);

    const degradedDetail = await env.DB.prepare(
      "SELECT detail_json FROM ingestion_errors WHERE ingestion_run_id = ? AND error_code = 'RENDER_PENDING_DEGRADED'",
    )
      .bind(result.run.id)
      .first<{ detail_json: string }>();
    const detail = JSON.parse(degradedDetail?.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['noticesRenderPending']).toBe(5);
    expect(detail['noticesSeen']).toBe(5);
    expect(detail['ratio']).toBe(1);
    expect(detail['min']).toBe(5);
    expect(detail['minRatio']).toBe(0.2);

    // No FETCH_FAILURE_THRESHOLD_EXCEEDED row — the §2 threshold was never
    // evaluated for this window at all (render-pending skips do not feed it).
    const thresholdRows = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM ingestion_errors WHERE ingestion_run_id = ? AND error_code = 'FETCH_FAILURE_THRESHOLD_EXCEEDED'",
    )
      .bind(result.run.id)
      .first<{ n: number }>();
    expect(thresholdRows?.n).toBe(0);
  });

  it('ADR-0009 §1: below the degraded-signal floor/ratio, render-pending skips write NO RENDER_PENDING_DEGRADED row', async () => {
    const db = createDb(env.DB);
    // 1 notice always-202 among 20 seen (5% ratio, and 1 < RENDER_PENDING_DEGRADED_MIN=5) —
    // below BOTH the floor and the ratio, so no degraded signal fires.
    const stuckUrl = 'https://ted.europa.eu/notice/degraded-floor-stuck.xml';
    const goodUrls = Array.from(
      { length: 19 },
      (_, i) => `https://ted.europa.eu/notice/degraded-floor-good-${String(i)}.xml`,
    );
    const goodRows = goodUrls.map((url, i) =>
      searchRow(`degraded-floor-good-${String(i)}`, '2026-08-22', url),
    );
    const rows = [searchRow('degraded-floor-stuck', '2026-08-22', stuckUrl), ...goodRows];
    const xmlByUrl: Record<string, string> = Object.fromEntries(
      goodUrls.map((url) => [url, normalXml]),
    );
    const base = makeFakeFetch([{ notices: rows }], xmlByUrl);
    const fetchImpl: TedFetch = (url, init) => {
      if (url === stuckUrl) return Promise.resolve(alwaysPendingResponse());
      return base(url, init);
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
      { windowFrom: '2026-08-22', windowTo: '2026-08-22' },
    );

    expect(result.status).toBe('partial');
    expect(result.run.noticesRenderPending).toBe(1);

    const degraded = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM ingestion_errors WHERE ingestion_run_id = ? AND error_code = 'RENDER_PENDING_DEGRADED'",
    )
      .bind(result.run.id)
      .first<{ n: number }>();
    expect(degraded?.n).toBe(0);
  });

  it('idempotent re-run of a partial window day: no duplicate retry row or notice rows on retry', async () => {
    const db = createDb(env.DB);
    const rows = [
      searchRow('idem-bad-1', '2026-08-23', 'https://ted.europa.eu/notice/idem-bad-1.xml'),
      searchRow('idem-good-1', '2026-08-23', 'https://ted.europa.eu/notice/idem-good-1.xml'),
    ];
    const badUrl = 'https://ted.europa.eu/notice/idem-bad-1.xml';
    const goodUrl = 'https://ted.europa.eu/notice/idem-good-1.xml';
    const deps = (): Parameters<typeof runIngestionWindow>[0] => ({
      db,
      client: makeClient((url, init) => {
        if (url === badUrl) return Promise.resolve(alwaysHttpErrorResponse(404));
        return makeFakeFetch([{ notices: rows }], { [goodUrl]: normalXml })(url, init);
      }),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      scope: DEFAULT_INGESTION_SCOPE,
      now: () => T0,
    });

    const first = await runIngestionWindow(deps(), {
      windowFrom: '2026-08-23',
      windowTo: '2026-08-23',
    });
    expect(first.status).toBe('partial');

    // Re-running the SAME day (equal date is a legal checkpoint no-op move)
    // with the same fixtures must not duplicate the notice or the retry row.
    const second = await runIngestionWindow(deps(), {
      windowFrom: '2026-08-23',
      windowTo: '2026-08-23',
    });
    expect(second.status).toBe('partial');
    // Re-fetching an unchanged good notice creates no new version/upsert.
    expect(second.run.noticesUpserted).toBe(0);

    const retryCount = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = 'idem-bad-1'",
    ).first<{ n: number }>();
    expect(retryCount?.n).toBe(1);

    const noticeCount = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM tender_notices WHERE source_notice_id = 'idem-good-1'",
    ).first<{ n: number }>();
    expect(noticeCount?.n).toBe(1);
  });

  it('§3: drain recovery end-to-end — a due row that now fetches successfully is recovered and its lot enqueued', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'drain-recover-1';
    const xmlUrl = 'https://ted.europa.eu/notice/drain-recover-1.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    // NOTE: this file shares one D1 across the whole suite, so other tests'
    // pending retry rows (created earlier, always immediately "due") are
    // ALSO swept into this drain invocation — assert on THIS row's own
    // outcome, not on the drain's aggregate counts.
    const client = makeClient(makeFakeFetch([], { [xmlUrl]: normalXml }));
    const result = await drainFetchRetries({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => T0 + 1000,
    });

    expect(result.recovered).toBeGreaterThanOrEqual(1);
    expect(result.newLotIds.length).toBeGreaterThanOrEqual(1);

    const retryRow = await env.DB.prepare(
      "SELECT status FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = ?",
    )
      .bind(sourceNoticeId)
      .first<{ status: string }>();
    expect(retryRow?.status).toBe('recovered');

    const notice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: sourceNoticeId,
    });
    expect(notice).not.toBeNull();
  });

  it('§3: drain failure backoff accumulates attempts and abandons at FETCH_RETRY_MAX_ATTEMPTS with a NOTICE_FETCH_ABANDONED diagnostic', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'drain-abandon-1';
    const xmlUrl = 'https://ted.europa.eu/notice/drain-abandon-1.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    // NOTE: this file shares one D1, so other tests' pending retry rows are
    // also swept into every drain call below — assert on THIS row's own
    // terminal outcome (via targeted queries), not on the drain's aggregate
    // per-call counts.
    const client = makeClient(makeFakeFetch([], {})); // xmlUrl never in the map -> 404 every time
    const DAY_MS = 86_400_000;
    let attemptNow = T0 + 1000;
    for (let i = 0; i < FETCH_RETRY_MAX_ATTEMPTS; i += 1) {
      await drainFetchRetries({
        db,
        client,
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        now: () => attemptNow,
      });
      // Push `now` well past whatever linear backoff was just scheduled so
      // the row is due again on the next loop iteration.
      attemptNow += (i + 2) * DAY_MS;
    }

    const retryRow = await env.DB.prepare(
      'SELECT status, attempts FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ status: string; attempts: number }>();
    expect(retryRow?.status).toBe('abandoned');
    expect(retryRow?.attempts).toBe(FETCH_RETRY_MAX_ATTEMPTS);

    const diag = await env.DB.prepare(
      "SELECT stage, source_notice_id, error_code, detail_json FROM ingestion_errors WHERE source_notice_id = ? AND error_code = 'NOTICE_FETCH_ABANDONED'",
    )
      .bind(sourceNoticeId)
      .first<{
        stage: string;
        source_notice_id: string;
        error_code: string;
        detail_json: string;
      }>();
    expect(diag?.stage).toBe('fetch');
    const detail = JSON.parse(diag?.detail_json ?? '{}') as Record<string, unknown>;
    expect(detail['attempts']).toBe(FETCH_RETRY_MAX_ATTEMPTS);
  });

  it('the drain is skipped when the catch-up loop ends failed (an already-failing origin is not hammered further)', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    const start = before?.lastPublicationDate ?? '2026-08-23';
    await advanceCheckpoint(db, { source: 'ted', lastPublicationDate: start });

    // A pending retry row exists and is due — if the drain ran, it would be
    // touched (attempts bumped or recovered). It must be left untouched.
    const sourceNoticeId = 'drain-skip-1';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/drain-skip-1.xml',
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    const now = Date.parse('2026-10-01T00:00:00Z');
    // Budget of 1: the first catch-up window's search call spends it, so its
    // very first notice-XML fetch throws TedBudgetExceededError -> the
    // window (and therefore catch-up) ends `failed`.
    const client = makeClient(
      makeFakeFetch(
        Array.from({ length: 3 }, () => ({
          notices: [
            searchRow(
              'drain-skip-window-1',
              start,
              'https://ted.europa.eu/notice/drain-skip-window-1.xml',
            ),
          ],
        })),
        { 'https://ted.europa.eu/notice/drain-skip-window-1.xml': normalXml },
      ),
      1,
    );

    const result = await runIngestionCatchUp({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      maxWindowsPerRun: 3,
      now: () => now,
    });

    expect(result.results.some((r) => r.status === 'failed')).toBe(true);
    // ADR-0009 §2: REQUEST_BUDGET_EXCEEDED is systemic -> drain skipped.
    expect(result.results.find((r) => r.status === 'failed')?.failureCode).toBe(
      'REQUEST_BUDGET_EXCEEDED',
    );
    expect(result.drain).toBeNull();

    const retryRow = await env.DB.prepare(
      'SELECT attempts, status FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ attempts: number; status: string }>();
    expect(retryRow?.attempts).toBe(0);
    expect(retryRow?.status).toBe('pending');
  });

  it('ADR-0009 §2: the drain RUNS after a non-systemic window failure (UNEXPECTED_WINDOW_ERROR) — a persistence bug says nothing about TED', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    const start = before?.lastPublicationDate ?? '2026-08-23';
    await advanceCheckpoint(db, { source: 'ted', lastPublicationDate: start });

    // A pending, due retry row for a DIFFERENT notice: if the drain runs, it
    // recovers via this same client/fixture.
    const drainNoticeId = 'drain-runs-nonsystemic-1';
    const drainXmlUrl = 'https://ted.europa.eu/notice/drain-runs-nonsystemic-1.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: drainNoticeId,
      xmlUrl: drainXmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    const windowNoticeUrl = 'https://ted.europa.eu/notice/nonsystemic-window-1.xml';
    const client = makeClient(
      makeFakeFetch(
        Array.from({ length: 3 }, () => ({
          notices: [searchRow('nonsystemic-window-1', start, windowNoticeUrl)],
        })),
        { [windowNoticeUrl]: normalXml, [drainXmlUrl]: normalXml },
      ),
    );

    // R2 `.put` throws ONLY for the window's freshly-created snapshot (key
    // contains the window notice's id) — an unexpected persistence failure,
    // NOT a TedRequestError/budget/threshold error, so
    // `describeWindowFailure` classifies it UNEXPECTED_WINDOW_ERROR (stage
    // `persist`) rather than any systemic code. Everything else (including
    // the drain's own snapshot write for a DIFFERENT notice) delegates to
    // the real R2 binding so the drain can genuinely recover.
    const selectivelyThrowingSnapshots = {
      put: (key: string, ...rest: unknown[]) => {
        if (key.includes('nonsystemic-window-1')) {
          return Promise.reject(new Error('simulated R2 outage'));
        }
        return (
          env.SNAPSHOTS as unknown as {
            put: (k: string, ...r: unknown[]) => Promise<unknown>;
          }
        ).put(key, ...rest);
      },
    } as unknown as R2Bucket;

    const result = await runIngestionCatchUp({
      db,
      client,
      snapshots: selectivelyThrowingSnapshots,
      logger: createLogger({ test: true }),
      maxWindowsPerRun: 1,
      now: () => Date.parse(`${start}T00:00:00Z`) + 5 * MS_PER_DAY,
    });

    const failed = result.results.find((r) => r.status === 'failed');
    expect(failed?.failureCode).toBe('UNEXPECTED_WINDOW_ERROR');
    // The drain ran (non-null result) and recovered the due row.
    expect(result.drain).not.toBeNull();

    const retryRow = await env.DB.prepare(
      'SELECT status FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', drainNoticeId)
      .first<{ status: string }>();
    expect(retryRow?.status).toBe('recovered');
  });

  it("RV-0009-02: ADR-0009 §2 same-run drain pickup — a notice that exhausts render-pending during the window's own pass is re-attempted and recovered by the SAME `runIngestionCatchUp` invocation's drain (upserted, retry row `recovered`, lot id in newLotIds)", async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    const start = before?.lastPublicationDate ?? '2026-08-23';
    await advanceCheckpoint(db, { source: 'ted', lastPublicationDate: start });
    const windowDate = nextIsoDate(start, 1);

    const sourceNoticeId = 'same-run-drain-1';
    const xmlUrl = 'https://ted.europa.eu/notice/same-run-drain-1.xml';
    // Stateful fake fetch keyed by call count on THIS url (the pattern
    // already used above for the drain-cycle tests): the window's Phase 2
    // trigger/collect cycle exhausts all MAX_RENDER_VISITS (6) as
    // 202/render-pending, so `recordFetchSkip` lands a retry row with
    // `nextAttemptAt = now()` and the window finishes `partial` (not
    // failed -> not systemic -> the drain is not skipped). The SAME
    // TedClient keeps counting hits into the drain that follows in the
    // same `runIngestionCatchUp` call: the 7th hit (the drain's first
    // visit for this row) serves the real XML — proving the drain picks
    // up and lands the skip it JUST created, in one invocation.
    let hits = 0;
    const base = makeFakeFetch([{ notices: [searchRow(sourceNoticeId, windowDate, xmlUrl)] }], {});
    const fetchImpl: TedFetch = (url, init) => {
      if (url.endsWith('/v3/notices/search')) return base(url, init);
      if (url !== xmlUrl) return base(url, init);
      hits += 1;
      if (hits <= 6) return Promise.resolve(alwaysPendingResponse());
      return Promise.resolve(textResponse(normalXml));
    };

    const now = Date.parse('2026-10-06T00:00:00Z');
    const result = await runIngestionCatchUp({
      db,
      client: makeClient(fetchImpl),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      maxWindowsPerRun: 1,
      now: () => now,
      renderRetryDelayMs: 0,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('partial');
    expect(result.results[0]?.failureCode).toBeNull();
    // The same invocation's drain ran (non-systemic) and swept up the row
    // the window just created.
    expect(result.drain).not.toBeNull();
    // 6 exhausted visits inside the window's own pass + 1 drain re-attempt
    // that lands the XML — proof the drain re-fetched in THIS invocation,
    // not merely that the notice exists somewhere.
    expect(hits).toBe(7);

    const retryRow = await env.DB.prepare(
      "SELECT status FROM ingestion_fetch_retries WHERE source = 'ted' AND source_notice_id = ?",
    )
      .bind(sourceNoticeId)
      .first<{ status: string }>();
    expect(retryRow?.status).toBe('recovered');

    const notice = await getNoticeByPublicationNumber(db, {
      source: 'ted',
      publicationNumber: sourceNoticeId,
    });
    expect(notice).not.toBeNull();

    const lot = await env.DB.prepare(
      'SELECT id FROM tender_lots WHERE notice_version_id = (SELECT current_version_id FROM tender_notices WHERE id = ?)',
    )
      .bind(notice?.id)
      .first<{ id: string }>();
    expect(lot?.id).toBeDefined();
    // The drain's freshly-created lot id surfaces in the catch-up's
    // returned newLotIds — the composed result the worker enqueues to
    // MATCH_QUEUE, not just the drain's own internal result.
    expect(result.newLotIds).toContain(lot?.id);
  });

  it('Amendment §A2 F-3a: a drain row that cycles through render-pending responses then succeeds is recovered WITHOUT incrementing attempts (a whole successful cycle is not a "failure")', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'drain-cycle-recover-1';
    const xmlUrl = 'https://ted.europa.eu/notice/drain-cycle-recover-1.xml';
    const seeded = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });
    expect(seeded.attempts).toBe(0);

    // First 3 visits answer 202 (render-pending); the 4th (well within
    // MAX_RENDER_VISITS=6) serves the real XML.
    let hits = 0;
    const fetchImpl: TedFetch = (url) => {
      if (url !== xmlUrl) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: () => Promise.reject(new Error('not found')),
          text: () => Promise.resolve(''),
        });
      }
      hits += 1;
      if (hits <= 3) {
        return Promise.resolve({
          ok: true,
          status: 202,
          headers: { get: () => null },
          json: () => Promise.reject(new Error('not json')),
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve(textResponse(normalXml));
    };

    const result = await drainFetchRetries({
      db,
      client: makeClient(fetchImpl),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => T0 + 1000,
      renderRetryDelayMs: 0,
    });
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    expect(hits).toBe(4); // 3 trigger/collect-empty visits + the one that lands the XML.

    const retryRow = await env.DB.prepare(
      'SELECT status, attempts FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ status: string; attempts: number }>();
    expect(retryRow?.status).toBe('recovered');
    // The whole cycle succeeded — a success is never a "failed re-attempt",
    // so `attempts` (a count of FAILED cycles, ADR-0008 §3) is untouched.
    expect(retryRow?.attempts).toBe(0);
  });

  it('Amendment §A2 F-3b: a drain row that exhausts all MAX_RENDER_VISITS as render-pending increments attempts ONCE per cycle (not once per visit), stays pending with backoff below FETCH_RETRY_MAX_ATTEMPTS', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'drain-cycle-exhaust-1';
    const xmlUrl = 'https://ted.europa.eu/notice/drain-cycle-exhaust-1.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    let hits = 0;
    const fetchImpl: TedFetch = (url) => {
      if (url !== xmlUrl) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: () => Promise.reject(new Error('not found')),
          text: () => Promise.resolve(''),
        });
      }
      hits += 1;
      return Promise.resolve({
        ok: true,
        status: 202,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve(''),
      });
    };

    const result = await drainFetchRetries({
      db,
      client: makeClient(fetchImpl),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => T0 + 1000,
      renderRetryDelayMs: 0,
    });
    expect(result.stillPending).toBeGreaterThanOrEqual(1);
    expect(result.abandoned).toBe(0); // 1st failed cycle: attempts -> 1, well below FETCH_RETRY_MAX_ATTEMPTS (5).
    expect(hits).toBe(6); // exactly MAX_RENDER_VISITS visits for this one row's single cycle.

    const retryRow = await env.DB.prepare(
      'SELECT status, attempts, next_attempt_at FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
    expect(retryRow?.status).toBe('pending');
    // ONE cycle (6 visits, all render-pending) -> ONE `attempts` increment,
    // not 6 — the drain's attempts accounting is per-cycle (Amendment §A2).
    expect(retryRow?.attempts).toBe(1);
    // Linear daily backoff computed from the INCREMENTED value (repo doc):
    // next_attempt_at = (T0 + 1000) + 1 * 86_400_000.
    expect(retryRow?.next_attempt_at).toBe(T0 + 1000 + 86_400_000);
  });

  it('F-4: a drain row that fetches successfully but fails to PARSE is marked recovered (fetch problem solved); the parse failure lands in ingestion_errors under the drain run, and the drain run finishes partial', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'drain-parse-fail-1';
    const xmlUrl = 'https://ted.europa.eu/notice/drain-parse-fail-1.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: T0,
      now: T0,
    });

    const client = makeClient(makeFakeFetch([], { [xmlUrl]: malformedTruncatedXml }));
    const result = await drainFetchRetries({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => T0 + 1000,
    });
    expect(result.runId).not.toBeNull();
    expect(result.recovered).toBeGreaterThanOrEqual(1);

    const retryRow = await env.DB.prepare(
      'SELECT status FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ status: string }>();
    // The retry table's job is fetch failures specifically — the notice WAS
    // fetched successfully; the parse failure is independently diagnosable
    // from its own ingestion_errors row below, so it does not keep
    // occupying a retry slot.
    expect(retryRow?.status).toBe('recovered');

    const errorRow = await env.DB.prepare(
      "SELECT ingestion_run_id, stage, error_code, detail_json FROM ingestion_errors WHERE source_notice_id = ? AND stage = 'parse'",
    )
      .bind(sourceNoticeId)
      .first<{
        ingestion_run_id: string;
        stage: string;
        error_code: string;
        detail_json: string | null;
      }>();
    expect(errorRow?.ingestion_run_id).toBe(result.runId);
    expect(errorRow?.stage).toBe('parse');
    expect(errorRow?.detail_json).toContain('snapshotR2Key');

    const runRow = await env.DB.prepare('SELECT status FROM ingestion_runs WHERE id = ?')
      .bind(result.runId)
      .first<{ status: string }>();
    expect(runRow?.status).toBe('partial');
  });

  it('RV-0009-03: TedBudgetExceededError mid-drain breaks out but still finishes the run row; rows not yet reached stay pending/untouched, and the checkpoint is never touched', async () => {
    const db = createDb(env.DB);
    const beforeCheckpoint = await getCheckpoint(db, { source: 'ted' });

    // Due strictly BEFORE T0: every OTHER retry row this shared-D1 file
    // creates is due at T0 or later (see this describe block's earlier
    // "shares one D1" notes; `grep nextAttemptAt:` confirms none go below
    // T0), so a drain call `now`'d before T0 sweeps up ONLY these three
    // rows, in this order (nextAttemptAt is the drain query's primary sort
    // key) — regardless of what any other test in this file left pending.
    const dueAt1 = T0 - 300_000;
    const dueAt2 = T0 - 200_000;
    const dueAt3 = T0 - 100_000;
    const xmlUrl1 = 'https://ted.europa.eu/notice/budget-die-1.xml';
    const xmlUrl2 = 'https://ted.europa.eu/notice/budget-die-2.xml';
    const xmlUrl3 = 'https://ted.europa.eu/notice/budget-die-3.xml';
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: 'budget-die-1',
      xmlUrl: xmlUrl1,
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: dueAt1,
      now: dueAt1,
    });
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: 'budget-die-2',
      xmlUrl: xmlUrl2,
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: dueAt2,
      now: dueAt2,
    });
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: 'budget-die-3',
      xmlUrl: xmlUrl3,
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: dueAt3,
      now: dueAt3,
    });

    // Budget of 1: the first (oldest-due) row's single fetch spends the
    // whole budget; the second row's very first fetch call finds the
    // budget already exhausted. `TedClient` checks the budget BEFORE
    // invoking the injected fetch (packages/ted/src/client.ts
    // `performOnce`), so this fake fetch never even sees a request for
    // xmlUrl2/xmlUrl3 — the client throws `TedBudgetExceededError`
    // synchronously on the second row's first visit.
    const client = makeClient(makeFakeFetch([], { [xmlUrl1]: normalXml }), 1);
    const drainNow = T0 - 50_000; // after all three nextAttemptAt, strictly before T0.
    const result = await drainFetchRetries({
      db,
      client,
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => drainNow,
    });

    expect(result.terminatedByBudget).toBe(true);
    expect(result.attempted).toBe(3);
    expect(result.recovered).toBe(1);
    expect(result.abandoned).toBe(0);
    expect(result.stillPending).toBe(0);
    expect(result.runId).not.toBeNull();

    const runRow = await env.DB.prepare('SELECT status FROM ingestion_runs WHERE id = ?')
      .bind(result.runId)
      .first<{ status: string }>();
    // The drain's own run row still finishes (recorded, not left `running`)
    // even though the work queue was cut short by the budget.
    expect(runRow?.status).toBe('succeeded');

    const row1 = await env.DB.prepare(
      'SELECT status FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', 'budget-die-1')
      .first<{ status: string }>();
    expect(row1?.status).toBe('recovered');

    // The row that hit the budget wall: its fetch WAS attempted, but the
    // `TedBudgetExceededError` branch breaks before any repository write
    // for it (fetch-retry-drain.ts: `terminatedByBudget = true; ...
    // break;`, no `recordFetchRetryFailure` call) — its state must be
    // exactly what it was before this drain call, not a recorded failure.
    const row2 = await env.DB.prepare(
      'SELECT status, attempts, next_attempt_at FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', 'budget-die-2')
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
    expect(row2?.status).toBe('pending');
    expect(row2?.attempts).toBe(0);
    expect(row2?.next_attempt_at).toBe(dueAt2);

    // Never reached by the work queue at all.
    const row3 = await env.DB.prepare(
      'SELECT status, attempts, next_attempt_at FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', 'budget-die-3')
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
    expect(row3?.status).toBe('pending');
    expect(row3?.attempts).toBe(0);
    expect(row3?.next_attempt_at).toBe(dueAt3);

    // The drain never touches the ingestion checkpoint (it is windowless
    // by construction, ADR-0008 §3).
    const afterCheckpoint = await getCheckpoint(db, { source: 'ted' });
    expect(afterCheckpoint?.lastPublicationDate).toBe(beforeCheckpoint?.lastPublicationDate);
  });
});

describe('ADR-0010 §5.2: fetch_retry_attempts_suspended (outage attempt-burn suspension)', () => {
  // The D1 file is shared across every test in this file, so other suites'
  // pending retry rows are also "due". These tests back-date their own rows
  // well before any of those so `listDueFetchRetries`' (next_attempt_at ASC)
  // ordering puts them at the front of the canary subset deterministically.
  const DUE_LONG_AGO = T0 - 30 * MS_PER_DAY;

  /** Sets the operator flag and always clears it again — the D1 file is shared. */
  async function withSuspension<T>(
    db: ReturnType<typeof createDb>,
    run: () => Promise<T>,
  ): Promise<T> {
    await setFeatureFlag(db, {
      key: FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED,
      valueJson: 'true',
      description: 'test: confirmed upstream render outage',
    });
    try {
      return await run();
    } finally {
      await setFeatureFlag(db, {
        key: FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED,
        valueJson: 'false',
        description: 'test: outage cleared',
      });
    }
  }

  async function seedDueRetry(
    db: ReturnType<typeof createDb>,
    sourceNoticeId: string,
    errorCode: string,
  ): Promise<string> {
    const xmlUrl = `https://ted.europa.eu/notice/${sourceNoticeId}.xml`;
    await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId,
      xmlUrl,
      publicationDate: '2026-08-10',
      errorCode,
      nextAttemptAt: DUE_LONG_AGO,
      now: DUE_LONG_AGO,
    });
    return xmlUrl;
  }

  function retryRowOf(sourceNoticeId: string) {
    return env.DB.prepare(
      'SELECT status, attempts, next_attempt_at FROM ingestion_fetch_retries WHERE source = ? AND source_notice_id = ?',
    )
      .bind('ted', sourceNoticeId)
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
  }

  it('S-1: render-pending exhaustion does NOT burn an attempt while suspended — attempts and next_attempt_at both unchanged, so the row stays due and is re-probed', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'suspended-render-pending-1';
    const xmlUrl = await seedDueRetry(db, sourceNoticeId, 'NOTICE_RENDER_PENDING');

    let hits = 0;
    const fetchImpl: TedFetch = (url) => {
      if (url !== xmlUrl) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: () => Promise.reject(new Error('not found')),
          text: () => Promise.resolve(''),
        });
      }
      hits += 1;
      return Promise.resolve(alwaysPendingResponse());
    };

    const result = await withSuspension(db, () =>
      drainFetchRetries({
        db,
        client: makeClient(fetchImpl, 500),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        now: () => T0 + 1000,
        renderRetryDelayMs: 0,
      }),
    );

    expect(result.attemptsSuspended).toBe(true);
    expect(result.stillPending).toBeGreaterThanOrEqual(1);
    // Recovery detection is PRESERVED: the row was really fetched, a full
    // render-visit cycle, exactly as an unsuspended drain would.
    expect(hits).toBe(6);

    const retryRow = await retryRowOf(sourceNoticeId);
    expect(retryRow?.status).toBe('pending');
    // The whole point of §5.2: the abandonment clock did not advance.
    expect(retryRow?.attempts).toBe(0);
    // next_attempt_at untouched too, so the row remains due and is re-probed
    // rather than being pushed a day out by a failure that was not its own.
    expect(retryRow?.next_attempt_at).toBe(DUE_LONG_AGO);
  });

  it('S-2: a genuine TedRequestError still burns an attempt while suspended — HTTP failures are per-notice evidence, outage or not', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'suspended-http-404-1';
    await seedDueRetry(db, sourceNoticeId, 'NOTICE_FETCH_HTTP_404');

    // 404 is deliberately NOT a retryable status (client.ts isRetryableStatus),
    // so this raises TedRequestError immediately instead of spending the test
    // budget on real backoff sleeps.
    const fetchImpl: TedFetch = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not found')),
        text: () => Promise.resolve(''),
      });

    const result = await withSuspension(db, () =>
      drainFetchRetries({
        db,
        client: makeClient(fetchImpl, 500),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        now: () => T0 + 1000,
        renderRetryDelayMs: 0,
      }),
    );

    expect(result.attemptsSuspended).toBe(true);

    const retryRow = await retryRowOf(sourceNoticeId);
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.attempts).toBe(1);
    // Normal linear daily backoff off the incremented value — suspension does
    // not touch the HTTP-failure path at all.
    expect(retryRow?.next_attempt_at).toBe(T0 + 1000 + MS_PER_DAY);
  });

  it('S-3: while suspended the drain pulls only the canary subset, not FETCH_RETRY_MAX_PER_RUN', async () => {
    const db = createDb(env.DB);
    const ids = ['canary-a', 'canary-b', 'canary-c', 'canary-d', 'canary-e'];
    for (const id of ids) {
      await seedDueRetry(db, id, 'NOTICE_RENDER_PENDING');
    }
    expect(FETCH_RETRY_SUSPENDED_CANARY_ROWS).toBeLessThan(ids.length);

    const result = await withSuspension(db, () =>
      drainFetchRetries({
        db,
        client: makeClient(() => Promise.resolve(alwaysPendingResponse()), 500),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        now: () => T0 + 1000,
        renderRetryDelayMs: 0,
      }),
    );

    expect(result.attemptsSuspended).toBe(true);
    expect(result.attempted).toBe(FETCH_RETRY_SUSPENDED_CANARY_ROWS);
    // No row anywhere burned an attempt this run: the three that were probed
    // were render-pending (suspended), and the rest were never touched.
    const burned = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE source_notice_id IN (?, ?, ?, ?, ?) AND attempts > 0',
    )
      .bind(...ids)
      .first<{ n: number }>();
    expect(burned?.n).toBe(0);
  });

  it('S-4: with the flag off the drain reports attemptsSuspended false and burns attempts normally (default posture unchanged)', async () => {
    const db = createDb(env.DB);
    const sourceNoticeId = 'unsuspended-default-1';
    await seedDueRetry(db, sourceNoticeId, 'NOTICE_RENDER_PENDING');

    const result = await drainFetchRetries({
      db,
      client: makeClient(() => Promise.resolve(alwaysPendingResponse()), 500),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      now: () => T0 + 1000,
      renderRetryDelayMs: 0,
    });

    expect(result.attemptsSuspended).toBe(false);

    const retryRow = await retryRowOf(sourceNoticeId);
    expect(retryRow?.attempts).toBe(1);
  });
});

describe('ADR-0008 §5: checkFetchResilienceAlerts (watchdog conditions i-iii)', () => {
  it('F-2(i): a recent FETCH_FAILURE_THRESHOLD_EXCEEDED/NOTICE_FETCH_ABANDONED error trips condition (i)', async () => {
    const db = createDb(env.DB);
    const run = await createRun(db, {
      source: 'ted',
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    const nowMs = T0 + 5000;
    await recordError(db, {
      ingestionRunId: run.id,
      source: 'ted',
      stage: 'fetch',
      errorCode: 'NOTICE_FETCH_ABANDONED',
      message: 'test: abandoned notice',
    });

    const alerts = await checkFetchResilienceAlerts(db, nowMs);
    expect(alerts.thresholdOrAbandonment).toBe(true);
    expect(alerts.degraded).toBe(true);
  });

  it('ADR-0009 §1: a recent RENDER_PENDING_DEGRADED error also trips condition (i)', async () => {
    const db = createDb(env.DB);
    const run = await createRun(db, {
      source: 'ted',
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    const nowMs = T0 + 5000;
    await recordError(db, {
      ingestionRunId: run.id,
      source: 'ted',
      stage: 'fetch',
      errorCode: 'RENDER_PENDING_DEGRADED',
      message: 'test: degraded render day',
    });

    const alerts = await checkFetchResilienceAlerts(db, nowMs);
    expect(alerts.thresholdOrAbandonment).toBe(true);
    expect(alerts.degraded).toBe(true);
  });

  it('F-2(ii): a pending retry backlog over the threshold trips condition (ii)', async () => {
    const db = createDb(env.DB);
    // Insert enough FRESH pending rows to push the total backlog over
    // PENDING_RETRY_BACKLOG_ALERT_THRESHOLD regardless of whatever this
    // shared-D1 file's earlier tests already left pending.
    const marker = `backlog-${String(T0)}`;
    for (let i = 0; i < PENDING_RETRY_BACKLOG_ALERT_THRESHOLD + 5; i += 1) {
      await upsertFetchRetry(db, {
        source: 'ted',
        sourceNoticeId: `${marker}-${String(i)}`,
        xmlUrl: `https://ted.europa.eu/notice/${marker}-${String(i)}.xml`,
        publicationDate: '2026-08-01',
        errorCode: 'NOTICE_FETCH_HTTP_404',
        // Due far in the future — condition (ii) counts the WHOLE pending
        // backlog regardless of due-ness (health.ts doc comment), so these
        // must NOT get swept/recovered by an earlier or later drain call in
        // this same test file.
        nextAttemptAt: T0 + 365 * 86_400_000,
        now: T0,
      });
    }

    const alerts = await checkFetchResilienceAlerts(db, T0 + 5000);
    expect(alerts.pendingRetryBacklog).toBe(true);
    expect(alerts.degraded).toBe(true);
  });

  it('the drain-run masking fix (F-1): condition (iii) is not broken by interleaved drain runs (noticesSeen=0) between partial windows', async () => {
    const db = createDb(env.DB);
    const before = await getCheckpoint(db, { source: 'ted' });
    let windowFrom = before?.lastPublicationDate ?? '2026-08-23';

    async function partialWindowWithFetchFailure(label: string): Promise<void> {
      windowFrom = nextIsoDate(windowFrom, 1);
      const url = `https://ted.europa.eu/notice/${label}.xml`;
      const rows = [searchRow(label, windowFrom, url)];
      const client = makeClient(
        makeFakeFetch([{ notices: rows }], {}), // absent from the map -> 404, non-retryable
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
        { windowFrom, windowTo: windowFrom },
      );
      expect(result.status).toBe('partial');
      expect(result.run.noticesFetchFailed).toBeGreaterThan(0);
    }

    async function drainRunGuaranteed(label: string): Promise<void> {
      // Guarantee a due row regardless of what other tests left pending, so
      // this test is self-contained rather than relying on shared-D1 state.
      await upsertFetchRetry(db, {
        source: 'ted',
        sourceNoticeId: `iii-fixture-${label}`,
        xmlUrl: `https://ted.europa.eu/notice/iii-fixture-${label}.xml`,
        publicationDate: '2026-08-01',
        errorCode: 'NOTICE_FETCH_HTTP_404',
        nextAttemptAt: T0,
        now: T0,
      });
      const drainResult = await drainFetchRetries({
        db,
        client: makeClient(makeFakeFetch([], {})),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        now: () => T0 + 1000,
      });
      expect(drainResult.runId).not.toBeNull();
      const runRow = await env.DB.prepare('SELECT notices_seen FROM ingestion_runs WHERE id = ?')
        .bind(drainResult.runId)
        .first<{ notices_seen: number }>();
      expect(runRow?.notices_seen).toBe(0);
    }

    // partial (failed>0) -> drain (0) -> partial -> drain -> partial -> drain.
    await partialWindowWithFetchFailure('iii-w1');
    await drainRunGuaranteed('a');
    await partialWindowWithFetchFailure('iii-w2');
    await drainRunGuaranteed('b');
    await partialWindowWithFetchFailure('iii-w3');
    await drainRunGuaranteed('c');

    const alerts = await checkFetchResilienceAlerts(db, T0 + 100_000);
    expect(alerts.consecutiveFetchFailedRuns).toBe(true);
    expect(alerts.degraded).toBe(true);
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
