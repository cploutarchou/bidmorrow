import { describe, expect, it } from 'vitest';
import type { RetentionLotRow } from '@bidmorrow/db';

import {
  NO_DEADLINE_RETENTION_DAYS,
  isLotExpired,
  selectEligibleNoticeIds,
} from './retention-eligibility';

const MS_PER_DAY = 86_400_000;
const NOW = Date.parse('2026-08-14T00:00:00Z');

describe('isLotExpired', () => {
  it('a lot with a deadline expires retentionDays after the deadline', () => {
    const deadline = NOW - 91 * MS_PER_DAY;
    expect(isLotExpired(NOW, deadline, '2026-01-01', 90)).toBe(true);
    expect(isLotExpired(NOW, NOW - 89 * MS_PER_DAY, '2026-01-01', 90)).toBe(false);
  });

  it('a lot with no deadline expires 180 days after publication', () => {
    const publishedLongAgo = new Date(NOW - (NO_DEADLINE_RETENTION_DAYS + 1) * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    expect(isLotExpired(NOW, null, publishedLongAgo, 90)).toBe(true);

    const publishedRecently = new Date(NOW - 10 * MS_PER_DAY).toISOString().slice(0, 10);
    expect(isLotExpired(NOW, null, publishedRecently, 90)).toBe(false);
  });
});

function lotRow(overrides: Partial<RetentionLotRow>): RetentionLotRow {
  return {
    lotId: 'lot-1',
    noticeId: 'notice-1',
    publicationDate: '2026-01-01',
    deadlineAt: NOW - 200 * MS_PER_DAY,
    ...overrides,
  };
}

describe('selectEligibleNoticeIds', () => {
  it('selects a notice only when EVERY current-version lot is expired and unpinned', () => {
    const lots: RetentionLotRow[] = [
      lotRow({ lotId: 'a1', noticeId: 'notice-a' }),
      lotRow({ lotId: 'a2', noticeId: 'notice-a' }),
    ];
    const result = selectEligibleNoticeIds({
      lots,
      pinnedLotIds: new Set(),
      nowMs: NOW,
      retentionDays: 90,
      limit: 500,
    });
    expect(result).toEqual(['notice-a']);
  });

  it('excludes a notice when even one lot is pinned (saved or has feedback)', () => {
    const lots: RetentionLotRow[] = [
      lotRow({ lotId: 'a1', noticeId: 'notice-a' }),
      lotRow({ lotId: 'a2', noticeId: 'notice-a' }),
    ];
    const result = selectEligibleNoticeIds({
      lots,
      pinnedLotIds: new Set(['a2']),
      nowMs: NOW,
      retentionDays: 90,
      limit: 500,
    });
    expect(result).toEqual([]);
  });

  it('excludes a notice when any lot is not yet expired', () => {
    const lots: RetentionLotRow[] = [
      lotRow({ lotId: 'a1', noticeId: 'notice-a' }),
      lotRow({ lotId: 'a2', noticeId: 'notice-a', deadlineAt: NOW }),
    ];
    const result = selectEligibleNoticeIds({
      lots,
      pinnedLotIds: new Set(),
      nowMs: NOW,
      retentionDays: 90,
      limit: 500,
    });
    expect(result).toEqual([]);
  });

  it('is bounded by limit, in deterministic ascending-id order', () => {
    const lots: RetentionLotRow[] = [
      lotRow({ lotId: 'b1', noticeId: 'notice-b' }),
      lotRow({ lotId: 'a1', noticeId: 'notice-a' }),
      lotRow({ lotId: 'c1', noticeId: 'notice-c' }),
    ];
    const result = selectEligibleNoticeIds({
      lots,
      pinnedLotIds: new Set(),
      nowMs: NOW,
      retentionDays: 90,
      limit: 2,
    });
    expect(result).toEqual(['notice-a', 'notice-b']);
  });
});
