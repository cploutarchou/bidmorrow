import { describe, expect, it } from 'vitest';

import { assertCheckpointAdvance } from './ingestion';

/**
 * The checkpoint advance-only rule (docs/data-model.md §5): the per-source
 * cursor may move forward or stay on the same date (sequence-token moves
 * within a window), but NEVER backwards. `advanceCheckpoint` additionally
 * guards the UPDATE with `last_publication_date <= next` in SQL; the pure
 * guard tested here is the first line of defense and is what throws.
 */
describe('assertCheckpointAdvance', () => {
  it('allows advancing to a later date', () => {
    expect(() => assertCheckpointAdvance('2026-08-01', '2026-08-02', 'ted')).not.toThrow();
    expect(() => assertCheckpointAdvance('2025-12-31', '2026-01-01', 'ted')).not.toThrow();
  });

  it('allows the same date (sequence token moves within a window)', () => {
    expect(() => assertCheckpointAdvance('2026-08-01', '2026-08-01', 'ted')).not.toThrow();
  });

  it('rejects moving the checkpoint backwards', () => {
    expect(() => assertCheckpointAdvance('2026-08-02', '2026-08-01', 'ted')).toThrow(/backwards/);
    expect(() => assertCheckpointAdvance('2026-01-01', '2025-12-31', 'ted')).toThrow(/backwards/);
  });

  it('rejects malformed dates (lexicographic ordering would be meaningless)', () => {
    expect(() => assertCheckpointAdvance('2026-08-01', '01/08/2026', 'ted')).toThrow(/YYYY-MM-DD/);
    expect(() => assertCheckpointAdvance('2026-08-01', '2026-8-1', 'ted')).toThrow(/YYYY-MM-DD/);
  });
});
