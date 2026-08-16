/**
 * Full scoring-pipeline integration tests: real local D1 (workerd via
 * @cloudflare/vitest-pool-workers), real ingestion via a FAKE TedClient
 * serving the shared `tests/fixtures/ted` fixtures, then real scoring via
 * `scoreLotsForOrgs`. Proves the component-persistence rule, the CPV
 * division pre-filter, non-EUR value conversion via `exchange_rates`,
 * EXCLUDED handling, the correction/recompute path, and scoring idempotency.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bidmorrow/observability';
import { TedClient } from '@bidmorrow/ted';
import type { TedFetch } from '@bidmorrow/ted';
import {
  DEFAULT_INGESTION_SCOPE,
  runIngestionWindow,
  scoreLotsForOrgs,
} from '@bidmorrow/procurement';
import {
  createDb,
  createOrganization,
  insertCpvCodes,
  insertLots,
  insertSnapshotIfNewHash,
  newId,
  upsertBuyer,
  upsertCompanyProfile,
  upsertMatchingPreferences,
  upsertNoticeWithVersion,
  replaceCompanyCertifications,
  replaceCompanyCpvPreferences,
  replaceCompanyExclusions,
  replaceCompanyGeographies,
  replaceCompanyKeywords,
} from '@bidmorrow/db';
import { schema } from '@bidmorrow/db';

// pool-workers tests run inside sandboxed workerd, not Node — fixtures are
// inlined via Vite's `?raw` loader (matches ingestion.d1.test.ts).
import normalXml from '../../../tests/fixtures/ted/1.15/normal.xml?raw';
import normalCorrectedXml from '../../../tests/fixtures/ted/1.15/normal-corrected.xml?raw';

/** Deadline in normal.xml/normal-corrected.xml is 2020-04-03; score 33 days before it. */
const SCORING_TIME = Date.parse('2020-03-01T00:00:00Z');

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

function searchRow(sourceNoticeId: string, publicationDate: string, xmlUrl: string) {
  return {
    'publication-number': sourceNoticeId,
    'publication-date': publicationDate,
    links: { xml: { MUL: xmlUrl } },
  };
}

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

function makeClient(fetchImpl: TedFetch): TedClient {
  return new TedClient({
    fetch: fetchImpl,
    budget: { maxRequestsPerRun: 100 },
    minRequestSpacingMs: 0,
    logger: createLogger({ test: true }),
  });
}

/** Ingests one notice via the real pipeline and returns its notice/lot ids. */
async function ingestOne(
  db: ReturnType<typeof createDb>,
  sourceNoticeId: string,
  publicationDate: string,
  xml: string,
): Promise<{ noticeId: string; lotId: string }> {
  const url = `https://ted.europa.eu/notice/${sourceNoticeId}.xml`;
  const result = await runIngestionWindow(
    {
      db,
      client: makeClient(
        makeFakeFetch([{ notices: [searchRow(sourceNoticeId, publicationDate, url)] }], {
          [url]: xml,
        }),
      ),
      snapshots: env.SNAPSHOTS,
      logger: createLogger({ test: true }),
      scope: DEFAULT_INGESTION_SCOPE,
      now: () => SCORING_TIME,
    },
    { windowFrom: publicationDate, windowTo: publicationDate },
  );
  expect(result.newLotIds.length).toBeGreaterThan(0);
  const lotId = result.newLotIds[0];
  if (lotId === undefined) throw new Error('ingestOne: no lot created');
  const noticeRow = await env.DB.prepare('SELECT id FROM tender_notices WHERE source_notice_id = ?')
    .bind(sourceNoticeId)
    .first<{ id: string }>();
  if (noticeRow === null) throw new Error('ingestOne: notice not found after ingestion');
  return { noticeId: noticeRow.id, lotId };
}

let orgCounter = 0;

