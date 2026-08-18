/**
 * Shared response DTO shapes — kept in exact sync with apps/worker/src/
 * routes/{feed,tenders,org}.ts and packages/db/src/repositories/matching.ts
 * (`FeedRow`).
 */

export type Classification =
  'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT' | 'EXCLUDED';

export interface FeedComponentSummary {
  componentKey: string;
  points: number;
  explanation: string;
}

export interface FeedRiskFlagSummary {
  type: string;
  confidence: string;
  explanation: string;
}

/** Matches packages/db/src/repositories/matching.ts `FeedRow` exactly. */
export interface FeedRow {
  matchId: string;
  lotId: string;
  score: number | null;
  classification: Classification;
  title: string;
  buyerName: string | null;
  country: string | null;
  valueEur: number | null;
  valueOriginalAmount: number | null;
  valueOriginalCurrency: string | null;
  deadlineAt: number | null;
  scoredAt: number;
  topComponents: readonly FeedComponentSummary[];
  topRiskFlag: FeedRiskFlagSummary | null;
  savedByYou: boolean;
  ignoredByYou: boolean;
}

export interface FeedResponse {
  items: FeedRow[];
  nextCursor: string | null;
}

export interface ComponentOut {
  componentKey: string;
  points: number;
  maxPoints: number;
  status: string;
  explanation: string;
}

export interface RiskFlagOut {
  type: string;
  evidence: string;
  sourceField: string;
  confidence: string;
  explanation: string;
}

export interface TenderDetailResponse {
  match: {
    id: string;
    score: number;
    classification: Classification;
    engineVersion: string;
    scoredAt: number;
    exclusionRule: string | null;
    exclusionEvidence: string | null;
  };
  lot: {
    id: string;
    lotNumber: string | null;
    title: string;
    description: string | null;
    contractNature: string | null;
    estimatedValueAmount: number | null;
    estimatedValueCurrency: string | null;
    estimatedValueEur: number | null;
    valueIsDerived: boolean;
    deadlineAt: number | null;
    cpvCodes: { cpvCode: string; isMain: boolean }[];
    geographies: { countryCode: string | null; nutsCode: string | null }[];
  };
  notice: {
    id: string;
    sourceNoticeId: string;
    source: string;
    sourceUrl: string;
    publicationDate: string | null;
    procedureType: string | null;
    noticeType: string | null;
    languages: string[];
  };
  buyerName: string | null;
  components: ComponentOut[];
  riskFlags: RiskFlagOut[];
  explanationRecomputed: boolean;
  explanationNote: string | null;
  savedByYou: boolean;
  ignoredByYou: boolean;
  feedback: { verdict: 'useful' | 'not_useful'; reasons: string[]; comment: string | null } | null;
}

export type FeedbackReason =
  | 'wrong_cpv'
  | 'wrong_geography'
  | 'too_large'
  | 'too_small'
  | 'not_our_work'
  | 'deadline_too_close'
  | 'other';

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong_cpv: 'Wrong CPV / category',
  wrong_geography: 'Wrong geography',
  too_large: 'Too large for us',
  too_small: 'Too small for us',
  not_our_work: 'Not the kind of work we do',
  deadline_too_close: 'Deadline too close',
  other: 'Other',
};
