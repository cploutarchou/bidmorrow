import { describe, expect, it } from 'vitest';

import { scoreProcedure } from './procedure';
import { baseOrg } from '../test-helpers';

describe('scoreProcedure', () => {
  it('both null -> UNKNOWN 2.5', () => {
    const result = scoreProcedure(null, null, baseOrg());
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it('supported nature + open procedure -> 5', () => {
    const org = baseOrg({ supportedContractNatures: ['services'] });
    const result = scoreProcedure('services', 'open', org);
    expect(result.points).toBe(5);
    expect(result.status).toBe('MATCHED');
  });

  it('supported nature + restricted procedure -> 5', () => {
    const org = baseOrg({ supportedContractNatures: ['services'] });
    const result = scoreProcedure('services', 'restricted', org);
    expect(result.points).toBe(5);
  });

  it('supported nature only (negotiated procedure) -> 3', () => {
    const org = baseOrg({ supportedContractNatures: ['services'] });
    const result = scoreProcedure('services', 'negotiated-without-publication', org);
    expect(result.points).toBe(3);
    expect(result.status).toBe('PARTIAL');
  });

  it('unsupported nature + open procedure -> 2', () => {
    const org = baseOrg({ supportedContractNatures: ['works'] });
    const result = scoreProcedure('services', 'open', org);
    expect(result.points).toBe(2);
    expect(result.status).toBe('PARTIAL');
  });

  it('unsupported nature + non-open procedure -> 0', () => {
    const org = baseOrg({ supportedContractNatures: ['works'] });
    const result = scoreProcedure('services', 'negotiated-without-publication', org);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('one field known, one absent, still resolves numerically (not UNKNOWN)', () => {
    const org = baseOrg({ supportedContractNatures: ['services'] });
    const result = scoreProcedure('services', null, org);
    expect(result.points).toBe(3);
    expect(result.status).toBe('PARTIAL');
  });
});
