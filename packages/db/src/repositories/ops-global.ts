/**
 * GLOBAL repository — runtime configuration and FX reference data
 * (docs/data-model.md §4 exchange_rates, §10 feature_flags).
 *
 * Both tables are global (no `organization_id`); per docs/security.md C6 no
 * function here takes an organizationId. Feature flags are admin-edited
 * runtime switches; exchange rates are ECB reference rates refreshed daily
 * by the ingestion cron (ADR-0004).
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import type { FeatureFlagKey } from '@bidmorrow/config';

import type { Db } from '../client';
import { newId } from '../id';
import { exchangeRates } from '../schema/tender';
import { featureFlags } from '../schema/ops';
import { assertIsoDate, isoDateDaysBefore } from './shared';

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/**
 * Reads one flag by its typed key (@bidmorrow/config FEATURE_FLAG_KEYS —
 * code never passes free-form strings). Null when the flag has not been
 * seeded yet; callers apply their own safe default.
 */
export async function getFeatureFlag(db: Db, key: FeatureFlagKey): Promise<FeatureFlag | null> {
  const row = (await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1))[0];
  return row ?? null;
}

export interface SetFeatureFlagArgs {
  readonly key: FeatureFlagKey;
  /** Pre-serialized JSON value, e.g. `"true"`, `"20"`. */
  readonly valueJson: string;
  /** What the flag does and safe values. */
  readonly description: string;
  /** The admin who changed it; null for system/seed writes. */
  readonly updatedByUserId?: string | null;
}

/**
 * Creates or updates a flag (upsert on unique `key`). `valueJson` must be
 * valid JSON — rejected here so a typo can never wedge every reader of the
 * flag. NOTE: every flag change must also write an `audit_events` row
 * (docs/data-model.md §10); that is the calling admin service's job, not
 * this primitive's.
 */
export async function setFeatureFlag(db: Db, args: SetFeatureFlagArgs): Promise<FeatureFlag> {
  JSON.parse(args.valueJson); // throws on malformed JSON — never store it
  const now = Date.now();
  const upserted = await db
    .insert(featureFlags)
    .values({
      id: newId(),
      key: args.key,
      valueJson: args.valueJson,
      description: args.description,
      updatedByUserId: args.updatedByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: {
        valueJson: args.valueJson,
        description: args.description,
        updatedByUserId: args.updatedByUserId ?? null,
        updatedAt: now,
      },
    })
    .returning();
  const row = upserted[0];
  if (row === undefined) {
    throw new Error('setFeatureFlag: upsert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Exchange rates (ADR-0004)
// ---------------------------------------------------------------------------

/** A rate is valid for scoring if ≤ 7 days old (ADR-0004). */
export const RATE_MAX_AGE_DAYS = 7;

export interface UpsertRatesArgs {
  /** `YYYY-MM-DD` ECB reference date the rates were published for. */
  readonly rateDate: string;
  readonly rates: readonly {
    /** ISO-4217 code, e.g. `SEK`. */
    readonly currency: string;
    /** Multiplier converting one unit of currency into EUR. */
    readonly rateToEur: number;
  }[];
  /** When the ECB feed was fetched; defaults to now. */
  readonly fetchedAt?: number;
}

/**
 * Upserts one ECB reference-rate batch (~30 currencies) keyed on unique
 * `(rate_date, currency)` — the daily refresh is idempotent; a re-fetch
 * moves `fetched_at`/`updated_at` on the same rows. Returns the row count
 * written. Non-positive rates are rejected: a zero/negative multiplier is
 * always feed corruption and would poison value-fit scoring silently.
 */
export async function upsertRates(db: Db, args: UpsertRatesArgs): Promise<number> {
  assertIsoDate(args.rateDate, 'rateDate');
  const now = Date.now();
  const fetchedAt = args.fetchedAt ?? now;
  for (const rate of args.rates) {
    if (!Number.isFinite(rate.rateToEur) || rate.rateToEur <= 0) {
      throw new Error(
        `upsertRates: invalid rate_to_eur ${rate.rateToEur} for ${rate.currency} on ${args.rateDate}`,
      );
    }
  }
  for (const rate of args.rates) {
    await db
      .insert(exchangeRates)
      .values({
        id: newId(),
        rateDate: args.rateDate,
        currency: rate.currency,
        rateToEur: rate.rateToEur,
        fetchedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [exchangeRates.rateDate, exchangeRates.currency],
        set: { rateToEur: rate.rateToEur, fetchedAt, updatedAt: now },
      });
  }
  return args.rates.length;
}

export interface GetRateArgs {
  /** ISO-4217 code. Callers short-circuit EUR (rate 1) per ADR-0004 — EUR rows are never stored. */
  readonly currency: string;
  /** Reference time for freshness; defaults to now. */
  readonly asOfMs?: number;
}

/**
 * Freshest rate for a currency within the 7-day validity window (ADR-0004):
 * the newest `rate_date` ≥ `asOf - 7 days`, or null — the caller must then
 * score the value component UNKNOWN, never guess a rate. The returned
 * `rateDate` is recorded on match rows so scores stay reproducible.
 */
export async function getRate(db: Db, args: GetRateArgs): Promise<ExchangeRate | null> {
  const asOfMs = args.asOfMs ?? Date.now();
  const cutoffDate = isoDateDaysBefore(asOfMs, RATE_MAX_AGE_DAYS);
  const row = (
    await db
      .select()
      .from(exchangeRates)
      .where(
        and(eq(exchangeRates.currency, args.currency), gte(exchangeRates.rateDate, cutoffDate)),
      )
      .orderBy(desc(exchangeRates.rateDate))
      .limit(1)
  )[0];
  return row ?? null;
}
