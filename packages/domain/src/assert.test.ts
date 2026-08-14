import { describe, expect, it } from 'vitest';

import { assertNever } from './assert';
import { MATCH_CLASSIFICATIONS } from './enums';
import type { MatchClassification } from './enums';

/**
 * Exhaustive switch over MatchClassification. If a classification is added to
 * the union and this switch is not updated, the assertNever call stops
 * compiling — this is the pattern all engine code must follow.
 */
function classificationRank(classification: MatchClassification): number {
  switch (classification) {
    case 'STRONG_MATCH':
      return 4;
    case 'WORTH_REVIEWING':
      return 3;
    case 'POSSIBLE_MATCH':
      return 2;
    case 'LOW_FIT':
      return 1;
    case 'EXCLUDED':
      return 0;
    default:
      return assertNever(classification);
  }
}

describe('assertNever', () => {
  it('is unreachable when a union is handled exhaustively', () => {
    const ranks = MATCH_CLASSIFICATIONS.map((classification) => classificationRank(classification));
    expect(ranks).toEqual([4, 3, 2, 1, 0]);
  });

  it('throws at runtime for values outside the union (e.g. corrupt DB rows)', () => {
    const corrupt = 'NOT_A_CLASSIFICATION' as never;
    expect(() => assertNever(corrupt)).toThrow(/NOT_A_CLASSIFICATION/);
    expect(() => assertNever(corrupt, 'unexpected classification')).toThrow(
      'unexpected classification',
    );
  });
});
