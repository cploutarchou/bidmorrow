/**
 * Pure formatting/mapping utilities kept out of components per the frontend
 * agent's thin-components rule (component logic under unit test; components
 * stay presentational). No `Intl` locale is hardcoded beyond the browser
 * default so this respects the user's locale.
 */

export type Classification =
  'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT' | 'EXCLUDED';

/**
 * Text label for a classification — status must never be conveyed by color
 * alone (WCAG 2.2 AA), so every score badge renders this label alongside any
 * color treatment.
 */
export function classificationLabel(classification: Classification): string {
  switch (classification) {
    case 'STRONG_MATCH':
      return 'Strong match';
    case 'WORTH_REVIEWING':
      return 'Worth reviewing';
    case 'POSSIBLE_MATCH':
      return 'Possible match';
    case 'LOW_FIT':
      return 'Low fit';
    case 'EXCLUDED':
      return 'Excluded';
  }
}

/**
 * Formats a deadline timestamp (epoch ms) relative to `now` (epoch ms) in
 * plain language. Past deadlines are stated explicitly rather than as a
 * negative number of days.
 */
export function formatRelativeDeadline(deadlineAt: number | null, now: number): string {
  if (deadlineAt === null) return 'No deadline published';
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((deadlineAt - now) / msPerDay);
  if (days < 0) return 'Deadline passed';
  if (days === 0) return 'Deadline today';
  if (days === 1) return 'Deadline tomorrow';
  return `Deadline in ${days} days`;
}

/**
 * Formats an original-currency value for display (never converts — the
 * original currency is what the buyer published; EUR-equivalent is a
 * separate, explicitly labelled figure elsewhere).
 */
export function formatOriginalValue(amount: number | null, currency: string | null): string {
  if (amount === null) return 'Value not published';
  const currencyCode = currency ?? 'EUR';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currencyCode}`;
  }
}

/** Score badge status text, distinct from the classification label (used together, e.g. "84.5 / 100 — Strong match"). */
export function formatScoreLine(score: number, classification: Classification): string {
  return `${score} / 100 — ${classificationLabel(classification)}`;
}

const RISK_CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: 'Confirmed pattern',
  POSSIBLE: 'Possible requirement — verify in source documents',
};

export function riskConfidenceLabel(confidence: string): string {
  return RISK_CONFIDENCE_LABEL[confidence] ?? confidence;
}

const COMPONENT_STATUS_LABEL: Record<string, string> = {
  MATCHED: 'Matched',
  PARTIAL: 'Partial match',
  NO_MATCH: 'No match',
  UNKNOWN: 'Unknown — neutral score applied',
};

export function componentStatusLabel(status: string): string {
  return COMPONENT_STATUS_LABEL[status] ?? status;
}

/**
 * ISO-8601 UTC timestamp for admin tooling (docs instruction: "all
 * timestamps rendered ISO UTC" — internal ops screens are not localized).
 * Returns a fixed placeholder for `null` rather than an empty string, so a
 * missing timestamp is never rendered as blank/ambiguous.
 */
export function formatIsoUtc(epochMs: number | null): string {
  if (epochMs === null) return 'not recorded';
  return new Date(epochMs).toISOString();
}

/**
 * Score component keys stored in `match_components.component_key`
 * (packages/db/src/schema/matching.ts CHECK constraint) — the REAL 8
 * engine components (docs/matching-engine.md), never the illustrative
 * labels from the Strata mockup. Human labels + max points are derived
 * directly from that spec; regression-tested in format.test.ts against the
 * documented weights so this can never silently drift from the engine.
 */
const COMPONENT_LABEL: Record<string, string> = {
  cpv: 'CPV fit',
  capability: 'Capability & keyword fit',
  geography: 'Geography',
  value: 'Contract value',
  buyer: 'Buyer & sector',
  procedure_nature: 'Procedure & contract nature',
  deadline: 'Deadline runway',
  eligibility: 'Eligibility & certifications',
};

const COMPONENT_MAX_POINTS: Record<string, number> = {
  cpv: 35,
  capability: 20,
  geography: 15,
  value: 10,
  buyer: 5,
  procedure_nature: 5,
  deadline: 5,
  eligibility: 5,
};

/** Human label for a `component_key`; falls back to the raw key for forward-compat. */
export function componentLabel(key: string): string {
  return COMPONENT_LABEL[key] ?? key;
}

/**
 * Locale-aware calendar date for billing UI ("Renews on 15 Sept 2026" /
 * "Cancels on ..."), following the same no-hardcoded-locale idiom as
 * `formatOriginalValue` above (`Intl` with `undefined` locale = the
 * browser's own). Distinct from `formatIsoUtc` (fixed ISO-UTC, admin-only
 * tooling) — this is a customer-facing date, so it renders in the visitor's
 * own locale/calendar, not a fixed machine format.
 */
export function formatCalendarDate(epochMs: number | null): string {
  if (epochMs === null) return 'unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(epochMs));
}

/**
 * Formats a Stripe-style minor-units amount (e.g. cents) as a currency
 * string, same `Intl.NumberFormat` idiom as `formatOriginalValue`. Unlike
 * `formatOriginalValue`, `amountMinorUnits`/`currency` here are never
 * user/notice-supplied — they come from `packages/billing`'s own
 * `planPrice()`/Stripe invoice fields, so there is no "value not published"
 * case to report.
 */
export function formatMinorUnitsAsCurrency(amountMinorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amountMinorUnits / 100);
  } catch {
    return `${(amountMinorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * `GET /api/billing/status` `subscription.status`/`paymentState` and
 * `POST /api/billing/reactivate`'s returned `status` (`packages/billing/src/
 * plans.ts` `SubscriptionStatus`/`PaymentState` — identical vocabularies).
 * Kept as a plain `string` param (not the DB/billing package's own type) so
 * `apps/web` never depends on `@bidmorrow/billing` for a five-value enum.
 */
const PAYMENT_STATE_LABEL: Record<string, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
};

export function paymentStateLabel(state: string): string {
  return PAYMENT_STATE_LABEL[state] ?? state;
}

export type PaymentStateTone = 'ok' | 'info' | 'warn' | 'danger' | 'muted';

const PAYMENT_STATE_TONE: Record<string, PaymentStateTone> = {
  trialing: 'info',
  active: 'ok',
  past_due: 'danger',
  unpaid: 'danger',
  canceled: 'muted',
};

/** Visual tone bucket for the payment-state badge — text label is always
 * rendered alongside it (WCAG: status is never color-only). */
export function paymentStateTone(state: string): PaymentStateTone {
  return PAYMENT_STATE_TONE[state] ?? 'muted';
}

/** Stripe `Invoice.status` (`draft | open | paid | uncollectible | void`,
 * or `null` for a not-yet-finalized invoice — verified from the installed
 * SDK, same source as `packages/billing/src/invoices.ts`). */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  paid: 'Paid',
  uncollectible: 'Uncollectible',
  void: 'Void',
};

export function invoiceStatusLabel(status: string | null): string {
  if (status === null) return 'Unknown';
  return INVOICE_STATUS_LABEL[status] ?? status;
}

/**
 * Max points for a `component_key` per docs/matching-engine.md. Returns
 * `null` for an unrecognized key rather than guessing — callers must treat
 * that as "no bar to render", never a silent 0/100.
 */
export function componentMaxPoints(key: string): number | null {
  return COMPONENT_MAX_POINTS[key] ?? null;
}
