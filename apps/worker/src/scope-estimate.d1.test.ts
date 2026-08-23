/**
 * `estimateScope` — the number behind onboarding's scope-estimate panel.
 *
 * The panel exists to tell a company, BEFORE it finishes onboarding, that its
 * chosen CPV codes currently match nothing. That is the honest answer for any
 * sector outside the ingested scope (`72*`, `48*`, `79417000`), and getting it
 * wrong in the optimistic direction is the failure that matters: it would
 * promise coverage the product does not have and be discovered later as an
 * empty feed.
 *
 * So the cases below pin the two things that could quietly inflate it — the
 * division-level match the scoring pre-filter really uses, and the
 * publication window — plus the tenancy-free reads the estimate depends on.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  estimateScope,
  insertCpvCodes,
  insertGeographies,
  insertLots,
  upsertNoticeWithVersion,
} from '@bidmorrow/db';
import { insertSnapshotIfNewHash } from '@bidmorrow/db';

const db = createDb(env.DB);

let seq = 0;

async function seedLot(args: {
  publicationDate: string;
  cpvCode: string;
  countryCode?: string;
}): Promise<string> {
  seq += 1;
  const sourceNoticeId = `scope-est-${String(seq)}-${String(Date.now())}`;
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
    publicationDate: args.publicationDate,
    contentHash: `hash-${sourceNoticeId}`,
    snapshotId: snapshot.snapshot.id,
  });
  const [lot] = await insertLots(db, {
    noticeVersionId: upsert.versionId,
    lots: [
      {
        lotNumber: '1',
        title: `Scope estimate lot ${sourceNoticeId}`,
        contractNature: 'services',
        estimatedValueAmount: 100_000,
        estimatedValueCurrency: 'EUR',
        estimatedValueEur: 100_000,
        valueIsDerived: false,
        deadlineAt: null,
      },
    ],
  });
  if (lot === undefined) throw new Error('seedLot: lot insert failed');
  await insertCpvCodes(db, { entries: [{ lotId: lot.id, cpvCode: args.cpvCode, isMain: true }] });
  if (args.countryCode !== undefined) {
    await insertGeographies(db, {
      entries: [{ lotId: lot.id, countryCode: args.countryCode, nutsCode: null }],
    });
  }
  return lot.id;
}

/** A window wide enough that only the deliberately-old fixtures fall outside. */
const WINDOW = { windowFrom: '2026-08-01', windowTo: '2026-08-31' };

describe('estimateScope', () => {
  it('counts a lot whose CPV shares only the DIVISION with the chosen code', async () => {
    // 72150000 vs 72999999 share "72" and nothing more. The scoring
    // pre-filter (packages/procurement/src/score.ts) compares divisions, so
    // an estimate that required a longer prefix would under-report every
    // real selection.
    await seedLot({ publicationDate: '2026-08-10', cpvCode: '72999999' });
    const estimate = await estimateScope(db, {
      ...WINDOW,
      cpvCodes: ['72150000'],
      countryCodes: [],
    });
    expect(estimate.scorableLots).toBeGreaterThan(0);
  });

  it('does not count a lot from an unrelated division', async () => {
    await seedLot({ publicationDate: '2026-08-10', cpvCode: '45000000' });
    const estimate = await estimateScope(db, {
      ...WINDOW,
      cpvCodes: ['09000000'],
      countryCodes: [],
    });
    // Division 09 is used by no other fixture in this file.
    expect(estimate.scorableLots).toBe(0);
  });

  it('excludes lots published outside the window', async () => {
    await seedLot({ publicationDate: '2025-01-05', cpvCode: '31000000' });
    const inWindow = await estimateScope(db, {
      ...WINDOW,
      cpvCodes: ['31000000'],
      countryCodes: [],
    });
    expect(inWindow.scorableLots).toBe(0);

    const widened = await estimateScope(db, {
      windowFrom: '2025-01-01',
      windowTo: '2026-08-31',
      cpvCodes: ['31000000'],
      countryCodes: [],
    });
    expect(widened.scorableLots).toBe(1);
  });

  it('reports the country breakdown WITHOUT narrowing the scorable count', async () => {
    // Geography is a scored component, not a gate: a lot outside the chosen
    // countries is still scored and can still surface. Folding country into
    // the headline number would tell the user those lots are excluded, which
    // is not true.
    await seedLot({ publicationDate: '2026-08-11', cpvCode: '38000000', countryCode: 'CY' });
    await seedLot({ publicationDate: '2026-08-11', cpvCode: '38000000', countryCode: 'DE' });

    const estimate = await estimateScope(db, {
      ...WINDOW,
      cpvCodes: ['38000000'],
      countryCodes: ['CY'],
    });
    expect(estimate.scorableLots).toBe(2);
    expect(estimate.inChosenCountries).toBe(1);
  });

  it('returns a null country breakdown when no country was chosen', async () => {
    await seedLot({ publicationDate: '2026-08-12', cpvCode: '42000000', countryCode: 'CY' });
    const estimate = await estimateScope(db, {
      ...WINDOW,
      cpvCodes: ['42000000'],
      countryCodes: [],
    });
    // Not 0: "0 of N" would read as a warning when the user simply has not
    // answered the country question yet.
    expect(estimate.inChosenCountries).toBeNull();
  });

  it('returns zero for an empty CPV selection rather than counting everything', async () => {
    const estimate = await estimateScope(db, { ...WINDOW, cpvCodes: [], countryCodes: [] });
    expect(estimate).toEqual({ scorableLots: 0, inChosenCountries: null });
  });
});
