import { describe, expect, it } from 'vitest';
import { validateBackfillRange } from './admin-date-range';

describe('validateBackfillRange', () => {
  it('accepts a single-day range', () => {
    const result = validateBackfillRange('2026-01-01', '2026-01-01', 90);
    expect(result.valid).toBe(true);
    expect(result.dayCount).toBe(1);
    expect(result.error).toBeNull();
  });

  it('accepts a range exactly at the max day count', () => {
    const result = validateBackfillRange('2026-01-01', '2026-03-31', 90);
    expect(result.valid).toBe(true);
    expect(result.dayCount).toBe(90);
  });

  it('rejects a range over the max day count', () => {
    const result = validateBackfillRange('2026-01-01', '2026-04-01', 90);
    expect(result.valid).toBe(false);
    expect(result.dayCount).toBe(91);
    expect(result.error).toContain('bounded to 90 days');
  });

  it('rejects an end date before the start date', () => {
    const result = validateBackfillRange('2026-02-01', '2026-01-01', 90);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must not be before');
  });

  it('rejects a malformed date string', () => {
    const result = validateBackfillRange('2026/01/01', '2026-01-05', 90);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('YYYY-MM-DD');
  });
});
