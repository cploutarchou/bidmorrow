/**
 * Typed repository errors. Callers branch on `instanceof` (or the stable
 * `code` discriminant) instead of sniffing driver error messages.
 */

/**
 * A replace-style write would exceed a per-organization cap
 * (docs/product-scope.md limits: keywords ≤ 50, CPV preferences ≤ 30).
 * Thrown BEFORE any statement runs — the existing rows are untouched.
 */
export class CapExceededError extends Error {
  readonly code = 'CAP_EXCEEDED' as const;

  constructor(
    /** The capped resource, e.g. `company_keywords`. */
    readonly resource: string,
    /** The maximum allowed rows per organization. */
    readonly cap: number,
    /** How many rows the caller tried to write. */
    readonly attempted: number,
  ) {
    super(`${resource}: cap exceeded (${attempted} > ${cap})`);
    this.name = 'CapExceededError';
  }
}

/**
 * A digest run for (organization, digest_date) already exists — another
 * invocation owns that day's digest (docs/data-model.md §8: the unique
 * constraint is the dedupe mechanism). The caller must stop, not retry.
 */
export class DuplicateDigestError extends Error {
  readonly code = 'DUPLICATE_DIGEST' as const;

  constructor(
    readonly organizationId: string,
    /** `YYYY-MM-DD` in the organization's timezone. */
    readonly digestDate: string,
  ) {
    super(`digest_runs: a run for ${digestDate} already exists for this organization`);
    this.name = 'DuplicateDigestError';
  }
}

/**
 * An upsert keyed on an external id (e.g. a Stripe customer id) collided
 * with a row owned by a DIFFERENT organization. Never handled silently —
 * this is either a caller bug or a cross-tenant attack attempt and must
 * surface loudly (docs/security.md C6).
 */
export class TenantMismatchError extends Error {
  readonly code = 'TENANT_MISMATCH' as const;

  constructor(
    readonly resource: string,
    readonly organizationId: string,
  ) {
    super(`${resource}: external key belongs to a different organization`);
    this.name = 'TenantMismatchError';
  }
}
