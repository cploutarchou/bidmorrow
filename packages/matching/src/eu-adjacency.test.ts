import { describe, expect, it } from 'vitest';

import { areNeighbors, neighborsOf } from './eu-adjacency';

describe('eu-adjacency', () => {
  it('is symmetric', () => {
    expect(areNeighbors('FR', 'BE')).toBe(true);
    expect(areNeighbors('BE', 'FR')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(areNeighbors('fr', 'be')).toBe(true);
  });

  it('returns empty set for islands with no land border', () => {
    expect(neighborsOf('CY').size).toBe(0);
    expect(neighborsOf('MT').size).toBe(0);
  });

  it('unknown country returns empty set', () => {
    expect(neighborsOf('ZZ').size).toBe(0);
  });

  it('non-neighbors are false', () => {
    expect(areNeighbors('PT', 'DE')).toBe(false);
  });
});
