import { COMPANY_PRESETS } from '@bidmorrow/domain';
import { describe, expect, it } from 'vitest';
import { CPV_SUGGESTIONS } from './cpv-suggestions';

/**
 * CPV codes referenced by scripts/seed-demo.sql (company_cpv_preferences and
 * tender_cpv_codes inserts). Kept as a literal here because the SQL file is
 * not importable; update alongside the seed script.
 */
const SEED_DEMO_CPV_CODES = ['72150000', '72200000', '79417000', '48000000'] as const;

describe('CPV_SUGGESTIONS', () => {
  const codes = CPV_SUGGESTIONS.map((entry) => entry.code);
  const codeSet = new Set(codes);

  it('contains every CPV code used by the onboarding presets', () => {
    for (const preset of COMPANY_PRESETS) {
      for (const cpvCode of preset.cpvCodes) {
        expect(codeSet, `preset ${preset.key} code ${cpvCode}`).toContain(cpvCode);
      }
    }
  });

  it('contains every CPV code used by the demo seed data', () => {
    for (const cpvCode of SEED_DEMO_CPV_CODES) {
      expect(codeSet).toContain(cpvCode);
    }
  });

  it('has unique codes', () => {
    expect(codeSet.size).toBe(codes.length);
  });

  it('stores codes as 8-digit strings without the check-digit suffix', () => {
    for (const code of codes) {
      expect(code).toMatch(/^\d{8}$/);
    }
  });

  it('has a non-empty label for every entry', () => {
    for (const entry of CPV_SUGGESTIONS) {
      expect(entry.label.trim().length, `label for ${entry.code}`).toBeGreaterThan(0);
    }
  });

  it('covers the documented curated scope, not the full CPV vocabulary', () => {
    // ~120-250 curated entries (see the dataset doc comment), never the
    // full 9,454-code CPV vocabulary.
    expect(CPV_SUGGESTIONS.length).toBeGreaterThanOrEqual(120);
    expect(CPV_SUGGESTIONS.length).toBeLessThanOrEqual(250);
  });
});
