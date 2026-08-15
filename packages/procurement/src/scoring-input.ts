/**
 * Deterministic mapping from repository rows to the matching engine's pure
 * `EngineInput` shape (packages/matching/src/types.ts). This is a stage-B
 * concern by design (packages/matching/src/types.ts header) — the engine
 * itself never touches `@bidmorrow/db` row types.
 *
 * Known reduction carried over from Phase 5 (ted-ingestion-audit): `tender_
 * lots.title`/`description` are stored as single flattened strings (the
 * first language value seen — see run-window.ts `firstLanguageValue`), not
 * as per-language maps. The engine's capability component wants a language
 * map (`titleByLang`/`descriptionByLang`) to know which languages are
 * "matchable". Until that schema gap is closed (would need a
 * `tender_lots`/notice-text redesign — out of scope for this stage), the
 * mapper here keys the single stored string under the NOTICE's first
 * declared language. This is an honest best-effort, not a guarantee the
 * text is actually in that language — flagged as an open item.
 */
import { CONTRACT_NATURES } from '@bidmorrow/domain';
import type { ContractNature, OrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';
import type { LotScoringBundle } from '@bidmorrow/db';
import type { Db } from '@bidmorrow/db';
import {
  getMatchingPreferences,
  getRate,
  listCompanyCapabilities,
  listCompanyCertifications,
  listCompanyCpvPreferences,
  listCompanyExclusions,
  listCompanyGeographies,
  listCompanyKeywords,
} from '@bidmorrow/db';
import type {
  LotCpv,
  LotInput,
  OrgCertification,
  OrgProfile,
  SynonymGroup,
} from '@bidmorrow/matching';

/** A single page covers every profile collection: caps are 50 keywords / 30 CPV (docs/product-scope.md). */
const PROFILE_PAGE_LIMIT = 100;

/**
 * MATCH-P6-02: `company_keywords.language` is stored as BCP-47 (docs/
 * data-model.md), but the engine's `LotInput.languages`/`titleByLang` keys
 * are lowercased ISO 639-2 (per eForms — packages/ted/src/parser/parse-
 * notice.ts). This maps each EU official language's BCP-47 primary subtag
 * to the ISO 639-2 (terminology) code TED actually emits, so a keyword
 * entered as `language: 'de'` makes German-language lot text matchable, not
 * just English. Small and static by design (24 EU official languages,
 * docs/matching-engine.md capability-fit section) — an unrecognized subtag
 * is passed through as-is rather than dropped, so a lowercase 3-letter
 * BCP-47 value (which often already IS the ISO 639-2 code, e.g. someone
 * enters `eng` directly) still works.
 */
const BCP47_TO_ISO_639_2: Readonly<Record<string, string>> = {
  bg: 'bul',
  hr: 'hrv',
  cs: 'ces',
  da: 'dan',
  nl: 'nld',
  en: 'eng',
  et: 'est',
  fi: 'fin',
  fr: 'fra',
  de: 'deu',
  el: 'ell',
  hu: 'hun',
  ga: 'gle',
  it: 'ita',
  lv: 'lav',
  lt: 'lit',
  mt: 'mlt',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  sk: 'slk',
  sl: 'slv',
  es: 'spa',
  sv: 'swe',
};

/** Maps a `company_keywords.language` BCP-47 value to the ISO 639-2 code the engine compares against. Exported for unit tests. */
export function toIso6392(bcp47Language: string): string {
  const primarySubtag = bcp47Language.trim().toLowerCase().split('-')[0] ?? '';
  return BCP47_TO_ISO_639_2[primarySubtag] ?? primarySubtag;
}

const VALID_CONTRACT_NATURES = new Set<string>(CONTRACT_NATURES);
const VALID_CERTIFICATION_CODES = new Set<string>(['ISO_27001', 'ISO_9001', 'SOC2', 'OTHER']);

/**
 * Validates a single `company_exclusions.value` row of kind `contract_nature`
 * against the known union — never a blind cast (Phase 7 residual of
 * SEC-P6-04, same pattern as `parseSupportedContractNatures`). Invalid
 * values are dropped and logged, never silently included in the exclusion
 * set (a bad exclusion value must never accidentally hard-exclude every
 * lot). Exported for unit tests.
 */
export function parseExclusionContractNature(
  value: string,
  logger?: Logger,
): ContractNature | null {
  if (VALID_CONTRACT_NATURES.has(value)) {
    return value as ContractNature;
  }
  logger?.error('scoring_input.exclusion_contract_nature.invalid_value', { value });
  return null;
}

/**
 * Validates a single `company_certifications.certification_code` row against
 * the engine's `OrgCertification['code']` union — never a blind cast (Phase 7
 * residual of SEC-P6-04). Invalid values are dropped and logged. Exported
 * for unit tests.
 */
export function parseCertificationCode(
  value: string,
  logger?: Logger,
): OrgCertification['code'] | null {
  if (VALID_CERTIFICATION_CODES.has(value)) {
    return value as OrgCertification['code'];
  }
  logger?.error('scoring_input.certification_code.invalid_value', { value });
  return null;
}

/**
 * @throws never — invalid `ContractNature` values are dropped and logged,
 * never blindly cast (SEC-P6-04). Exported for unit tests.
 */
export function parseSupportedContractNatures(json: string, logger?: Logger): ContractNature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger?.error('scoring_input.supported_contract_natures.invalid_json', {});
    return [];
  }
  if (!Array.isArray(parsed)) {
    logger?.error('scoring_input.supported_contract_natures.not_array', {});
    return [];
  }
  const valid = new Set<string>(CONTRACT_NATURES);
  const result: ContractNature[] = [];
  for (const value of parsed) {
    if (typeof value === 'string' && valid.has(value)) {
      result.push(value as ContractNature);
    } else {
      logger?.error('scoring_input.supported_contract_natures.invalid_value', {
        value: typeof value === 'string' ? value : typeof value,
      });
    }
  }
  return result;
}

