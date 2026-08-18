import { describe, expect, it } from 'vitest';
import { validateCpvScope } from './admin-scope';

describe('validateCpvScope', () => {
  it('accepts a normal scope', () => {
    expect(validateCpvScope(['72', '48', '79417000'], ['DE', 'FR'])).toEqual({
      valid: true,
      error: null,
    });
  });

  it('rejects an empty family list', () => {
    const result = validateCpvScope([], []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('At least one');
  });

  it('rejects more than 20 families', () => {
    const families = Array.from({ length: 21 }, (_, i) => String(i + 10));
    const result = validateCpvScope(families, []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('bounded to 20');
  });

  it('rejects a too-short family code', () => {
    const result = validateCpvScope(['7'], []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('2-8 characters');
  });

  it('rejects a country code that is not 2 letters', () => {
    const result = validateCpvScope(['72'], ['DEU']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('2-letter country code');
  });
});
