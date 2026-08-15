import { describe, expect, it } from 'vitest';
import {
  classificationLabel,
  componentStatusLabel,
  formatIsoUtc,
  formatOriginalValue,
  formatRelativeDeadline,
  formatScoreLine,
  riskConfidenceLabel,
} from './format';

describe('classificationLabel', () => {
  it('never returns a bare enum value — always a human label', () => {
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
    expect(formatScoreLine(84.5, 'STRONG_MATCH')).toBe('84.5 / 100 — Strong match');
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

describe('formatIsoUtc', () => {
  it('renders a fixed epoch as an ISO-8601 UTC timestamp', () => {
    expect(formatIsoUtc(Date.parse('2026-08-15T12:00:00Z'))).toBe('2026-08-15T12:00:00.000Z');
  });
  it('reports a missing timestamp honestly, never as blank', () => {
    expect(formatIsoUtc(null)).toBe('not recorded');
  });
});
