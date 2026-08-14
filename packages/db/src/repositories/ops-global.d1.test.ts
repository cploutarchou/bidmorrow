/**
 * exchange_rates integration tests against real D1 (workerd): the 7-day
 * freshness window from ADR-0004 — a stale rate must come back null so the
 * caller scores the value component UNKNOWN instead of guessing.
 *
 * All times are injected through the repos' own `fetchedAt` / `asOfMs`
 * parameters, so the tests never depend on the wall clock.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { exchangeRates } from '../schema/tender';
import { MS_PER_DAY, T0, testDb } from '../test/helpers';
import { RATE_MAX_AGE_DAYS, getRate, upsertRates } from './ops-global';

/** T0 is 2026-08-01T00:00:00Z — rate dates below are relative to it. */
const RATE_DATE = '2026-08-01';

describe('exchange rates', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('returns the rate while fresh and null once older than 7 days', async () => {
    await upsertRates(db, {
      rateDate: RATE_DATE,
      rates: [{ currency: 'SEK', rateToEur: 0.0885 }],
      fetchedAt: T0,
    });

    // Exactly 7 days later the rate is still within the validity window…
    const fresh = await getRate(db, {
      currency: 'SEK',
      asOfMs: T0 + RATE_MAX_AGE_DAYS * MS_PER_DAY,
    });
    expect(fresh).toMatchObject({ currency: 'SEK', rateDate: RATE_DATE, rateToEur: 0.0885 });

    // …but at 8 days it is stale: null, never a guessed rate.
    const stale = await getRate(db, {
      currency: 'SEK',
      asOfMs: T0 + (RATE_MAX_AGE_DAYS + 1) * MS_PER_DAY,
    });
    expect(stale).toBeNull();
  });

  it('returns null for a currency that has no stored rate at all', async () => {
    expect(await getRate(db, { currency: 'NOK', asOfMs: T0 })).toBeNull();
  });

  it('picks the freshest rate date within the window', async () => {
    await upsertRates(db, {
      rateDate: '2026-08-01',
      rates: [{ currency: 'DKK', rateToEur: 0.134 }],
      fetchedAt: T0,
    });
    await upsertRates(db, {
      rateDate: '2026-08-04',
      rates: [{ currency: 'DKK', rateToEur: 0.1341 }],
      fetchedAt: T0 + 3 * MS_PER_DAY,
    });

    const rate = await getRate(db, { currency: 'DKK', asOfMs: T0 + 5 * MS_PER_DAY });
    expect(rate).toMatchObject({ rateDate: '2026-08-04', rateToEur: 0.1341 });
  });

  it('re-upserting the same (rate_date, currency) updates in place, never duplicates', async () => {
    await upsertRates(db, {
      rateDate: RATE_DATE,
      rates: [{ currency: 'CZK', rateToEur: 0.0405 }],
      fetchedAt: T0,
    });
    await upsertRates(db, {
      rateDate: RATE_DATE,
      rates: [{ currency: 'CZK', rateToEur: 0.0406 }],
      fetchedAt: T0 + 3_600_000,
    });

    const rows = await db.select().from(exchangeRates).where(eq(exchangeRates.currency, 'CZK'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rateDate: RATE_DATE,
      rateToEur: 0.0406,
      fetchedAt: T0 + 3_600_000,
    });
  });
});
