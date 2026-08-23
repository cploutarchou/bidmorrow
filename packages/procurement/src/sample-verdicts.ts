/**
 * The public sample-verdict demo's data, built by running the production
 * matching engine over real TED notices (docs/product-scope.md "Product
 * policy lock", 2026-08-17: a controlled, no-signup demonstration of
 * EXPLAINABILITY — not a free tier).
 *
 * The whole point of the demo is that the verdicts are real, so nothing here
 * is written by hand:
 *
 *   sanitized real TED notice  ──parseEformsNotice()──▶  NormalizedNotice
 *                                                            │
 *                                       noticeToLotInputs()  │  (the SAME
 *                                                            ▼   mapping
 *   representative supplier profile ──▶ scoreLotForOrg() ──▶ score,
 *                                       (the SAME engine     components,
 *                                        the product runs)   risk flags
 *
 * The supplier profiles are representative composites of the ICP, never real
 * customers, and the page says so. Everything else — the tender, the buyer,
 * the CPV, the deadline, the numbers — comes from a notice TED published and
 * from the engine.
 *
 * This lives in `src/` rather than in the generator script so it is covered
 * by the normal test run: the committed output in
 * `apps/web/src/lib/sample-verdicts.generated.ts` is checked against a fresh
 * build, which is what stops the published demo from quietly going stale
 * after an engine change.
 */
import { parseEformsNotice } from '@bidmorrow/ted';
import type { OrgProfile } from '@bidmorrow/matching';
import { ENGINE_VERSION, renderExplanation, scoreLotForOrg } from '@bidmorrow/matching';

import { normalizeBuyerCountry } from './country-map';
import { noticeToLotInputs } from './notice-lot-input';
import { COMPONENT_KEY_TO_DB } from './score';

/**
 * Pinned so the committed output is deterministic and reviewable, and set to
 * the morning the demo's notices were published — the moment a subscriber
 * would first have seen them.
 *
 * Deadline runway is scored relative to this instant, so the page states it
 * rather than hiding it. Left floating, every verdict's deadline component
 * would drift with the calendar and the committed numbers would stop being
 * the ones the engine produces.
 */
const SCORING_TIME = Date.parse('2026-08-21T09:00:00Z');

/**
 * Representative supplier profiles — composites of the ICP (5–50 person EU
 * IT and cyber consultancies), never real customers, and the page says so.
 *
 * Both are Berlin-based, and that is not decoration. Geography and language
 * are scored components: a profile serving countries no fixture covers would
 * score 0/15 on geography every time, and a profile whose matchable
 * languages exclude the notice's language gets an UNKNOWN capability score
 * instead of a real one. Either would publish a systematically understated
 * version of what the engine does. The fixtures behind the demo are German
 * notices, so the suppliers are German.
 */
