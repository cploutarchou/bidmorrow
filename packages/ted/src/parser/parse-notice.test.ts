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
