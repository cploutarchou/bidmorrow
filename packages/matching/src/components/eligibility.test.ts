import { describe, expect, it } from 'vitest';

import { scoreEligibility } from './eligibility';
import type { RiskFlag } from '../types';

function certFlag(overrides: Partial<RiskFlag> = {}): RiskFlag {
  return {
    type: 'certification',
    evidence: 'certified to ISO 27001',
    sourceField: 'lot.descriptionByLang.eng',
    confidence: 'HIGH',
    explanation: 'Requirement detected in source text.',
    ...overrides,
  };
}

describe('scoreEligibility', () => {
  it('no signals -> UNKNOWN 2.5', () => {
    const result = scoreEligibility([], []);
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it('only POSSIBLE-confidence signals -> still UNKNOWN (not a confirmed requirement)', () => {
    const result = scoreEligibility([certFlag({ confidence: 'POSSIBLE' })], []);
    expect(result.status).toBe('UNKNOWN');
    expect(result.points).toBe(2.5);
  });

  it('HIGH signal satisfied by declared certification -> 5', () => {
    const result = scoreEligibility([certFlag()], [{ code: 'ISO_27001' }]);
    expect(result.points).toBe(5);
    expect(result.status).toBe('MATCHED');
  });

  it('HIGH signal not satisfied -> 0, never fabricates ineligibility beyond points', () => {
    const result = scoreEligibility([certFlag()], [{ code: 'SOC2' }]);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('HIGH signal not satisfied when org has no certifications -> 0', () => {
    const result = scoreEligibility([certFlag()], []);
    expect(result.points).toBe(0);
  });
});
