/**
 * @bidmorrow/matching — deterministic, explainable scoring engine.
 *
 * Phase 2 skeleton: component scorers, hard exclusions, and risk flags
 * arrive in Phase 6. The constants and classification thresholds below ARE
 * the engine contract (docs/matching-engine.md): any change to weights,
 * gradients, UNKNOWN policy, or exclusion rules bumps ENGINE_VERSION.
 */

export const PACKAGE = '@bidmorrow/matching';

/**
 * Monotonically increasing engine version string, stored with every match so
 * old and new scores stay comparable across recomputation.
 *
 * 1 → 2 (2026-08-23): the buyer component's `buyer-legal-type` code sets were
 * completed against OP-TED eForms-SDK 1.13.2. Eight codes the codelist
 * defines were missing and scored UNKNOWN; two codes that are not in the
 * codelist were being accepted. That changes the score of any lot whose buyer
 * carries one of them — 7 of the 25 TED fixtures in this repo — so it is a
 * version bump, not a silent fix: invariant 1 (same inputs + same engine
 * version ⇒ identical score) would otherwise be false across the change.
 */
export const ENGINE_VERSION = '2';

/** Maximum points per score component; values sum to exactly 100. */
export const COMPONENT_MAX = {
  cpv: 35,
  capability: 20,
  geography: 15,
  value: 10,
  buyer: 5,
  procedure: 5,
  deadline: 5,
  eligibility: 5,
} as const;

export type MatchComponentId = keyof typeof COMPONENT_MAX;

/**
 * Neutral fraction of a component's max applied when its input is UNKNOWN —
 * never silently 0, never max (docs/matching-engine.md, invariant 3).
 */
export const UNKNOWN_NEUTRAL = 0.5;

export type MatchClassification = 'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT';

/**
 * Classify a total score per docs/matching-engine.md:
 * 80–100 STRONG_MATCH · 65–79 WORTH_REVIEWING · 45–64 POSSIBLE_MATCH ·
 * 0–44 LOW_FIT. A score outside [0, 100] is an engine bug and throws.
 */
export function classify(score: number): MatchClassification {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError(`match score must be within [0, 100], got ${String(score)}`);
  }
  if (score >= 80) return 'STRONG_MATCH';
  if (score >= 65) return 'WORTH_REVIEWING';
  if (score >= 45) return 'POSSIBLE_MATCH';
  return 'LOW_FIT';
}

export { scoreLotForOrg } from './engine';
export { renderExplanation } from './explanation';
export { evaluateExclusions } from './exclusions';
export { detectRiskFlags } from './risk-flags';
export { scoreCpv } from './components/cpv';
export { scoreCapability, DEFAULT_MATCHABLE_LANGUAGES } from './components/capability';
export { scoreGeography } from './components/geography';
export { scoreValue } from './components/value';
export { scoreBuyer } from './components/buyer';
export { scoreProcedure } from './components/procedure';
export { scoreDeadline, DEFAULT_MINIMUM_DAYS_REMAINING } from './components/deadline';
export { scoreEligibility } from './components/eligibility';
export { neighborsOf, areNeighbors } from './eu-adjacency';
export type {
  ComponentResult,
  EngineInput,
  ExcludedResult,
  ExclusionRule,
  LanguageTextMap,
  LotCpv,
  LotInput,
  MatchResult,
  OrgCertification,
  OrgExclusions,
  OrgGeographyPreferences,
  OrgKeywords,
  OrgProfile,
  OrgValueRange,
  RiskConfidence,
  RiskFlag,
  RiskFlagType,
  ScoredResult,
  SynonymGroup,
} from './types';
