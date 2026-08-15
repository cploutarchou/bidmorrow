import { describe, expect, it } from 'vitest';

import { scoreCpv } from './cpv';
import { baseOrg } from '../test-helpers';

describe('scoreCpv', () => {
  it('exact match scores 35 MATCHED', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    const result = scoreCpv({ main: '72150000', additional: [] }, org);
    expect(result.points).toBe(35);
    expect(result.status).toBe('MATCHED');
    expect(result.maxPoints).toBe(35);
  });

  it('same category (5 digits) scores 31', () => {
    const org = baseOrg({ cpvPreferences: ['72151000'] });
    const result = scoreCpv({ main: '72151234', additional: [] }, org);
    expect(result.points).toBe(31);
  });

  it('same class (4 digits) scores 27', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    const result = scoreCpv({ main: '72155000', additional: [] }, org);
    expect(result.points).toBe(27);
    expect(result.explanation).toContain('72155000');
    expect(result.explanation).toContain('72150000');
    expect(result.explanation).toContain('same class');
  });

  it('same group (3 digits) scores 21', () => {
    const org = baseOrg({ cpvPreferences: ['72100000'] });
    const result = scoreCpv({ main: '72199000', additional: [] }, org);
    expect(result.points).toBe(21);
  });

  it('same division (2 digits) scores 12', () => {
    const org = baseOrg({ cpvPreferences: ['72000000'] });
    const result = scoreCpv({ main: '72300000', additional: [] }, org);
    expect(result.points).toBe(12);
  });

  it('no relationship scores 0 NO_MATCH', () => {
    const org = baseOrg({ cpvPreferences: ['30000000'] });
    const result = scoreCpv({ main: '72000000', additional: [] }, org);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('no configured CPV preferences scores 0 NO_MATCH', () => {
    const org = baseOrg({ cpvPreferences: [] });
    const result = scoreCpv({ main: '72000000', additional: [] }, org);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('additional CPV scored at 85% of table value, rounded half up', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    // additional exact match (35) * 0.85 = 29.75 -> round half up -> 30
    const result = scoreCpv({ main: '30000000', additional: ['72150000'] }, org);
    expect(result.points).toBe(30);
  });

  it('additional CPV class match: 27 * 0.85 = 22.95 -> 23', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    const result = scoreCpv({ main: '30000000', additional: ['72155000'] }, org);
    expect(result.points).toBe(23);
  });

  it('main vs additional: takes the max across both', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    // main scores 12 (division), additional scores 30 (85% of exact) -> max 30
    const result = scoreCpv({ main: '73000000', additional: ['72150000'] }, org);
    expect(result.points).toBe(30);
  });

  it('+2 bonus when >=2 distinct org preferences match at class level or better, capped at 35', () => {
    const org = baseOrg({ cpvPreferences: ['72150000', '72155100'] });
    // main exact-matches 72150000 (35); additional 72155200 matches class of 72155100 (27, reduced to 23)
    const result = scoreCpv({ main: '72150000', additional: ['72155200'] }, org);
    expect(result.points).toBe(35); // 35 + 2 capped at 35
    expect(result.explanation).toContain('multiple independent matches');
  });

  it('bonus does not apply with only 1 qualifying preference', () => {
    const org = baseOrg({ cpvPreferences: ['72150000'] });
    const result = scoreCpv({ main: '72150000', additional: [] }, org);
    expect(result.points).toBe(35);
    expect(result.explanation).not.toContain('multiple independent matches');
  });

  it('bonus lifts a sub-max score without exceeding the component max', () => {
    const org = baseOrg({ cpvPreferences: ['72150000', '73000000'] });
    // main matches division of both prefs at 12 pts each (>= class? no, division is below class,
    // so this should NOT qualify for bonus) -- use class-level matches instead.
    const orgClassLevel = baseOrg({ cpvPreferences: ['72150000', '72151000'] });
    const result = scoreCpv({ main: '72155000', additional: [] }, orgClassLevel);
    // main matches class of 72150000 (27) and class of 72151000 (27) -> best 27, bonus +2 -> 29
    expect(result.points).toBe(29);
    void org;
  });
});
