/**
 * Pure input/output types for the matching engine. These deliberately do NOT
 * reuse `@bidmorrow/db` row types — the engine takes plain data; mapping
 * repository rows (and `NormalizedLot`) into these shapes is a stage-B
 * concern (pipeline wiring), kept out of this package so it stays free of
 * I/O and DB dependencies.
 */
import type { ComponentStatus, ContractNature, MatchClassification } from '@bidmorrow/domain';
import type { MatchComponentId } from './index';

/** A customer-defined synonym group: one hit counts once per group. */
export interface SynonymGroup {
  readonly label: string;
  readonly terms: readonly string[];
}

export interface OrgKeywords {
  /** Positive single-word or phrase terms (already normalized: lowercased). */
  readonly positiveTerms: readonly string[];
  readonly synonymGroups: readonly SynonymGroup[];
}

export interface OrgGeographyPreferences {
  /** NUTS code prefixes (e.g. `CY`, `CY30`). */
  readonly preferredNuts: readonly string[];
  /** ISO-3166-1 alpha-2. */
  readonly opportunityCountries: readonly string[];
  readonly countriesServed: readonly string[];
}

export interface OrgExclusions {
  /** CPV code prefixes. */
  readonly cpvFamilies: readonly string[];
  /** ISO-3166-1 alpha-2. */
  readonly countries: readonly string[];
  /** NUTS code prefixes. */
  readonly nutsPrefixes: readonly string[];
  /** Normalized (lowercased, diacritic-folded) phrases. */
  readonly phrases: readonly string[];
  readonly contractNatures: readonly ContractNature[];
}

export interface OrgValueRange {
  readonly minEur?: number;
  readonly maxEur?: number;
}

/** Certification codes the org holds; `OTHER` entries carry a free-text label. */
export interface OrgCertification {
  readonly code: 'ISO_27001' | 'ISO_9001' | 'SOC2' | 'OTHER';
  readonly label?: string;
}

export interface OrgProfile {
  /** 8-digit CPV codes (check digit stripped). */
  readonly cpvPreferences: readonly string[];
  readonly keywords: OrgKeywords;
  /** Free-text capability labels; folded into the capability-matching corpus vocabulary. */
  readonly capabilities: readonly string[];
  readonly certifications: readonly OrgCertification[];
  readonly geographies: OrgGeographyPreferences;
  readonly exclusions: OrgExclusions;
  readonly valueRange: OrgValueRange;
  /** Null/undefined = threshold unset (deadline rule never hard-excludes). */
  readonly minimumDaysRemaining?: number;
  readonly supportedContractNatures: readonly ContractNature[];
}

export type LanguageTextMap = Readonly<Record<string, string>>;

export interface LotCpv {
  /** Mandatory per eForms; absence is an ingestion error, not an engine concern. */
  readonly main: string;
  readonly additional: readonly string[];
}

export interface LotInput {
  readonly cpv: LotCpv;
  readonly titleByLang: LanguageTextMap;
  readonly descriptionByLang: LanguageTextMap;
  /** ISO-3166-1 alpha-2 country codes associated with the lot. */
  readonly countries: readonly string[];
  readonly nuts: readonly string[];
  /**
   * EUR amount, already converted (stage B via exchange rates). Null when no
   * value was published or the source currency could not be converted.
   */
  readonly valueEur: number | null;
  /** Original currency code, kept only for explanation text when `valueEur` is null. */
  readonly originalCurrency?: string | null;
  /** True when `valueEur` came from dividing a procedure-level total across lots. */
  readonly valueIsDerived: boolean;
  readonly deadlineAt: number | null;
  readonly buyerLegalType: string | null;
  readonly procedureType: string | null;
  readonly contractNature: ContractNature | null;
  /** BCP-47/ISO 639 language codes the notice text is available in. */
  readonly languages: readonly string[];
}

export interface EngineInput {
  readonly org: OrgProfile;
  readonly lot: LotInput;
  /** Epoch millis; the engine never reads the clock itself. */
  readonly scoringTime: number;
}

export interface ComponentResult {
  readonly key: MatchComponentId;
  readonly points: number;
  readonly maxPoints: number;
  readonly status: ComponentStatus;
  /** Human-readable line (no point prefix — `explanation.ts` renders that). */
  readonly explanation: string;
}

export type RiskFlagType =
  | 'certification'
  | 'security_clearance'
  | 'insurance'
  | 'financial_turnover'
  | 'prior_experience'
  | 'framework_membership'
  | 'local_presence'
  | 'mandatory_references';

export type RiskConfidence = 'HIGH' | 'POSSIBLE';

export interface RiskFlag {
  readonly type: RiskFlagType;
  /** Quoted source snippet, capped at 200 chars. */
  readonly evidence: string;
  /** Field path the evidence came from, e.g. `lot.descriptionByLang.eng`. */
  readonly sourceField: string;
  readonly confidence: RiskConfidence;
  readonly explanation: string;
}

export type ExclusionRule =
  | 'excluded_geography'
  | 'excluded_cpv'
  | 'excluded_phrase'
  | 'unsupported_nature'
  | 'deadline_below_threshold';

export interface ExcludedResult {
  readonly kind: 'excluded';
  readonly rule: ExclusionRule;
  readonly evidence: string;
}

export interface ScoredResult {
  readonly kind: 'scored';
  readonly score: number;
  readonly classification: MatchClassification;
  readonly components: readonly ComponentResult[];
  readonly riskFlags: readonly RiskFlag[];
  /** Set when the lot carried no matchable-language text — capability was UNKNOWN. */
  readonly sourceLanguageIndicator?: string;
}

export type MatchResult = ExcludedResult | ScoredResult;

export type { ComponentStatus, ContractNature, MatchClassification };
