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
 */
export const ENGINE_VERSION = '1';

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