/**
 * Loads and maps one organization's full preference bundle (profile,
 * capabilities, certifications, CPV preferences, geographies, keywords +
 * synonym groups, exclusions, matching preferences) into the engine's
 * `OrgProfile`. Missing `matching_preferences` (org never set value/nature/
 * deadline knobs) maps to permissive defaults — no bound, no supported
 * natures, no deadline threshold — never a thrown error; onboarding may be
 * incomplete but the org can still be scored on its CPV/keyword/geography
 * signals.
 */
export async function loadOrgProfile(
  db: Db,
  organizationId: OrganizationId,
  logger?: Logger,
): Promise<OrgProfile> {
  const [cpvPrefs, capabilities, certifications, geographies, keywords, exclusions, matchingPrefs] =
    await Promise.all([
      listCompanyCpvPreferences(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      listCompanyCapabilities(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      listCompanyCertifications(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      listCompanyGeographies(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      listCompanyKeywords(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      listCompanyExclusions(db, organizationId, { limit: PROFILE_PAGE_LIMIT }),
      getMatchingPreferences(db, organizationId),
    ]);

  const synonymGroups = new Map<string, SynonymGroup>();
  const positiveTerms: string[] = [];
  const matchableLanguageSet = new Set<string>();
  for (const keyword of keywords.items) {
    if (keyword.language !== null) {
      matchableLanguageSet.add(toIso6392(keyword.language));
    }
    if (keyword.kind === 'positive') {
      positiveTerms.push(keyword.term);
      continue;
    }
    const groupKey = keyword.synonymGroup ?? keyword.term;
    const group = synonymGroups.get(groupKey) ?? { label: groupKey, terms: [] };
    synonymGroups.set(groupKey, { label: group.label, terms: [...group.terms, keyword.term] });
  }

  const preferredNuts: string[] = [];
  const opportunityCountries: string[] = [];
  const countriesServed: string[] = [];
  for (const geo of geographies.items) {
    if (geo.kind === 'preferred_nuts') preferredNuts.push(geo.code);
    else if (geo.kind === 'opportunity_country') opportunityCountries.push(geo.code);
    else if (geo.kind === 'country_served') countriesServed.push(geo.code);
  }

  const cpvFamilies: string[] = [];
  const excludedCountries: string[] = [];
  const nutsPrefixes: string[] = [];
  const phrases: string[] = [];
  const excludedNatures: ContractNature[] = [];
  for (const exclusion of exclusions.items) {
    if (exclusion.kind === 'cpv_family') cpvFamilies.push(exclusion.value);
    else if (exclusion.kind === 'country') excludedCountries.push(exclusion.value);
    else if (exclusion.kind === 'nuts') nutsPrefixes.push(exclusion.value);
    else if (exclusion.kind === 'phrase') phrases.push(exclusion.value);
    else if (exclusion.kind === 'contract_nature') {
      const nature = parseExclusionContractNature(exclusion.value, logger);
      if (nature !== null) excludedNatures.push(nature);
    }
  }

  const orgCertifications: OrgCertification[] = certifications.items.flatMap((cert) => {
    const code = parseCertificationCode(cert.certificationCode, logger);
    if (code === null) return [];
    return [{ code, ...(cert.label !== null ? { label: cert.label } : {}) }];
  });

  const supportedContractNatures: ContractNature[] =
    matchingPrefs !== null
      ? parseSupportedContractNatures(matchingPrefs.supportedContractNaturesJson, logger)
      : [];

  return {
    cpvPreferences: cpvPrefs.items.map((c) => c.cpvCode),
    keywords: { positiveTerms, synonymGroups: [...synonymGroups.values()] },
    capabilities: capabilities.items.map((c) => c.label),
    matchableLanguages: [...matchableLanguageSet],
    certifications: orgCertifications,
    geographies: { preferredNuts, opportunityCountries, countriesServed },
    exclusions: {
      cpvFamilies,
      countries: excludedCountries,
      nutsPrefixes,
      phrases,
      contractNatures: excludedNatures,
    },
    valueRange: {
      ...(matchingPrefs?.minValueEur != null ? { minEur: matchingPrefs.minValueEur } : {}),
      ...(matchingPrefs?.maxValueEur != null ? { maxEur: matchingPrefs.maxValueEur } : {}),
    },
    ...(matchingPrefs?.minimumDaysRemaining != null
      ? { minimumDaysRemaining: matchingPrefs.minimumDaysRemaining }
      : {}),
    supportedContractNatures,
  };
}

export type LotMappingResult =
  | { readonly kind: 'ok'; readonly lot: LotInput; readonly rateDate: string | null }
  /** Lot has no main CPV — mandatory per eForms; treated as a `score`-stage ingestion error, never scored. */
  | { readonly kind: 'missing_main_cpv' };

/**
 * Maps one `LotScoringBundle` (packages/db tender-corpus repo) into the
 * engine's `LotInput`. EUR values pass straight through; non-EUR values are
 * converted via the freshest ≤7-day ECB rate (ADR-0004) — `rateDate` is
 * returned alongside so the caller can record it in the persisted value
 * component's explanation (the engine itself never sees the rate date; it
 * stays pure). No fresh rate → `valueEur: null` (engine scores value
 * UNKNOWN), never a guessed conversion.
 */
export async function mapLotToEngineInput(
  db: Db,
  bundle: LotScoringBundle,
  asOfMs: number,
): Promise<LotMappingResult> {
  const mainCpv = bundle.cpvCodes.find((c) => c.isMain === 1)?.cpvCode;
  if (mainCpv === undefined) {
    return { kind: 'missing_main_cpv' };
  }
  const additionalCpv = bundle.cpvCodes.filter((c) => c.isMain !== 1).map((c) => c.cpvCode);
  const cpv: LotCpv = { main: mainCpv, additional: additionalCpv };

  const countries = [...new Set(bundle.geographies.map((g) => g.countryCode))];
  const nuts = bundle.geographies
    .map((g) => g.nutsCode)
    .filter((code): code is string => code !== null);

  const { valueEur, rateDate } = await resolveValueEur(db, bundle.lot, asOfMs);

  let languages: string[];
  try {
    const parsed: unknown = JSON.parse(bundle.sourceLanguagesJson);
    languages = Array.isArray(parsed)
      ? parsed.filter((l): l is string => typeof l === 'string')
      : [];
  } catch {
    languages = [];
  }
  const primaryLanguage = languages[0] ?? 'und';

  const lot: LotInput = {
    cpv,
    titleByLang: { [primaryLanguage]: bundle.lot.title },
    descriptionByLang:
      bundle.lot.description !== null ? { [primaryLanguage]: bundle.lot.description } : {},
    countries,
    nuts,
    valueEur,
    originalCurrency: bundle.lot.estimatedValueCurrency,
    valueIsDerived: bundle.lot.valueIsDerived === 1,
    deadlineAt: bundle.lot.deadlineAt,
    buyerLegalType: bundle.buyerLegalType,
    procedureType: bundle.procedureType,
    contractNature: (bundle.lot.contractNature as ContractNature | null) ?? null,
    languages: languages.length > 0 ? languages : [primaryLanguage],
  };
  return { kind: 'ok', lot, rateDate };
}

interface ResolvedValue {
  readonly valueEur: number | null;
  readonly rateDate: string | null;
}

async function resolveValueEur(
  db: Db,
  lot: LotScoringBundle['lot'],
  asOfMs: number,
): Promise<ResolvedValue> {
  // Ingestion already resolved EUR-direct values (packages/procurement/value.ts).
  if (lot.estimatedValueEur !== null) {
    return { valueEur: lot.estimatedValueEur, rateDate: null };
  }
  if (lot.estimatedValueAmount === null || lot.estimatedValueCurrency === null) {
    return { valueEur: null, rateDate: null };
  }
  if (lot.estimatedValueCurrency === 'EUR') {
    // Ingestion should already have set estimated_value_eur for EUR — this
    // is a defensive fallback so a data anomaly never produces a wrong
    // conversion attempt.
    return { valueEur: lot.estimatedValueAmount, rateDate: null };
  }
  const rate = await getRate(db, { currency: lot.estimatedValueCurrency, asOfMs });
  if (rate === null) {
    return { valueEur: null, rateDate: null };
  }
  return { valueEur: lot.estimatedValueAmount * rate.rateToEur, rateDate: rate.rateDate };
}
