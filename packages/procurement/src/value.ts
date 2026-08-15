/**
 * Lot value derivation: dividing a procedure-level estimated value across
 * lots that publish no lot-level value of their own (docs/matching-engine.md
 * PARTIAL semantics — scoring itself is Phase 6, this module only decides
 * what gets stored: `estimated_value_amount` + `value_is_derived`).
 */
import type { MoneyValue, NormalizedLot } from '@bidmorrow/ted';

export interface LotValue {
  readonly amount: number | null;
  readonly currency: string | null;
  /** True when the amount came from an equal split of the procedure total. */
  readonly valueIsDerived: boolean;
}

/**
 * Per-lot value: a lot's OWN estimated value always wins. When a lot has
 * none but the procedure publishes a total, the total is split EQUALLY
 * across every lot that itself lacks a value (never guessed unevenly) —
 * `valueIsDerived: true` marks the row so scoring treats it as PARTIAL
 * evidence, not a MATCHED fact. When neither exists, both fields stay null
 * (explicit unknown, never zero).
 */
export function divideValueAcrossLots(
  lots: readonly NormalizedLot[],
  procedureEstimatedValue: MoneyValue | null,
): LotValue[] {
  const lotsNeedingDerivedValue = lots.filter((lot) => lot.estimatedValue === null).length;

  return lots.map((lot) => {
    if (lot.estimatedValue !== null) {
      return {
        amount: lot.estimatedValue.amount,
        currency: lot.estimatedValue.currency,
        valueIsDerived: false,
      };
    }
    if (procedureEstimatedValue === null || lotsNeedingDerivedValue === 0) {
      return { amount: null, currency: null, valueIsDerived: false };
    }
    return {
      amount: procedureEstimatedValue.amount / lotsNeedingDerivedValue,
      currency: procedureEstimatedValue.currency,
      valueIsDerived: true,
    };
  });
}

/**
 * ADR-0004: EUR values pass through directly; converting other currencies
 * needs an ECB reference rate, which is a Phase 6 scoring-time concern (rate
 * freshness is evaluated at score time, not ingestion time, so a rate
 * fetched today must not get baked into a lot row that might be scored
 * weeks later against a stale conversion). Non-EUR lots therefore store
 * `estimated_value_eur: null` at ingestion time — explicit unknown, not a
 * guess.
 */
export function deriveValueEur(amount: number | null, currency: string | null): number | null {
  if (amount === null || currency === null) {
    return null;
  }
  return currency === 'EUR' ? amount : null;
}
