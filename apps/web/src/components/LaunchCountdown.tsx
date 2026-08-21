import { useEffect, useState, type ReactElement } from 'react';

/**
 * Live countdown to the launch instant (owner decision 2026-08-21:
 * "end of August we launch"). Day/hour/minute granularity, ticking once a
 * minute — a seconds counter adds urgency theatre without information.
 * The full launch date is always printed beside the numerals so the
 * countdown is never the only carrier, and a past date degrades to
 * "any moment now" rather than a negative count.
 */

function remainingParts(launchDate: string, now: number): string | null {
  const target = Date.parse(launchDate);
  if (Number.isNaN(target) || target - now <= 0) return null;
  const totalMinutes = Math.floor((target - now) / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${String(days)}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function launchDayLabel(launchDate: string): string {
  const parsed = Date.parse(launchDate);
  if (Number.isNaN(parsed)) return 'end of August';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(parsed);
}

export function LaunchCountdown({ launchDate }: { launchDate: string }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  const remaining = remainingParts(launchDate, now);
  return (
    <span className="launch-countdown">
      <span className="launch-countdown__label">Launching {launchDayLabel(launchDate)}</span>
      <span className="launch-countdown__value num">{remaining ?? 'any moment now'}</span>
    </span>
  );
}
