import { describe, expect, it } from 'vitest';

import { D1_MAX_BYTES, D1_SIZE_ALERT_FRACTION, evaluateDbSize } from './health';

// ---------------------------------------------------------------------------
// F-05: D1 storage-capacity alert
// ---------------------------------------------------------------------------

describe('evaluateDbSize', () => {
  it('does not alert well below the threshold', () => {
    const result = evaluateDbSize({ measured: true, approxBytes: 5_000_000 });
    expect(result.alerting).toBe(false);
    expect(result.measured).toBe(true);
    expect(result.limitBytes).toBe(D1_MAX_BYTES);
    expect(result.usedFraction).toBeCloseTo(5_000_000 / D1_MAX_BYTES);
  });

  it('alerts exactly AT the 60% threshold, not only past it', () => {
    const atThreshold = Math.ceil(D1_MAX_BYTES * D1_SIZE_ALERT_FRACTION);
    expect(evaluateDbSize({ measured: true, approxBytes: atThreshold }).alerting).toBe(true);
  });

  it('does not alert just below the threshold', () => {
    const justUnder = Math.floor(D1_MAX_BYTES * D1_SIZE_ALERT_FRACTION) - 1;
    expect(evaluateDbSize({ measured: true, approxBytes: justUnder }).alerting).toBe(false);
  });

  it('alerts above the threshold', () => {
    const result = evaluateDbSize({ measured: true, approxBytes: D1_MAX_BYTES * 0.9 });
    expect(result.alerting).toBe(true);
    expect(result.usedFraction).toBeCloseTo(0.9);
  });

  // An unmeasured estimate must never alert (it would fire constantly and
  // train the operator to ignore it) AND must never look measured-and-fine.
  // The watchdog logs the unmeasured case on its own line instead.
  it('never alerts on an unmeasured estimate, and never fabricates a fraction', () => {
    for (const input of [
      { measured: false, approxBytes: null },
      { measured: false, approxBytes: 123 },
      { measured: true, approxBytes: null },
    ]) {
      const result = evaluateDbSize(input);
      expect(result.alerting).toBe(false);
      expect(result.measured).toBe(false);
      expect(result.usedFraction).toBeNull();
      expect(result.approxBytes).toBeNull();
    }
  });

  it('states the D1 paid-plan ceiling as exactly 10 GiB', () => {
    expect(D1_MAX_BYTES).toBe(10 * 1024 * 1024 * 1024);
  });
});
