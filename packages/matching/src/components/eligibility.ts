/**
 * Eligibility/cert signals (5 pts). docs/matching-engine.md
 * §Eligibility/cert signals.
 *
 * Interpretation decision: only HIGH-confidence `certification` risk flags
 * count as a "signal found" for this component. POSSIBLE-confidence
 * certification mentions are real, useful information (surfaced separately
 * as risk flags for the user to verify) but are, by definition, not
 * confident enough to assert "a certification is required" for scoring —
 * treating them as a found signal would contradict the "never assert a
 * requirement without evidence" invariant when the evidence itself is
 * marked uncertain. So POSSIBLE-only findings fall through to the
 * "no signals detected" UNKNOWN branch.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import type { ComponentResult, OrgCertification, RiskFlag } from '../types';

const CERT_CODE_PATTERN: Record<string, RegExp> = {
  ISO_27001: /iso\s?\/?\s?iec\s?27001|iso\s?27001/i,
  ISO_9001: /iso\s?9001/i,
  SOC2: /soc\s?2/i,
};

function orgHoldsMatchingCert(
  evidence: string,
  certifications: readonly OrgCertification[],
): boolean {
  for (const cert of certifications) {
    if (cert.code === 'OTHER') {
      continue;
    }
    const pattern = CERT_CODE_PATTERN[cert.code];
    if (pattern !== undefined && pattern.test(evidence)) {
      return true;
    }
  }
  return false;
}

export function scoreEligibility(
  riskFlags: readonly RiskFlag[],
  certifications: readonly OrgCertification[],
): ComponentResult {
  const maxPoints = COMPONENT_MAX.eligibility;

  const highConfidenceCertFlags = riskFlags.filter(
    (f) => f.type === 'certification' && f.confidence === 'HIGH',
  );

  if (highConfidenceCertFlags.length === 0) {
    return {
      key: 'eligibility',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: 'Eligibility: no signals detected. UNKNOWN, neutral half of 5',
    };
  }

  const satisfied = highConfidenceCertFlags.some((f) =>
    orgHoldsMatchingCert(f.evidence, certifications),
  );
  if (satisfied) {
    return {
      key: 'eligibility',
      points: 5,
      maxPoints,
      status: 'MATCHED',
      explanation:
        'Eligibility: certification signal detected and satisfied by your declared certifications.',
    };
  }

  return {
    key: 'eligibility',
    points: 0,
    maxPoints,
    status: 'NO_MATCH',
    explanation:
      'Eligibility: certification signal detected but not satisfied by your declared certifications.',
  };
}
