import { describe, expect, it } from 'vitest';

import { PAST_DUE_GRACE_DAYS, reasonFor } from './entitlement';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-15T00:00:00.000Z');

describe('reasonFor (entitlement grace-window logic, pure)', () => {
  it('trialing is active with no grace boundary', () => {
    expect(reasonFor({ status: 'trialing', currentPeriodEndAt: null }, NOW)).toEqual({
      active: true,
      reason: 'trialing',
      graceEndsAt: null,
    });
  });

  it('active is active with no grace boundary', () => {
    expect(reasonFor({ status: 'active', currentPeriodEndAt: NOW - DAY_MS }, NOW)).toEqual({
      active: true,
      reason: 'active',
      graceEndsAt: null,
    });
  });

  it('past_due stays active within the grace window', () => {
    const currentPeriodEndAt = NOW - DAY_MS; // period ended yesterday
    const result = reasonFor({ status: 'past_due', currentPeriodEndAt }, NOW);
    expect(result.active).toBe(true);
    expect(result.reason).toBe('past_due_grace');
    expect(result.graceEndsAt).toBe(currentPeriodEndAt + PAST_DUE_GRACE_DAYS * DAY_MS);
  });

  it('past_due exactly at the grace boundary is still active (inclusive)', () => {
    const currentPeriodEndAt = NOW - PAST_DUE_GRACE_DAYS * DAY_MS;
    const result = reasonFor({ status: 'past_due', currentPeriodEndAt }, NOW);
    expect(result.active).toBe(true);
    expect(result.reason).toBe('past_due_grace');
  });

  it('past_due past the grace window is inactive', () => {
    const currentPeriodEndAt = NOW - (PAST_DUE_GRACE_DAYS * DAY_MS + 1);
    const result = reasonFor({ status: 'past_due', currentPeriodEndAt }, NOW);
    expect(result.active).toBe(false);
    expect(result.reason).toBe('past_due_expired');
  });

  it('past_due with no stored period end fails closed (no grace basis)', () => {
    const result = reasonFor({ status: 'past_due', currentPeriodEndAt: null }, NOW);
    expect(result.active).toBe(false);
    expect(result.reason).toBe('past_due_expired');
    expect(result.graceEndsAt).toBeNull();
  });

  it('canceled is never active', () => {
    expect(reasonFor({ status: 'canceled', currentPeriodEndAt: null }, NOW)).toEqual({
      active: false,
      reason: 'canceled',
      graceEndsAt: null,
    });
  });

  it('unpaid is never active', () => {
    expect(reasonFor({ status: 'unpaid', currentPeriodEndAt: null }, NOW)).toEqual({
      active: false,
      reason: 'unpaid',
      graceEndsAt: null,
    });
  });
});
