import { describe, expect, it } from 'vitest';

import { blocksNewCheckout, isFoundingPlanOpenFlag, resolveFoundingCap } from './checkout';
import { DEFAULT_FOUNDING_CAP } from './plans';

describe('blocksNewCheckout (existing-subscription 409 guard)', () => {
  it('blocks new checkout for every non-canceled status', () => {
    for (const status of ['trialing', 'active', 'past_due', 'unpaid']) {
      expect(blocksNewCheckout(status)).toBe(true);
    }
  });

  it('allows a new checkout (reactivation path) when canceled', () => {
    expect(blocksNewCheckout('canceled')).toBe(false);
  });
});

describe('isFoundingPlanOpenFlag', () => {
  it('is closed when the flag row is absent', () => {
    expect(isFoundingPlanOpenFlag(null)).toBe(false);
  });

  it('is closed when the flag value is explicitly false', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: 'false' })).toBe(false);
  });

  it('is open only when the flag value is exactly boolean true', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: 'true' })).toBe(true);
  });

  it('never treats a truthy-but-non-boolean value as open', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: '"true"' })).toBe(false);
    expect(isFoundingPlanOpenFlag({ valueJson: '1' })).toBe(false);
  });
});

describe('resolveFoundingCap', () => {
  it('falls back to the default when the flag row is absent', () => {
    expect(resolveFoundingCap(null)).toBe(DEFAULT_FOUNDING_CAP);
  });

  it('reads a configured integer cap', () => {
    expect(resolveFoundingCap({ valueJson: '5' })).toBe(5);
  });

  it('falls back to the default on a malformed/negative value rather than throwing', () => {
    expect(resolveFoundingCap({ valueJson: '-3' })).toBe(DEFAULT_FOUNDING_CAP);
    expect(resolveFoundingCap({ valueJson: '"not-a-number"' })).toBe(DEFAULT_FOUNDING_CAP);
  });

  it('allows a zero cap (founding fully closed without touching the open flag)', () => {
    expect(resolveFoundingCap({ valueJson: '0' })).toBe(0);
  });
});