/** Creates a bare organization (auth user + org) eligible for the eligibility check once a profile/CPV pref is added. */
async function makeOrg(db: ReturnType<typeof createDb>, label: string): Promise<string> {
  orgCounter += 1;
  const userId = newId(Date.now());
  await db.insert(schema.users).values({
    id: userId,
    email: `scoring-test-${String(orgCounter)}@example.test`,
    emailVerified: true,
    name: `Scoring Tester ${String(orgCounter)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { organization } = await createOrganization(db, {
    name: `${label} ${String(orgCounter)}`,
    createdByUserId: userId,
  });
  return organization.id;
}

/**
 * Seeds a minimal notice + lot with one main CPV code — bypasses full TED
 * XML ingestion (unneeded for the P-4 write-batching scale test below,
 * which only cares about org×lot pair volume) the same way
 * `matching.d1.test.ts`'s `seedLot` does.
 */
async function seedBareLot(
  db: ReturnType<typeof createDb>,
  sourceNoticeId: string,
  cpvCode: string,
): Promise<{ noticeId: string; lotId: string }> {
  const snapshot = await insertSnapshotIfNewHash(db, {
    source: 'ted',
    sourceNoticeId,
    versionNumber: 1,
    r2Key: `ted/2026/${sourceNoticeId}/1.xml.gz`,
    contentHash: `hash-${sourceNoticeId}`,
    sizeBytes: 10,
    contentType: 'application/xml',
  });
  const upsert = await upsertNoticeWithVersion(db, {
    source: 'ted',
    sourceNoticeId,
    noticeType: 'cn-standard',
    sourceLanguagesJson: '["eng"]',
    sourceUrl: `https://example.test/${sourceNoticeId}`,
    publicationDate: '2026-08-10',
    contentHash: `hash-${sourceNoticeId}`,
    snapshotId: snapshot.snapshot.id,
  });
  const [lot] = await insertLots(db, {
    noticeVersionId: upsert.versionId,
    lots: [
      {
        lotNumber: '1',
        title: `Scale test lot ${sourceNoticeId}`,
        contractNature: 'services',
        estimatedValueAmount: 100_000,
        estimatedValueCurrency: 'EUR',
        estimatedValueEur: 100_000,
        valueIsDerived: false,
        deadlineAt: SCORING_TIME + 30 * 86_400_000,
      },
    ],
  });
  if (lot === undefined) throw new Error('seedBareLot: lot insert failed');
  await insertCpvCodes(db, { entries: [{ lotId: lot.id, cpvCode, isMain: true }] });
  return { noticeId: upsert.noticeId, lotId: lot.id };
}