const PROFILES: Record<string, { readonly label: string; readonly profile: OrgProfile }> = {
  cyber: {
    label: 'A 20-person cybersecurity consultancy in Berlin',
    profile: {
      cpvPreferences: ['72800000', '79417000', '72222300', '48730000'],
      keywords: {
        // The standard German trade vocabulary for this work — what such a
        // consultancy writes on its own site, not terms lifted from a notice.
        positiveTerms: [
          'penetrationstest',
          'it-sicherheit',
          'informationssicherheit',
          'sicherheitsanalysen',
          'schwachstelle',
          'iso 27001',
        ],
        synonymGroups: [],
      },
      capabilities: [
        'Penetrationstests',
        'IT-Sicherheit',
        'Sicherheitsanalysen',
        'Informationssicherheit',
        'ISO 27001',
        'Incident Response',
      ],
      certifications: [{ code: 'ISO_27001' }],
      geographies: {
        preferredNuts: ['DE3'],
        opportunityCountries: ['DE', 'AT'],
        countriesServed: ['DE', 'AT'],
      },
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
      valueRange: { minEur: 50_000, maxEur: 2_000_000 },
      // A four-person bid team on a framework: a week is tight but workable.
      minimumDaysRemaining: 7,
      supportedContractNatures: ['services'],
      matchableLanguages: ['deu', 'eng'],
    },
  },
  irishSoftware: {
    label: 'A 25-person software supplier in Ireland',
    profile: {
      cpvPreferences: ['48000000', '72000000', '72260000', '72220000'],
      keywords: {
        positiveTerms: [
          'software',
          'systems integration',
          'maintenance',
          'support',
          'implementation',
        ],
        synonymGroups: [],
      },
      capabilities: ['Software supply and integration', 'Systems maintenance and support'],
      certifications: [{ code: 'ISO_9001' }],
      geographies: {
        preferredNuts: ['IE'],
        opportunityCountries: ['IE'],
        countriesServed: ['IE'],
      },
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
      valueRange: { minEur: 50_000, maxEur: 5_000_000 },
      minimumDaysRemaining: 10,
      supportedContractNatures: ['services', 'supplies'],
      matchableLanguages: ['eng'],
    },
  },
  software: {
    label: 'A 30-person IT consultancy in Berlin',
    profile: {
      cpvPreferences: ['72220000', '72224000', '72000000', '72230000'],
      keywords: {
        positiveTerms: [
          'it-beratung',
          'beratungsleistungen',
          'projektbegleitung',
          'systemintegration',
          'softwareentwicklung',
        ],
        synonymGroups: [],
      },
      capabilities: ['IT-Beratung', 'Projektbegleitung', 'Softwareentwicklung'],
      certifications: [{ code: 'ISO_9001' }],
      geographies: {
        preferredNuts: ['DE3'],
        opportunityCountries: ['DE', 'AT'],
        countriesServed: ['DE', 'AT'],
      },
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        // An IT consultancy does not bid construction works. This is what
        // produces a genuine hard EXCLUDED verdict on a real works notice,
        // rather than a low score dressed up as one.
        contractNatures: ['works'],
      },
      valueRange: { minEur: 50_000, maxEur: 5_000_000 },
      // Larger proposals with references and CVs to assemble.
      minimumDaysRemaining: 10,
      supportedContractNatures: ['services', 'supplies'],
      matchableLanguages: ['deu', 'eng'],
    },
  },
};

/**
 * Which fixture lot each verdict uses. Chosen to span the real outcome
 * classes; the classification is NOT asserted here — it is whatever the
 * engine returns, and the generation fails below if the set stops covering a
 * range, rather than being quietly re-labelled.
 *
 * Every fixture used here is a notice TED actually published, with a real
 * buyer and a real title, fetched and sanitized under the
 * ted-fixture-refresh procedure. The Publications Office's own eForms
 * example notices parse and score identically and several sit in
 * tests/fixtures/ted, but none of them is a tender anyone could have bid
 * for — which on a public page is a difference that matters.
 */
/**
 * Where a verdict is shown. `demo` is /sample-verdicts, which the policy
 * caps at a curated 3–5; `cybersecurity` is the /cybersecurity-tenders
 * category page. One verdict can serve both — the data is identical either
 * way, only the page framing differs.
 */
type SampleSurface = 'demo' | 'cybersecurity';

interface SampleCase {
  readonly id: string;
  /** Path under `tests/fixtures/ted`. */
  readonly fixture: string;
  readonly lotIndex: number;
  readonly profile: keyof typeof PROFILES;
  readonly why: string;
  readonly surfaces: readonly SampleSurface[];
}

