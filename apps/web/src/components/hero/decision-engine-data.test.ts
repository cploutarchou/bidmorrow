/**
 * Product-truth guard for the hero data: the visual advertises the real
 * scoring arithmetic, so the illustrative numbers must obey it.
 */
import { describe, expect, it } from 'vitest';

import {
  BAND_LABELS,
  COMPONENT_WEIGHTS,
  CYCLE_SECONDS,
  HERO_TENDERS,
  bandFor,
} from './decision-engine-data';

describe('decision-engine illustrative data', () => {
  it('uses the eight published components summing to one hundred points', () => {
    expect(COMPONENT_WEIGHTS.map((c) => c.label)).toEqual([
      'CPV fit',
      'Capability & keyword fit',
      'Geography',
      'Contract value',
      'Buyer & sector',
      'Procedure & contract nature',
      'Deadline runway',
      'Eligibility & certifications',
    ]);
    expect(COMPONENT_WEIGHTS.reduce((sum, c) => sum + c.max, 0)).toBe(100);
  });

  it.each(HERO_TENDERS)('$id: points sum to the score and the band follows the score', (tender) => {
    expect(tender.signals).toHaveLength(COMPONENT_WEIGHTS.length);
    expect(tender.signals.reduce((sum, s) => sum + s.pts, 0)).toBe(tender.score);
    for (const signal of tender.signals) {
      expect(signal.pts).toBeGreaterThanOrEqual(0);
      expect(signal.pts).toBeLessThanOrEqual(signal.max);
    }
    expect(bandFor(tender.score)).toBe(tender.band);
  });

  it('maps scores to the published bands at their boundaries', () => {
    expect(bandFor(100)).toBe('strong');
    expect(bandFor(80)).toBe('strong');
    expect(bandFor(79)).toBe('review');
    expect(bandFor(65)).toBe('review');
    expect(bandFor(64)).toBe('possible');
    expect(bandFor(45)).toBe('possible');
    expect(bandFor(44)).toBe('low');
    expect(bandFor(0)).toBe('low');
    expect(BAND_LABELS.strong).toBe('Strong match');
  });

  it('shows one of each decisive outcome and loops inside the 8 to 15 second window', () => {
    expect(HERO_TENDERS.map((t) => t.band)).toEqual(['strong', 'review', 'low']);
    expect(CYCLE_SECONDS).toBeGreaterThanOrEqual(8);
    expect(CYCLE_SECONDS).toBeLessThanOrEqual(15);
  });

  it('never names a real institution and never promises a win', () => {
    for (const tender of HERO_TENDERS) {
      expect(tender.buyer).toMatch(/^[A-Z][a-z].* · [A-Z]{2}$/);
      expect(`${tender.title} ${tender.flag ?? ''}`.toLowerCase()).not.toMatch(/\bwin\b|guarantee/);
    }
  });
});
