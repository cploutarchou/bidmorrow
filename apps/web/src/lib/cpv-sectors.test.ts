/**
 * The sector list is the first thing a non-IT company sees, and the
 * in-scope/out-of-scope split it drives is the difference between an honest
 * onboarding and one that promises coverage the product does not have.
 */
import { describe, expect, it } from 'vitest';
import { CPV_SECTORS, findSector, hasOfficialCpvLabel } from './cpv-sectors';
import { isIngestedCpvCode } from './onboarding-scope';

const DEFAULT_FAMILIES = ['72', '48', '79417000'];

describe('CPV_SECTORS', () => {
  it('covers more than the IT sector — the reason this exists', () => {
    expect(CPV_SECTORS.length).toBeGreaterThanOrEqual(12);
    const divisions = new Set(CPV_SECTORS.flatMap((s) => s.codes.map((c) => c.code.slice(0, 2))));
    // If this ever collapses back to 72/48/79 the picker has silently
    // regressed to the IT-only wizard it replaced.
    expect(divisions.size).toBeGreaterThan(10);
  });

  it('every code is an 8-digit CPV code', () => {
    for (const sector of CPV_SECTORS) {
      for (const entry of sector.codes) {
        expect(entry.code, `${sector.id}/${entry.code}`).toMatch(/^\d{8}$/);
      }
    }
  });

  it('has no duplicate sector ids', () => {
    const ids = CPV_SECTORS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findSector returns null for an unknown or absent id', () => {
    expect(findSector(null)).toBeNull();
    expect(findSector('no-such-sector')).toBeNull();
    expect(findSector('tech')?.id).toBe('tech');
  });
});

describe('isIngestedCpvCode', () => {
  it('treats a short entry as a family prefix', () => {
    expect(isIngestedCpvCode('72150000', DEFAULT_FAMILIES)).toBe(true);
    expect(isIngestedCpvCode('48730000', DEFAULT_FAMILIES)).toBe(true);
  });

  it('treats a full 8-digit entry as an exact match, not a prefix', () => {
    expect(isIngestedCpvCode('79417000', DEFAULT_FAMILIES)).toBe(true);
    // The rest of division 79 is NOT ingested — the scope picks one code out
    // of it deliberately (docs/ted-ingestion-scope.md).
    expect(isIngestedCpvCode('79400000', DEFAULT_FAMILIES)).toBe(false);
    expect(isIngestedCpvCode('79710000', DEFAULT_FAMILIES)).toBe(false);
  });

  it('reports the sectors that genuinely return nothing today as out of scope', () => {
    for (const codeValue of ['45000000', '85100000', '55300000', '03000000']) {
      expect(isIngestedCpvCode(codeValue, DEFAULT_FAMILIES), codeValue).toBe(false);
    }
  });

  it('follows the live families it is given, so widening ingestion needs no frontend change', () => {
    expect(isIngestedCpvCode('45000000', DEFAULT_FAMILIES)).toBe(false);
    expect(isIngestedCpvCode('45000000', [...DEFAULT_FAMILIES, '45'])).toBe(true);
  });

  it('is false when the scope is empty rather than defaulting to permissive', () => {
    expect(isIngestedCpvCode('72150000', [])).toBe(false);
  });
});

describe('label provenance', () => {
  it('only claims official CPV wording for the divisions that actually have it', () => {
    expect(hasOfficialCpvLabel('72000000')).toBe(true);
    expect(hasOfficialCpvLabel('48000000')).toBe(true);
    expect(hasOfficialCpvLabel('79417000')).toBe(true);
    expect(hasOfficialCpvLabel('45000000')).toBe(false);
    expect(hasOfficialCpvLabel('15000000')).toBe(false);
  });
});