const CASES: readonly SampleCase[] = [
  // A framework contract for penetration testing, in the city this
  // consultancy works in. What a strong match actually looks like.
  {
    id: 'cyber-core',
    fixture: '1.13/real-cyber-pentest.xml',
    lotIndex: 0,
    profile: 'cyber',
    why: 'Penetration testing, in this consultancy’s own city — its core service.',
    surfaces: ['demo', 'cybersecurity'],
  },
  // Software packaging and QA for a regional authority — the consultancy's
  // subject exactly, at a contract size that tests the value component.
  {
    id: 'software-core',
    fixture: '1.13/real-it-framework-three-lot.xml',
    lotIndex: 0,
    profile: 'software',
    why: 'Software packaging for a state IT authority — this consultancy’s subject, at scale.',
    surfaces: ['demo'],
  },
  // Gigabit broadband: CPV division 72, so it is scored rather than
  // pre-filtered, but it is telecoms infrastructure, not IT consulting.
  {
    id: 'software-low-fit',
    fixture: '1.13/real-broadband-no-deadline.xml',
    lotIndex: 0,
    profile: 'software',
    why: 'Broadband infrastructure — close enough in CPV to reach scoring, far from the work.',
    surfaces: ['demo'],
  },
  // Managed security services and a Security Operations Centre — the
  // clearest cybersecurity procurement in the set, and the one whose MAIN
  // CPV (72514100, computer operation) says nothing about security at all.
  // The additional codes carry it, which is the point.
  {
    id: 'cyber-managed-soc',
    fixture: '1.13/real-managed-security-soc.xml',
    lotIndex: 0,
    profile: 'cyber',
    why: 'Managed security services and a Security Operations Centre, at a €5.5m ceiling.',
    surfaces: ['cybersecurity'],
  },
  // The only English-language notice in the set, and the only one that
  // raises a risk flag. That is not a coincidence worth hiding: risk-flag
  // detection is an English pattern set (packages/matching/src/
  // risk-flags.ts), so the German notices above correctly raise none. A demo
  // that only ever showed English notices would imply flags are universal;
  // one that only showed German ones would never demonstrate the feature at
  // all. Both are here, and the page says which is which.
  {
    id: 'irish-framework-flag',
    fixture: '1.13/real-english-framework-risk-flag.xml',
    lotIndex: 0,
    profile: 'irishSoftware',
    why: 'A framework agreement in this supplier’s own market — and the one notice here the engine flags.',
    surfaces: ['demo'],
  },
  // Construction works against a supplier that excludes works outright: a
  // hard exclusion, not a low score — even though the notice carries an IT
  // CPV code among its nineteen.
  {
    id: 'software-excluded-works',
    fixture: '1.13/real-works-multi-cpv.xml',
    lotIndex: 0,
    profile: 'software',
    why: 'A construction contract that happens to carry an IT code, ruled out before scoring.',
    surfaces: ['demo'],
  },
];

/**
 * Reads a fixture (and its sibling `.meta.json`) relative to
 * `tests/fixtures/ted`. Injected rather than imported so this module stays
 * free of `node:fs` — everything else in this package has to run inside
 * workerd.
 */
export interface FixtureReader {
  (relativePath: string): string;
}

export interface SampleVerdictBuild {
  readonly engineVersion: string;
  readonly scoredAt: number;
  readonly verdicts: readonly Record<string, unknown>[];
}

/**
 * Builds every sample verdict.
 *
 * @throws when a case names a lot the mapper cannot score, or when the set
 * stops covering a range of outcomes — see the checks at the end. Both are
 * deliberate: a demo that silently collapsed to one outcome class, or that
 * quietly dropped a case, would still look fine on the page.
 */
