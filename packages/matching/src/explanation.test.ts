import { describe, expect, it } from 'vitest';

import { renderExplanation } from './explanation';
import { scoreLotForOrg } from './engine';
import { baseLot, baseOrg, T0 } from './test-helpers';
import type { EngineInput } from './types';

const DAY = 86_400_000;

describe('renderExplanation', () => {
  it('renders an excluded result', () => {
    const input: EngineInput = {
      scoringTime: T0,
      org: baseOrg({
        exclusions: {
          cpvFamilies: [],
          countries: ['RU'],
          nutsPrefixes: [],
          phrases: [],
          contractNatures: [],
        },
      }),
      lot: baseLot({ countries: ['RU'] }),
    };
    const result = scoreLotForOrg(input);
    const text = renderExplanation(result);
    expect(text).toContain('EXCLUDED');
    expect(text).toContain('excluded_geography');
    expect(text).toContain('RU');
  });

  it('renders the worked example with a score line, component lines, and a risk-flag line', () => {
    const input: EngineInput = {
      scoringTime: T0,
      org: baseOrg({
        cpvPreferences: ['72150000'],
        keywords: {
          positiveTerms: ['penetration testing', 'security assessment', 'audit', 'cloud'],
          synonymGroups: [{ label: 'SOC', terms: ['SOC 2', 'SOC2'] }],
        },
        geographies: { preferredNuts: ['CY'], opportunityCountries: [], countriesServed: [] },
        valueRange: { minEur: 50_000, maxEur: 500_000 },
        minimumDaysRemaining: 10,
        supportedContractNatures: ['services'],
      }),
      lot: baseLot({
        cpv: { main: '72155000', additional: [] },
        titleByLang: {
          eng: 'Penetration testing and security assessment services, SOC 2, audit and cloud',
        },
        descriptionByLang: { eng: 'The supplier is currently certified to ISO 27001.' },
        countries: ['CY'],
        nuts: ['CY00'],
        valueEur: 180_000,
        deadlineAt: T0 + 34 * DAY,
        buyerLegalType: 'cga',
        procedureType: 'open',
        contractNature: 'services',
        languages: ['eng'],
      }),
    };
    const result = scoreLotForOrg(input);
    const text = renderExplanation(result);

    expect(text).toContain('84.5 / 100 — STRONG_MATCH');
    expect(text).toContain('engine v1');
    expect(text).toContain('+27');
    expect(text).toContain('CPV: lot 72155000 vs your preference 72150000 — same class (7215)');
    expect(text).toContain('+15  Geography: lot NUTS CY00 within your preferred region CY');
    expect(text).toContain('+10  Value: €180,000 within your €50,000–€500,000 range');
    expect(text).toContain('Risk flags:');
    expect(text).toContain('ISO 27001');
    expect(text).toContain('(POSSIBLE)');
    expect(text).toContain('verify in source documents');
  });
});
