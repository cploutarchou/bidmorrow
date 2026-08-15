/**
 * Unit tests for the pure branches of `mapLotToEngineInput` — every branch
 * that never touches the database (EUR-direct values, absent values,
 * missing main CPV, language mapping). The non-EUR ECB-conversion branch is
 * inherently DB-coupled (`getRate` runs a real drizzle query against
 * `exchange_rates`) and is proven instead by the D1 integration suite
 * (apps/worker/src/scoring.d1.test.ts) against real seeded rates —
 * faking a drizzle query chain here would test the fake, not the code.
 * `loadOrgProfile` is likewise DB-coupled end-to-end and covered there.
 */
import { describe, expect, it } from 'vitest';
import type {
  Db,
  LotScoringBundle,
  TenderCpvCode,
  TenderGeography,
  TenderLot,
} from '@bidmorrow/db';

import { mapLotToEngineInput } from './scoring-input';

const NEVER_CALLED_DB = {} as Db;

function makeLot(overrides: Partial<TenderLot> = {}): TenderLot {
  return {
    id: 'lot-1',
    noticeVersionId: 'version-1',
    lotNumber: 'LOT-0001',
    title: 'Penetration testing services',
    description: 'Annual penetration testing engagement.',
    contractNature: 'services',
    estimatedValueAmount: null,
    estimatedValueCurrency: null,
    estimatedValueEur: null,
    valueIsDerived: 0,
    deadlineAt: null,
    createdAt: 0,
    ...overrides,
  };
}

function makeCpv(overrides: Partial<TenderCpvCode>[]): TenderCpvCode[] {
  return overrides.map((o, index) => ({
    id: `cpv-${String(index)}`,
    lotId: 'lot-1',
    cpvCode: '72155000',
    isMain: 1,
    createdAt: 0,
    ...o,
  }));
}

function makeBundle(overrides: Partial<LotScoringBundle> = {}): LotScoringBundle {
  return {
    lot: makeLot(),
    noticeId: 'notice-1',
    sourceLanguagesJson: '["eng","fra"]',
    procedureType: 'open',
    buyerLegalType: 'central-government-authority',
    cpvCodes: makeCpv([{ cpvCode: '72155000', isMain: 1 }]),
    geographies: [],
    ...overrides,
  };
}

const NOW = 1_800_000_000_000;

describe('mapLotToEngineInput', () => {
  it('returns missing_main_cpv when no CPV row is main', async () => {
    const bundle = makeBundle({ cpvCodes: makeCpv([{ cpvCode: '72155000', isMain: 0 }]) });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('missing_main_cpv');
  });

  it('passes an already-EUR value straight through with no rate lookup', async () => {
    const bundle = makeBundle({
      lot: makeLot({
        estimatedValueEur: 180_000,
        estimatedValueAmount: 180_000,
        estimatedValueCurrency: 'EUR',
      }),
    });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.valueEur).toBe(180_000);
    expect(result.rateDate).toBeNull();
  });

  it('maps an unpublished value to valueEur: null, no rate date', async () => {
    const bundle = makeBundle();
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.valueEur).toBeNull();
    expect(result.rateDate).toBeNull();
  });

  it('splits main vs. additional CPV codes deterministically', async () => {
    const bundle = makeBundle({
      cpvCodes: makeCpv([
        { cpvCode: '72155000', isMain: 1 },
        { cpvCode: '79417000', isMain: 0 },
        { cpvCode: '72212000', isMain: 0 },
      ]),
    });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.cpv.main).toBe('72155000');
    expect([...result.lot.cpv.additional].sort()).toEqual(['72212000', '79417000']);
  });

  it("keys title/description under the notice's first declared language", async () => {
    const bundle = makeBundle({ sourceLanguagesJson: '["fra","eng"]' });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.titleByLang).toEqual({ fra: 'Penetration testing services' });
    expect(result.lot.descriptionByLang).toEqual({ fra: 'Annual penetration testing engagement.' });
    expect(result.lot.languages).toEqual(['fra', 'eng']);
  });

  it('falls back to "und" when source_languages_json is empty/malformed', async () => {
    const bundle = makeBundle({ sourceLanguagesJson: 'not json' });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.languages).toEqual(['und']);
    expect(Object.keys(result.lot.titleByLang)).toEqual(['und']);
  });

  it('dedupes geography countries and drops null NUTS codes from the nuts list', async () => {
    const geographies: TenderGeography[] = [
      { id: 'g1', lotId: 'lot-1', countryCode: 'CY', nutsCode: 'CY000', createdAt: 0 },
      { id: 'g2', lotId: 'lot-1', countryCode: 'CY', nutsCode: null, createdAt: 0 },
      { id: 'g3', lotId: 'lot-1', countryCode: 'GR', nutsCode: 'EL300', createdAt: 0 },
    ];
    const bundle = makeBundle({ geographies });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect([...result.lot.countries].sort()).toEqual(['CY', 'GR']);
    expect([...result.lot.nuts].sort()).toEqual(['CY000', 'EL300']);
  });

  it('omits descriptionByLang entirely when the lot has no description', async () => {
    const bundle = makeBundle({ lot: makeLot({ description: null }) });
    const result = await mapLotToEngineInput(NEVER_CALLED_DB, bundle, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.lot.descriptionByLang).toEqual({});
  });
});