export function buildSampleVerdicts(readFixture: FixtureReader): SampleVerdictBuild {
  const verdicts: Record<string, unknown>[] = [];

  for (const testCase of CASES) {
    const notice = parseEformsNotice(readFixture(testCase.fixture));
    const meta: unknown = JSON.parse(readFixture(testCase.fixture.replace(/\.xml$/, '.meta.json')));
    const metaRecord = meta as Record<string, unknown>;

    // One mapping, shared with the ingestion path (notice-lot-input.ts) —
    // never re-derived here, because a lookalike mapper is how the first
    // version of this generator silently produced understated verdicts.
    const { inputs, skipped } = noticeToLotInputs(notice);
    const mapped = inputs[testCase.lotIndex];
    if (mapped === undefined) {
      throw new Error(
        `${testCase.fixture}: no scorable lot at index ${String(testCase.lotIndex)} ` +
          `(${String(inputs.length)} scorable, skipped: ` +
          `${skipped.map((s) => `${s.lotId}=${s.reason}`).join(', ') || 'none'})`,
      );
    }
    const lotInput = mapped.lot;
    const entry = PROFILES[testCase.profile];
    if (entry === undefined) {
      throw new Error(`${testCase.id}: unknown profile "${testCase.profile}"`);
    }
    const { label, profile } = entry;
    const buyerCountry = normalizeBuyerCountry(notice.buyer?.country ?? null)?.countryCode ?? null;
    const result = scoreLotForOrg({ org: profile, lot: lotInput, scoringTime: SCORING_TIME });

    // Provenance, stated rather than assumed. A notice TED actually
    // published has a real buyer, a real procurement and a resolvable
    // ted.europa.eu link; the Publications Office's own eForms example
    // notices parse and score identically but are not tenders anyone could
    // have bid for. The page must not present the second as the first, so
    // the distinction is carried through to the UI rather than being
    // flattened into a link that would 404.
    const sourceUrl = typeof metaRecord.source === 'string' ? metaRecord.source : null;
    const isTedPublished =
      typeof metaRecord.sourceNoticeId === 'string' &&
      sourceUrl !== null &&
      sourceUrl.startsWith('https://ted.europa.eu/');
    // A `source` that is neither a TED notice URL nor an SDK example URL has
    // no business reaching an `href` on a public page. Refusing here — rather
    // than relying on the page to check, or on the content test to notice —
    // keeps a fixture author from turning a meta field into a link target.
    if (
      sourceUrl !== null &&
      !isTedPublished &&
      !sourceUrl.startsWith('https://github.com/OP-TED/')
    ) {
      throw new Error(
        `${testCase.fixture}: meta.source is neither a ted.europa.eu notice nor an OP-TED example URL`,
      );
    }

    const isExcluded = result.kind === 'excluded';
    verdicts.push({
      id: testCase.id,
      why: testCase.why,
      surfaces: testCase.surfaces,
      supplierLabel: label,
      // The title ingestion would store, not a hand-picked translation.
      tenderTitle: mapped.title,
      buyerName: notice.buyer?.name ?? null,
      // Same derivation the scored input uses, so the country shown next to
      // a verdict is the one the geography component actually scored.
      country: buyerCountry,
      cpvMain: lotInput.cpv.main,
      valueEur: lotInput.valueEur,
      deadlineAt: lotInput.deadlineAt,
      sourceNoticeId: notice.sourceNoticeId,
      sourceKind: isTedPublished ? 'ted_notice' : 'eforms_example',
      sourceUrl,
      publicationDate:
        typeof metaRecord.publicationDate === 'string' ? metaRecord.publicationDate : null,
      // An excluded lot is never scored — the engine stops at the rule. The
      // demo shows that as its own outcome rather than inventing a 0.
      score: isExcluded ? null : result.score,
      classification: isExcluded ? 'EXCLUDED' : result.classification,
      exclusionRule: isExcluded ? result.rule : null,
      exclusionEvidence: isExcluded ? result.evidence : null,
      components: isExcluded
        ? []
        : result.components.map((component) => ({
            // Same vocabulary `match_components.component_key` stores, so
            // the demo and the customer UI label components identically.
            key: COMPONENT_KEY_TO_DB[component.key],
            points: component.points,
            maxPoints: component.maxPoints,
            status: component.status,
            explanation: component.explanation,
          })),
      riskFlags: isExcluded
        ? []
        : result.riskFlags.map((flag) => ({
            type: flag.type,
            confidence: flag.confidence,
            explanation: flag.explanation,
            evidence: flag.evidence,
          })),
      explanation: renderExplanation(result),
    });
  }

  // The policy requires the demo to span the real outcome classes. If a
  // fixture or the engine changes such that the cases collapse into one
  // bucket, the demo stops demonstrating anything — fail loudly instead of
  // publishing it.
  const demoVerdicts = verdicts.filter((v) => (v.surfaces as readonly string[]).includes('demo'));
  if (demoVerdicts.length < 3 || demoVerdicts.length > 5) {
    throw new Error(
      `the /sample-verdicts demo is policy-capped at a curated 3-5 verdicts; got ${String(demoVerdicts.length)}`,
    );
  }
  const distinctClasses = new Set(demoVerdicts.map((v) => v.classification));
  if (distinctClasses.size < 3) {
    throw new Error(
      `sample verdicts must span at least three outcome classes; got only ` +
        `${[...distinctClasses].join(', ')}`,
    );
  }
  if (!distinctClasses.has('EXCLUDED')) {
    throw new Error(
      'sample verdicts must include an EXCLUDED case — it is the outcome the demo exists to explain',
    );
  }

  return { engineVersion: ENGINE_VERSION, scoredAt: SCORING_TIME, verdicts };
}
