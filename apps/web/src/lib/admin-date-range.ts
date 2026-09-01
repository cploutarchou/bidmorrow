/**
 * Client-side mirror of the ingestion backfill window validator
 * (apps/worker/src/routes/admin.ts `enumerateDays`/`MAX_BACKFILL_DAYS`):
 * gives the admin immediate feedback before submitting, but the server
 * re-validates independently and is the actual authority (never a security
 * boundary, just UX).
 */
const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRangeValidation {
  readonly valid: boolean;
  readonly dayCount: number;
  readonly error: string | null;
}

export function validateBackfillRange(
  fromDate: string,
  toDate: string,
  maxDays: number,
): DateRangeValidation {
  if (!ISO_DATE_RE.test(fromDate) || !ISO_DATE_RE.test(toDate)) {
    return { valid: false, dayCount: 0, error: 'Dates must be in YYYY-MM-DD format.' };
  }
  const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
  const toMs = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { valid: false, dayCount: 0, error: 'Dates must be valid calendar dates.' };
  }
  if (toMs < fromMs) {
    return { valid: false, dayCount: 0, error: 'End date must not be before start date.' };
  }
  const dayCount = Math.round((toMs - fromMs) / MS_PER_DAY) + 1;
  if (dayCount > maxDays) {
    return {
      valid: false,
      dayCount,
      error: `Range is bounded to ${String(maxDays)} days (requested ${String(dayCount)}).`,
    };
  }
  return { valid: true, dayCount, error: null };
}
