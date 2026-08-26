import { describe, expect, it } from 'vitest';
import { parseFactValue } from './home-facts';

describe('parseFactValue', () => {
  it('splits a dash range, preserving the en dash in the prefix', () => {
    expect(parseFactValue('0–100')).toEqual({ prefix: '0–', target: 100, suffix: '' });
  });

  it('splits a leading number with a trailing word', () => {
    expect(parseFactValue('5 rules')).toEqual({ prefix: '', target: 5, suffix: ' rules' });
    expect(parseFactValue('3 tiers')).toEqual({ prefix: '', target: 3, suffix: ' tiers' });
    expect(parseFactValue('1 email')).toEqual({ prefix: '', target: 1, suffix: ' email' });
  });

  it('reconstructs the exact original string from its parts', () => {
    for (const value of ['0–100', '5 rules', '3 tiers', '1 email']) {
      const parsed = parseFactValue(value);
      expect(parsed).not.toBeNull();
      expect(`${parsed!.prefix}${parsed!.target}${parsed!.suffix}`).toBe(value);
    }
  });

  it('returns null for a value with no digits', () => {
    expect(parseFactValue('no score')).toBeNull();
  });
});