describe('scoreLotsForOrgs', () => {
  it('a STRONG_MATCH org gets a full component breakdown that sums to the score', async () => {
    const db = createDb(env.DB);
    const { lotId, noticeId } = await ingestOne(db, 'score-strong-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Strong Match Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Strong Match Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71630000'] });
    await replaceCompanyGeographies(db, orgId as never, {
      geographies: [{ kind: 'opportunity_country', code: 'GB' }],
    });
    await replaceCompanyKeywords(db, orgId as never, {
      keywords: [
        { kind: 'positive', term: 'electrical equipment' },
        { kind: 'positive', term: 'inspection' },
        { kind: 'positive', term: 'testing' },
      ],
    });
    await replaceCompanyCertifications(db, orgId as never, {
      certifications: [{ certificationCode: 'ISO_9001' }],
    });
    await upsertMatchingPreferences(db, orgId as never, {
      minValueEur: 400_000,
      maxValueEur: 600_000,
      supportedContractNatures: ['services'],
      minimumDaysRemaining: 10,
    });

    // NOTE: other tests in this file share one D1 (vitest-pool-workers
    // per-file isolation) and every org they create stays eligible, so
    // `scoreLotsForOrgs` here also (harmlessly) scores THEIR orgs against
    // THIS lot — assertions below are always scoped to this test's own
    // `orgId`, never to the call's aggregate counters.
    const result = await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );
    expect(result.truncated).toBe(false);
    expect(result.matchesWritten).toBeGreaterThanOrEqual(1);

    const match = await env.DB.prepare(
      'SELECT id, score, classification, notice_id FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{ id: string; score: number; classification: string; notice_id: string }>();
    expect(match).not.toBeNull();
    expect(match?.notice_id).toBe(noticeId);
    expect(match?.classification).toBe('STRONG_MATCH');
    expect(match?.score).toBeGreaterThanOrEqual(80);

    const components = await env.DB.prepare(
      'SELECT component_key, points, max_points, status, explanation FROM match_components WHERE match_id = ?',
    )
      .bind(match?.id)
      .all<{
        component_key: string;
        points: number;
        max_points: number;
        status: string;
        explanation: string;
      }>();
    expect(components.results.length).toBe(8);
    const summed = components.results.reduce((sum, c) => sum + c.points, 0);
    expect(summed).toBeCloseTo(match?.score ?? -1, 5);
  });

  it('a LOW_FIT org gets zero component rows (component-persistence rule)', async () => {
    const db = createDb(env.DB);
    const { lotId } = await ingestOne(db, 'score-lowfit-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Low Fit Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Low Fit Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    // Division-only CPV overlap (71xxxxxx) — passes the pre-filter, scores low.
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71500000'] });
    await upsertMatchingPreferences(db, orgId as never, {
      minValueEur: 10_000_000,
      maxValueEur: 20_000_000,
      supportedContractNatures: [],
      minimumDaysRemaining: null,
    });

    const result = await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );
    expect(result.matchesWritten).toBeGreaterThanOrEqual(1);

    const match = await env.DB.prepare(
      'SELECT id, score, classification FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{ id: string; score: number; classification: string }>();
    expect(match).not.toBeNull();
    expect(match?.classification).toBe('LOW_FIT');
    expect(match?.score).toBeLessThan(45);

    const componentCount = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM match_components WHERE match_id = ?',
    )
      .bind(match?.id)
      .first<{ n: number }>();
    expect(componentCount?.n).toBe(0);
    const riskFlagCount = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM match_risk_flags WHERE match_id = ?',
    )
      .bind(match?.id)
      .first<{ n: number }>();
    expect(riskFlagCount?.n).toBe(0);
  });

  it('CPV division pre-filter: an org with disjoint CPV divisions gets NO match row at all', async () => {
    const db = createDb(env.DB);
    const { lotId } = await ingestOne(db, 'score-disjoint-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Disjoint CPV Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Disjoint CPV Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    // Division 90 (waste/environmental) never overlaps the lot's division 71/50/31.
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['90500000'] });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );

    // This specific org's pair was pre-filtered out — no row for it, ever,
    // regardless of how many other (unrelated) orgs were also scored in the
    // same call against this shared-D1 test file's accumulated orgs.
    const match = await env.DB.prepare(
      'SELECT id FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first();
    expect(match).toBeNull();
  });

  it('an excluded-phrase org gets an EXCLUDED row (rule + evidence, no score, no component leak)', async () => {
    const db = createDb(env.DB);
    const { lotId } = await ingestOne(db, 'score-excluded-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Excluded Phrase Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Excluded Phrase Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    // Overlaps CPV division 71 (passes the pre-filter) but excludes the phrase in the lot title/description.
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71600000'] });
    await replaceCompanyExclusions(db, orgId as never, {
      exclusions: [{ kind: 'phrase', value: 'electrical equipment' }],
    });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );

    const match = await env.DB.prepare(
      'SELECT id, score, classification, exclusion_rule, exclusion_evidence FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{
        id: string;
        score: number | null;
        classification: string;
        exclusion_rule: string;
        exclusion_evidence: string;
      }>();
    expect(match).not.toBeNull();
    expect(match?.classification).toBe('EXCLUDED');
    expect(match?.score).toBeNull();
    expect(match?.exclusion_rule).toBe('excluded_phrase');
    expect(match?.exclusion_evidence).toBe('electrical equipment');

    const componentCount = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM match_components WHERE match_id = ?',
    )
      .bind(match?.id)
      .first<{ n: number }>();
    expect(componentCount?.n).toBe(0);
  });

  it('non-EUR value: a fresh ECB rate converts and scores a value band; a stale/absent rate scores UNKNOWN', async () => {
    const db = createDb(env.DB);

    // Seed a lot directly (bypassing full ingestion) with a non-EUR value.
    const snapshot = await insertSnapshotIfNewHash(db, {
      source: 'ted',
      sourceNoticeId: 'score-fx-1',
      versionNumber: 1,
      r2Key: 'ted/2026/score-fx-1/1.xml.gz',
      contentHash: 'hash-score-fx-1',
      sizeBytes: 10,
      contentType: 'application/xml',
    });
    const buyer = await upsertBuyer(db, {
      source: 'ted',
      name: 'FX Test Buyer',
      countryCode: 'SE',
    });
    const upsert = await upsertNoticeWithVersion(db, {
      source: 'ted',
      sourceNoticeId: 'score-fx-1',
      buyerId: buyer.id,
      noticeType: 'cn-standard',
      procedureType: 'open',
      sourceLanguagesJson: '["eng"]',
      sourceUrl: 'https://example.test/score-fx-1',
      publicationDate: '2026-08-10',
      contentHash: 'hash-score-fx-1',
      snapshotId: snapshot.snapshot.id,
    });
    const [lot] = await insertLots(db, {
      noticeVersionId: upsert.versionId,
      lots: [
        {
          lotNumber: '1',
          title: 'Cybersecurity consulting services',
          contractNature: 'services',
          estimatedValueAmount: 1_000_000,
          estimatedValueCurrency: 'SEK',
          estimatedValueEur: null,
          valueIsDerived: false,
          deadlineAt: SCORING_TIME + 30 * 86_400_000,
        },
      ],
    });
    if (lot === undefined) throw new Error('no lot inserted');
    await env.DB.prepare(
      'INSERT INTO tender_cpv_codes (id, lot_id, cpv_code, is_main, created_at) VALUES (?, ?, ?, 1, ?)',
    )
      .bind(newId(), lot.id, '72155000', Date.now())
      .run();

    const orgId = await makeOrg(db, 'FX Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'FX Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['72155000'] });
    // ~90,000 EUR at rate_to_eur 0.09 for 1,000,000 SEK, well inside range.
    await upsertMatchingPreferences(db, orgId as never, {
      minValueEur: 50_000,
      maxValueEur: 150_000,
      supportedContractNatures: ['services'],
      minimumDaysRemaining: null,
    });

    // No exchange_rates row yet — the value component must be UNKNOWN.
    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lot.id] },
    );
    const matchNoRate = await env.DB.prepare(
      'SELECT tm.id as match_id, mc.status, mc.points FROM tender_matches tm JOIN match_components mc ON mc.match_id = tm.id WHERE tm.organization_id = ? AND tm.lot_id = ? AND mc.component_key = ?',
    )
      .bind(orgId, lot.id, 'value')
      .first<{ match_id: string; status: string; points: number }>();
    expect(matchNoRate?.status).toBe('UNKNOWN');
    expect(matchNoRate?.points).toBeCloseTo(5, 5);

    // Seed a fresh SEK rate (within the 7-day validity window) and re-score
    // a DIFFERENT lot (idempotency of the first row is covered separately).
    const rateDate = new Date(SCORING_TIME).toISOString().slice(0, 10);
    await env.DB.prepare(
      'INSERT INTO exchange_rates (id, rate_date, currency, rate_to_eur, fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(newId(), rateDate, 'SEK', 0.09, Date.now(), Date.now(), Date.now())
      .run();

    const orgId2 = await makeOrg(db, 'FX Org Two');
    await upsertCompanyProfile(db, orgId2 as never, {
      displayName: 'FX Org Two',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId2 as never, { cpvCodes: ['72155000'] });
    await upsertMatchingPreferences(db, orgId2 as never, {
      minValueEur: 50_000,
      maxValueEur: 150_000,
      supportedContractNatures: ['services'],
      minimumDaysRemaining: null,
    });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lot.id] },
    );
    const matchWithRate = await env.DB.prepare(
      'SELECT mc.status, mc.points, mc.explanation FROM tender_matches tm JOIN match_components mc ON mc.match_id = tm.id WHERE tm.organization_id = ? AND tm.lot_id = ? AND mc.component_key = ?',
    )
      .bind(orgId2, lot.id, 'value')
      .first<{ status: string; points: number; explanation: string }>();
    expect(matchWithRate?.status).not.toBe('UNKNOWN');
    expect(matchWithRate?.points).toBe(10);
    expect(matchWithRate?.explanation).toContain(rateDate);
  });

  it('scoring is idempotent: re-running scoring for the same lot/org produces no duplicate or changed rows', async () => {
    const db = createDb(env.DB);
    const { lotId } = await ingestOne(db, 'score-idem-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Idempotent Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Idempotent Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71630000'] });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );
    const countAfterFirst = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{ n: number }>();
    expect(countAfterFirst?.n).toBe(1);

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds: [lotId] },
    );
    const countAfterSecond = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{ n: number }>();
    expect(countAfterSecond?.n).toBe(1); // skipped — already scored at this engine version, no duplicate
  });

  it('recompute (correction) path: replaceTenderMatches never leaves duplicate rows across repeated recompute passes', async () => {
    const db = createDb(env.DB);
    const { noticeId, lotId } = await ingestOne(db, 'score-recompute-1', '2026-08-10', normalXml);

    const orgId = await makeOrg(db, 'Recompute Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Recompute Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71630000'] });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { noticeIds: [noticeId], recompute: true },
    );

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { noticeIds: [noticeId], recompute: true },
    );

    const count = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM tender_matches WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lotId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('a real correction (new notice version) is scored via the recompute path against the CURRENT version lots', async () => {
    const db = createDb(env.DB);
    const { noticeId: noticeId1 } = await ingestOne(
      db,
      'score-corr-real-1',
      '2026-08-10',
      normalXml,
    );

    // Ingest a correction — new content, new current version, new lot row.
    const url2 = 'https://ted.europa.eu/notice/score-corr-real-1-v2.xml';
    const correctionResult = await runIngestionWindow(
      {
        db,
        client: makeClient(
          makeFakeFetch([{ notices: [searchRow('score-corr-real-1', '2026-08-11', url2)] }], {
            [url2]: normalCorrectedXml,
          }),
        ),
        snapshots: env.SNAPSHOTS,
        logger: createLogger({ test: true }),
        scope: DEFAULT_INGESTION_SCOPE,
        now: () => SCORING_TIME,
      },
      { windowFrom: '2026-08-11', windowTo: '2026-08-11' },
    );
    expect(correctionResult.newLotIds.length).toBeGreaterThan(0);

    const orgId = await makeOrg(db, 'Correction Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Correction Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['71630000'] });

    await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { noticeIds: [noticeId1], recompute: true },
    );

    const currentVersionLotId = correctionResult.newLotIds[0];
    const match = await env.DB.prepare(
      'SELECT lot_id FROM tender_matches WHERE organization_id = ? AND notice_id = ?',
    )
      .bind(orgId, noticeId1)
      .first<{ lot_id: string }>();
    expect(match?.lot_id).toBe(currentVersionLotId);
  });

  it('P-4 write batching, multi-pair scale: one org scored against many lots in a single invocation writes exactly one match per pair, idempotently', async () => {
    const db = createDb(env.DB);
    const orgId = await makeOrg(db, 'Scale Org');
    await upsertCompanyProfile(db, orgId as never, {
      displayName: 'Scale Org',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    // CPV division 77 is unused by every other test in this shared-D1 file,
    // so this org — and ONLY this org — passes the pre-filter for the lots
    // seeded below, keeping `result.matchesWritten`/`pairsScored` exact
    // even though `scoreLotsForOrgs` still considers every other org
    // created earlier in the file.
    await replaceCompanyCpvPreferences(db, orgId as never, { cpvCodes: ['77000000'] });

    // Kept comfortably under D1's per-statement bound-parameter cap for
    // `loadLotScoringBundlesByIds`'s own (unchunked, unrelated to P-4)
    // `lot_id IN (...)` lookup — the write-side batching this test targets
    // (`insertTenderMatches`'s bulk existence check chunked at
    // `ID_CHUNK_SIZE`, and `scoreLotsForOrgs`'s per-org flush buffer) is
    // exercised at full scale (>90 matches, >150 for the flush chunk) by
    // `insertTenderMatches`'s own dedicated scale test in
    // `matching.d1.test.ts`.
    const LOT_COUNT = 40;
    const lotIds: string[] = [];
    for (let i = 0; i < LOT_COUNT; i++) {
      const { lotId } = await seedBareLot(db, `scale-lot-${String(i)}`, '77100000');
      lotIds.push(lotId);
    }

    const result = await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds },
    );
    expect(result.truncated).toBe(false);
    expect(result.pairsScored).toBe(LOT_COUNT);
    expect(result.matchesWritten).toBe(LOT_COUNT);
    expect(result.matchesSkipped).toBe(0);

    const countRow = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM tender_matches WHERE organization_id = ?',
    )
      .bind(orgId)
      .first<{ n: number }>();
    expect(countRow?.n).toBe(LOT_COUNT);

    // Re-run: every pair already exists — no duplicate/changed rows.
    const rerun = await scoreLotsForOrgs(
      { db, logger: createLogger({ test: true }), now: () => SCORING_TIME },
      { lotIds },
    );
    expect(rerun.pairsScored).toBe(LOT_COUNT);
    expect(rerun.matchesWritten).toBe(0);
    expect(rerun.matchesSkipped).toBe(LOT_COUNT);

    const countAfterRerun = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM tender_matches WHERE organization_id = ?',
    )
      .bind(orgId)
      .first<{ n: number }>();
    expect(countAfterRerun?.n).toBe(LOT_COUNT);
  }, 30_000);
});
