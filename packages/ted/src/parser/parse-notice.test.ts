/**
 * Contract tests: sanitized REAL eForms notices (official OP-TED eForms-SDK
 * examples — live TED API unreachable from this environment; see fixture
 * meta.json files) parse to explicitly asserted normalized output. No vitest
 * snapshots: reviewers must be able to read every expectation.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TedParseError } from '../errors';
import { parseEformsNotice } from './parse-notice';

const FIXTURES = new URL('../../../../tests/fixtures/ted/', import.meta.url);

function loadFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, FIXTURES), 'utf8');
}

/**
 * All SDK-example fixtures are pre-publication documents: they carry no OJS
 * publication number / publication date, so the parser falls back to the
 * notice-id UUID and the dispatch IssueDate — each recorded as a warning.
 */
const EXAMPLE_FALLBACK_WARNING_CODES = [
  'missing-publication-number',
  'publication-date-from-issue-date',
];

describe('parseEformsNotice — 1.15 fixtures', () => {
  it('normal: single-lot cn-standard notice normalizes fully (explicit expected object)', () => {
    const notice = parseEformsNotice(loadFixture('1.15/normal.xml'));
    expect(notice).toEqual({
      sourceNoticeId: 'c4c415ee-ac08-4465-8fa6-57568cf69462',
      eformsSdkVersion: '1.15',
      formType: 'competition',
      noticeType: 'cn-standard',
      noticeSubtype: '16',
      languages: ['eng'],
      buyer: {
        name: 'Renfrewshire Council',
        nameByLanguage: { eng: 'Renfrewshire Council' },
        country: 'GBR',
        legalTypeCode: 'la',
        organizationId: 'ORG-0001',
      },
      procedureType: 'open',
      contractNature: 'services',
      publicationDate: '2020-02-28',
      procedureEstimatedValue: { amount: 500_000, currency: 'EUR' },
      lots: [
        {
          lotId: 'LOT-0000',
          title: {
            eng: 'Term Contract for a Planned Programme of In-service Inspection and Testing of Electrical Equipment',
          },
          description: {
            eng: 'The purpose of this contract is to formalise the Councils requirement to employ a contractor to carry out a planned programme of in-service inspection and testing of electrical equipment within the Councils public buildings.',
          },
          contractNature: 'services',
          // Estimated value exists at PROCEDURE level only — lot value stays
          // null (division across lots is stage-B `value_is_derived` logic).
          estimatedValue: null,
          // BT-131: 2020-04-03 12:00:00 +01:00 → 11:00 UTC.
          deadline: Date.UTC(2020, 3, 3, 11, 0, 0),
          cpv: { main: '71630000', additional: ['71314100', '50300000', '31600000'] },
          // Source declares only a country (GBR), no NUTS — explicit empty.
          nuts: [],
        },
      ],
      issues: [
        {
          severity: 'warning',
          code: 'missing-publication-number',
          message: 'no efbc:NoticePublicationID; using cbc:ID (notice-id) as sourceNoticeId',
        },
        {
          severity: 'warning',
          code: 'publication-date-from-issue-date',
          message:
            'no efbc:PublicationDate; using dispatch cbc:IssueDate (Search API date is authoritative during ingestion)',
        },
      ],
    });
  });

  it('multi-lot: two lots parse; the LotsGroup ProcurementProjectLot is NOT a lot', () => {
    const notice = parseEformsNotice(loadFixture('1.15/multi-lot.xml'));
    expect(notice.sourceNoticeId).toBe('14549263-b47b-4e59-96a1-2d0d13e19343');
    expect(notice.eformsSdkVersion).toBe('1.15');
    expect(notice.formType).toBe('competition');
    expect(notice.noticeType).toBe('cn-standard');
    expect(notice.procedureType).toBe('neg-w-call');
    expect(notice.buyer).toEqual({
      name: 'Financial Adinistration for ...', // sic — verbatim source text
      nameByLanguage: { eng: 'Financial Adinistration for ...' },
      country: 'LUX',
      legalTypeCode: 'body-pl',
      organizationId: 'ORG-0001',
    });
    expect(notice.procedureEstimatedValue).toEqual({ amount: 9_999_999.99, currency: 'EUR' });
    // The fixture has THREE ProcurementProjectLot elements: LOT-0001,
    // LOT-0002 and the lots group GLO-0001 (schemeName="LotsGroup").
    expect(notice.lots.map((lot) => lot.lotId)).toEqual(['LOT-0001', 'LOT-0002']);
    expect(notice.lots[0]).toEqual({
      lotId: 'LOT-0001',
      title: { eng: 'Title ---' },
      description: { eng: 'Description ---' },
      contractNature: 'services',
      estimatedValue: { amount: 9_999_999.99, currency: 'EUR' },
      // neg-w-call: participation deadline, no tender-submission deadline.
      deadline: null,
      cpv: { main: '75121000', additional: [] },
      nuts: ['LU000'],
    });
    expect(notice.lots[1]?.title).toEqual({ eng: 'Title Lot 2---' });
    expect(notice.lots[1]?.estimatedValue).toEqual({ amount: 9_999_999.99, currency: 'EUR' });
  });

  it('missing value: no estimated value anywhere → explicit nulls, never 0', () => {
    const notice = parseEformsNotice(loadFixture('1.15/missing-value.xml'));
    expect(notice.procedureEstimatedValue).toBeNull();
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.estimatedValue).toBeNull();
    // The rest of the lot still normalizes (procedure-level CPV/NUTS fall
    // through to the lot, which repeats them in this fixture).
    expect(notice.lots[0]?.cpv).toEqual({ main: '72230000', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['FRD22']);
    // BT-131: 2020-02-04 10:00:00 +02:00 → 08:00 UTC.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2020, 1, 4, 8, 0, 0));
  });

  it('missing deadline: pin-cfc competition notice without a submission deadline → explicit null', () => {
    const notice = parseEformsNotice(loadFixture('1.15/missing-deadline.xml'));
    expect(notice.formType).toBe('competition');
    expect(notice.noticeType).toBe('pin-cfc-standard');
    expect(notice.noticeSubtype).toBe('10');
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.deadline).toBeNull();
    // No deadline is NOT an issue — it is a legitimate explicit unknown.
    expect(notice.issues.map((issue) => issue.code)).toEqual(EXAMPLE_FALLBACK_WARNING_CODES);
    // `anyw-eea` is a Region, not a NUTS CountrySubentityCode → nuts empty.
    expect(notice.lots[0]?.nuts).toEqual([]);
  });

  it('non-English (FRA) notice keeps the language map and languages list — never penalized', () => {
    const notice = parseEformsNotice(loadFixture('1.15/non-english.xml'));
    expect(notice.languages).toEqual(['fra']);
    expect(notice.buyer?.name).toBe('Rouen Habitat');
    expect(notice.buyer?.country).toBe('FRA');
    expect(notice.lots.map((lot) => lot.lotId)).toEqual(['LOT-0001', 'LOT-0002']);
    expect(notice.lots[0]?.title).toEqual({ fra: 'Agence centre' });
    expect(notice.lots[0]?.description).toEqual({
      fra: "Service d'entretien de remise en état et de nettoyage des espaces verts.",
    });
    expect(notice.lots[0]?.cpv).toEqual({ main: '77310000', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['FRD22']);
    // BT-131: EndDate 2019-06-24Z, EndTime 16:00:00Z.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2019, 5, 24, 16, 0, 0));
  });

  it('multilingual notice keeps ALL 24 language variants for title/description', () => {
    const notice = parseEformsNotice(loadFixture('1.15/multilingual.xml'));
    expect(notice.languages).toHaveLength(24);
    expect(notice.languages[0]).toBe('eng'); // BT-702 primary first
    expect(notice.languages).toContain('bul');
    expect(notice.languages).toContain('swe');
    const lot = notice.lots[0];
    expect(lot?.lotId).toBe('LOT-0000');
    expect(Object.keys(lot?.title ?? {})).toHaveLength(24);
    expect(lot?.title?.['eng']).toBe(
      'Provision of IT Services Related to OP IT Systems (EUR-Lex, N-Lex, Search Layer, and Others)',
    );
    expect(lot?.title?.['fra']).toBe(
      'Fourniture de services informatiques liés aux systèmes informatiques OP (EUR-Lex, N-Lex, Search Layer, etc.)',
    );
    expect(Object.keys(lot?.description ?? {})).toHaveLength(24);
    // Buyer name resolves across repeated cac:PartyName wrappers; the
    // primary-language variant is picked for `name`.
    expect(notice.buyer?.name).toBe('Publications Office of the European Union');
    expect(Object.keys(notice.buyer?.nameByLanguage ?? {})).toHaveLength(24);
    expect(lot?.estimatedValue).toEqual({ amount: 4_500_000, currency: 'EUR' });
    expect(lot?.cpv).toEqual({ main: '72230000', additional: ['72260000'] });
    // BT-131: 2020-02-03 13:00:00Z.
    expect(lot?.deadline).toBe(Date.UTC(2020, 1, 3, 13, 0, 0));
  });

  it('unexpected optional fields (qu-sy utilities notice) are ignored gracefully', () => {
    const notice = parseEformsNotice(loadFixture('1.15/unexpected-optional-fields.xml'));
    expect(notice.formType).toBe('competition');
    expect(notice.noticeType).toBe('qu-sy');
    expect(notice.noticeSubtype).toBe('15');
    expect(notice.languages).toEqual(['ita']);
    // qu-sy carries no ProcedureCode — explicit null, not an error.
    expect(notice.procedureType).toBeNull();
    expect(notice.buyer?.name).toBe('Acque Bresciane srl');
    expect(notice.buyer?.legalTypeCode).toBe('pub-undert-ra');
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.cpv).toEqual({ main: '45233222', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['ITC47']);
    expect(notice.lots[0]?.deadline).toBeNull();
    // Only the standard example-fixture warnings — nothing about the
    // sectoral/qualification-system fields we do not map.
    expect(notice.issues.map((issue) => issue.code)).toEqual(EXAMPLE_FALLBACK_WARNING_CODES);
  });

  it('published notice: OJS publication number and date are the primary source ids', () => {
    // pin-buyer partitions by schemeName="Part" (planning form) — no Lot
    // entries, so normalization fails fatally; but the error must carry the
    // REAL publication number, proving the efac:Publication path works.
    let caught: unknown = null;
    try {
      parseEformsNotice(loadFixture('1.15/published-publication-id.xml'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TedParseError);
    const parseError = caught as TedParseError;
    expect(parseError.sourceNoticeId).toBe('12345678-2025');
    expect(parseError.issues).toEqual([
      {
        severity: 'error',
        code: 'no-lots',
        message: 'notice contains no ProcurementProjectLot with schemeName="Lot"',
      },
    ]);
  });

  it('malformed (truncated XML) throws TedParseError with a malformed-xml issue — never skipped', () => {
    let caught: unknown = null;
    try {
      parseEformsNotice(loadFixture('1.15/malformed-truncated.xml'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TedParseError);
    const parseError = caught as TedParseError;
    expect(parseError.issues).toHaveLength(1);
    expect(parseError.issues[0]?.severity).toBe('error');
    expect(parseError.issues[0]?.code).toBe('malformed-xml');
    expect(parseError.sourceNoticeId).toBeNull();
  });
});

describe('parseEformsNotice — schema version handling', () => {
  it('second schema version (SDK 1.13) parses with its own declared version', () => {
    const notice = parseEformsNotice(loadFixture('1.13/second-schema-version.xml'));
    expect(notice.eformsSdkVersion).toBe('1.13');
    expect(notice.formType).toBe('competition');
    expect(notice.noticeType).toBe('cn-standard');
    expect(notice.buyer).toEqual({
      name: 'Publications Office of the European Union',
      nameByLanguage: { eng: 'Publications Office of the European Union' },
      country: 'LUX',
      legalTypeCode: 'eu-ins-bod-ag',
      organizationId: 'ORG-0001',
    });
    expect(notice.lots).toEqual([
      {
        lotId: 'LOT-0000',
        title: {
          eng: 'Provision of IT Services Related to OP IT Systems (EUR-Lex, N-Lex, Search Layer, and Others)',
        },
        description: {
          // Verbatim source text — internal whitespace is preserved.
          eng: 'Provision of IT services related to the information systems of the publications office (namely EUR-Lex, N-Lex, and Search Layer),\n\t\t\twith the possibility to extend the provision to other information systems.',
        },
        contractNature: 'services',
        estimatedValue: null,
        deadline: Date.UTC(2020, 1, 4, 8, 0, 0), // 10:00 +02:00
        cpv: { main: '72230000', additional: [] },
        nuts: ['FRD22'],
      },
    ]);
    // Version inside the supported 1.13–1.15 range: no version warning.
    expect(notice.issues.map((issue) => issue.code)).toEqual(EXAMPLE_FALLBACK_WARNING_CODES);
  });

  it('unknown newer minor version parses best-effort with a recorded warning — never a hard failure', () => {
    const xml = loadFixture('1.15/normal.xml').replace(
      '<cbc:CustomizationID>eforms-sdk-1.15</cbc:CustomizationID>',
      '<cbc:CustomizationID>eforms-sdk-1.99</cbc:CustomizationID>',
    );
    const notice = parseEformsNotice(xml);
    expect(notice.eformsSdkVersion).toBe('1.99');
    expect(notice.lots).toHaveLength(1);
    expect(notice.issues.map((issue) => issue.code)).toContain('untested-sdk-version');
  });

  it('missing CustomizationID is a fatal ParseError (SDK version is required)', () => {
    const xml = loadFixture('1.15/normal.xml').replace(
      '<cbc:CustomizationID>eforms-sdk-1.15</cbc:CustomizationID>',
      '',
    );
    let caught: unknown = null;
    try {
      parseEformsNotice(xml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TedParseError);
    expect((caught as TedParseError).issues.map((issue) => issue.code)).toContain(
      'missing-customization-id',
    );
  });
});

/**
 * Fixtures below are REAL TED-published notices (2026-08-16 fixture refresh;
 * see each fixture's meta.json for source, retrieval provenance and the
 * sanitization applied). Expected values were derived by reading the XML
 * source of truth first, independently of the parser.
 *
 * Cross-cutting realities these notices exposed:
 * - `efbc:NoticePublicationID` is zero-padded ("00569058-2026") while the
 *   Search API `publication-number` is unpadded ("569058-2026") — the
 *   assertions pin the parser's verbatim (padded) form.
 * - Corrected notices carry `efac:Changes` / `efac:ChangedSection`; the
 *   parser exposes NO correction signal on NormalizedNotice today (version
 *   detection rides on the Search API during ingestion), so these tests can
 *   only assert that corrected notices still normalize correctly.
 */
describe('parseEformsNotice — real published notices (2026-08-16 refresh)', () => {
  it('real-normal (1.13, SPA): single lot, procedure-level value only, padded publication id', () => {
    const notice = parseEformsNotice(loadFixture('1.13/real-normal.xml'));
    expect(notice.sourceNoticeId).toBe('00569058-2026');
    expect(notice.eformsSdkVersion).toBe('1.13');
    expect(notice.formType).toBe('competition');
    expect(notice.noticeType).toBe('cn-standard');
    expect(notice.noticeSubtype).toBe('16');
    expect(notice.languages).toEqual(['spa']);
    expect(notice.publicationDate).toBe('2026-08-17');
    expect(notice.procedureType).toBe('open');
    expect(notice.buyer).toEqual({
      name: 'Gerencia del Centro de Investigación Biomédica en Red (CIBER)',
      nameByLanguage: { spa: 'Gerencia del Centro de Investigación Biomédica en Red (CIBER)' },
      country: 'ESP',
      legalTypeCode: 'body-pl-cga',
      organizationId: 'ORG-0001',
    });
    expect(notice.procedureEstimatedValue).toEqual({ amount: 458_000, currency: 'EUR' });
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.lotId).toBe('LOT-0000');
    expect(notice.lots[0]?.cpv).toEqual({ main: '79211110', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['ES300']);
    // Value exists at PROCEDURE level only — lot value stays null.
    expect(notice.lots[0]?.estimatedValue).toBeNull();
    // BT-131: 2026-09-18 23:59:00 +02:00 → 21:59 UTC.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2026, 8, 18, 21, 59, 0));
    // A published notice inside the supported SDK range: zero issues.
    expect(notice.issues).toEqual([]);
  });

  it('real-missing-value-deadline (1.14, ENG): no value, no submission deadline, no ProcedureCode', () => {
    const notice = parseEformsNotice(loadFixture('1.14/real-missing-value-deadline.xml'));
    expect(notice.sourceNoticeId).toBe('00566363-2026');
    expect(notice.eformsSdkVersion).toBe('1.14');
    expect(notice.noticeType).toBe('cn-standard');
    expect(notice.noticeSubtype).toBe('19');
    expect(notice.languages).toEqual(['eng']);
    expect(notice.buyer?.name).toBe('Malta International Airport plc');
    expect(notice.buyer?.country).toBe('MLT');
    // Real cn-standard notice WITHOUT BT-105 — explicit null, not an error.
    expect(notice.procedureType).toBeNull();
    expect(notice.procedureEstimatedValue).toBeNull();
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.lotId).toBe('LOT-0001');
    expect(notice.lots[0]?.cpv).toEqual({ main: '55000000', additional: [] });
    expect(notice.lots[0]?.estimatedValue).toBeNull();
    // The notice has EndDate/EndTime under AdditionalInformationRequestPeriod
    // and PlannedPeriod but NO TenderSubmissionDeadlinePeriod → null, silently.
    expect(notice.lots[0]?.deadline).toBeNull();
    expect(notice.issues).toEqual([]);
  });

  it('real-missing-deadline (1.12, SLV): below-range SDK parses best-effort with a version warning', () => {
    const notice = parseEformsNotice(loadFixture('1.12/real-missing-deadline.xml'));
    expect(notice.sourceNoticeId).toBe('00566469-2026');
    expect(notice.eformsSdkVersion).toBe('1.12');
    expect(notice.noticeSubtype).toBe('17');
    expect(notice.languages).toEqual(['slv']);
    expect(notice.procedureType).toBe('neg-w-call');
    expect(notice.buyer?.legalTypeCode).toBe('pub-undert');
    expect(notice.buyer?.country).toBe('SVN');
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.cpv).toEqual({ main: '66514110', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['SI043']);
    // neg-w-call: ParticipationRequestReceptionPeriod only — deadline null.
    expect(notice.lots[0]?.deadline).toBeNull();
    expect(notice.procedureEstimatedValue).toBeNull();
    expect(notice.lots[0]?.estimatedValue).toBeNull();
    expect(notice.issues.map((issue) => issue.code)).toEqual(['untested-sdk-version']);
  });

  it('real-multi-lot (1.12, FRA): seven lots with per-lot values; buyer is ORG-0002', () => {
    const notice = parseEformsNotice(loadFixture('1.12/real-multi-lot.xml'));
    expect(notice.sourceNoticeId).toBe('00568795-2026');
    expect(notice.eformsSdkVersion).toBe('1.12');
    expect(notice.languages).toEqual(['fra']);
    // OPT-300 resolution against a non-first organization id.
    expect(notice.buyer).toEqual({
      name: 'Conseil Départemental du Nord',
      nameByLanguage: { fra: 'Conseil Départemental du Nord' },
      country: 'FRA',
      legalTypeCode: 'la',
      organizationId: 'ORG-0002',
    });
    expect(notice.procedureEstimatedValue).toEqual({ amount: 16_666_667, currency: 'EUR' });
    expect(notice.lots.map((lot) => lot.lotId)).toEqual([
      'LOT-0001',
      'LOT-0002',
      'LOT-0003',
      'LOT-0004',
      'LOT-0005',
      'LOT-0006',
      'LOT-0007',
    ]);
    expect(notice.lots.map((lot) => lot.estimatedValue?.amount)).toEqual([
      575_000, 425_000, 375_000, 700_000, 1_116_666, 625_000, 350_000,
    ]);
    // Real-world quirk kept verbatim: the lot repeats its own main CPV inside
    // AdditionalCommodityClassification (dedupe against main is stage-B).
    expect(notice.lots[0]?.cpv).toEqual({
      main: '90900000',
      additional: ['90900000', '90911300', '90919200'],
    });
    // Shared BT-131: 2026-09-14 16:30 +02:00 → 14:30 UTC on every lot.
    for (const lot of notice.lots) {
      expect(lot.deadline).toBe(Date.UTC(2026, 8, 14, 14, 30, 0));
      expect(lot.nuts).toEqual(['FRE11']);
    }
    expect(notice.issues.map((issue) => issue.code)).toEqual(['untested-sdk-version']);
  });

  it('real-corrected-multi-lot (1.13, EST): efac:Changes notice normalizes; NUTS duplicates dedupe', () => {
    const notice = parseEformsNotice(loadFixture('1.13/real-corrected-multi-lot.xml'));
    expect(notice.sourceNoticeId).toBe('00567156-2026');
    expect(notice.eformsSdkVersion).toBe('1.13');
    expect(notice.languages).toEqual(['est']);
    expect(notice.buyer?.name).toBe('Transpordiamet');
    expect(notice.contractNature).toBe('supplies');
    expect(notice.procedureEstimatedValue).toEqual({ amount: 315_000, currency: 'EUR' });
    expect(notice.lots.map((lot) => lot.lotId)).toEqual([
      'LOT-0001',
      'LOT-0002',
      'LOT-0003',
      'LOT-0004',
    ]);
    // Lot-level CPV (34110000) wins over the procedure main (34100000).
    expect(notice.lots.map((lot) => lot.cpv.main)).toEqual([
      '34110000',
      '34110000',
      '34110000',
      '34110000',
    ]);
    expect(notice.lots.map((lot) => lot.estimatedValue?.amount)).toEqual([
      75_000, 120_000, 70_000, 50_000,
    ]);
    // Source lists each lot NUTS code once but repeats the procedure set 4x;
    // extraction dedupes while preserving order.
    expect(notice.lots[0]?.nuts).toEqual(['EE009', 'EE00A', 'EE004', 'EE008', 'EE001']);
    // BT-131 with fractional seconds: 2026-09-02 15:00:00.000 +03:00 → 12:00 UTC.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2026, 8, 2, 12, 0, 0));
    // Corrected notice (efac:Changes, ChangedSection PROCEDURE) parses clean;
    // no correction signal is exposed on NormalizedNotice (see block docs).
    expect(notice.issues).toEqual([]);
  });

  it('real-namespace-quirk (1.13, LIT): redundant xmlns="" on top-level elements is tolerated', () => {
    const notice = parseEformsNotice(loadFixture('1.13/real-namespace-quirk.xml'));
    expect(notice.sourceNoticeId).toBe('00566500-2026');
    expect(notice.eformsSdkVersion).toBe('1.13');
    expect(notice.languages).toEqual(['lit']);
    expect(notice.buyer?.name).toBe('Lietuvos Respublikos Seimo kanceliarija');
    expect(notice.buyer?.country).toBe('LTU');
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.cpv).toEqual({ main: '63510000', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['LT011']);
    // Identical value declared at procedure AND lot level — both kept.
    expect(notice.procedureEstimatedValue).toEqual({ amount: 991_735.54, currency: 'EUR' });
    expect(notice.lots[0]?.estimatedValue).toEqual({ amount: 991_735.54, currency: 'EUR' });
    // BT-131: 2026-09-17 10:00 +03:00 → 07:00 UTC.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2026, 8, 17, 7, 0, 0));
    expect(notice.issues).toEqual([]);
  });

  it('real-corrected-greek (1.14, ELL): Greek script preserved; source value anomaly kept verbatim', () => {
    const notice = parseEformsNotice(loadFixture('1.14/real-corrected-greek.xml'));
    expect(notice.sourceNoticeId).toBe('00566489-2026');
    expect(notice.eformsSdkVersion).toBe('1.14');
    expect(notice.languages).toEqual(['ell']);
    expect(notice.buyer).toEqual({
      name: 'ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΣΕΡΡΩΝ',
      nameByLanguage: { ell: 'ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΣΕΡΡΩΝ' },
      country: 'GRC',
      legalTypeCode: 'body-pl',
      organizationId: 'ORG-0001',
    });
    expect(notice.lots).toHaveLength(1);
    expect(notice.lots[0]?.title).toEqual({ ell: 'Τμήμα 1' });
    expect(notice.lots[0]?.cpv).toEqual({ main: '33140000', additional: [] });
    expect(notice.lots[0]?.nuts).toEqual(['EL526']);
    // REAL source anomaly (never "fixed" by the parser): the procedure-level
    // amount is 931557860 while the lot says 931557.86 — the buyer dropped
    // the decimal separator at procedure level. Both are reported verbatim.
    expect(notice.procedureEstimatedValue).toEqual({ amount: 931_557_860, currency: 'EUR' });
    expect(notice.lots[0]?.estimatedValue).toEqual({ amount: 931_557.86, currency: 'EUR' });
    // BT-131: 2026-09-16 11:00 +03:00 → 08:00 UTC.
    expect(notice.lots[0]?.deadline).toBe(Date.UTC(2026, 8, 16, 8, 0, 0));
    // Corrigendum (efac:Changes referencing 517841-2026, reason cor-buy)
    // parses clean; no correction signal on NormalizedNotice.
    expect(notice.issues).toEqual([]);
  });

  it('real-large-multi-lot (1.14, POL): 140 KB corrected six-lot notice, no values anywhere', () => {
    const notice = parseEformsNotice(loadFixture('1.14/real-large-multi-lot.xml'));
    expect(notice.sourceNoticeId).toBe('00568668-2026');
    expect(notice.eformsSdkVersion).toBe('1.14');
    expect(notice.languages).toEqual(['pol']);
    expect(notice.buyer?.name).toBe(
      'Regionalny Szpital Specjalistyczny im. dr Władysława Biegańskiego',
    );
    expect(notice.contractNature).toBe('supplies');
    expect(notice.lots.map((lot) => lot.lotId)).toEqual([
      'LOT-0001',
      'LOT-0002',
      'LOT-0003',
      'LOT-0004',
      'LOT-0005',
      'LOT-0006',
    ]);
    // Per-lot main CPV varies (medical-equipment families).
    expect(notice.lots.map((lot) => lot.cpv.main)).toEqual([
      '33111730',
      '33111730',
      '33186000',
      '33100000',
      '33141620',
      '33111730',
    ]);
    // No estimated value at ANY level — explicit nulls, never 0.
    expect(notice.procedureEstimatedValue).toBeNull();
    for (const lot of notice.lots) {
      expect(lot.estimatedValue).toBeNull();
      // Deadline moved to 2026-08-27 12:00 +02:00 by the correction → 10:00 UTC.
      expect(lot.deadline).toBe(Date.UTC(2026, 7, 27, 10, 0, 0));
      expect(lot.nuts).toEqual(['PL616']);
    }
    expect(notice.issues).toEqual([]);
  });
});

describe('parseEformsNotice — adversarial input safety', () => {
  it('script/HTML content in text nodes is preserved as inert plain text', () => {
    // replaceAll: the title appears at procedure AND lot level.
    const xml = loadFixture('1.15/normal.xml').replaceAll(
      'Term Contract for a Planned Programme of In-service Inspection and Testing of Electrical Equipment',
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; <![CDATA[<img src=x onerror=alert(2)>]]>',
    );
    const notice = parseEformsNotice(xml);
    const title = notice.lots[0]?.title?.['eng'] ?? '';
    // Decoded entities/CDATA stay DATA — the parser never interprets them.
    expect(title).toContain('<script>alert(1)</script>');
    expect(title).toContain('<img src=x onerror=alert(2)>');
  });

  it('text fields are capped at 100k chars with a recorded truncation warning', () => {
    const bomb = 'A'.repeat(150_000);
    const xml = loadFixture('1.15/normal.xml').replaceAll(
      'The purpose of this contract is to formalise the Councils requirement to employ a contractor to carry out a planned programme of in-service inspection and testing of electrical equipment within the Councils public buildings.',
      bomb,
    );
    const notice = parseEformsNotice(xml);
    // Both procedure- and lot-level descriptions were replaced; check the lot.
    expect(notice.lots[0]?.description?.['eng']).toHaveLength(100_000);
    expect(notice.issues.map((issue) => issue.code)).toContain('text-truncated');
  });

  it('a huge source-derived value never produces an unbounded ParseIssue message (SEC-P5-04)', () => {
    // Doesn't match the `eforms-sdk-<major>.<minor>` shape at all, so the raw
    // (huge) value gets interpolated verbatim into the issue message.
    const hugeId = 'not-a-valid-sdk-version-' + 'a'.repeat(50_000);
    const xml = loadFixture('1.15/normal.xml').replace(
      '<cbc:CustomizationID>eforms-sdk-1.15</cbc:CustomizationID>',
      `<cbc:CustomizationID>${hugeId}</cbc:CustomizationID>`,
    );
    let caught: unknown = null;
    try {
      parseEformsNotice(xml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TedParseError);
    const issue = (caught as TedParseError).issues.find(
      (i) => i.code === 'unsupported-customization-id',
    );
    expect(issue).toBeDefined();
    expect(issue?.message.length).toBeLessThanOrEqual(1_100);
  });

  it('documents with a DTD are rejected (entity-expansion attack surface)', () => {
    const xml = `<!DOCTYPE lol [<!ENTITY a "b">]>${loadFixture('1.15/normal.xml').replace('<?xml version="1.0" encoding="utf-8"?>', '')}`;
    let caught: unknown = null;
    try {
      parseEformsNotice(xml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TedParseError);
    expect((caught as TedParseError).issues[0]?.code).toBe('malformed-xml');
  });
});
