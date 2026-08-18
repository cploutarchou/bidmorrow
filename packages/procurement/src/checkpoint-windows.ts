/**
 * Bounded catch-up windowing: one publication-date DAY per window, advancing
 * from the checkpoint (exclusive) up to yesterday UTC (inclusive), capped at
 * `maxWindows` per run (docs/ted-ingestion-scope.md, ted-ingestion-audit
 * checklist item 2). Today is never ingested — TED's publication feed for
 * "today" is still filling in as the day progresses, so only fully-elapsed
 * UTC days are safe to treat as a closed window.
 */
import type { PublicationWindow } from './scope';

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): string {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got "${value}"`);
  }
  return value;
}

/** `YYYY-MM-DD` of `nowMs` in UTC. */
export function todayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of the UTC day before `nowMs`'s UTC day. */
export function yesterdayUtc(nowMs: number): string {
  return nextIsoDate(todayUtc(nowMs), -1);
}

/** Adds `deltaDays` (may be negative) whole UTC days to a `YYYY-MM-DD` date. */
export function nextIsoDate(date: string, deltaDays = 1): string {
  assertIsoDate(date, 'date');
  const ms = Date.parse(`${date}T00:00:00Z`) + deltaDays * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Computes at most `maxWindows` single-day publication windows to process
 * this run, starting the day after `lastCheckpointDate` (or yesterday, for a
 * source with no checkpoint yet — no historic backfill on first run) up
 * through yesterday UTC. Returns an empty array once fully caught up.
 */
export function computeCatchUpWindows(
  lastCheckpointDate: string | null,
  nowMs: number,
  maxWindows: number,
): PublicationWindow[] {
  if (maxWindows <= 0) {
    return [];
  }
  const cutoff = yesterdayUtc(nowMs);
  const start = lastCheckpointDate === null ? cutoff : nextIsoDate(lastCheckpointDate, 1);
  if (start > cutoff) {
    return [];
  }

  const windows: PublicationWindow[] = [];
  let day = start;
  while (day <= cutoff && windows.length < maxWindows) {
    windows.push({ windowFrom: day, windowTo: day });
    day = nextIsoDate(day, 1);
  }
  return windows;
}
