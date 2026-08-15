import { describe, expect, it } from 'vitest';

import { scoreCapability } from './capability';
import { baseLot, baseOrg } from '../test-helpers';

describe('scoreCapability', () => {
  it('no matchable-language text -> UNKNOWN 10, carries source-language indicator', () => {
    const lot = baseLot({
      titleByLang: { fra: 'Titre' },
      descriptionByLang: {},
      languages: ['fra'],
    });
    const result = scoreCapability(lot, baseOrg());
    expect(result.component.points).toBe(10);
    expect(result.component.status).toBe('UNKNOWN');
    expect(result.sourceLanguageIndicator).toContain('fra');
    expect(result.sourceLanguageIndicator).toContain('keyword matching limited');
  });

  it('no configured terms -> NO_MATCH 0', () => {
    const lot = baseLot({ titleByLang: { eng: 'Cloud security audit' }, languages: ['eng'] });
    const result = scoreCapability(lot, baseOrg());
    expect(result.component.points).toBe(0);
    expect(result.component.status).toBe('NO_MATCH');
  });

  it('phrase hit scores 4', () => {
    const lot = baseLot({
      titleByLang: { eng: 'Penetration testing services' },
      languages: ['eng'],
    });
    const org = baseOrg({
      keywords: { positiveTerms: ['penetration testing'], synonymGroups: [] },
    });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(4);
  });

  it('word hit scores 2', () => {
    const lot = baseLot({ titleByLang: { eng: 'Annual audit of IT systems' }, languages: ['eng'] });
    const org = baseOrg({ keywords: { positiveTerms: ['audit'], synonymGroups: [] } });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(2);
  });

  it('synonym group hit counts once per group even with multiple term matches', () => {
    const lot = baseLot({
      titleByLang: { eng: 'SOC 2 and SOC2 compliance review' },
      languages: ['eng'],
    });
    const org = baseOrg({
      keywords: {
        positiveTerms: [],
        synonymGroups: [{ label: 'SOC', terms: ['SOC 2', 'SOC2'] }],
      },
    });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(3);
  });

  it('is case-insensitive and diacritic-folded', () => {
    const lot = baseLot({ titleByLang: { eng: 'Sécurité review' }, languages: ['eng'] });
    const org = baseOrg({ keywords: { positiveTerms: ['securite'], synonymGroups: [] } });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(2);
  });

  it('does not match partial words', () => {
    const lot = baseLot({ titleByLang: { eng: 'Auditorium construction' }, languages: ['eng'] });
    const org = baseOrg({ keywords: { positiveTerms: ['audit'], synonymGroups: [] } });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(0);
  });

  it('capped at 20', () => {
    const lot = baseLot({
      titleByLang: {
        eng: 'penetration testing security assessment vulnerability scanning incident response threat modeling risk assessment',
      },
      languages: ['eng'],
    });
    const org = baseOrg({
      keywords: {
        // 6 distinct phrase hits * 4 = 24 raw points, capped at 20.
        positiveTerms: [
          'penetration testing',
          'security assessment',
          'vulnerability scanning',
          'incident response',
          'threat modeling',
          'risk assessment',
        ],
        synonymGroups: [],
      },
    });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(20);
    expect(result.component.status).toBe('MATCHED');
  });

  it('MATCH-P6-02: an org with a German keyword matches German-language lot text', () => {
    const lot = baseLot({
      titleByLang: { deu: 'Sicherheitsüberprüfung und Penetrationstest' },
      languages: ['deu'],
    });
    const org = baseOrg({
      keywords: { positiveTerms: ['penetrationstest'], synonymGroups: [] },
      matchableLanguages: ['deu'],
    });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(2);
    expect(result.component.status).toBe('PARTIAL');
  });

  it('MATCH-P6-02: an English-only org (no matchableLanguages configured) stays UNKNOWN against German-only lot text', () => {
    const lot = baseLot({
      titleByLang: { deu: 'Sicherheitsüberprüfung und Penetrationstest' },
      languages: ['deu'],
    });
    const org = baseOrg({
      keywords: { positiveTerms: ['penetrationstest'], synonymGroups: [] },
      matchableLanguages: [],
    });
    const result = scoreCapability(lot, org);
    expect(result.component.status).toBe('UNKNOWN');
    expect(result.component.points).toBe(10);
  });

  it('worked-example combination sums to 15', () => {
    const lot = baseLot({
      titleByLang: {
        eng: 'Penetration testing and security assessment services, SOC 2 compliant, audit and cloud focus',
      },
      languages: ['eng'],
    });
    const org = baseOrg({
      keywords: {
        positiveTerms: ['penetration testing', 'security assessment', 'audit', 'cloud'],
        synonymGroups: [{ label: 'SOC', terms: ['SOC 2', 'SOC2', 'security operations center'] }],
      },
    });
    const result = scoreCapability(lot, org);
    expect(result.component.points).toBe(15);
    expect(result.component.explanation).toBe(
      'Capabilities: phrases "penetration testing" (+4), "security assessment" (+4), synonym group "SOC" (+3), words "audit" (+2), "cloud" (+2)',
    );
  });
});
