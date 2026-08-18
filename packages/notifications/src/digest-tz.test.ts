import { describe, expect, it } from 'vitest';

import { DEFAULT_SEND_HOUR_LOCAL, localDateAndHour } from './digest-orchestration';

describe('localDateAndHour', () => {
  it('splits the same UTC instant into different local dates for Europe/Nicosia vs America/New_York', () => {
    // 2026-08-15T01:00:00Z: 04:00 in Nicosia (UTC+3, same calendar day), still
    // 2026-08-14 21:00 in New York (UTC-4) — a genuinely different local date.
    const utcNow = Date.parse('2026-08-15T01:00:00Z');

    const nicosia = localDateAndHour(utcNow, 'Europe/Nicosia');
    const newYork = localDateAndHour(utcNow, 'America/New_York');

    expect(nicosia.localDate).toBe('2026-08-15');
    expect(nicosia.localHour).toBe(4);
    expect(newYork.localDate).toBe('2026-08-14');
    expect(newYork.localHour).toBe(21);
  });

  it('is usable with Intl.DateTimeFormat timeZone in this runtime (workerd support check)', () => {
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' })).not.toThrow();
  });

  it('DEFAULT_SEND_HOUR_LOCAL matches the documented 06:00 local send hour', () => {
    expect(DEFAULT_SEND_HOUR_LOCAL).toBe(6);
  });

  it('never returns local hour 24 (midnight normalization)', () => {
    // Nicosia midnight local instant: pick a UTC instant that lands exactly
    // on a Nicosia day boundary (UTC+3 in August).
    const utcMidnightNicosia = Date.parse('2026-08-15T21:00:00Z'); // 2026-08-16T00:00 Nicosia
    const result = localDateAndHour(utcMidnightNicosia, 'Europe/Nicosia');
    expect(result.localHour).toBe(0);
    expect(result.localDate).toBe('2026-08-16');
  });
});
