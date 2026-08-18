import { describe, expect, it } from 'vitest';

import { computeCatchUpWindows, nextIsoDate, todayUtc, yesterdayUtc } from './checkpoint-windows';

const AUG_14_NOON_UTC = Date.parse('2026-08-14T12:00:00Z');

describe('date helpers', () => {
  it('todayUtc/yesterdayUtc', () => {
    expect(todayUtc(AUG_14_NOON_UTC)).toBe('2026-08-14');
    expect(yesterdayUtc(AUG_14_NOON_UTC)).toBe('2026-08-13');
  });

  it('nextIsoDate steps forward and backward, crossing month/year boundaries', () => {
    expect(nextIsoDate('2026-08-14', 1)).toBe('2026-08-15');
    expect(nextIsoDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(nextIsoDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('computeCatchUpWindows', () => {
  it('first-ever run (no checkpoint) starts at yesterday only — no historic backfill', () => {
    const windows = computeCatchUpWindows(null, AUG_14_NOON_UTC, 3);
    expect(windows).toEqual([{ windowFrom: '2026-08-13', windowTo: '2026-08-13' }]);
  });

  it('bounds catch-up to maxWindows per run, leaving the rest for next time', () => {
    // Checkpoint 5 days behind yesterday (2026-08-13): 2026-08-08..08-13 = 6 days owed.
    const windows = computeCatchUpWindows('2026-08-07', AUG_14_NOON_UTC, 3);
    expect(windows).toEqual([
      { windowFrom: '2026-08-08', windowTo: '2026-08-08' },
      { windowFrom: '2026-08-09', windowTo: '2026-08-09' },
      { windowFrom: '2026-08-10', windowTo: '2026-08-10' },
    ]);
  });

  it('returns an empty array once fully caught up', () => {
    expect(computeCatchUpWindows('2026-08-13', AUG_14_NOON_UTC, 3)).toEqual([]);
  });

  it('never returns a window for "today"', () => {
    const windows = computeCatchUpWindows('2026-08-12', AUG_14_NOON_UTC, 10);
    expect(windows.every((w) => w.windowTo < todayUtc(AUG_14_NOON_UTC))).toBe(true);
    expect(windows.at(-1)).toEqual({ windowFrom: '2026-08-13', windowTo: '2026-08-13' });
  });
});
