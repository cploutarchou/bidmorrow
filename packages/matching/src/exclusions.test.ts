import { describe, expect, it } from 'vitest';

import { evaluateExclusions } from './exclusions';
import { baseLot, baseOrg, T0 } from './test-helpers';

const DAY = 86_400_000;

describe('evaluateExclusions', () => {
  it('no rule fires on a clean lot -> null', () => {
    expect(evaluateExclusions(baseLot(), baseOrg(), T0)).toBeNull();
  });

  it('excluded country', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: ['RU'],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(baseLot({ countries: ['RU'] }), org, T0);
    expect(result).toEqual({ kind: 'excluded', rule: 'excluded_geography', evidence: 'RU' });
  });

  it('excluded NUTS prefix', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: ['DE9'],
        phrases: [],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(baseLot({ nuts: ['DE913'] }), org, T0);
    expect(result?.rule).toBe('excluded_geography');
  });

  it('unknown geography never excludes', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: ['RU'],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
    });
    expect(evaluateExclusions(baseLot({ countries: [] }), org, T0)).toBeNull();
  });

  it('excluded CPV family prefix (main)', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: ['79'],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(
      baseLot({ cpv: { main: '79000000', additional: [] } }),
      org,
      T0,
    );
    expect(result).toEqual({ kind: 'excluded', rule: 'excluded_cpv', evidence: '79000000' });
  });

  it('excluded CPV family prefix (additional)', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: ['79'],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(
      baseLot({ cpv: { main: '72000000', additional: ['79100000'] } }),
      org,
      T0,
    );
    expect(result?.rule).toBe('excluded_cpv');
  });

  it('excluded phrase in matchable text', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: ['on-site only'],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(
      baseLot({
        titleByLang: { eng: 'Requires staff on-site only for the duration' },
        languages: ['eng'],
      }),
      org,
      T0,
    );
    expect(result).toEqual({ kind: 'excluded', rule: 'excluded_phrase', evidence: 'on-site only' });
  });

  it('excluded phrase absent from non-matchable-language-only text never excludes', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: ['on-site only'],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(
      baseLot({ titleByLang: { fra: 'Sur site uniquement' }, languages: ['fra'] }),
      org,
      T0,
    );
    expect(result).toBeNull();
  });

  it('unsupported contract nature', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: ['works'],
      },
    });
    const result = evaluateExclusions(baseLot({ contractNature: 'works' }), org, T0);
    expect(result).toEqual({ kind: 'excluded', rule: 'unsupported_nature', evidence: 'works' });
  });

  it('unsupported nature: null contract nature never excludes', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: [],
        countries: [],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: ['works'],
      },
    });
    expect(evaluateExclusions(baseLot({ contractNature: null }), org, T0)).toBeNull();
  });

  it('deadline below threshold (both known)', () => {
    const org = baseOrg({ minimumDaysRemaining: 10 });
    const result = evaluateExclusions(baseLot({ deadlineAt: T0 + 3 * DAY }), org, T0);
    expect(result?.rule).toBe('deadline_below_threshold');
  });

  it('deadline below threshold: unset threshold never excludes', () => {
    const org = baseOrg();
    const result = evaluateExclusions(baseLot({ deadlineAt: T0 + 1 * DAY }), org, T0);
    expect(result).toBeNull();
  });

  it('deadline below threshold: no deadline never excludes', () => {
    const org = baseOrg({ minimumDaysRemaining: 10 });
    const result = evaluateExclusions(baseLot({ deadlineAt: null }), org, T0);
    expect(result).toBeNull();
  });

  it('rule precedence: geography checked before CPV', () => {
    const org = baseOrg({
      exclusions: {
        cpvFamilies: ['79'],
        countries: ['RU'],
        nutsPrefixes: [],
        phrases: [],
        contractNatures: [],
      },
    });
    const result = evaluateExclusions(
      baseLot({ countries: ['RU'], cpv: { main: '79000000', additional: [] } }),
      org,
      T0,
    );
    expect(result?.rule).toBe('excluded_geography');
  });
});
