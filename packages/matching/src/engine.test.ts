import { describe, expect, it } from 'vitest';

import { COMPONENT_MAX } from './index';
import { scoreLotForOrg } from './engine';
import { baseInput, baseLot, baseOrg, T0 } from './test-helpers';
import type { EngineInput } from './types';

const DAY = 86_400_000;

/** The docs/matching-engine.md worked example, constructed to score exactly 84.5. */
function workedExampleInput(): EngineInput {
  return {
    scoringTime: T0,
    org: baseOrg({
      cpvPreferences: ['72150000'],
      keywords: {
        positiveTerms: ['penetration testing', 'security assessment', 'audit', 'cloud'],
        synonymGroups: [{ label: 'SOC', terms: ['SOC 2', 'SOC2', 'security operations center'] }],
      },
      capabilities: [],
      certifications: [],
      geographies: { preferredNuts: ['CY'], opportunityCountries: [], countriesServed: [] },
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
      valueRange: { minEur: 50_000, maxEur: 500_000 },
      minimumDaysRemaining: 10,
      supportedContractNatures: ['services'],
    }),
    lot: baseLot({
      cpv: { main: '72155000', additional: [] },
      titleByLang: {
        eng: 'Penetration testing and security assessment services, SOC 2 compliant, audit and cloud focus',
      },
      descriptionByLang: {
        eng: 'The buyer notes the current supplier is certified to ISO 27001.',
      },
      countries: ['CY'],
      nuts: ['CY00'],
      valueEur: 180_000,
      valueIsDerived: false,
      deadlineAt: T0 + 34 * DAY,
      buyerLegalType: 'cga',
      procedureType: 'open',
      contractNature: 'services',
      languages: ['eng'],
    }),
  };
}

describe('scoreLotForOrg — worked example (docs/matching-engine.md)', () => {
  it('scores exactly 84.5 / STRONG_MATCH with the documented component breakdown', () => {
    const result = scoreLotForOrg(workedExampleInput());
    if (result.kind !== 'scored') {
      throw new Error('expected a scored result');
    }
    expect(result.score).toBe(84.5);
    expect(result.classification).toBe('STRONG_MATCH');

    const byKey = Object.fromEntries(result.components.map((c) => [c.key, c]));
    expect(byKey.cpv?.points).toBe(27);
    expect(byKey.capability?.points).toBe(15);
    expect(byKey.geography?.points).toBe(15);
    expect(byKey.value?.points).toBe(10);
    expect(byKey.buyer?.points).toBe(5);
    expect(byKey.procedure?.points).toBe(5);
    expect(byKey.deadline?.points).toBe(5);
    expect(byKey.eligibility?.points).toBe(2.5);
    expect(byKey.eligibility?.status).toBe('UNKNOWN');

    const sum = result.components.reduce((acc, c) => acc + c.points, 0);
    expect(sum).toBe(84.5);

    expect(
      result.riskFlags.some((f) => f.type === 'certification' && f.confidence === 'POSSIBLE'),
    ).toBe(true);
  });
});

describe('scoreLotForOrg — exclusions short-circuit scoring', () => {
  it('returns an excluded result with no score when a hard rule fires', () => {
    const input = workedExampleInput();
    const excludedInput: EngineInput = {
      ...input,
      org: { ...input.org, exclusions: { ...input.org.exclusions, countries: ['CY'] } },
    };
    const result = scoreLotForOrg(excludedInput);
    expect(result.kind).toBe('excluded');
    if (result.kind === 'excluded') {
      expect(result.rule).toBe('excluded_geography');
    }
  });
});

describe('scoreLotForOrg — invariants', () => {
  it('is deterministic: same input scored twice yields identical output', () => {
    const input = workedExampleInput();
    expect(scoreLotForOrg(input)).toEqual(scoreLotForOrg(input));
  });

  it('every component key from COMPONENT_MAX is present exactly once', () => {
    const result = scoreLotForOrg(baseInput());
    if (result.kind !== 'scored') {
      throw new Error('expected scored');
    }
    const keys = result.components.map((c) => c.key).sort();
    expect(keys).toEqual(Object.keys(COMPONENT_MAX).sort());
  });

  it('an all-UNKNOWN input scores the sum of neutral halves and never throws', () => {
    const result = scoreLotForOrg(baseInput());
    if (result.kind !== 'scored') {
      throw new Error('expected scored');
    }
    // capability(10) + geography(7.5) + value(5) + buyer(2.5) + procedure(2.5)
    // + deadline(2.5) + eligibility(2.5) + cpv(0, no prefs configured) = 32.5
    expect(result.score).toBe(32.5);
    expect(result.classification).toBe('LOW_FIT');
  });
});

describe('scoreLotForOrg — component-sum property across varied inputs', () => {
  const cpvOptions = ['72150000', '72155000', '30000000', '45000000'];
  const valueOptions = [null, 10_000, 100_000, 300_000, 1_000_000];
  const deadlineOffsets = [null, 1, 5, 10, 15, 20, 40];
  const buyerOptions = [null, 'cga', 'pub-undert', 'xx-unknown'];
  const natureOptions: EngineInput['lot']['contractNature'][] = [
    null,
    'services',
    'works',
    'supplies',
  ];

  it('components always sum exactly to the total score, across a grid of varied inputs', () => {
    let cases = 0;
    for (const cpv of cpvOptions) {
      for (const value of valueOptions) {
        for (const deadlineDays of deadlineOffsets) {
          for (const buyer of buyerOptions) {
            for (const nature of natureOptions) {
              cases += 1;
              const input: EngineInput = {
                scoringTime: T0,
                org: baseOrg({
                  cpvPreferences: ['72150000'],
                  valueRange: { minEur: 50_000, maxEur: 500_000 },
                  minimumDaysRemaining: 10,
                  supportedContractNatures: ['services'],
                }),
                lot: baseLot({
                  cpv: { main: cpv, additional: [] },
                  valueEur: value,
                  deadlineAt: deadlineDays === null ? null : T0 + deadlineDays * DAY,
                  buyerLegalType: buyer,
                  contractNature: nature,
                }),
              };
              const result = scoreLotForOrg(input);
              if (result.kind === 'excluded') {
                continue; // deadline_below_threshold cases; scoring invariant not applicable
              }
              const sum = result.components.reduce((acc, c) => acc + c.points, 0);
              expect(sum).toBeCloseTo(result.score, 10);
              expect(result.score).toBeGreaterThanOrEqual(0);
              expect(result.score).toBeLessThanOrEqual(100);
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(50);
  });
});

describe('scoreLotForOrg — classification is wired from the total score', () => {
  it('a near-maximal input classifies STRONG_MATCH (>= 80)', () => {
    const result = scoreLotForOrg(workedExampleInput());
    if (result.kind !== 'scored') {
      throw new Error('expected scored');
    }
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.classification).toBe('STRONG_MATCH');
  });

  it('an all-UNKNOWN input classifies LOW_FIT (< 45)', () => {
    const result = scoreLotForOrg(baseInput());
    if (result.kind !== 'scored') {
      throw new Error('expected scored');
    }
    expect(result.score).toBeLessThan(45);
    expect(result.classification).toBe('LOW_FIT');
  });
});
