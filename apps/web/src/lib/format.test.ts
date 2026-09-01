import { describe, expect, it } from 'vitest';
import {
  classificationLabel,
  componentLabel,
  componentMaxPoints,
  componentStatusLabel,
  formatCalendarDate,
  formatIsoUtc,
  formatMinorUnitsAsCurrency,
  formatOriginalValue,
  formatRelativeDeadline,
  formatScoreLine,
  invoiceStatusLabel,
  paymentStateLabel,
  paymentStateTone,
  riskConfidenceLabel,
} from './format';

describe('classificationLabel', () => {
  it('never returns a bare enum value, always a human label', () => {
    expect(classificationLabel('STRONG_MATCH')).toBe('Strong match');
    expect(classificationLabel('WORTH_REVIEWING')).toBe('Worth reviewing');
    expect(classificationLabel('POSSIBLE_MATCH')).toBe('Possible match');
    expect(classificationLabel('LOW_FIT')).toBe('Low fit');
    expect(classificationLabel('EXCLUDED')).toBe('Excluded');
  });
});

describe('formatRelativeDeadline', () => {
  const now = Date.parse('2026-08-15T00:00:00Z');
  it('reports no deadline honestly', () => {
    expect(formatRelativeDeadline(null, now)).toBe('No deadline published');
  });
  it('reports a passed deadline explicitly rather than negative days', () => {
    expect(formatRelativeDeadline(now - 24 * 60 * 60 * 1000, now)).toBe('Deadline passed');
  });
  it('reports today and tomorrow specially', () => {
    expect(formatRelativeDeadline(now + 1000, now)).toBe('Deadline today');
    expect(formatRelativeDeadline(now + 24 * 60 * 60 * 1000, now)).toBe('Deadline tomorrow');
  });
  it('reports N days for further-out deadlines', () => {
    expect(formatRelativeDeadline(now + 10 * 24 * 60 * 60 * 1000, now)).toBe('Deadline in 10 days');
  });
});

describe('formatOriginalValue', () => {
  it('reports missing value honestly, never as zero', () => {
    expect(formatOriginalValue(null, 'EUR')).toBe('Value not published');
  });
  it('formats a known amount in its original currency', () => {
    expect(formatOriginalValue(180000, 'EUR')).toContain('180,000');
  });
  it('falls back gracefully for an unrecognized currency code', () => {
    expect(formatOriginalValue(100, 'XXX')).toContain('100');
  });
});

describe('formatScoreLine', () => {
  it('matches the matching-engine.md worked-example rendering shape', () => {
    expect(formatScoreLine(84.5, 'STRONG_MATCH')).toBe('84.5 / 100 - Strong match');
  });
});

describe('riskConfidenceLabel', () => {
  it('always includes the verify-in-source-documents wording for POSSIBLE', () => {
    expect(riskConfidenceLabel('POSSIBLE')).toContain('verify in source documents');
  });
  it('labels HIGH confidence distinctly', () => {
    expect(riskConfidenceLabel('HIGH')).toBe('Confirmed pattern');
  });
});

