import { describe, expect, it } from 'vitest';

import { detectRiskFlags } from './risk-flags';
import { baseLot } from './test-helpers';

describe('detectRiskFlags', () => {
  it('no matches -> empty array', () => {
    expect(detectRiskFlags(baseLot({ titleByLang: { eng: 'Office supplies' } }))).toEqual([]);
  });

  it('certification: POSSIBLE without a requirement verb nearby', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'The supplier is currently certified to ISO 27001.' } }),
    );
    const cert = flags.find((f) => f.type === 'certification');
    expect(cert?.confidence).toBe('POSSIBLE');
    expect(cert?.explanation).toBe('Possible requirement detected — verify in source documents.');
    expect(cert?.evidence).toContain('ISO 27001');
    expect(cert?.sourceField).toBe('lot.descriptionByLang.eng');
  });

  it('certification: HIGH when a requirement verb is nearby', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'Bidders must hold ISO 27001 certification.' } }),
    );
    const cert = flags.find((f) => f.type === 'certification');
    expect(cert?.confidence).toBe('HIGH');
  });

  it('security_clearance', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'Staff must undergo security clearance vetting.' } }),
    );
    expect(flags.some((f) => f.type === 'security_clearance')).toBe(true);
  });

  it('insurance', () => {
    const flags = detectRiskFlags(
      baseLot({
        descriptionByLang: { eng: 'Contractor must carry professional indemnity insurance.' },
      }),
    );
    expect(flags.some((f) => f.type === 'insurance')).toBe(true);
  });

  it('financial_turnover: currency amount near turnover', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'Minimum annual turnover of €2,000,000 is required.' } }),
    );
    expect(flags.some((f) => f.type === 'financial_turnover' && f.confidence === 'HIGH')).toBe(
      true,
    );
  });

  it('prior_experience', () => {
    const flags = detectRiskFlags(
      baseLot({
        descriptionByLang: {
          eng: 'Bidders should demonstrate prior experience in cloud migration.',
        },
      }),
    );
    expect(flags.some((f) => f.type === 'prior_experience')).toBe(true);
  });

  it('framework_membership', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'This is a call-off under a framework agreement.' } }),
    );
    expect(flags.some((f) => f.type === 'framework_membership')).toBe(true);
  });

  it('local_presence', () => {
    const flags = detectRiskFlags(
      baseLot({
        descriptionByLang: { eng: 'Supplier must maintain a local office in the region.' },
      }),
    );
    expect(flags.some((f) => f.type === 'local_presence' && f.confidence === 'HIGH')).toBe(true);
  });

  it('mandatory_references', () => {
    const flags = detectRiskFlags(
      baseLot({ descriptionByLang: { eng: 'Provide client references from similar projects.' } }),
    );
    expect(flags.some((f) => f.type === 'mandatory_references')).toBe(true);
  });

  it('evidence is capped at 200 chars', () => {
    const long = `must hold ISO 27001 certification. ${'x'.repeat(500)}`;
    const flags = detectRiskFlags(baseLot({ descriptionByLang: { eng: long } }));
    const cert = flags.find((f) => f.type === 'certification');
    expect(cert).toBeDefined();
    expect(cert?.evidence.length).toBeLessThanOrEqual(200);
  });

  it('at most one flag per type per field (HIGH wins over POSSIBLE)', () => {
    const flags = detectRiskFlags(
      baseLot({
        descriptionByLang: {
          eng: 'Bidders must hold ISO 27001 certification. Also generally certified to ISO 9001.',
        },
      }),
    );
    const certFlags = flags.filter((f) => f.type === 'certification');
    expect(certFlags).toHaveLength(1);
    expect(certFlags[0]?.confidence).toBe('HIGH');
  });

  it('is deterministic across repeated calls', () => {
    const lot = baseLot({
      descriptionByLang: {
        eng: 'Bidders must hold ISO 27001 certification and provide references.',
      },
    });
    expect(detectRiskFlags(lot)).toEqual(detectRiskFlags(lot));
  });

  it('adversarial input: very long text scans within a bounded time and does not throw', () => {
    const hostile = `${'a '.repeat(50_000)}must hold ISO 27001 certification ${'b'.repeat(200_000)}`;
    const start = Date.now();
    const flags = detectRiskFlags(baseLot({ descriptionByLang: { eng: hostile } }));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(Array.isArray(flags)).toBe(true);
  });

  it('regex-hostile repeated-boundary input does not hang', () => {
    const hostile = `${'must '.repeat(20_000)}iso 27001`;
    const start = Date.now();
    detectRiskFlags(baseLot({ descriptionByLang: { eng: hostile } }));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
