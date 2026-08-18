/**
 * Explicit unknown representation.
 *
 * The docs mandate that missing source data is never coerced to a default
 * (docs/data-model.md: "unknown is explicit, never 0"; matching engine scores
 * UNKNOWN components neutrally). `Unknown<T>` makes that policy visible in
 * the type system: a value is either a real `T` or an unknown carrying a
 * human-readable reason.
 */

export interface UnknownValue {
  readonly kind: 'unknown';
  readonly reason: string;
}

export type Unknown<T> = T | UnknownValue;

/** Construct an explicit unknown with a mandatory, non-empty reason. */
export function unknown(reason: string): UnknownValue {
  if (reason.trim().length === 0) {
    throw new Error('unknown() requires a non-empty reason');
  }
  return { kind: 'unknown', reason };
}

export function isUnknown<T>(value: Unknown<T>): value is UnknownValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { readonly kind: unknown }).kind === 'unknown' &&
    'reason' in value &&
    typeof (value as { readonly reason: unknown }).reason === 'string'
  );
}

export function isKnown<T>(value: Unknown<T>): value is T {
  return !isUnknown(value);
}
