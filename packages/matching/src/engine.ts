/**
 * Engine entry point: `scoreLotForOrg`. Pure, deterministic — no I/O, no
 * clock, no randomness. docs/matching-engine.md is the contract.
 */
import { classify, COMPONENT_MAX } from './index';
import { scoreBuyer } from './components/buyer';
import { scoreCapability } from './components/capability';
import { scoreCpv } from './components/cpv';
import { scoreDeadline } from './components/deadline';
import { scoreEligibility } from './components/eligibility';
import { scoreGeography } from './components/geography';
import { scoreProcedure } from './components/procedure';
import { scoreValue } from './components/value';
import { evaluateExclusions } from './exclusions';
import { detectRiskFlags } from './risk-flags';
import type { ComponentResult, EngineInput, MatchResult } from './types';

/** Round to the nearest half-point — the finest granularity any component produces. */
function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function scoreLotForOrg(input: EngineInput): MatchResult {
  const { org, lot, scoringTime } = input;

  const excluded = evaluateExclusions(lot, org, scoringTime);
  if (excluded !== null) {
    return excluded;
  }

  const riskFlags = detectRiskFlags(lot);

  const cpvResult = scoreCpv(lot.cpv, org);
  const capabilityScore = scoreCapability(lot, org);
  const geographyResult = scoreGeography(lot, org);
  const valueResult = scoreValue(lot, org);
  const buyerResult = scoreBuyer(lot.buyerLegalType);
  const procedureResult = scoreProcedure(lot.contractNature, lot.procedureType, org);
  const deadlineResult = scoreDeadline(lot.deadlineAt, scoringTime, org.minimumDaysRemaining);
  const eligibilityResult = scoreEligibility(riskFlags, org.certifications);

  const components: readonly ComponentResult[] = [
    cpvResult,
    capabilityScore.component,
    geographyResult,
    valueResult,
    buyerResult,
    procedureResult,
    deadlineResult,
    eligibilityResult,
  ];

  // Invariant: components sum EXACTLY to the score, and every component's
  // max matches the engine-wide contract (COMPONENT_MAX).
  for (const component of components) {
    const expectedMax = COMPONENT_MAX[component.key];
    if (component.maxPoints !== expectedMax) {
      throw new Error(
        `engine bug: component "${component.key}" maxPoints ${String(component.maxPoints)} != COMPONENT_MAX ${String(expectedMax)}`,
      );
    }
    if (component.points < 0 || component.points > component.maxPoints) {
      throw new Error(
        `engine bug: component "${component.key}" points ${String(component.points)} outside [0, ${String(component.maxPoints)}]`,
      );
    }
  }

  const rawScore = components.reduce((sum, c) => sum + c.points, 0);
  const score = roundToHalf(rawScore);
  if (score < 0 || score > 100) {
    throw new Error(`engine bug: total score ${String(score)} outside [0, 100]`);
  }

  return {
    kind: 'scored',
    score,
    classification: classify(score),
    components,
    riskFlags,
    ...(capabilityScore.sourceLanguageIndicator !== undefined
      ? { sourceLanguageIndicator: capabilityScore.sourceLanguageIndicator }
      : {}),
  };
}