describe('componentStatusLabel', () => {
  it('labels UNKNOWN with the neutral-score explanation', () => {
    expect(componentStatusLabel('UNKNOWN')).toContain('neutral score applied');
  });
  it('falls back to the raw string for unrecognized statuses', () => {
    expect(componentStatusLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });
});

describe('componentMaxPoints', () => {
  it('matches the REAL 8-component weights in docs/matching-engine.md, never the mockup labels', () => {
    expect(componentMaxPoints('cpv')).toBe(35);
    expect(componentMaxPoints('capability')).toBe(20);
    expect(componentMaxPoints('geography')).toBe(15);
    expect(componentMaxPoints('value')).toBe(10);
    expect(componentMaxPoints('buyer')).toBe(5);
    expect(componentMaxPoints('procedure_nature')).toBe(5);
    expect(componentMaxPoints('deadline')).toBe(5);
    expect(componentMaxPoints('eligibility')).toBe(5);
  });
  it('sums to the 100-point score model', () => {
    const keys = [
      'cpv',
      'capability',
      'geography',
      'value',
      'buyer',
      'procedure_nature',
      'deadline',
      'eligibility',
    ];
    const total = keys.reduce((sum, key) => sum + (componentMaxPoints(key) ?? 0), 0);
    expect(total).toBe(100);
  });
  it('returns null (never a guessed max) for an unrecognized key', () => {
    expect(componentMaxPoints('something_new')).toBeNull();
  });
});

describe('componentLabel', () => {
  it('gives every real component a human label, never a bare DB key', () => {
    expect(componentLabel('cpv')).toBe('CPV fit');
    expect(componentLabel('procedure_nature')).toBe('Procedure & contract nature');
  });
  it('falls back to the raw key for forward-compat', () => {
    expect(componentLabel('something_new')).toBe('something_new');
  });
});

describe('formatIsoUtc', () => {
  it('renders a fixed epoch as an ISO-8601 UTC timestamp', () => {
    expect(formatIsoUtc(Date.parse('2026-08-15T12:00:00Z'))).toBe('2026-08-15T12:00:00.000Z');
  });
  it('reports a missing timestamp honestly, never as blank', () => {
    expect(formatIsoUtc(null)).toBe('not recorded');
  });
});

describe('formatCalendarDate', () => {
  it('formats a known epoch as a locale calendar date', () => {
    expect(formatCalendarDate(Date.parse('2026-09-15T00:00:00Z'))).toContain('2026');
  });
  it('reports a missing date honestly, never as blank', () => {
    expect(formatCalendarDate(null)).toBe('unknown date');
  });
});

describe('formatMinorUnitsAsCurrency', () => {
  it('formats the founding-plan price (2900 minor units, EUR)', () => {
    const result = formatMinorUnitsAsCurrency(2900, 'eur');
    expect(result).toContain('29');
  });
  it('formats the standard-plan price (4900 minor units, EUR)', () => {
    const result = formatMinorUnitsAsCurrency(4900, 'eur');
    expect(result).toContain('49');
  });
  it('falls back gracefully for an unrecognized currency code', () => {
    expect(formatMinorUnitsAsCurrency(100, 'not-a-currency')).toContain('1.00');
  });
});

describe('paymentStateLabel', () => {
  it('gives every known payment state a human label, never a bare enum value', () => {
    expect(paymentStateLabel('trialing')).toBe('Trialing');
    expect(paymentStateLabel('active')).toBe('Active');
    expect(paymentStateLabel('past_due')).toBe('Past due');
    expect(paymentStateLabel('canceled')).toBe('Canceled');
    expect(paymentStateLabel('paused')).toBe('Paused');
  });
  it('falls back to the raw value for forward-compat', () => {
    expect(paymentStateLabel('something_new')).toBe('something_new');
  });
});

describe('paymentStateTone', () => {
  it('maps failed-payment states to the danger tone', () => {
    expect(paymentStateTone('past_due')).toBe('danger');
  });
  it('maps a paused subscription to the warn tone', () => {
    expect(paymentStateTone('paused')).toBe('warn');
  });
  it('maps a healthy subscription to the ok tone', () => {
    expect(paymentStateTone('active')).toBe('ok');
  });
  it('falls back to muted for an unrecognized state, never danger by default', () => {
    expect(paymentStateTone('something_new')).toBe('muted');
  });
});

describe('invoiceStatusLabel', () => {
  it('labels every known Paddle transaction status', () => {
    expect(invoiceStatusLabel('paid')).toBe('Paid');
    expect(invoiceStatusLabel('completed')).toBe('Paid');
    expect(invoiceStatusLabel('billed')).toBe('Issued');
    expect(invoiceStatusLabel('past_due')).toBe('Past due');
  });
  it('reports a null status honestly, never as blank', () => {
    expect(invoiceStatusLabel(null)).toBe('Unknown');
  });
});
